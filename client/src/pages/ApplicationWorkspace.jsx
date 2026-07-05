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

  useEffect(() => {
    api.get(`/api/customers`)
      .then(res => {
        const found = (res.customers || res || []).find(c => c.id === id);
        if (found) setCustomer(found);
      }).catch(console.error);
  }, [id]);

  return (
    <div className="flex-col gap-4 w-full">
      <div className="flex justify-between items-start pb-4 border-b border-default w-full">
        <div>
          <h2 className="text-3xl font-bold mb-1">{customer?.full_name || 'Loading applicant...'}</h2>
          <p className="text-secondary text-sm">
            Applicant ID: {id} {customer?.pan_number ? `• PAN: ${customer.pan_number}` : ''}
          </p>
        </div>
        <button className="btn-primary">Generate report</button>
      </div>

      <div className="tabs-row w-full mt-2">
        <button className={`tab-button ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>Documents</button>
        <button className={`tab-button ${activeTab === 'findings' ? 'active' : ''}`} onClick={() => setActiveTab('findings')}>Cross-document findings</button>
        <button className={`tab-button ${activeTab === 'financial' ? 'active' : ''}`} onClick={() => setActiveTab('financial')}>Financial analysis</button>
        <button className={`tab-button ${activeTab === 'land' ? 'active' : ''}`} onClick={() => setActiveTab('land')}>Land record</button>
      </div>

      <div className="w-full mt-2">
        {activeTab === 'documents' && <DocumentsTab customerId={id} />}
        {activeTab === 'financial' && <FinancialTab customerId={id} />}
        {activeTab === 'land' && <LandTab customerId={id} />}
        
        {/* Placeholder Shells for Phase 5 continued work */}
        {activeTab === 'findings' && (
          <div className="panel p-8 text-center flex-col items-center justify-center gap-2">
            <h3 className="font-bold text-primary">Cross-Document Correlation</h3>
            <p className="text-secondary">Awaiting Day 3 correlation engine integration.</p>
          </div>
        )}
      </div>
    </div>
  );
}