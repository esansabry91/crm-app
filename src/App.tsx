import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import PipelinePage from './pages/PipelinePage';
import AnalysisPage from './pages/AnalysisPage';
import ActiveProjectsPage from './pages/ActiveProjectsPage';
import PastProjectsPage from './pages/PastProjectsPage';
import DutyRosterPage from './pages/DutyRosterPage';
import QuotationCalculatorPage from './pages/QuotationCalculatorPage';
import AdminPage from './pages/AdminPage';
import NewTenderWatcher from './components/notifications/NewTenderWatcher';

/** A "Staff" or "Payroll" account can only ever reach Duty Roster; everyone else's home is Pipeline. */
function defaultRouteFor(role: string | undefined): string {
  return role === 'dutyStaff' || role === 'payroll' ? '/duty-roster' : '/pipeline';
}

function LoginRoute() {
  const { firebaseUser, profile, loading } = useAuth();
  if (loading) return null;
  if (firebaseUser) return <Navigate to={defaultRouteFor(profile?.role)} replace />;
  return <LoginPage />;
}

/** Catch-all target — same role-aware default as LoginRoute, for any unmatched path. */
function DefaultRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={defaultRouteFor(profile?.role)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Mounted once here (not inside AppLayout, which remounts on every route change) so the
            live "new tender" listener survives page navigation instead of resetting each time. */}
        <NewTenderWatcher />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/pipeline"
            element={
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <PipelinePage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis"
            element={
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <AnalysisPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/active-projects"
            element={
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <ActiveProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/past-projects"
            element={
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <PastProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duty-roster"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <DutyRosterPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/quotation-calculator"
            element={
              // hideFromStaff alone restricts this to exactly admin + branchManager — those are
              // the only two roles it doesn't bounce to Duty Roster, since dutyStaff and payroll
              // are the only roles it excludes.
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <QuotationCalculatorPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly hideFromStaff>
                <AppLayout>
                  <AdminPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
