import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import AlertBadge from '../components/AlertBadge';

export default function LandRecords() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [record, setRecord] = useState(null);

  useEffect(() => {
    api.get('/api/customers').then((data) => {
      const list = data.customers || [];
      setCustomers(list);
      setCustomerId(list[0]?.id || '');
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!customerId) return;
    api.get(`/api/customers/${customerId}/land-record`).then((data) => setRecord(data.record || null)).catch(() => setRecord(null));
  }, [customerId]);

  const ownershipChain = Array.isArray(record?.ownership_chain_json) ? record.ownership_chain_json : [];

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Record Verification View</div>
        <label className="inline-field">
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
          </select>
        </label>
      </section>

      <section className="two-column-grid">
        <div className="panel">
          <div className="panel-title">Land Record Details</div>
          {record ? (
            <dl className="definition-grid">
              <div><dt>Survey No.</dt><dd>{record.survey_number}</dd></div>
              <div><dt>Owner</dt><dd>{record.registered_owner}</dd></div>
              <div><dt>Area</dt><dd>{record.total_area} {record.area_unit}</dd></div>
              <div><dt>Encumbrance</dt><dd>{record.has_encumbrance ? 'Yes' : 'No'}</dd></div>
            </dl>
          ) : <p className="muted">Select a customer to load land data.</p>}
        </div>

        <div className="panel">
          <div className="panel-title">Discrepancy Highlights</div>
          {record ? (
            <div className="stack-list">
              <div className="feed-item"><AlertBadge severity={record.has_encumbrance ? 'high' : 'low'}>{record.has_encumbrance ? 'encumbrance' : 'clear'}</AlertBadge><p>Encumbrance status rendered from the seeded record.</p></div>
              <div className="feed-item"><AlertBadge severity="medium">survey</AlertBadge><p>Survey number and area validations render here.</p></div>
            </div>
          ) : <p className="muted">Highlights appear after a record is loaded.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">Ownership Chain</div>
        <div className="timeline-list">
          {ownershipChain.length ? ownershipChain.map((node, index) => (
            <div key={`${node.owner}-${index}`} className="timeline-row">
              <strong>{node.owner}</strong>
              <p>{node.date || 'historical transfer'}</p>
            </div>
          )) : <p className="muted">Ownership chain is serialized from the backend record when available.</p>}
        </div>
      </section>
    </div>
  );
}
