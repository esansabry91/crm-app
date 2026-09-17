/**
 * Guard Bank & Buffer Guard sync (cross-collection, best-effort, one-directional) — ported from
 * public/duty-roster/index.html lines ~6150-6342 (excluding the two DOM-bound temp-guard-form
 * lookup helpers, scheduleTempGuardMatchLookup()/lookupBufferGuardForTempForm(), which belong in
 * the Adjustments tab component instead since they read form fields directly).
 *
 * This console owns the day-to-day guard roster (per-site `sites/{id}.guards[]` and
 * `sites/{id}.months/{key}.tempGuards{}`); the top-level `guards`/`bufferGuards` collections
 * mirror that into a firm-wide view for the Guard Bank page (src/pages/GuardBankPage.tsx). Sync
 * only ever flows OUT of here — Guard Bank's own "Assign to site" writes straight into
 * `sites/{id}.guards[]` itself (see assignGuardToSite() in src/services/guards.ts), so the two
 * sides never fight over the same write. Every function below swallows its own errors: a Guard
 * Bank sync failure must never block or roll back the roster edit that triggered it — callers
 * should fire-and-forget these (they intentionally don't throw).
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Guard } from "./types";

export interface SiteMeta {
  id: string;
  name: string | null;
  branch: string | null;
  tenderId?: string | null;
}

async function guardBankMatchByEmployeeId(employeeId: string | null | undefined) {
  if (!employeeId) return null;
  try {
    const snap = await getDocs(query(collection(db, "guards"), where("employeeId", "==", employeeId), limit(1)));
    return snap.empty ? null : snap.docs[0];
  } catch {
    return null;
  }
}

/** Best-effort lookup of a tender's client brand, so a deployed/dismissed guard's Guard Bank
 * record can be filtered by brand (see Guard.brandId/brandName's doc comment in src/types.ts).
 * A site with no linked tender, or a caller without read access to it, just gets nulls back —
 * this never blocks the guard sync it's part of. */
async function guardBankResolveBrand(tenderId: string | null | undefined) {
  if (!tenderId) return { brandId: null as string | null, brandName: null as string | null };
  try {
    const snap = await getDoc(doc(db, "tenders", tenderId));
    const data = snap.exists() ? snap.data() : null;
    return { brandId: (data && data.brandId) || null, brandName: (data && data.brandName) || null };
  } catch {
    return { brandId: null as string | null, brandName: null as string | null };
  }
}

function guardBankIdentityFields(g: Pick<Guard, "name" | "employeeId" | "category" | "age" | "state" | "city" | "passportNumber" | "permitExpiryDate" | "mykadNumber" | "phoneNumber">) {
  const out: Record<string, unknown> = {
    name: g.name,
    employeeId: g.employeeId || "",
    category: g.category || "local",
    age: g.age != null ? g.age : null,
    state: g.state || null,
    city: g.city || null,
  };
  if (g.category === "nepal") {
    out.passportNumber = g.passportNumber || null;
    out.permitExpiryDate = g.permitExpiryDate || null;
    out.mykadNumber = null;
    out.phoneNumber = null;
  } else {
    out.mykadNumber = g.mykadNumber || null;
    out.phoneNumber = g.phoneNumber || null;
    out.passportNumber = null;
    out.permitExpiryDate = null;
  }
  return out;
}

/** Fires whenever "+ Add guard" adds someone — matches-or-creates them in Guard Bank as Deployed
 * to this site: "whenever guard being added directly in duty roster, if the details already
 * existed in the guard bank, it still can be proceed to add, but then that particular guard will
 * be automatically sync and moved to deployed." Fire-and-forget; never throws. */
export function syncGuardBankOnAdd(g: Guard, site: SiteMeta, isTestData: boolean): void {
  if (!g.employeeId) return;
  const now = Date.now();
  Promise.all([guardBankMatchByEmployeeId(g.employeeId), guardBankResolveBrand(site.tenderId)])
    .then(([existingDoc, brand]) => {
      const payload = {
        ...guardBankIdentityFields(g),
        status: "deployed",
        siteId: site.id,
        siteName: site.name || null,
        branch: site.branch || null,
        brandId: brand.brandId,
        brandName: brand.brandName,
        dismissalReason: null,
        dismissedAt: null,
        updatedAt: now,
      };
      if (existingDoc) {
        return setDoc(existingDoc.ref, payload, { merge: true }).catch(() => {});
      }
      return addDoc(collection(db, "guards"), { ...payload, createdAt: now, isTestData }).catch(() => {});
    })
    .catch(() => {});
}

/** Fires from the Dismiss modal — the ONLY place a guard's Guard Bank status ever becomes
 * "dismissed" (Guard Bank itself has no dismiss action of its own). */
export function syncGuardBankOnDismiss(g: Guard, reason: string, site: SiteMeta, isTestData: boolean): void {
  if (!g.employeeId) return;
  const now = Date.now();
  guardBankMatchByEmployeeId(g.employeeId)
    .then((existingDoc) => {
      if (existingDoc) {
        return setDoc(existingDoc.ref, { status: "dismissed", dismissalReason: reason, dismissedAt: now, updatedAt: now }, { merge: true }).catch(() => {});
      }
      // Guard predates Guard Bank — create the record now so the dismissal still shows up there
      // instead of silently going untracked.
      return guardBankResolveBrand(site.tenderId).then((brand) => {
        const payload = {
          ...guardBankIdentityFields(g),
          status: "dismissed",
          siteId: site.id,
          siteName: site.name || null,
          branch: site.branch || null,
          brandId: brand.brandId,
          brandName: brand.brandName,
          dismissalReason: reason,
          dismissedAt: now,
          createdAt: now,
          updatedAt: now,
          isTestData,
        };
        return addDoc(collection(db, "guards"), payload).catch(() => {});
      });
    })
    .catch(() => {});
}

/** Fires from "Reactivate" — mirrors the guard back to Deployed at this site. */
export function syncGuardBankOnReactivate(g: Guard, site: SiteMeta): void {
  if (!g.employeeId) return;
  const now = Date.now();
  guardBankMatchByEmployeeId(g.employeeId)
    .then((existingDoc) => {
      if (!existingDoc) return;
      return guardBankResolveBrand(site.tenderId).then((brand) =>
        setDoc(
          existingDoc.ref,
          {
            status: "deployed",
            siteId: site.id,
            siteName: site.name || null,
            branch: site.branch || null,
            brandId: brand.brandId,
            brandName: brand.brandName,
            dismissalReason: null,
            dismissedAt: null,
            updatedAt: now,
          },
          { merge: true }
        ).catch(() => {})
      );
    })
    .catch(() => {});
}

/** Fires from "Back to Guard Pool" on a site's guard list — releases the guard back to the Guard
 * Pool in Guard Bank, the same shape releaseGuardsFromSite() (services/guards.ts) gives a
 * freshly-released guard: status 'pool', siteId/siteName/branch/brandId/brandName cleared.
 * Deliberately does NOT touch this site's already-recorded shift/manhour history — that lives in
 * the roster's own schedule data, untouched by this guard-list removal, so hours already logged
 * here stay exactly as worked. */
export function syncGuardBankOnReturnToPool(g: Guard, isTestData: boolean): void {
  if (!g.employeeId) return;
  const now = Date.now();
  guardBankMatchByEmployeeId(g.employeeId)
    .then((existingDoc) => {
      const payload = { status: "pool", siteId: null, siteName: null, branch: null, brandId: null, brandName: null, updatedAt: now };
      if (existingDoc) {
        return setDoc(existingDoc.ref, payload, { merge: true }).catch(() => {});
      }
      // Guard predates Guard Bank tracking — create the pool record now so they're still
      // reachable for reassignment elsewhere instead of silently going untracked.
      const created = { ...guardBankIdentityFields(g), ...payload, createdAt: now, isTestData };
      return addDoc(collection(db, "guards"), created).catch(() => {});
    })
    .catch(() => {});
}

export interface BufferGuardAssignEntry {
  name: string;
  mykadNumber?: string | null;
  rate?: number | null;
  phoneNumber?: string | null;
  age?: number | null;
  state?: string | null;
  city?: string | null;
}

/** Fires whenever a temp/relief guard is assigned to cover a slot — recorded in `bufferGuards`
 * purely for future contact, deduped by name+MyKad, with NO linkage back to guards/sites. */
export function syncBufferGuardOnAssign(entry: BufferGuardAssignEntry | null | undefined, site: SiteMeta, isTestData: boolean): void {
  if (!entry || !entry.name) return;
  const now = Date.now();
  getDocs(
    query(
      collection(db, "bufferGuards"),
      where("name", "==", entry.name),
      where("mykadNumber", "==", entry.mykadNumber || null),
      limit(1)
    )
  )
    .then((snap) => {
      const patch = {
        rate: entry.rate != null ? entry.rate : null,
        phoneNumber: entry.phoneNumber || null,
        mykadNumber: entry.mykadNumber || null,
        age: entry.age != null ? entry.age : null,
        state: entry.state || null,
        city: entry.city || null,
        lastSiteName: site.name || null,
        lastBranch: site.branch || null,
        lastUsedAt: now,
      };
      if (!snap.empty) {
        const ref = snap.docs[0].ref;
        const prevUsed = (snap.docs[0].data() || {}).timesUsed || 0;
        return setDoc(ref, { ...patch, timesUsed: prevUsed + 1 }, { merge: true }).catch(() => {});
      }
      return addDoc(collection(db, "bufferGuards"), { name: entry.name, ...patch, firstUsedAt: now, timesUsed: 1, isTestData }).catch(() => {});
    })
    .catch(() => {});
}

/** Live "have we used this person before?" lookup for the temp-guard form, matched the exact
 * same way syncBufferGuardOnAssign() dedupes (name + mykadNumber, both exact) so the record
 * found is guaranteed to be the one an assignment would actually update. Returns null when there
 * is no match (or the lookup fails) rather than throwing — the Adjustments tab component is
 * responsible for debouncing calls to this (the original debounced 400ms via
 * scheduleTempGuardMatchLookup()) and for deciding whether the admin has kept typing since the
 * call was made. */
export async function lookupBufferGuardMatch(
  name: string,
  mykadNumber: string
): Promise<{ age?: number | null; phoneNumber?: string | null; state?: string | null; city?: string | null; timesUsed: number; rate?: number | null } | null> {
  if (!name || !mykadNumber) return null;
  try {
    const snap = await getDocs(
      query(collection(db, "bufferGuards"), where("name", "==", name), where("mykadNumber", "==", mykadNumber), limit(1))
    );
    if (snap.empty) return null;
    const bg = snap.docs[0].data() || {};
    return {
      age: bg.age,
      phoneNumber: bg.phoneNumber,
      state: bg.state,
      city: bg.city,
      timesUsed: bg.timesUsed || 0,
      rate: bg.rate,
    };
  } catch {
    return null;
  }
}
