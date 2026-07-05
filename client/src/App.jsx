import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Applications from './pages/Applications';
import ApplicationWorkspace from './pages/ApplicationWorkspace';
import AuditLog from './pages/AuditLog';
import ReviewQueue from './pages/ReviewQueue';

export default function App() {
  const isBypassEnabled = import.meta.env.VITE_AUTH_DISABLED === 'true';

  return (
    <Routes>
      <Route 
        path="/login" 
        element={isBypassEnabled ? <Navigate to="/" replace /> : <Login />} 
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          
          {/* New Core Workspaces */}
          <Route path="applications" element={<Applications />} />
          <Route path="applications/:id" element={<ApplicationWorkspace />} />
          <Route path="review-queue" element={<ReviewQueue />} />
          <Route path="audit-log" element={<AuditLog />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}