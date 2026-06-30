import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UploadVerify from './pages/UploadVerify';
import VerificationResults from './pages/VerificationResults';
import FinancialAnalysis from './pages/FinancialAnalysis';
import LandRecords from './pages/LandRecords';
import Reports from './pages/Reports';
import AuditLog from './pages/AuditLog';
import AadhaarVerify from './pages/AadhaarVerify';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="upload" element={<UploadVerify />} />
          <Route path="results" element={<VerificationResults />} />
          <Route path="results/:documentId" element={<VerificationResults />} />
          <Route path="financial" element={<FinancialAnalysis />} />
          <Route path="land-records" element={<LandRecords />} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="aadhaar-verify" element={<AadhaarVerify />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
