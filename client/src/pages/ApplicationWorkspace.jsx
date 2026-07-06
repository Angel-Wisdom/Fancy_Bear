import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import DocumentsTab from '../components/DocumentsTab';
import FinancialTab from '../components/FinancialTab';
import LandTab from '../components/LandTab';

export default function ApplicationWorkspace() {
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState('documents');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/customers`)
      .then(res => {
        const found = (res.customers || res || []).find(c => c.id === id);
        if (found) setCustomer(found);
        else setCustomer(null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

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
          disabled={!customer}
          title={!customer ? 'Applicant must load first' : 'Generate report'}
        >
          Generate report
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

        {/* Placeholder Shells for Phase 5 continued work */}
        {activeTab === 'findings' && (
          <div className="panel p-8 text-center flex-col items-center justify-center gap-2 h-full">
            <h3 className="font-bold text-primary">Cross-Document Correlation</h3>
            <p className="text-secondary">Awaiting Day 3 correlation engine integration.</p>
          </div>
        )}
      </div>
    </div>
  );
}