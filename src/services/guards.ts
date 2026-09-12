import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { shouldStampTestData } from './settings';
import type { BufferGuard, Guard } from '../types';

/**
 * The shared "identity" fields Guard Bank and Duty Roster both need for a guard — everything
 * except Guard Bank's own status/assignment/dismissal bookkeeping. Mirrors the guard object
 * openAddGuardModal() builds in public/duty-roster/index.html, minus the site-only `position`
 * field (a pool guard has no site yet to hold a position on).
 */
export interface GuardIdentityInput {
  name: string;
  employeeId: string;
  category: 'local' | 'nepal';
  age?: number;
  state?: string;
  city?: string;
  passportNumber?: string;
  permitExpiryDate?: string;
  mykadNumber?: string;
  phoneNumber?: string;
}

export interface SitePickerOption {
  id: string;
  name: string;
  branch: string | null;
  /** The tender this site is linked to, if any — used to resolve which client brand a guard
   *  deployed here should be filed under (see resolveBrandForTender()). */
  tenderId: string | null;
}

function guardsCollection() {
  return collection(db, 'guards');
}

function bufferGuardsCollection() {
  return collection(db, 'bufferGuards');
}

/** True if a guard with this employeeId already exists anywhere in Guard Bank (any status). */
async function findByEmployeeId(employeeId: string) {
  const snap = await getDocs(query(guardsCollection(), where('employeeId', '==', employeeId), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<Guard, 'id'>) };
}

/**
 * Best-effort lookup of a tender's client brand, for denormalizing onto a deployed guard (see
 * Guard.brandId/brandName's doc comment in types.ts). Swallows its own errors — a caller without
 * read access to this particular tender (firestore.rules scopes tender reads by ownership/
 * department/stage) just gets nulls back rather than the whole assign/sync failing.
 */
async function resolveBrandForTender(tenderId: string | null | undefined): Promise<{ brandId: string | null; brandName: string | null }> {
  if (!tenderId) return { brandId: null, brandName: null };
  try {
    const snap = await getDoc(doc(db, 'tenders', tenderId));
    if (!snap.exists()) return { brandId: null, brandName: null };
    const data = snap.data() as { brandId?: string; brandName?: string };
    return { brandId: data.brandId ?? null, brandName: data.brandName ?? null };
  } catch {
    return { brandId: null, brandName: null };
  }
}

/**
 * Registers a brand-new guard directly into the Guard Pool (status 'pool', no site). This is
 * Guard Bank's own entry point — separate from Duty Roster's "+ Add guard", which registers (or
 * matches) a guard AND deploys them to a site in one step. Throws if the employeeId is already
 * in use anywhere in Guard Bank, so the two entry points never silently create duplicate guards.
 */
export async function registerGuard(input: GuardIdentityInput): Promise<string> {
  const existing = await findByEmployeeId(input.employeeId);
  if (existing) {
    throw new Error(
      `Employee ID ${input.employeeId} is already registered (${existing.name}, currently ${existing.status}).`
    );
  }
  const now = Date.now();
  // See Guard.isTestData's doc comment in types.ts — see shouldStampTestData()'s doc comment
  // in services/settings.ts for why this isn't just the global Testing Mode toggle.
  const isTestData = await shouldStampTestData();
  const ref = await addDoc(guardsCollection(), {
    name: input.name,
    employeeId: input.employeeId,
    category: input.category,
    age: input.age ?? null,
    state: input.state ?? null,
    city: input.city ?? null,
    passportNumber: input.passportNumber ?? null,
    permitExpiryDate: input.permitExpiryDate ?? null,
    mykadNumber: input.mykadNumber ?? null,
    phoneNumber: input.phoneNumber ?? null,
    status: 'pool',
    siteId: null,
    siteName: null,
    branch: null,
    brandId: null,
    brandName: null,
    dismissalReason: null,
    dismissedAt: null,
    isTestData,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

/** Fields Guard Bank's own "+ Register buffer guard" entry point collects. */
export interface BufferGuardIdentityInput {
  name: string;
  rate: number;
  mykadNumber?: string;
  age?: number;
  phoneNumber?: string;
  state?: string;
  city?: string;
}

/**
 * Guard Bank's own manual entry point for Buffer Guards — separate from Duty Roster's temp-guard
 * assignment flow (syncBufferGuardOnAssign() in public/duty-roster/index.html), which creates or
 * updates a bufferGuards record automatically whenever a relief guard actually covers a shift.
 * Mirrors what registerGuard() does for the Guard Pool: lets an admin add someone to the roster
 * up front, before they've ever covered a shift. Throws if a buffer guard with the same
 * name+MyKad already exists — the exact dedupe key syncBufferGuardOnAssign() uses — so the two
 * entry points never end up creating two records for the same person. A guard registered this
 * way starts at timesUsed: 0; that only climbs once Duty Roster actually assigns them.
 */
export async function registerBufferGuard(input: BufferGuardIdentityInput): Promise<string> {
  const name = input.name;
  const mykadNumber = input.mykadNumber ?? null;
  const existingSnap = await getDocs(
    query(bufferGuardsCollection(), where('name', '==', name), where('mykadNumber', '==', mykadNumber), limit(1))
  );
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0].data() as Omit<BufferGuard, 'id'>;
    throw new Error(
      `${name} is already on the Buffer Guards list (used ${existing.timesUsed} time${existing.timesUsed === 1 ? '' : 's'}).`
    );
  }
  const now = Date.now();
  // See BufferGuard.isTestData's doc comment in types.ts — see shouldStampTestData()'s doc
  // comment in services/settings.ts for why this isn't just the global Testing Mode toggle.
  const isTestData = await shouldStampTestData();
  const ref = await addDoc(bufferGuardsCollection(), {
    name,
    rate: input.rate,
    mykadNumber,
    age: input.age ?? null,
    phoneNumber: input.phoneNumber ?? null,
    state: input.state ?? null,
    city: input.city ?? null,
    lastSiteName: null,
    lastBranch: null,
    firstUsedAt: now,
    lastUsedAt: now,
    timesUsed: 0,
    isTestData,
  });
  return ref.id;
}

/**
 * Assigns a Guard Pool guard to a client site/branch — moves them to 'deployed' in Guard Bank
 * AND pushes a matching guard row into that site's own roster (public/duty-roster/index.html's
 * `sites/{siteId}.guards[]`), so they show up there immediately without anyone re-entering their
 * details a second time. The reverse direction (Duty Roster -> Guard Bank) is handled entirely
 * inside index.html itself — see the doc comment above the `guards` collection in firestore.rules.
 */
export async function assignGuardToSite(guard: Guard, site: SitePickerOption): Promise<void> {
  const brand = await resolveBrandForTender(site.tenderId);
  const rosterGuard: Record<string, unknown> = {
    id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: guard.name,
    employeeId: guard.employeeId,
    active: true,
    inactiveFrom: null,
    category: guard.category,
    age: guard.age ?? null,
    state: guard.state ?? null,
    city: guard.city ?? null,
  };
  if (guard.category === 'nepal') {
    rosterGuard.passportNumber = guard.passportNumber ?? '';
    rosterGuard.permitExpiryDate = guard.permitExpiryDate ?? '';
  } else {
    rosterGuard.mykadNumber = guard.mykadNumber ?? '';
    rosterGuard.phoneNumber = guard.phoneNumber ?? '';
  }

  await updateDoc(doc(db, 'sites', site.id), {
    guards: arrayUnion(rosterGuard),
    isSample: false,
    updatedAt: new Date().toISOString(),
  });

  await updateDoc(doc(db, 'guards', guard.id), {
    status: 'deployed',
    siteId: site.id,
    siteName: site.name,
    branch: site.branch,
    brandId: brand.brandId,
    brandName: brand.brandName,
    dismissalReason: null,
    dismissedAt: null,
    updatedAt: Date.now(),
  });
}

/**
 * Returns every currently-deployed guard at this site back to the Guard Pool (status 'pool', with
 * siteId/siteName/branch/brandId/brandName cleared — the same shape a freshly-registered pool
 * guard has). Called whenever a site is archived because the project it belongs to is ending
 * (see setLinkedSitesArchived() in services/tenders.ts, invoked from closeOutProject() and
 * deleteTender()) — a guard's deployment shouldn't outlive the project they were assigned to, so
 * they're released for reassignment elsewhere instead of sitting "deployed" against a site that's
 * no longer active.
 *
 * Deliberately filtered to status == 'deployed' only: a DISMISSED guard also keeps their old
 * siteId (see Guard.siteId's doc comment — kept so the Dismissed tab can still be filtered by
 * where they last worked), and this must never resurrect one back to 'pool' just because that
 * old site closed. Best-effort — swallows its own errors so a permissions hiccup here never
 * blocks the close-out/delete action itself, same spirit as setLinkedSitesArchived()'s own
 * best-effort site archiving.
 */
export async function releaseGuardsFromSite(siteId: string): Promise<void> {
  try {
    const snap = await getDocs(
      query(guardsCollection(), where('siteId', '==', siteId), where('status', '==', 'deployed'))
    );
    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(d.ref, {
          status: 'pool',
          siteId: null,
          siteName: null,
          branch: null,
          brandId: null,
          brandName: null,
          updatedAt: Date.now(),
        })
      )
    );
  } catch {
    // Best-effort — see doc comment above.
  }
}

/**
 * Trailing-12-month turnover: (guards dismissed in the last 12 months) / (average active
 * headcount over that same window) * 100 — the formula confirmed for this feature. Guard Bank
 * has no historical headcount snapshots, so "active at a past moment" is approximated from each
 * guard's own createdAt/dismissedAt: a guard counts as active at the period's start if they
 * existed before it began and either aren't dismissed or were dismissed after it began. Average
 * headcount is the mean of the start-of-period and end-of-period (today) counts, the standard
 * approximation when only two headcount points are available.
 */
export function computeGuardTurnover(guards: Guard[], asOf: number = Date.now()) {
  const periodStart = asOf - 365 * 24 * 60 * 60 * 1000;
  const activeNow = guards.filter((g) => g.status === 'deployed').length;
  const activeAtStart = guards.filter(
    (g) =>
      g.createdAt <= periodStart &&
      (g.status !== 'dismissed' || (g.dismissedAt != null && g.dismissedAt > periodStart))
  ).length;
  const dismissedLast12mo = guards.filter(
    (g) => g.status === 'dismissed' && g.dismissedAt != null && g.dismissedAt > periodStart
  ).length;
  const avgHeadcount = (activeNow + activeAtStart) / 2;
  const rate = avgHeadcount > 0 ? (dismissedLast12mo / avgHeadcount) * 100 : 0;
  return { rate, dismissedLast12mo, avgHeadcount, activeNow, activeAtStart };
}

/** Guards (Nepal category, not dismissed) whose work permit expires within the given window. */
export function guardsWithPermitExpiringSoon(guards: Guard[], withinDays = 60, asOf: number = Date.now()) {
  const cutoff = asOf + withinDays * 24 * 60 * 60 * 1000;
  return guards.filter((g) => {
    if (g.status === 'dismissed' || g.category !== 'nepal' || !g.permitExpiryDate) return false;
    const expiry = new Date(`${g.permitExpiryDate}T12:00:00`).getTime();
    return Number.isFinite(expiry) && expiry <= cutoff;
  });
}

/**
 * Updates a Nepal-category guard's work permit expiry date after a renewal — the one field on a
 * Guard Bank record that's expected to change after registration (everything else is corrected
 * by re-registering/dismissing+re-adding). Used by the "Update" control on the Permit expiry
 * date row in GuardDetailsModal; feeds the same guardsWithPermitExpiringSoon() check the Permit
 * expiring tile and its "Go to list" shortcut use, so a renewal here clears the guard from that
 * tile immediately.
 */
export async function updateGuardPermitExpiry(id: string, permitExpiryDate: string): Promise<void> {
  await updateDoc(doc(db, 'guards', id), { permitExpiryDate, updatedAt: Date.now() });
}

/**
 * Permanently removes a Guard Pool record — e.g. a duplicate registration, or someone added by
 * mistake who was never actually deployed. Admin-only (see the Remove button in
 * GuardBankPage.tsx and the matching /guards delete rule in firestore.rules) and only ever
 * offered from the Guard Pool tab: a Deployed guard needs releasing back to the pool first (see
 * releaseGuardsFromSite()) so no site is left referencing a guard id that no longer exists, and
 * a Dismissed guard goes through archiveDismissedGuard() below instead, which keeps the record
 * (and its dismissedAt) so turnover reporting stays accurate.
 */
export async function removeGuard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'guards', id));
}

/**
 * Hides a Dismissed guard from the Dismissed Guards list without deleting their record —
 * admin-only (see the Archive button in GuardBankPage.tsx and the matching /guards update rule
 * in firestore.rules), and deliberately NOT a delete: computeGuardTurnover()'s trailing-12-month
 * rate reads dismissedAt off every guard ever dismissed, so removing the record itself would
 * silently understate turnover the moment an old dismissal is tidied away. Cleared automatically
 * if Duty Roster later reactivates this guard (see backfillGuardsFromDutyRoster() below).
 */
export async function archiveDismissedGuard(id: string): Promise<void> {
  await updateDoc(doc(db, 'guards', id), { archivedAt: Date.now() });
}

/** Manual contact-detail edit for a Buffer Guard row (the only edit Guard Bank offers there). */
export async function updateBufferGuardContact(
  id: string,
  patch: Partial<{ phoneNumber: string; state: string; city: string }>
): Promise<void> {
  await updateDoc(doc(db, 'bufferGuards', id), patch);
}

/**
 * Permanently removes a Buffer Guard record — e.g. someone who's no longer available for relief
 * work, or a record added by mistake. Irreversible: unlike a guard's Guard Pool/Deployed/
 * Dismissed lifecycle (which just moves them between states), Buffer Guards has no "dismissed"
 * status to fall back on, so the row disappears entirely. If they cover a shift again later,
 * syncBufferGuardOnAssign() in public/duty-roster/index.html will simply create a fresh record —
 * their timesUsed history here is not preserved.
 */
export async function removeBufferGuard(id: string): Promise<void> {
  await deleteDoc(doc(db, 'bufferGuards', id));
}

export interface BackfillResult {
  sitesScanned: number;
  guardsScanned: number;
  created: number;
  updated: number;
  skippedNoEmployeeId: number;
}

/**
 * Reconciliation sync, meant to be run anytime (not just once): matches-or-creates every guard
 * from every site's own `guards[]` array (the same data Duty Roster itself reads) into Guard
 * Bank by employeeId — identical to what the live per-action sync in
 * public/duty-roster/index.html does on its own, just swept across the whole firm in one pass
 * instead of triggered by a single add/dismiss/reactivate click. Two reasons this is worth
 * keeping around as a standing "Refresh" action rather than a one-off migration step: it's what
 * catches guards that were already in a site's roster before Guard Bank existed, AND it's the
 * recovery path if one of those live per-action syncs ever silently fails (they're all
 * best-effort and swallow their own errors, by design, so a dropped call there leaves no other
 * trace). Fully idempotent — re-running it just re-confirms data that's already correct.
 *
 * Two honesty notes about the result, both because a guard synced here for the first time
 * carries no real history:
 * - `createdAt` is set to "now" for anyone newly created by this backfill, so the trailing-12-
 *   month turnover's "active at start of period" estimate will undercount them until enough real
 *   time passes — there's no historical join date to recover this from.
 * - A guard whose roster entry has `active: false` (Duty Roster's old un-reasoned inactive flag)
 *   comes in as 'dismissed' with `dismissalReason` and `dismissedAt` left null — we genuinely
 *   don't know why or when, and guessing "today" would artificially inflate the turnover rate's
 *   trailing-12-month numerator. The Dismissed Guards count itself is unaffected either way.
 */
export async function backfillGuardsFromDutyRoster(): Promise<BackfillResult> {
  const sitesSnap = await getDocs(collection(db, 'sites'));
  const result: BackfillResult = {
    sitesScanned: sitesSnap.docs.length,
    guardsScanned: 0,
    created: 0,
    updated: 0,
    skippedNoEmployeeId: 0,
  };
  const now = Date.now();

  // One tender lookup per SITE (not per guard) — every guard at the same site shares the same
  // brand, so this avoids re-reading the same tender doc once per guard on a busy site.
  const brandCache = new Map<string, { brandId: string | null; brandName: string | null }>();

  for (const siteDoc of sitesSnap.docs) {
    const site = siteDoc.data() as {
      name?: string;
      branch?: string | null;
      tenderId?: string | null;
      guards?: Record<string, unknown>[];
    };
    const rosterGuards = Array.isArray(site.guards) ? site.guards : [];
    if (rosterGuards.length === 0) continue;

    if (!brandCache.has(siteDoc.id)) {
      brandCache.set(siteDoc.id, await resolveBrandForTender(site.tenderId));
    }
    const brand = brandCache.get(siteDoc.id)!;

    for (const g of rosterGuards) {
      result.guardsScanned += 1;
      const employeeId = typeof g.employeeId === 'string' ? g.employeeId : '';
      if (!employeeId) {
        result.skippedNoEmployeeId += 1;
        continue;
      }
      const dismissed = g.active === false;
      const category = g.category === 'nepal' ? 'nepal' : 'local';
      const payload: Record<string, unknown> = {
        name: g.name ?? '',
        employeeId,
        category,
        age: (g.age as number | undefined) ?? null,
        state: (g.state as string | undefined) ?? null,
        city: (g.city as string | undefined) ?? null,
        passportNumber: category === 'nepal' ? (g.passportNumber as string | undefined) ?? null : null,
        permitExpiryDate: category === 'nepal' ? (g.permitExpiryDate as string | undefined) ?? null : null,
        mykadNumber: category === 'local' ? (g.mykadNumber as string | undefined) ?? null : null,
        phoneNumber: category === 'local' ? (g.phoneNumber as string | undefined) ?? null : null,
        status: dismissed ? 'dismissed' : 'deployed',
        siteId: siteDoc.id,
        siteName: site.name || null,
        branch: site.branch ?? null,
        brandId: brand.brandId,
        brandName: brand.brandName,
        updatedAt: now,
      };
      // Neither branch knows a real reason/date (see the doc comment above), so both leave
      // these null rather than guess.
      payload.dismissalReason = null;
      payload.dismissedAt = null;
      // A guard who's back on the live roster is no longer "dismissed" at all, so any earlier
      // admin Archive (see archiveDismissedGuard() below) no longer applies either — clear it
      // the same way, rather than leaving a stale archivedAt on what's now an active guard.
      payload.archivedAt = null;

      const existing = await findByEmployeeId(employeeId);
      if (existing) {
        await updateDoc(doc(db, 'guards', existing.id), payload);
        result.updated += 1;
      } else {
        await addDoc(guardsCollection(), { ...payload, createdAt: now });
        result.created += 1;
      }
    }
  }

  return result;
}
