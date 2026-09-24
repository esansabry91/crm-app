/**
 * Live Firestore subscription for the whole reachable site list — ported from
 * public/duty-roster/index.html's `initDb()` site-subscription block (lines ~6566-6656):
 * `reachableSiteQueries()`, the per-query `buckets`, `recombineSitesAndRender()`'s merge/sort
 * (minus its own deep-link-on-empty branch, which `useTenderDeepLink()` in tenderDeepLink.ts
 * already generalizes to both the empty- and non-empty-list cases — see that hook's doc comment),
 * and `state.configsCache`'s population.
 *
 * Firestore can't partially filter an unconstrained collection query and silently drop the docs a
 * caller isn't allowed to see — it just rejects the whole query — so a non-privileged,
 * non-payroll-like viewer needs two separate listeners (their own branch, and unassigned sites)
 * merged client-side, exactly like the original. A privileged/payroll-like viewer's read access
 * doesn't depend on `branch` at all, so one unfiltered listener covers them.
 *
 * `loading` stays true until EVERY listener has delivered its first snapshot (or errored).
 * Clearing it when the first of the two branch queries returns would hand callers a partial
 * list. useTenderDeepLink() treats "list ready and this tenderId is absent" as "create a site",
 * so a half-loaded list creates a duplicate roster.
 *
 * PORTING NOTE (Task #22 composition dependency): the original auto-selected an initial/fallback
 * current site (`state.currentSiteId`) as part of this same subscription callback, reading a
 * `localStorage.getItem("dutyRosterLastSite")` preference and falling back to the first site in
 * `state.sites`. That's page-shell state (which site is "current" right now), not this hook's
 * concern — kept as the pure, side-effect-free `pickInitialSiteId()` below instead; Task #22's
 * page should call it whenever `sites` changes and the caller's own `currentSiteId` is null or no
 * longer present in `sites`, and owns the actual `localStorage` read/write itself (no other hook
 * in this port touches `localStorage` directly either).
 */
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../firebase";
import type { SiteConfig } from "../types";
import { deepClone } from "../rosterModel";
import type { RosterViewer } from "../rosterViewer";
import type { SiteListEntry } from "../siteListData";

export interface UseSiteListResult {
  /** Merged, deduped, createdAt-ascending-sorted — matches the original's exact sort. */
  sites: SiteListEntry[];
  /** Full site config docs, keyed by id — every listener's raw doc data, deep-cloned, exactly
   * like `state.configsCache`. Structurally assignable wherever `Record<string,
   * GenerateMonthConfig>` is expected (schedulingEngine.ts's `GenerateMonthConfig` is a `Pick` of
   * `SiteConfig`'s own fields). */
  configsCache: Record<string, SiteConfig>;
  loading: boolean;
}

function toEntry(id: string, data: Partial<SiteConfig>): SiteListEntry {
  return {
    id,
    name: data.name || "Untitled site",
    branch: data.branch || null,
    tenderId: data.tenderId || null,
    clientName: data.clientName || null,
    archived: !!data.archived,
    createdAt: data.createdAt || "",
  };
}

export function useSiteList(viewer: RosterViewer): UseSiteListResult {
  const [sites, setSites] = useState<SiteListEntry[]>([]);
  const [configsCache, setConfigsCache] = useState<Record<string, SiteConfig>>({});
  const [loading, setLoading] = useState(true);

  // Only the reachability class (privileged/payroll-like vs a specific branch) should ever
  // re-subscribe — re-subscribing on every profile object identity change would tear down and
  // rebuild both listeners for no reason.
  const canSeeAll = viewer.isPrivileged || viewer.isPayrollLike;
  const myDepartment = viewer.myDepartment || null;

  useEffect(() => {
    setLoading(true);
    const sitesCol = collection(db, "sites");
    const queries = canSeeAll ? [sitesCol] : [query(sitesCol, where("branch", "==", myDepartment)), query(sitesCol, where("branch", "==", null))];

    const buckets: SiteListEntry[][] = queries.map(() => []);
    const configBuckets: Record<string, SiteConfig>[] = queries.map(() => ({}));
    const settled = queries.map(() => false);

    function recombine() {
      const seen = new Set<string>();
      const merged: SiteListEntry[] = [];
      buckets.forEach((list) =>
        list.forEach((s) => {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        })
      );
      merged.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      setSites(merged);
      setConfigsCache(Object.assign({}, ...configBuckets));
      if (settled.every(Boolean)) setLoading(false);
    }

    const unsubs: Unsubscribe[] = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = [];
          configBuckets[i] = {};
          snap.docs.forEach((d) => {
            const data = (d.data() || {}) as SiteConfig;
            configBuckets[i][d.id] = deepClone(data);
            buckets[i].push(toEntry(d.id, data));
          });
          settled[i] = true;
          recombine();
        },
        () => {
          buckets[i] = [];
          configBuckets[i] = {};
          settled[i] = true;
          recombine();
        }
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [canSeeAll, myDepartment]);

  return { sites, configsCache, loading };
}

/** Pure "which site should be current" decision — see this file's own doc comment for why the
 * `localStorage` read itself stays with the caller. Mirrors the original exactly: prefer
 * `preferredId` if it's actually in `sites`, else the first site in `sites`' own (createdAt-
 * ascending) order, else null when there's nothing to select at all. */
export function pickInitialSiteId(sites: SiteListEntry[], preferredId: string | null): string | null {
  if (preferredId && sites.some((s) => s.id === preferredId)) return preferredId;
  return sites.length ? sites[0].id : null;
}
