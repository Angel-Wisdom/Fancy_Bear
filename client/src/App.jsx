import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Applications from './pages/Applications';
import ApplicationWorkspace from './pages/ApplicationWorkspace';
import UploadVerify from './pages/UploadVerify';
import VerificationResults from './pages/VerificationResults';
import FinancialAnalysis from './pages/FinancialAnalysis';
import LandRecords from './pages/LandRecords';
import AuditLog from './pages/AuditLog';

// Still keeping Phase 6 placeholder
function ReviewQueuePlaceholder() {
  return (
    <div className="panel">
      <h2 className="panel-title">Review Queue</h2>
      <p className="text-secondary">Portfolio-wide alert list sorted by risk profile coming soon.</p>
    </div>
  );
}

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
          <Route path="review-queue" element={<ReviewQueuePlaceholder />} />
          <Route path="audit-log" element={<AuditLog />} />

          {/* Legacy Back-Compat Routes */}
          <Route path="upload" element={<UploadVerify />} />
          <Route path="results" element={<VerificationResults />} />
          <Route path="results/:documentId" element={<VerificationResults />} />
          <Route path="financial" element={<FinancialAnalysis />} />
          <Route path="land-records" element={<LandRecords />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}