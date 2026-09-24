import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';

export default function ProtectedRoute({
  children,
  adminOnly = false,
  allowBranchManager = false,
  hideFromStaff = false,
  allowOperationAdmin = false,
  hidePayrollOnly = false,
  hideHr = false,
  hideFromFinance = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /**
   * Only meaningful alongside adminOnly — additionally lets a 'branchManager' account through an
   * adminOnly route, for Admin Settings' scoped-to-Team-tab reach (see AdminPage.tsx, which
   * itself further narrows a Branch Manager to just the Team tab, and firestore.rules' /users
   * rules for the matching server-side scoping). Every other adminOnly route deliberately leaves
   * this false — Branch Manager gets Admin Settings and nothing else new.
   */
  allowBranchManager?: boolean;
  /**
   * The "Operation Staff" role can only ever reach Duty Roster — every other route passes this
   * so an Operation Staff account bounces straight there instead of landing wherever this route
   * would show. "Operation Admin" is the same role under a different job title (see the Role doc
   * comment in types.ts) so it's gated identically. "Payroll" and "HR" accounts are
   * Duty-Roster-only in the same way (HR's only difference is Guard Bank, handled separately by
   * hidePayrollOnly below), so they're gated by this too.
   */
  hideFromStaff?: boolean;
  /**
   * Only meaningful alongside hideFromStaff — additionally lets an 'operationAdmin' account
   * through, while dutyStaff/payroll/hr still bounce to Duty Roster. Used only by Branch
   * Collection's route: Operation Admin is otherwise gated identically to dutyStaff (see
   * hideFromStaff's own doc comment), except it's now also let into Branch Collection, scoped
   * client-side (BranchCollectionPage.tsx) to just the Generate Invoice and Invoices tabs, and
   * server-side (firestore.rules' isOperationAdmin()) to the matching /invoices writes.
   */
  allowOperationAdmin?: boolean;
  /**
   * Narrower than hideFromStaff: blocks ONLY Payroll, leaving dutyStaff (and every other role)
   * through. Used by Guard Bank, which every role can reach except Payroll — Payroll's Duty
   * Roster access is strictly view/export (see the Role doc comments in types.ts), and Guard
   * Bank carries the same read/write-affecting data, so it stays out of reach the same way.
   */
  hidePayrollOnly?: boolean;
  /**
   * Narrower still: blocks ONLY HR, leaving dutyStaff/branchManager/admin-tier roles through.
   * Used by Task Board, which HR has no reason to reach (it's Branch Manager <-> Operation
   * Staff task assignment, not a Guard Bank/Duty Roster concern) but which dutyStaff and
   * payroll are excluded from differently: dutyStaff needs it (they're the assignee), so it
   * isn't covered by hideFromStaff; payroll is covered by hidePayrollOnly above instead.
   */
  hideHr?: boolean;
  /**
   * The "Finance" role can only ever reach Branch Collection — every other route (including
   * Duty Roster and Guard Bank, which have no hideFromStaff of their own since dutyStaff/payroll
   * need those) passes this so a Finance account bounces straight there instead of landing
   * wherever this route would show. See the Role doc comment in types.ts.
   */
  hideFromFinance?: boolean;
}) {
  const { t } = useTranslation();
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        {t('protectedRoute.loading')}
      </div>
    );
  }

  if (!firebaseUser) return <Navigate to="/login" replace />;

  if (firebaseUser && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center text-sm text-slate-500">
          {t('protectedRoute.noProfile')}
        </div>
      </div>
    );
  }

  if (profile && profile.active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center text-sm text-slate-500">
          {t('protectedRoute.deactivated')}
        </div>
      </div>
    );
  }

  if (
    hideFromStaff &&
    !(allowOperationAdmin && profile?.role === 'operationAdmin') &&
    (profile?.role === 'dutyStaff' ||
      profile?.role === 'operationAdmin' ||
      profile?.role === 'payroll' ||
      profile?.role === 'hr')
  ) {
    return <Navigate to="/duty-roster" replace />;
  }

  if (hidePayrollOnly && profile?.role === 'payroll') {
    return <Navigate to="/duty-roster" replace />;
  }

  if (hideHr && profile?.role === 'hr') {
    return <Navigate to="/duty-roster" replace />;
  }

  if (hideFromFinance && profile?.role === 'finance') {
    return <Navigate to="/branch-collection" replace />;
  }

  if (adminOnly && !isAdminRole(profile?.role) && !(allowBranchManager && profile?.role === 'branchManager')) {
    return <Navigate to="/pipeline" replace />;
  }

  return <>{children}</>;
}
