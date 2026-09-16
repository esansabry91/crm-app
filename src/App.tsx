import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import PipelinePage from './pages/PipelinePage';
import AnalysisPage from './pages/AnalysisPage';
import ActiveProjectsPage from './pages/ActiveProjectsPage';
import PastProjectsPage from './pages/PastProjectsPage';
import ArchivePage from './pages/ArchivePage';
import DutyRosterPage from './pages/DutyRosterPage';
import GuardBankPage from './pages/GuardBankPage';
import QuotationCalculatorPage from './pages/QuotationCalculatorPage';
import AdminPage from './pages/AdminPage';
import BranchCollectionPage from './pages/BranchCollectionPage';
import NewTenderWatcher from './components/notifications/NewTenderWatcher';
import TenderAssignedWatcher from './components/notifications/TenderAssignedWatcher';

/** An "Operation Staff", "Payroll", or "HR" account can only ever reach Duty Roster, a
 *  "Finance" account can only ever reach Branch Collection; everyone else's home is Pipeline. */
function defaultRouteFor(role: string | undefined): string {
  if (role === 'dutyStaff' || role === 'payroll' || role === 'hr') return '/duty-roster';
  if (role === 'finance') return '/branch-collection';
  return '/pipeline';
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
            live "new tender" listeners survive page navigation instead of resetting each time.
            Each watcher checks the signed-in role itself and renders nothing for every other
            role, so it's safe to always mount both. */}
        <NewTenderWatcher />
        <TenderAssignedWatcher />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/pipeline"
            element={
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <PipelinePage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis"
            element={
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <AnalysisPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/active-projects"
            element={
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <ActiveProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/past-projects"
            element={
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <PastProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/archive"
            element={
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <ArchivePage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/duty-roster"
            element={
              <ProtectedRoute hideFromFinance>
                <AppLayout>
                  <DutyRosterPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/guard-bank"
            element={
              <ProtectedRoute hidePayrollOnly hideFromFinance>
                <AppLayout>
                  <GuardBankPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/quotation-calculator"
            element={
              // hideFromStaff alone restricts this to admin + branchManager + developer +
              // ceo/director/tenderController — those are the only roles it doesn't bounce to
              // Duty Roster, since dutyStaff, payroll, and hr are the only roles it excludes.
              // index.html itself (and firestore.rules) also allow developer/ceo/director/
              // tenderController, matching isAdminRole()'s treatment of them as admin-equivalent.
              // hideFromFinance keeps Finance out too, same as every other non-Branch-Collection
              // route.
              <ProtectedRoute hideFromStaff hideFromFinance>
                <AppLayout>
                  <QuotationCalculatorPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              // allowBranchManager: a Branch Manager reaches Admin Settings too now, scoped by
              // AdminPage.tsx itself to just the Team tab (add/manage their own branch's
              // Operation Staff — see firestore.rules' /users rules for the matching
              // server-side scoping).
              <ProtectedRoute adminOnly allowBranchManager hideFromStaff hideFromFinance>
                <AppLayout>
                  <AdminPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/branch-collection"
            element={
              <ProtectedRoute hideFromStaff>
                <AppLayout>
                  <BranchCollectionPage />
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
