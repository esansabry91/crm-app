import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';

export default function ProtectedRoute({
  children,
  adminOnly = false,
  hideFromStaff = false,
  hidePayrollOnly = false,
  hideFromFinance = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /**
   * The "Operation Staff" role can only ever reach Duty Roster — every other route passes this
   * so an Operation Staff account bounces straight there instead of landing wherever this route
   * would show. "Payroll" and "HR" accounts are Duty-Roster-only in the same way (HR's only
   * difference is Guard Bank, handled separately by hidePayrollOnly below), so they're gated by
   * this too.
   */
  hideFromStaff?: boolean;
  /**
   * Narrower than hideFromStaff: blocks ONLY Payroll, leaving dutyStaff (and every other role)
   * through. Used by Guard Bank, which every role can reach except Payroll — Payroll's Duty
   * Roster access is strictly view/export (see the Role doc comments in types.ts), and Guard
   * Bank carries the same read/write-affecting data, so it stays out of reach the same way.
   */
  hidePayrollOnly?: boolean;
  /**
   * The "Finance" role can only ever reach Branch Collection — every other route (including
   * Duty Roster and Guard Bank, which have no hideFromStaff of their own since dutyStaff/payroll
   * need those) passes this so a Finance account bounces straight there instead of landing
   * wherever this route would show. See the Role doc comment in types.ts.
   */
  hideFromFinance?: boolean;
}) {
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!firebaseUser) return <Navigate to="/login" replace />;

  if (firebaseUser && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center text-sm text-slate-500">
          Your account doesn't have a CRM profile set up yet, or it has been deactivated. Contact
          your HQ admin.
        </div>
      </div>
    );
  }

  if (profile && profile.active === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center text-sm text-slate-500">
          Your account has been deactivated. Contact your HQ admin if this is unexpected.
        </div>
      </div>
    );
  }

  if (hideFromStaff && (profile?.role === 'dutyStaff' || profile?.role === 'payroll' || profile?.role === 'hr')) {
    return <Navigate to="/duty-roster" replace />;
  }

  if (hidePayrollOnly && profile?.role === 'payroll') {
    return <Navigate to="/duty-roster" replace />;
  }

  if (hideFromFinance && profile?.role === 'finance') {
    return <Navigate to="/branch-collection" replace />;
  }

  if (adminOnly && !isAdminRole(profile?.role)) {
    return <Navigate to="/pipeline" replace />;
  }

  return <>{children}</>;
}
