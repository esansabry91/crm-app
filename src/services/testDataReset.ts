import { collection, collectionGroup, getDocs, query, where, writeBatch, type DocumentReference } from 'firebase/firestore';
import { db } from '../firebase';

export interface TestDataResetResult {
  tenders: number;
  history: number;
  sites: number;
  months: number;
  guards: number;
  bufferGuards: number;
  guardsReleased: number;
}

export interface TestDataCounts {
  tenders: number;
  sites: number;
  guards: number;
  bufferGuards: number;
}

/**
 * Live counts of everything currently tagged isTestData:true, for the confirmation prompt in
 * TestingDataTool.tsx's "Delete all test data" button — a fresh read at the moment the button is
 * clicked, rather than trusting whatever the page's own onSnapshot listeners last rendered,
 * since a stale count here would understate exactly what's about to be permanently deleted.
 */
export async function getTestDataCounts(): Promise<TestDataCounts> {
  const [tendersSnap, sitesSnap, guardsSnap, bufferSnap] = await Promise.all([
    getDocs(query(collection(db, 'tenders'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'sites'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'guards'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'bufferGuards'), where('isTestData', '==', true))),
  ]);
  return {
    tenders: tendersSnap.docs.length,
    sites: sitesSnap.docs.length,
    guards: guardsSnap.docs.length,
    bufferGuards: bufferSnap.docs.length,
  };
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
  const [tendersSnap, sitesSnap, guardsSnap, bufferSnap, historySnapAll] = await Promise.all([
    getDocs(query(collection(db, 'tenders'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'sites'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'guards'), where('isTestData', '==', true))),
    getDocs(query(collection(db, 'bufferGuards'), where('isTestData', '==', true))),
    getDocs(collectionGroup(db, 'history')),
  ]);

  const testTenderIds = new Set(tendersSnap.docs.map((d) => d.id));
  const historyDocsToDelete = historySnapAll.docs.filter((d) =>
    testTenderIds.has((d.data() as { tenderId?: string }).tenderId || '')
  );

  const testGuardIds = new Set(guardsSnap.docs.map((d) => d.id));
  const guardsToRelease: DocumentReference[] = [];
  const monthDocsToDelete: DocumentReference[] = [];
  for (const siteDoc of sitesSnap.docs) {
    const deployedSnap = await getDocs(
      query(collection(db, 'guards'), where('siteId', '==', siteDoc.id), where('status', '==', 'deployed'))
    );
    for (const gd of deployedSnap.docs) {
      if (!testGuardIds.has(gd.id)) guardsToRelease.push(gd.ref);
    }
    const monthsSnap = await getDocs(collection(db, 'sites', siteDoc.id, 'months'));
    monthDocsToDelete.push(...monthsSnap.docs.map((d) => d.ref));
  }

  // Release real guards first, before their site disappears underneath them.
  if (guardsToRelease.length > 0) {
    let releaseBatch = writeBatch(db);
    let count = 0;
    for (const ref of guardsToRelease) {
      releaseBatch.update(ref, {
        status: 'pool',
        siteId: null,
        siteName: null,
        branch: null,
        brandId: null,
        brandName: null,
        updatedAt: Date.now(),
      });
      count++;
      if (count === 400) {
        await releaseBatch.commit();
        releaseBatch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await releaseBatch.commit();
  }

  const refsToDelete: DocumentReference[] = [
    ...historyDocsToDelete.map((d) => d.ref),
    ...tendersSnap.docs.map((d) => d.ref),
    ...monthDocsToDelete,
    ...sitesSnap.docs.map((d) => d.ref),
    ...guardsSnap.docs.map((d) => d.ref),
    ...bufferSnap.docs.map((d) => d.ref),
  ];

  let batch = writeBatch(db);
  let opCount = 0;
  for (const ref of refsToDelete) {
    batch.delete(ref);
    opCount++;
    if (opCount === 400) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();

  return {
    tenders: tendersSnap.docs.length,
    history: historyDocsToDelete.length,
    sites: sitesSnap.docs.length,
    months: monthDocsToDelete.length,
    guards: guardsSnap.docs.length,
    bufferGuards: bufferSnap.docs.length,
    guardsReleased: guardsToRelease.length,
  };
}
