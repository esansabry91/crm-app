import { useEffect } from "react";
import type { RosterViewer } from "../rosterViewer";
import { buildSitePickerView, type SiteListEntry, type SitePickerFilters } from "../siteListData";

/**
 * The Site/Client/Branch picker bar (`.sitebar`, index.html lines 296-309) — Branch filter,
 * Client filter, Client site select, "Show archived" toggle, and the branch badge. Pure
 * presentational, matching every other panel in this port: calls `buildSitePickerView()` itself
 * from the raw inputs, all Firestore-facing/navigation behavior lives in the caller.
 *
 * Deliberately does NOT render "+ New site"/"Rename" (index.html's own #newSiteBtn/#renameSiteBtn)
 * — confirmed via applyRoleUiLockdown() that both are unconditionally hidden for every role, i.e.
 * unreachable dead UI in the original; see rosterViewer.ts's own doc comment on the equivalent
 * decision for archive/unarchive (that's handled entirely on the tenders/React side instead).
 *
 * Does NOT render the topbar's brand subtitle (`#brandSubtitle`) either — that element lives
 * outside `.sitebar` in the original's markup, in the page-level topbar Task #22 composes.
 * `buildSitePickerView()` already computes `brandSubtitle` as part of this same call; the page
 * shell should just call it again there (cheap, pure) rather than have this component thread it
 * back up through a prop.
 *
 * Any navigation this bar triggers (switching site, changing a filter) that could interrupt an
 * unlocked Roster with pending drags should be routed through `useUnlockGuard()`'s `guard()` by
 * the caller — this component itself has no opinion on that, matching how every other
 * navigation-adjacent control in this port (tab clicks, month nav) stays unaware of the lock
 * guard and leaves it to the page shell.
 */
export interface SitePickerBarProps {
  viewer: RosterViewer;
  allSites: SiteListEntry[];
  branches: { name: string }[];
  currentSiteId: string | null;
  filters: SitePickerFilters;
  onFiltersChange: (next: SitePickerFilters) => void;
  onSelectSite: (siteId: string) => void;
}

export default function SitePickerBar({ viewer, allSites, branches, currentSiteId, filters, onFiltersChange, onSelectSite }: SitePickerBarProps) {
  const view = buildSitePickerView(viewer, allSites, branches, currentSiteId, filters);

  // Mirrors renderClientFilterSelect()'s own `state.clientFilterValue = ""` reset: once the
  // branch filter changes out from under a selected client (or the site list itself changes) such
  // that the current client filter no longer has any matching option, correct the caller's own
  // filter state to match what was actually applied this render.
  useEffect(() => {
    if (view.effectiveClientFilterValue !== filters.clientFilterValue) {
      onFiltersChange({ ...filters, clientFilterValue: view.effectiveClientFilterValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.effectiveClientFilterValue]);

  return (
    <div className="flex flex-wrap items-center gap-3 py-2">
      {view.canFilterBranch && (
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-slate-600">Branch</label>
          <select
            className="input"
            value={filters.branchFilterValue}
            onChange={(e) => onFiltersChange({ ...filters, branchFilterValue: e.target.value })}
          >
            {view.branchOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-600">Client</label>
        <select
          className="input min-w-[180px]"
          value={view.effectiveClientFilterValue}
          onChange={(e) => onFiltersChange({ ...filters, clientFilterValue: e.target.value })}
        >
          {view.clientOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-600">Client site</label>
        {view.emptyMessage ? (
          <span className="text-xs text-slate-500">{view.emptyMessage}</span>
        ) : (
          <select className="input" value={currentSiteId || ""} onChange={(e) => onSelectSite(e.target.value)}>
            {view.siteOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {view.canSeeArchived && (
        <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={filters.showArchivedSites}
            onChange={(e) => onFiltersChange({ ...filters, showArchivedSites: e.target.checked })}
          />
          Show archived
        </label>
      )}

      {view.branchBadgeText && <span className="text-xs text-slate-500">{view.branchBadgeText}</span>}
    </div>
  );
}
