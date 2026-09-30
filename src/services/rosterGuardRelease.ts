/**
 * Duty Roster treats a site guard as still on the active roster whenever `active` is not
 * strictly false (see activeGuardsOn in rosterModel.ts and useLiveGuardCountsByTender).
 * Close-out / archive releases the matching Guard Bank rows back to the pool, but that alone
 * leaves these roster entries active. Reopening the site then schedules them again even when
 * Guard Bank already has them in the pool or deployed at another site.
 *
 * Mark every still-active entry inactive and leave already-inactive ones untouched, including
 * their other fields, so past shifts can still resolve the guard's name.
 */
export function markRosterGuardsInactive<T extends { active?: boolean }>(
  guards: readonly T[] | null | undefined
): { guards: T[]; changed: boolean } {
  if (!Array.isArray(guards)) return { guards: [], changed: false };
  let changed = false;
  const next = guards.map((guard) => {
    if (guard.active === false) return guard;
    changed = true;
    return { ...guard, active: false };
  });
  return { guards: next, changed };
}
