import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import PipelinePage from './pages/PipelinePage';
import AnalysisPage from './pages/AnalysisPage';
import ActiveProjectsPage from './pages/ActiveProjectsPage';
import PastProjectsPage from './pages/PastProjectsPage';
import AdminPage from './pages/AdminPage';

function LoginRoute() {
  const { firebaseUser, loading } = useAuth();
  if (loading) return null;
  if (firebaseUser) return <Navigate to="/pipeline" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/pipeline"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <PipelinePage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/analysis"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <AnalysisPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/active-projects"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ActiveProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/past-projects"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <PastProjectsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <AppLayout>
                  <AdminPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/pipeline" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
