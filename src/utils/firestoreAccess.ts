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
