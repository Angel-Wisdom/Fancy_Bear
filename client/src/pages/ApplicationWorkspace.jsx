import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import DocumentsTab from '../components/DocumentsTab';
import FinancialTab from '../components/FinancialTab';
import LandTab from '../components/LandTab';
import CrossDocumentTab from '../components/CrossDocumentTab';

export default function ApplicationWorkspace() {
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState('documents');
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/customers/${id}`)
      .then(res => setCustomer(res.customer || null))
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, [id]);

  function handleGenerateReport() {
    setReportLoading(true);
    // Open the PDF in a new tab so the user keeps their workspace context.
    const token = localStorage.getItem('suraksha_token');
    // Use fetch so we can attach the Authorization header (window.open can't).
    fetch(`/api/reports/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(response => {
        if (!response.ok) throw new Error(`Report fetch failed: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        // Revoke the URL after the new tab has had time to load it.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch(err => {
        console.error('Report generation failed:', err);
        alert('Could not generate the PDF report. Please try again.');
      })
      .finally(() => setReportLoading(false));
  }

  return (
    <div className="flex-col w-full h-full min-h-0">
      {/* ===== HEADER (fixed, never scrolls) ===== */}
      <div className="flex justify-between items-start pb-4 border-b border-default w-full shrink-0 gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold mb-1 truncate">
            {loading ? 'Loading applicant…' : (customer?.full_name || 'Unknown applicant')}
          </h2>
          <p className="text-secondary text-sm">
            Applicant ID: <code className="text-xs">{id}</code>
            {customer?.pan_number ? <> • PAN: <span className="font-mono">{customer.pan_number}</span></> : null}
          </p>
        </div>
        <button
          className="btn-primary shrink-0"
          disabled={!customer || reportLoading}
          title={!customer ? 'Applicant must load first' : 'Download PDF report'}
          onClick={handleGenerateReport}
        >
          {reportLoading ? 'Generating…' : 'Generate report'}
        </button>
      </div>

      {/* ===== TABS BAR (fixed, never scrolls) ===== */}
      <div className="tabs-row w-full mt-4 shrink-0">
        <button
          className={`tab-button ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >Documents</button>
        <button
          className={`tab-button ${activeTab === 'findings' ? 'active' : ''}`}
          onClick={() => setActiveTab('findings')}
        >Cross-document findings</button>
        <button
          className={`tab-button ${activeTab === 'financial' ? 'active' : ''}`}
          onClick={() => setActiveTab('financial')}
        >Financial analysis</button>
        <button
          className={`tab-button ${activeTab === 'land' ? 'active' : ''}`}
          onClick={() => setActiveTab('land')}
        >Land record</button>
      </div>

      {/* ===== ACTIVE TAB CONTENT (fills remaining height, scrolls internally) ===== */}
      <div className="w-full flex-1 min-h-0 overflow-hidden">
        {activeTab === 'documents' && <DocumentsTab customerId={id} />}
        {activeTab === 'financial' && <FinancialTab customerId={id} />}
        {activeTab === 'land' && <LandTab customerId={id} />}
        {activeTab === 'findings' && <CrossDocumentTab customerId={id} />}
      </div>
    </div>
  );
}
