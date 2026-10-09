/**
 * Decides what one Guard Bank record should become when the same employee id shows up on one
 * or more Duty Roster site rosters. backfillGuardsFromDutyRoster() used to apply each site in
 * scan order and let the last write win, and every write cleared dismissalReason, dismissedAt,
 * and archivedAt.
 *
 * That is wrong once a guard can be inactive on a closed site and active on another:
 * close-out marks the old roster row inactive without deleting it (see
 * markRosterGuardsInactive). Whichever site Firestore returned last decided the Guard Bank
 * status, so a working guard could be saved as dismissed. The same pass also un-archived
 * dismissed guards and erased the dismissal date the turnover figure reads.
 *
 * An active roster copy always wins. When every copy is inactive, a guard already in the
 * pool stays in the pool (released, not dismissed), and an existing dismissal keeps its
 * reason, date, and archive flag.
 */

export interface GuardRosterSighting {
  active?: boolean;
  siteId: string;
  siteName: string | null;
  branch: string | null;
  brandId: string | null;
  brandName: string | null;
  name: string;
  category: 'local' | 'nepal';
  age: number | null;
  state: string | null;
  city: string | null;
  passportNumber: string | null;
  permitExpiryDate: string | null;
  mykadNumber: string | null;
  phoneNumber: string | null;
}

export interface ExistingGuardBankRecord {
  status: 'pool' | 'deployed' | 'dismissed';
  siteId?: string | null;
  dismissalReason?: string | null;
  dismissedAt?: number | null;
  archivedAt?: number | null;
}

export interface ReconciledGuardBank {
  status: 'pool' | 'deployed' | 'dismissed';
  siteId: string | null;
  siteName: string | null;
  branch: string | null;
  brandId: string | null;
  brandName: string | null;
  name: string;
  category: 'local' | 'nepal';
  age: number | null;
  state: string | null;
  city: string | null;
  passportNumber: string | null;
  permitExpiryDate: string | null;
  mykadNumber: string | null;
  phoneNumber: string | null;
  dismissalReason: string | null;
  dismissedAt: number | null;
  archivedAt: number | null;
}

function rosterCopyIsActive(active: boolean | undefined): boolean {
  return active !== false;
}

/** Prefer a still-active roster copy. Among copies in that class, keep the site Guard Bank
 *  already has when it is one of them, so a refresh does not hop a guard between sites. */
export function pickRosterSighting<T extends { active?: boolean; siteId: string }>(
  sightings: readonly T[],
  existingSiteId: string | null | undefined
): T {
  const active = sightings.filter((s) => rosterCopyIsActive(s.active));
  const candidates = active.length > 0 ? active : sightings;
  if (existingSiteId) {
    const match = candidates.find((s) => s.siteId === existingSiteId);
    if (match) return match;
  }
  return candidates[0];
}

function identityFrom(sighting: GuardRosterSighting) {
  return {
    name: sighting.name,
    category: sighting.category,
    age: sighting.age,
    state: sighting.state,
    city: sighting.city,
    passportNumber: sighting.passportNumber,
    permitExpiryDate: sighting.permitExpiryDate,
    mykadNumber: sighting.mykadNumber,
    phoneNumber: sighting.phoneNumber,
  };
}

export function reconcileGuardBankFromRoster(
  sightings: readonly GuardRosterSighting[],
  existing: ExistingGuardBankRecord | null
): ReconciledGuardBank | null {
  if (sightings.length === 0) return null;
  const hasActive = sightings.some((s) => rosterCopyIsActive(s.active));
  const chosen = pickRosterSighting(sightings, existing?.siteId);
  const identity = identityFrom(chosen);

  if (hasActive) {
    return {
      ...identity,
      status: 'deployed',
      siteId: chosen.siteId,
      siteName: chosen.siteName,
      branch: chosen.branch,
      brandId: chosen.brandId,
      brandName: chosen.brandName,
      dismissalReason: null,
      dismissedAt: null,
      archivedAt: null,
    };
  }

  // Released back to the pool (close-out or "Back to Guard Pool") leaves the old roster row
  // inactive. That is not a dismissal.
  if (existing?.status === 'pool') {
    return {
      ...identity,
      status: 'pool',
      siteId: null,
      siteName: null,
      branch: null,
      brandId: null,
      brandName: null,
      dismissalReason: null,
      dismissedAt: null,
      archivedAt: null,
    };
  }

  if (existing?.status === 'dismissed') {
    return {
      ...identity,
      status: 'dismissed',
      siteId: chosen.siteId,
      siteName: chosen.siteName,
      branch: chosen.branch,
      brandId: chosen.brandId,
      brandName: chosen.brandName,
      dismissalReason: existing.dismissalReason ?? null,
      dismissedAt: existing.dismissedAt ?? null,
      archivedAt: existing.archivedAt ?? null,
    };
  }

  // No Guard Bank record yet, or the record still says deployed while every roster copy is
  // inactive. There is no dismissal date to recover — same as before, do not invent "today".
  return {
    ...identity,
    status: 'dismissed',
    siteId: chosen.siteId,
    siteName: chosen.siteName,
    branch: chosen.branch,
    brandId: chosen.brandId,
    brandName: chosen.brandName,
    dismissalReason: null,
    dismissedAt: null,
    archivedAt: null,
  };
}
