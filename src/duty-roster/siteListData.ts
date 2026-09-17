/**
 * Duty Roster page shell — the Site/Client/Branch picker's pure filtering/labeling logic.
 * Ported from public/duty-roster/index.html's renderSiteSelect() (lines 5947-6019),
 * renderClientFilterSelect() (5927-5943), applyRoleUiLockdown()'s branch-filter half
 * (6037-6066), renderSiteBranchControl() (6079-6089), and updateBrandSubtitle() (6021-6035).
 *
 * Firestore-agnostic — takes the already-fetched site list (from the new useSiteList() hook)
 * and the already-fetched branch list (the real CRM's existing `useBranches()` — see
 * rosterViewer.ts's own doc comment on avoiding redundant re-fetches) and produces everything
 * the SitePickerBar component needs to render, in one pure call per render.
 */
import type { RosterViewer } from "./rosterViewer";

/** Mirrors `state.sites`' own entry shape (index.html line 1290) — a lightweight summary, not
 * the full SiteConfig doc (see useSiteList.ts's `configsCache` for that). */
export interface SiteListEntry {
  id: string;
  name: string;
  branch: string | null;
  tenderId: string | null;
  clientName: string | null;
  archived: boolean;
  createdAt: string;
}

/** Sentinel branch-filter value meaning "sites with no branch assigned" — matches the original's
 * own `"__unassigned__"` literal exactly (also used by the branch-filter `<select>`'s own
 * option value). */
export const UNASSIGNED_BRANCH_FILTER = "__unassigned__";

export interface SitePickerFilters {
  /** "" = all branches, UNASSIGNED_BRANCH_FILTER = no branch, else an exact branch name. Only
   * has any filtering effect for a viewer who can see the branch filter at all (§ canFilterBranch
   * below) — matches the original's own `(isPayrollLike || isPrivileged) && branchFilterValue`
   * guard. */
  branchFilterValue: string;
  /** "" = all clients, else an exact clientName. */
  clientFilterValue: string;
  showArchivedSites: boolean;
}

export interface SitePickerOption {
  id: string;
  label: string;
}

export interface SitePickerView {
  /** Whether the Branch filter `<select>` (and its label) should render at all. */
  canFilterBranch: boolean;
  /** Branch `<select>` options, in the original's exact order: "All branches" first, then
   * every real branch except "HQ" (in whatever order the caller's branch list is in — the real
   * CRM's `useBranches()` already returns them `orderBy("name")`, a faithful stand-in for the
   * original's unordered one-shot fetch), then "Unassigned" last. Only meaningful when
   * `canFilterBranch` is true. */
  branchOptions: SitePickerOption[];
  /** Client `<select>` options — "All clients" first, then the distinct, non-empty client
   * names among the BRANCH-scoped (not yet client- or archived-scoped) site list, sorted
   * locale-aware. */
  clientOptions: SitePickerOption[];
  /** The client filter value to actually use this render — differs from
   * `filters.clientFilterValue` only when that value just fell out of `clientOptions` (e.g. the
   * branch filter changed to one this client has no site in). The caller should reset its own
   * client-filter state to this value when it differs, mirroring the original's direct
   * `state.clientFilterValue = ""` reset inside renderClientFilterSelect(). */
  effectiveClientFilterValue: string;
  /** Whether the "Show archived" checkbox should render at all. HR/Payroll can ALWAYS see
   * archived sites (even without checking the box you can't see, since it's hidden for them
   * too — see the original's own comment); a plain Branch Manager/Staff never can, checkbox or
   * not. */
  canSeeArchived: boolean;
  /** The site list after every filter (branch, client, archived) has been applied, in order. */
  filteredSites: SiteListEntry[];
  /** `<option>` entries for the Client Site `<select>`, built from `filteredSites` — label
   * includes the "{clientName} — " prefix only when "All clients" is selected AND the site's
   * clientName differs from its own name (repeating it is just noise once a specific client is
   * already selected), plus a literal " (Archived)" suffix. */
  siteOptions: SitePickerOption[];
  /** Shown instead of `siteOptions` when `filteredSites` is empty. */
  emptyMessage: string | null;
  /** "Branch: X" / "Branch: Unassigned" — shown only for a non-privileged, non-payroll-like
   * viewer (their only branch context, since they have no branch filter); null otherwise.
   * Derived from the CURRENTLY SELECTED site's own `branch` field (not the viewer's
   * department) — matches the original exactly. */
  branchBadgeText: string | null;
  brandSubtitle: string;
}

const DEFAULT_BRAND_SUBTITLE = "Global Density — security guard scheduling";

function clientFilterOptions(scopedSites: SiteListEntry[]): SitePickerOption[] {
  const clients = Array.from(new Set(scopedSites.map((s) => (s.clientName || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  return [{ id: "", label: "All clients" }, ...clients.map((c) => ({ id: c, label: c }))];
}

export function buildSitePickerView(viewer: RosterViewer, allSites: SiteListEntry[], branches: { name: string }[], currentSiteId: string | null, filters: SitePickerFilters): SitePickerView {
  const canFilterBranch = viewer.isPayrollLike || viewer.isPrivileged;

  let visibleSites = allSites;
  if (canFilterBranch && filters.branchFilterValue) {
    visibleSites =
      filters.branchFilterValue === UNASSIGNED_BRANCH_FILTER
        ? allSites.filter((s) => !s.branch)
        : allSites.filter((s) => s.branch === filters.branchFilterValue);
  }

  const branchOptions: SitePickerOption[] = canFilterBranch
    ? [
        { id: "", label: "All branches" },
        ...branches.filter((b) => b.name !== "HQ").map((b) => ({ id: b.name, label: b.name })),
        { id: UNASSIGNED_BRANCH_FILTER, label: "Unassigned" },
      ]
    : [];

  // Client options come from the branch-scoped list, BEFORE narrowing by the client filter
  // itself, so the dropdown's own options always match what's actually selectable.
  const clientOptions = clientFilterOptions(visibleSites);
  const effectiveClientFilterValue = filters.clientFilterValue && clientOptions.some((o) => o.id === filters.clientFilterValue) ? filters.clientFilterValue : "";

  if (effectiveClientFilterValue) {
    visibleSites = visibleSites.filter((s) => s.clientName === effectiveClientFilterValue);
  }

  const canSeeArchived = (viewer.isPrivileged && !viewer.isPayrollLike) || viewer.isPayrollLike;
  if (!canSeeArchived || !filters.showArchivedSites) {
    visibleSites = visibleSites.filter((s) => !s.archived);
  }

  const filteredSites = visibleSites;
  let emptyMessage: string | null = null;
  let siteOptions: SitePickerOption[] = [];
  if (!filteredSites.length) {
    emptyMessage = effectiveClientFilterValue ? `No sites for "${effectiveClientFilterValue}"` : "No client sites in this branch";
  } else {
    siteOptions = filteredSites.map((s) => {
      const label = !effectiveClientFilterValue && s.clientName && s.clientName !== s.name ? `${s.clientName} — ${s.name}` : s.name;
      return { id: s.id, label: label + (s.archived ? " (Archived)" : "") };
    });
  }

  let branchBadgeText: string | null = null;
  if (!(viewer.isPayrollLike || viewer.isPrivileged)) {
    const site = allSites.find((s) => s.id === currentSiteId);
    const branch = site ? site.branch || null : null;
    branchBadgeText = branch ? `Branch: ${branch}` : "Branch: Unassigned";
  }

  let brandSubtitle = DEFAULT_BRAND_SUBTITLE;
  if (viewer.isHr) brandSubtitle = "HR — all branches, view & export only";
  else if (viewer.isPayroll) brandSubtitle = "Payroll — all branches, view & export only";
  else if (viewer.isPrivileged) brandSubtitle = "Master Schedule";
  else if (viewer.myDepartment) brandSubtitle = `${viewer.myDepartment} — security guard scheduling`;

  return {
    canFilterBranch,
    branchOptions,
    clientOptions,
    effectiveClientFilterValue,
    canSeeArchived,
    filteredSites,
    siteOptions,
    emptyMessage,
    branchBadgeText,
    brandSubtitle,
  };
}
