import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ChevronRight } from 'lucide-react';
import { api } from '../utils/api';

/**
 * Applications
 * ------------
 * Lists all applicants with search and create-new actions.
 *
 * Logic & data flow unchanged from original.
 */
export default function Applications() {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [newApplicantName, setNewApplicantName] = useState('');
  const [creatingApplicant, setCreatingApplicant] = useState(false);
  const [createError, setCreateError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
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

  async function handleCreateApplicant(event) {
    event.preventDefault();
    const fullName = newApplicantName.trim();
    if (!fullName) {
      setCreateError('Enter the applicant name to create a new application.');
      return;
    }

    setCreatingApplicant(true);
    setCreateError('');
    try {
      const response = await api.post('/api/customers', { fullName });
      const customer = response.customer;
      if (customer) {
        setCustomers((current) => [customer, ...current]);
        setNewApplicantName('');
        navigate(`/applications/${customer.id}`);
      }
    } catch (error) {
      setCreateError(error.message || 'Unable to create applicant right now.');
    } finally {
      setCreatingApplicant(false);
    }
  }

  return (
    <div className="flex-col gap-6 w-full">
      <div className="flex justify-between items-end mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold mb-1">Applications</h2>
          <p className="text-secondary text-sm">Select an applicant to open their underwriting workspace.</p>
        </div>
      </div>

      <div className="panel flex-col gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <form className="flex items-end gap-3 flex-wrap" onSubmit={handleCreateApplicant}>
            <label className="flex-col gap-2" style={{ minWidth: '260px' }}>
              Add new applicant
              <input
                type="text"
                value={newApplicantName}
                onChange={(event) => setNewApplicantName(event.target.value)}
                placeholder="Enter applicant name"
              />
            </label>
            <button className="btn-primary" type="submit" disabled={creatingApplicant}>
              <Plus size={16} />
              {creatingApplicant ? 'Creating…' : 'Create applicant'}
            </button>
          </form>

          <div className="search-box" style={{ maxWidth: '320px', backgroundColor: 'var(--surface-raised)' }}>
            <Search size={16} className="text-tertiary shrink-0" />
            <input
              type="text"
              placeholder="Search by name or PAN…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full"
              style={{ backgroundColor: 'transparent', border: 'none', outline: 'none' }}
            />
          </div>
        </div>

        {createError ? <div className="inline-error">{createError}</div> : null}
      </div>

      <div className="panel p-0 overflow-hidden w-full">
        <div className="table-scroll-wrap">
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
                  <td colSpan="5" className="py-4 text-center text-secondary text-sm">Loading applications…</td>
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
                    <td className="text-secondary uppercase tracking-wide font-mono text-xs">{customer.pan_number || 'N/A'}</td>
                    <td className="text-secondary">{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}</td>
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
    </div>
  );
}
