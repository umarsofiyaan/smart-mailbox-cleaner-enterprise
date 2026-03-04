import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import Home     from './pages/Home';
import Login    from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pricing  from './pages/Pricing';
import Admin    from './pages/Admin';
import Privacy  from './pages/Privacy';
import Terms    from './pages/Terms';
import SiteFooter from './components/SiteFooter';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return user.isAdmin ? children : <Navigate to="/dashboard" replace />;
}

function ExtensionAuth() {
  const params = new URLSearchParams(window.location.search);
  const accessToken  = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (accessToken) {
    localStorage.setItem('access_token', accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
    window.close();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <p className="text-2xl mb-2">OK</p>
        <p className="font-semibold text-gray-900">Connected! You can close this tab.</p>
      </div>
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const hideFooter = location.pathname === '/extension-auth';

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <Routes>
          <Route path="/"                element={<Home />} />
          <Route path="/home"            element={<Home />} />
          <Route path="/login"           element={<Login />} />
          <Route path="/pricing"         element={<Pricing />} />
          <Route path="/privacy-policy"  element={<Privacy />} />
          <Route path="/terms-of-service" element={<Terms />} />
          <Route path="/privacy"         element={<Navigate to="/privacy-policy" replace />} />
          <Route path="/terms"           element={<Navigate to="/terms-of-service" replace />} />
          <Route path="/extension-auth"  element={<ExtensionAuth />} />
          <Route path="/dashboard"       element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/admin"           element={<AdminRoute><Admin /></AdminRoute>} />
        </Routes>
      </main>
      {!hideFooter && <SiteFooter />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}
