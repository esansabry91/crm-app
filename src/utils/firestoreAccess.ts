import type { UserProfile } from '../types';
import { isAdminRole } from '../types';

/**
 * How a LIST/listen against `/users` must be constrained so Cloud Firestore can prove it
 * against firestore.rules' read rule:
 *   isAdmin() || request.auth.uid == uid || (isBranchManager() && role == 'dutyStaff' && department == myDepartment())
 *
 * An unfiltered collection query is only safe for admin-tier roles — `isAdmin()` is
 * unconditionally true regardless of resource.data. For everyone else the rule depends on
 * resource.data (or the document id), and Firestore denies the whole LIST rather than silently
 * dropping documents the caller can't read. Same class of bug as useTasks/useTenderHistory.
 */
export type UsersListPlan =
  | { mode: 'none' }
  | { mode: 'all' }
  | { mode: 'branchDutyStaff'; department: string };

export function usersListPlan(profile: UserProfile | null | undefined): UsersListPlan {
  if (!profile) return { mode: 'none' };
  if (isAdminRole(profile.role)) return { mode: 'all' };
  if (profile.role === 'branchManager' && profile.department) {
    return { mode: 'branchDutyStaff', department: profile.department };
  }
  return { mode: 'none' };
}

/**
 * How a LIST/listen against `/sites` must be constrained so Cloud Firestore can prove it
 * against firestore.rules' canReadSite():
 *   isAdmin() || myDepartment() == 'HQ' || isPayrollLike() || branch == null || branch == myDepartment()
 *   || canAssignSiteBranchViaTender()  // uses get() on the parent tender — NOT query-plannable
 *
 * Admin / HQ / Payroll / HR are unconditional regardless of resource.data, so they can listen
 * unfiltered. Everyone else must query `branch == myDepartment` and `branch == null` separately
 * and merge client-side — see useSiteList.ts, which already does this for Duty Roster.
 *
 * The get()-based `canAssignSiteBranchViaTender` clause (a site delegated to another branch
 * but still linked to a tender this caller owns) cannot be expressed as a where() constraint,
 * so a LIST will never return those rows. Single-document gets of a known id still work.
 */
export type SitesListPlan =
  | { mode: 'none' }
  | { mode: 'all' }
  | { mode: 'branchAndUnassigned'; department: string };

export function sitesListPlan(profile: UserProfile | null | undefined): SitesListPlan {
  if (!profile) return { mode: 'none' };
  if (
    isAdminRole(profile.role) ||
    profile.department === 'HQ' ||
    profile.role === 'payroll' ||
    profile.role === 'hr' ||
    profile.role === 'hrManager'
  ) {
    return { mode: 'all' };
  }
  return { mode: 'branchAndUnassigned', department: profile.department };
}

/**
 * Thrown (as Error.message) when a Branch Manager tries to accept a reassignment that was
 * requested before `pendingReassignment.siteIds` existed. A tenderId LIST of /sites is
 * permission-denied for them, so there is no way to discover the other branch's site ids.
 * The UI maps this code to a translated alert.
 */
export const REASSIGNMENT_SITES_UNAVAILABLE = 'REASSIGNMENT_SITES_UNAVAILABLE';

/** `siteIds` recorded on a pending reassignment, or null when the field was never written
 *  (requests created before it existed). An empty array is recorded — the project had no
 *  following sites — and must not be treated as "unknown". */
export function recordedReassignmentSiteIds(
  pending: { siteIds?: string[] } | null | undefined
): string[] | null {
  if (!pending || !Array.isArray(pending.siteIds)) return null;
  return pending.siteIds;
}

/**
 * Whether a site still "follows" the project branch a reassignment or first assignment is
 * moving. Null and missing branch are the same (unassigned). `alsoSweepUnassigned` is only
 * for the first-ever assignment: a site that never inherited a branch comes along even when
 * `fromBranch` is a real department. A later branch-to-branch move leaves a deliberately
 * unassigned site where it is.
 */
export function siteFollowsProjectBranch(
  branch: string | null | undefined,
  fromBranch: string | null,
  alsoSweepUnassigned = false
): boolean {
  const current = branch ?? null;
  const from = fromBranch ?? null;
  if (current === from) return true;
  return alsoSweepUnassigned && current === null;
}

/**
 * Client-side half of a non-privileged /sites LIST: the caller can read their own department
 * and unassigned sites, then keep only the ones linked to this tender. A site delegated to
 * another branch is not in that result — the get()-based rule that would allow it is not
 * query-plannable.
 */
export function isLinkedSiteVisibleInBranchList(
  site: { tenderId?: string | null; branch?: string | null },
  tenderId: string,
  department: string
): boolean {
  if (site.tenderId !== tenderId) return false;
  const branch = site.branch ?? null;
  return branch === null || branch === department;
}
