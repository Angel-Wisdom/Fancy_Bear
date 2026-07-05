import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import { api } from '../utils/api';

export default function Applications() {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Relying on the existing endpoint per the UI Rebuild Plan
    api.get('/api/customers')
      .then(res => {
        setCustomers(res.customers || res || []);
      })
      .catch(err => console.error("Failed to load customers:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = customers.filter(c =>
    c.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.pan_number?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-col gap-6 w-full">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Applications</h2>
          <p className="text-secondary text-sm">Select an applicant to open their underwriting workspace.</p>
        </div>
        
        <div className="search-box" style={{ maxWidth: '320px', backgroundColor: 'var(--surface-raised)' }}>
          <Search size={16} className="text-tertiary" />
          <input
            type="text"
            placeholder="Search by name or PAN..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full"
            style={{ backgroundColor: 'transparent', border: 'none', outline: 'none' }}
          />
        </div>
      </div>

      <div className="panel p-0 overflow-hidden w-full">
        <table className="compact-table w-full">
          <thead>
            <tr>
              <th>Applicant Name</th>
              <th>PAN Identifier</th>
              <th>Applied On</th>
              <th>System Risk Score</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="5" className="py-4 text-center text-secondary text-sm">Loading applications...</td>
              </tr>
            ) : filtered.length > 0 ? (
              filtered.map(customer => (
                <tr 
                  key={customer.id} 
                  onClick={() => navigate(`/applications/${customer.id}`)}
                  style={{ cursor: 'pointer' }}
                  className="hover:bg-muted"
                >
                  <td className="font-bold text-primary">{customer.full_name}</td>
                  <td className="text-secondary uppercase tracking-wide">{customer.pan_number || 'N/A'}</td>
                  <td className="text-secondary">{new Date(customer.created_at).toLocaleDateString()}</td>
                  <td>
                    <span className={`badge ${customer.risk_score > 70 ? 'badge-danger' : customer.risk_score > 30 ? 'badge-warning' : 'badge-success'}`}>
                      {customer.risk_score || 0}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <ChevronRight size={16} className="text-tertiary inline" />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="py-6 text-center text-secondary text-sm">
                  No applications match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}