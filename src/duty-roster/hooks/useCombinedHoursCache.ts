/**
 * React equivalent of the original's session-only `state.combinedHoursCache` /
 * currentCombinedHours() / invalidateCombinedHoursCache() (public/duty-roster/index.html lines
 * 4543-4560) — an in-memory (never persisted) map keyed by "siteId::monthKey", populated only by
 * an explicit "Refresh combined hours" click, read by the Combined Hours panel and the
 * TimeAttendance export.
 *
 * PORTING NOTE (Task #22 resolution): the original called invalidateCombinedHoursCache() from
 * FOUR call sites — persistSiteConfig(), persistMonthByKey() (i.e. EVERY site-config or
 * month-state write, anywhere in the app), the live onSnapshot handler in subscribeMonth()
 * (another user's edit landing), and syncHomeSiteSupportLeave()'s own best-effort cross-site
 * write. Task #22's page shell (src/duty-roster/DutyRosterApp.tsx) now owns this hook (lifted
 * above the tab set, passed into SummaryReportTab as `combinedCache`) and calls `invalidateAll()`
 * from a `useEffect` watching the CURRENT site's own `config`/`ms` object identity — which fires
 * for every local edit AND every remote onSnapshot update landing on THIS site, covering the
 * first three of the original's four call sites in one place (object-identity change is a
 * simpler, equally-correct stand-in for enumerating every individual write path). The one case
 * that's NOT covered automatically is a mutation on a SIBLING site the user isn't currently
 * looking at (support-guard-elsewhere edits, syncHomeSiteSupportLeave()'s own case) — watching
 * every other site's own subscription just to keep one cache warm isn't worth the extra
 * listeners, so that gap is exactly what the "Refresh combined hours" button (this cache's own
 * primary populate mechanism, not a fallback) already exists to close by hand.
 */
import { useCallback, useState } from "react";
import type { IncomingSupportMap } from "../types";

function cacheKey(siteId: string, monthKey: string): string {
  return siteId + "::" + monthKey;
}

export interface CombinedHoursCache {
  get: (siteId: string, monthKey: string) => IncomingSupportMap | null;
  set: (siteId: string, monthKey: string, map: IncomingSupportMap) => void;
  invalidateAll: () => void;
}

export function useCombinedHoursCache(): CombinedHoursCache {
  const [store, setStore] = useState<Record<string, IncomingSupportMap>>({});

  const get = useCallback((siteId: string, monthKey: string) => store[cacheKey(siteId, monthKey)] || null, [store]);
  const set = useCallback((siteId: string, monthKey: string, map: IncomingSupportMap) => {
    setStore((prev) => ({ ...prev, [cacheKey(siteId, monthKey)]: map }));
  }, []);
  const invalidateAll = useCallback(() => setStore({}), []);

  return { get, set, invalidateAll };
}
