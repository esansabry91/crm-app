import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({
  children,
  adminOnly = false,
  hideFromStaff = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  /**
   * The "Staff" role can only ever reach Duty Roster — every other route passes this so a
   * Staff account bounces straight there instead of landing wherever this route would show.
   */
  hideFromStaff?: boolean;
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

  if (hideFromStaff && profile?.role === 'dutyStaff') {
    return <Navigate to="/duty-roster" replace />;
  }

  if (adminOnly && profile?.role !== 'admin') {
    return <Navigate to="/pipeline" replace />;
  }

  return <>{children}</>;
}
