import { collection, deleteDoc, getDocs, query, updateDoc, where, type DocumentReference } from 'firebase/firestore';
import { db } from '../firebase';

export interface TestDataResetResult {
  tenders: number;
  history: number;
  sites: number;
  months: number;
  guards: number;
  bufferGuards: number;
  invoices: number;
  guardsReleased: number;
}

export interface TestDataCounts {
  tenders: number;
  sites: number;
  guards: number;
  bufferGuards: number;
  invoices: number;
}

/**
 * Live counts of everything currently tagged isTestData:true, for the confirmation prompt in
 * TestingDataTool.tsx's "Delete all test data" button — a fresh read at the moment the button is
 * clicked, rather than trusting whatever the page's own onSnapshot listeners last rendered,
 * since a stale count here would understate exactly what's about to be permanently deleted.
 */
export async function getTestDataCounts(): Promise<TestDataCounts> {
  const [tendersSnap, sitesSnap, guardsSnap, bufferSnap, invoicesSnap] = await Promise.all([
    getDocs(query(collection(db, 'tenders'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'sites'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'guards'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'bufferGuards'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'invoices'), where('isTestData', '==', true))),
  ]);
  return {
    tenders: tendersSnap.docs.length,
    sites: sitesSnap.docs.length,
    guards: guardsSnap.docs.length,
    bufferGuards: bufferSnap.docs.length,
    invoices: invoicesSnap.docs.length,
  };
}

interface OpFailure {
  path: string;
  message: string;
}

/**
 * Wraps a single read so a permission denial names exactly which read it was — resetTestData()'s
 * upfront reads (the counts + the per-site guard/months lookups) run before any delete and
 * aren't covered by deleteEach()'s per-document failure collection, so an unlabeled denial here
 * used to surface as a bare, unhelpful "Missing or insufficient permissions." with no indication
 * of which of the ~7 reads actually caused it.
 */
async function taggedRead<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    e.message = `[reading ${label}] ${e.message}`;
    throw e;
  }
}

/**
 * Deletes each document one at a time (a plain deleteDoc() per document) instead of batching
 * them into a writeBatch. Two reasons, in order of how this was actually found:
 *
 * 1. A batched write's security-rule evaluation is capped at 20 total get()/exists() calls
 *    across ALL its operations combined (see
 *    https://firebase.google.com/docs/firestore/security/rules-conditions) — several of the
 *    rules this purge relies on (isAdmin()/isDeveloper()/canReachSite()) call get(). A first fix
 *    just shrank the batch size to stay under that cap — but "Delete all test data" kept failing
 *    with the same generic "Missing or insufficient permissions." even after that shipped, which
 *    means either the real cap wasn't the (only) problem, or some other rule denial was hiding
 *    behind the same one-size-fails-all batch error the whole time.
 * 2. That's the deeper reason to go one-at-a-time regardless: a writeBatch commit fails or
 *    succeeds as a single all-or-nothing unit with ONE error for the whole thing — there is no
 *    way to tell, from a failed batch, which specific document among dozens was actually denied.
 *    Individual deleteDoc() calls each get their own success/failure, so a denial now names the
 *    exact collection/document path it happened on instead of a dead end.
 */
async function deleteEach(refs: DocumentReference[], failures: OpFailure[]): Promise<number> {
  let succeeded = 0;
  for (const ref of refs) {
    try {
      await deleteDoc(ref);
      succeeded++;
    } catch (err) {
      failures.push({ path: ref.path, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return succeeded;
}

function throwIfAny(failures: OpFailure[]): void {
  if (failures.length === 0) return;
  const shown = failures.slice(0, 6).map((f) => `${f.path} — ${f.message}`);
  const more = failures.length > 6 ? [`…and ${failures.length - 6} more`] : [];
  throw new Error(
    `${failures.length} of the operations were denied (everything else was deleted):\n${[...shown, ...more].join('\n')}`
  );
}

/**
 * Admin-only (enforced by firestore.rules on every collection touched here) — the in-app
 * equivalent of `node scripts/purge-test-data.mjs --test-data`, called from
 * TestingDataTool.tsx's "Delete all test data" button instead of a terminal. Deletes everything
 * tagged isTestData:true across tenders (+ their `history` subcollection, which Firestore never
 * cascade-deletes on its own), sites (+ their `months` subcollection, same story), guards, and
 * buffer guards. Releases any REAL (non-test) guard still deployed at a purged site back to the
 * Guard Pool first (mirrors releaseGuardsFromSite() in services/guards.ts), so nothing real ends
 * up pointing at a site that's about to disappear. Mirrors that script's logic exactly — see its
 * own doc comment for the full reasoning behind each of these steps — just running from the
 * signed-in admin's own browser session instead of a separate terminal sign-in.
 */
export async function resetTestData(): Promise<TestDataResetResult> {
  const [tendersSnap, sitesSnap, guardsSnap, bufferSnap, invoicesSnap] = await Promise.all([
    taggedRead('tenders (isTestData query)', getDocs(query(collection(db, 'tenders'), where('isTestData', '==', true)))),
    taggedRead('sites (isTestData query)', getDocs(query(collection(db, 'sites'), where('isTestData', '==', true)))),
    taggedRead('guards (isTestData query)', getDocs(query(collection(db, 'guards'), where('isTestData', '==', true)))),
    taggedRead('bufferGuards (isTestData query)', getDocs(query(collection(db, 'bufferGuards'), where('isTestData', '==', true)))),
    // Deliberately does NOT also touch /invoiceCounters — a counter is shared per
    // brand+branch+client, and if any REAL (non-test) invoice still uses that exact combination,
    // resetting its running number back down risks a future real invoice reusing a number that
    // real one already has. The cost of leaving a test-only counter's lastNumber sitting unused
    // forever is purely cosmetic (a gap in a sequence nobody prints); a duplicate invoice number
    // is not.
    taggedRead('invoices (isTestData query)', getDocs(query(collection(db, 'invoices'), where('isTestData', '==', true)))),
  ]);

  const testTenderIds = new Set(tendersSnap.docs.map((d) => d.id));

  // Each test tender's own `history` subcollection, read directly — NOT via a database-wide
  // collectionGroup('history') query like this used to. That was the actual root cause of every
  // "Delete all test data" permission denial: Firestore only authorizes a collectionGroup query
  // when a security rule can be proven to hold for EVERY 'history' subcollection anywhere in the
  // database, not just the ones nested under tenders, so a rule scoped to
  // `/tenders/{tenderId}/history/{historyId}` (which is otherwise exactly correct) doesn't cover
  // it and Firestore denies the whole read outright — see useTenderHistory.ts's doc comment,
  // which already hit and fixed this exact issue for the trend-chart read path. This was never a
  // batching or get()-call-limit problem; those fixes were real improvements but this collectionGroup
  // read was denied before any delete — or any batch — ever ran.
  const historyDocsToDelete: DocumentReference[] = [];
  for (const tenderId of testTenderIds) {
    const historySnap = await taggedRead(
      `tenders/${tenderId}/history`,
      getDocs(collection(db, 'tenders', tenderId, 'history'))
    );
    historyDocsToDelete.push(...historySnap.docs.map((d) => d.ref));
  }

  const testGuardIds = new Set(guardsSnap.docs.map((d) => d.id));
  const guardsToRelease: DocumentReference[] = [];
  const monthDocsToDelete: DocumentReference[] = [];
  for (const siteDoc of sitesSnap.docs) {
    const deployedSnap = await taggedRead(
      `guards deployed at site ${siteDoc.id}`,
      getDocs(query(collection(db, 'guards'), where('siteId', '==', siteDoc.id), where('status', '==', 'deployed')))
    );
    for (const gd of deployedSnap.docs) {
      if (!testGuardIds.has(gd.id)) guardsToRelease.push(gd.ref);
    }
    const monthsSnap = await taggedRead(
      `sites/${siteDoc.id}/months`,
      getDocs(collection(db, 'sites', siteDoc.id, 'months'))
    );
    monthDocsToDelete.push(...monthsSnap.docs.map((d) => d.ref));
  }

  const failures: OpFailure[] = [];

  // Release real guards first, before their site disappears underneath them.
  for (const ref of guardsToRelease) {
    try {
      await updateDoc(ref, {
        status: 'pool',
        siteId: null,
        siteName: null,
        branch: null,
        brandId: null,
        brandName: null,
        updatedAt: Date.now(),
      });
    } catch (err) {
      failures.push({ path: ref.path, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const historyDeleted = await deleteEach(historyDocsToDelete, failures);
  const monthsDeleted = await deleteEach(monthDocsToDelete, failures);
  const tendersDeleted = await deleteEach(
    tendersSnap.docs.map((d) => d.ref),
    failures
  );
  const sitesDeleted = await deleteEach(
    sitesSnap.docs.map((d) => d.ref),
    failures
  );
  const guardsDeleted = await deleteEach(
    guardsSnap.docs.map((d) => d.ref),
    failures
  );
  const bufferDeleted = await deleteEach(
    bufferSnap.docs.map((d) => d.ref),
    failures
  );
  const invoicesDeleted = await deleteEach(
    invoicesSnap.docs.map((d) => d.ref),
    failures
  );

  throwIfAny(failures);

  return {
    tenders: tendersDeleted,
    history: historyDeleted,
    sites: sitesDeleted,
    months: monthsDeleted,
    guards: guardsDeleted,
    bufferGuards: bufferDeleted,
    invoices: invoicesDeleted,
    guardsReleased: guardsToRelease.length,
  };
}
