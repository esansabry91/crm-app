/**
 * Summary Report tab — the "Combined hours" panel's cross-site read. Ported from
 * public/duty-roster/index.html's computeIncomingSupportDates() (lines 4586-4635). For the
 * site/month on screen, finds every OTHER site in the same branch, checks each sibling's month
 * doc for support-guard records whose `homeSiteId` is THIS site, and for each one re-runs that
 * sibling's own generateMonth() to find every date/hours pair the borrowed guard actually
 * worked there. Returns a flat, UNCLASSIFIED map `{homeGuardId: {dateStr,hours}[]}` —
 * classification into normal/rest/holiday happens back home, in combinedGuardBreakdown()
 * (already ported to payrollMath.ts) — never here.
 *
 * The original swapped `state.currentSiteId`/`currentMonth`/`monthsCache` to each sibling,
 * synchronously, so generateMonth()'s (then-global-reading) internal helpers resolved against
 * the sibling's own data, then restored them in a `finally`. The ported generateMonth()/
 * guardWorkedDayList() both already take config/monthState as explicit parameters (see
 * schedulingEngine.ts/payrollMath.ts), so that whole swap/restore dance is dead weight here and
 * is deliberately dropped — the same simplification already applied to computeFreeGuardsAt() in
 * supportGuardCrossSite.ts.
 *
 * Deliberate, flagged deviation from the original: the original only looked at a sibling whose
 * SiteConfig was already locally cached (`state.configsCache[sib.id]`, populated by some other
 * already-open listener elsewhere in the app) and silently skipped any sibling not yet cached.
 * This port instead fetches a sibling's SiteConfig on demand via `getDoc()` when it isn't
 * already in the caller's `siteConfigsCache`, so a sibling is never silently dropped just
 * because nothing else happened to be subscribed to it yet — a strictly more complete result
 * for the same inputs, not a silent behavior change.
 */
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { SiteConfig, MonthState, IncomingSupportMap } from "./types";
import { generateMonth } from "./schedulingEngine";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { guardWorkedDayList } from "./payrollMath";
import { emptyMonthState } from "./rosterModel";
import { parseYM } from "./dateUtils";

export async function computeIncomingSupportDates(
  siteId: string,
  monthKeyStr: string,
  allSites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[],
  siteConfigsCache: Record<string, GenerateMonthConfig>
): Promise<IncomingSupportMap> {
  const out: IncomingSupportMap = {};
  const here = allSites.find((s) => s.id === siteId);
  if (!here || here.branch == null) return out; // no branch → nothing cross-site to find
  const siblings = allSites.filter((s) => s.id !== siteId && !s.archived && s.branch === here.branch);

  await Promise.all(
    siblings.map(async (sib) => {
      let sibConfig: GenerateMonthConfig | undefined = siteConfigsCache[sib.id];
      if (!sibConfig) {
        const cfgSnap = await getDoc(doc(db, "sites", sib.id)).catch(() => null);
        if (!cfgSnap || !cfgSnap.exists()) return;
        sibConfig = cfgSnap.data() as SiteConfig;
      }
      let msData: MonthState;
      try {
        const snap = await getDoc(doc(db, "sites", sib.id, "months", monthKeyStr));
        msData = snap.exists() ? (snap.data() as MonthState) : emptyMonthState(monthKeyStr);
      } catch {
        return; // Firestore read error — skip this sibling silently, no toast/log
      }
      if (!msData.supportGuards) return;
      const relevant = Object.keys(msData.supportGuards).filter((supportId) => msData.supportGuards[supportId]?.homeSiteId === siteId);
      if (!relevant.length) return;

      const { y, m } = parseYM(monthKeyStr);
      const result = generateMonth(y, m, sibConfig, msData);
      relevant.forEach((supportId) => {
        const entry = msData.supportGuards[supportId];
        const worked = guardWorkedDayList(sibConfig as GenerateMonthConfig, result, supportId);
        if (!worked.length) return;
        if (!out[entry.homeGuardId]) out[entry.homeGuardId] = [];
        out[entry.homeGuardId].push(...worked);
      });
    })
  );
  return out;
}
