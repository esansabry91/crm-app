import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { SiteBillingRate } from '../types';

/** Minimal shape of a Duty Roster `sites/{id}` doc this feature needs — mirrors the same local
 *  pattern TestingDataTool.tsx uses (there's no shared Site type in types.ts; that collection is
 *  owned by public/duty-roster/index.html's own data model). `billingRates` is the one field this
 *  side of the app actually writes to that collection — everything else here is read-only. */
export interface BillingSite {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  tenderId: string | null;
  billingRates: SiteBillingRate[];
  /**
   * How many guard posts the site's Client Site Requirement (Duty Roster > Guards & Shifts tab)
   * calls for on its busiest single day — see requiredGuardPosts() below for the actual math,
   * which mirrors public/duty-roster/index.html's own computeShiftDefs/postsAt/
   * computeShiftDefsForDay pattern-by-pattern (DN/WW/FULL/FULLH/U all handled the same way that
   * console does). Null when the site doc has no `site` sub-object at all (predates Duty
   * Roster's data model, or was never touched there) and so there's nothing real to cap against.
   * The invoice generator uses this as the hard ceiling on total headcount typed across an
   * invoice's line items — see InvoiceGenerator.tsx's headcountExceedsSite.
   *
   * Deliberately NOT how many guards are currently marked active in the site's `guards[]` roster
   * (Guard Bank) — that count answers "how many people happen to be assigned right now," which
   * can be temporarily over- or under-staffed relative to what the client actually contracted
   * for, and drifting out of sync with it should never change what's billable. The Client Site
   * Requirement is the actual contracted headcount, so that's what invoicing is capped against.
   */
  guardCount: number | null;
}

/** The handful of Client Site Requirement fields (Duty Roster > Guards & Shifts tab) that
 *  requiredGuardPosts() below needs — a subset of the full `site` sub-object shape defaultSite()
 *  in public/duty-roster/index.html defines; every other field that console reads/writes is
 *  irrelevant here. */
interface SiteRequirement {
  pattern?: string;
  hoursDay?: number;
  shiftHrs?: number;
  rosterStart?: number;
  daysWeek?: number;
  postsU?: number;
  postsDay?: number;
  postsNight?: number;
  postsWd?: number;
  postsWe?: number;
  postsWdDay?: number;
  postsWdNight?: number;
  postsWeDay?: number;
  postsWeNight?: number;
  shiftsWdDay?: number[];
  shiftsWdNight?: number[];
  shiftsWeDay?: number[];
  shiftsWeNight?: number[];
}

/** Same uniform-pattern shift split public/duty-roster/index.html's computeShiftDefs() uses for
 *  every pattern except FULLH (see computeShiftDefsForDay below) — same day/night shifts every
 *  day of the week, one every `shiftHrs` hours starting at `rosterStart`, night meaning
 *  "doesn't start between 06:00 and 18:00". */
function computeShiftDefs(site: SiteRequirement): { night: boolean }[] {
  const shiftHrs = Number(site.shiftHrs) || 0;
  const count = shiftHrs > 0 ? Math.max(0, Math.round((Number(site.hoursDay) || 0) / shiftHrs)) : 0;
  const defs: { night: boolean }[] = [];
  for (let s = 0; s < count; s++) {
    const startHour = ((Number(site.rosterStart) || 0) + s * shiftHrs) % 24;
    const startHourNorm = ((startHour % 24) + 24) % 24;
    defs.push({ night: !(startHourNorm >= 6 && startHourNorm < 18) });
  }
  return defs;
}

/** Mirrors fullHList() in public/duty-roster/index.html — always a non-empty list of hour
 *  lengths, falling back to a single 12h post for a not-yet-configured FULLH category. */
function fullHList(site: SiteRequirement, key: 'shiftsWdDay' | 'shiftsWdNight' | 'shiftsWeDay' | 'shiftsWeNight'): number[] {
  const v = site[key];
  return Array.isArray(v) && v.length ? v : [12];
}

/** Mirrors postsAt() in public/duty-roster/index.html — how many guard posts this pattern calls
 *  for on a given weekday/weekend × day/night slot. `dm` is Monday=0..Sunday=6. */
function postsAt(site: SiteRequirement, dm: number, night: boolean): number {
  const we = dm >= 5;
  switch (site.pattern) {
    case 'DN':
      return Number(night ? site.postsNight : site.postsDay) || 0;
    case 'WW':
      return Number(we ? site.postsWe : site.postsWd) || 0;
    case 'FULL':
      return (
        Number(we ? (night ? site.postsWeNight : site.postsWeDay) : night ? site.postsWdNight : site.postsWdDay) || 0
      );
    // Under FULLH every individual guard post is already its own entry from
    // computeShiftDefsForDay below, so each shift def there represents exactly one post.
    case 'FULLH':
      return 1;
    default:
      return Number(site.postsU) || 0;
  }
}

/** Mirrors computeShiftDefsForDay() in public/duty-roster/index.html — every pattern except
 *  FULLH runs the same shifts every day (computeShiftDefs above); FULLH gives every weekday/
 *  weekend × day/night category its own variable-length list of guard posts. */
function computeShiftDefsForDay(site: SiteRequirement, dm: number): { night: boolean }[] {
  if (site.pattern !== 'FULLH') return computeShiftDefs(site);
  const we = dm >= 5;
  const dayList = fullHList(site, we ? 'shiftsWeDay' : 'shiftsWdDay');
  const nightList = fullHList(site, we ? 'shiftsWeNight' : 'shiftsWdNight');
  const defs: { night: boolean }[] = [];
  dayList.forEach((hours) => {
    if ((Number(hours) || 0) > 0) defs.push({ night: false });
  });
  nightList.forEach((hours) => {
    if ((Number(hours) || 0) > 0) defs.push({ night: true });
  });
  return defs;
}

/** Mirrors coverageDaysPerWeek() in public/duty-roster/index.html. */
function coverageDaysPerWeek(site: SiteRequirement): number {
  return Math.min(7, Math.max(0, Math.round(Number(site.daysWeek) || 0)));
}

/**
 * How many guard posts the Client Site Requirement calls for on this site's busiest single day —
 * summing every shift's posts for each covered day (day AND night both run within one day, so
 * both are real, simultaneously-billable positions), then taking the day with the highest total
 * across the week (weekday vs weekend can differ). This is what invoice line items' Total
 * headcount is capped against — see BillingSite.guardCount's doc comment for why it's this and
 * not the live guards[] roster.
 */
function requiredGuardPosts(site: SiteRequirement): number {
  const cov = coverageDaysPerWeek(site);
  let maxDaySlots = 0;
  for (let dm = 0; dm < cov; dm++) {
    let daySlots = 0;
    for (const sd of computeShiftDefsForDay(site, dm)) {
      daySlots += Math.max(0, postsAt(site, dm, sd.night));
    }
    if (daySlots > maxDaySlots) maxDaySlots = daySlots;
  }
  return maxDaySlots;
}

export function useSitesForBilling() {
  const [sites, setSites] = useState<BillingSite[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sites'),
      (snap) => {
        setSites(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            const requirement = data.site as SiteRequirement | undefined;
            return {
              id: d.id,
              name: (data.name as string) || 'Untitled site',
              branch: (data.branch as string) ?? null,
              archived: !!data.archived,
              tenderId: (data.tenderId as string) ?? null,
              billingRates: Array.isArray(data.billingRates) ? (data.billingRates as SiteBillingRate[]) : [],
              guardCount: requirement ? requiredGuardPosts(requirement) : null,
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);
  return { sites, loading };
}

/** Overwrites a site's whole billing-rates list — the invoice generator's rate-editor always
 *  sends the complete list back (add/remove/edit all happen client-side first), so a full
 *  replace is simpler and safer here than trying to patch individual array entries. */
export async function updateSiteBillingRates(siteId: string, rates: SiteBillingRate[]): Promise<void> {
  await updateDoc(doc(db, 'sites', siteId), { billingRates: rates, updatedAt: new Date().toISOString() });
}
