/**
 * React equivalent of the original's session-only `state.combinedHoursCache` /
 * currentCombinedHours() / invalidateCombinedHoursCache() (public/duty-roster/index.html lines
 * 4543-4560) — an in-memory (never persisted) map keyed by "siteId::monthKey", populated only by
 * an explicit "Refresh combined hours" click, read by the Combined Hours panel and the
 * TimeAttendance export.
 *
 * PORTING NOTE (Task #22 composition dependency): the original called
 * invalidateCombinedHoursCache() from FOUR call sites — persistSiteConfig(), persistMonthByKey()
 * (i.e. EVERY site-config or month-state write, anywhere in the app, not just this tab), the
 * live onSnapshot handler in subscribeMonth() (another user's edit landing), and
 * syncHomeSiteSupportLeave()'s own best-effort cross-site write (index.html line ~4318). In
 * short: "invalidate on essentially any mutation to any site's roster data, local or remote."
 * This hook only owns the cache's storage; wiring `invalidateAll()` into every one of those call
 * sites needs a cache instance that outlives a single tab and is reachable from
 * useMonthState.ts/useSiteConfig.ts/supportGuardCrossSite.ts — i.e. lifted into a context above
 * every tab, which doesn't exist until Task #22 composes the page (every other Adjustments-tab
 * panel already declares the same kind of "Task #22 wires the shared subscription" dependency —
 * see AdjustmentsTab.tsx's own doc comment). Until then this hook is owned locally by
 * SummaryReportTab, which is correct for the common case (this tab's own Refresh/Confirm
 * actions invalidate its own cache immediately below) but can go stale if a mutation on another
 * tab (e.g. assigning a support guard in Adjustments) changes a SIBLING site's combined figure
 * without the user revisiting this tab in between. Task #22 should lift this hook above the tab
 * set and thread its `invalidateAll` into the four call sites listed above.
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
