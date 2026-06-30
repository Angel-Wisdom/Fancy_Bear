import { useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import BenfordChart from '../components/BenfordChart';
import AlertBadge from '../components/AlertBadge';

function benfordDistribution(records = []) {
  const expected = [1,2,3,4,5,6,7,8,9].map((digit) => Math.log10(1 + 1 / digit));
  const actualCounts = Array(9).fill(0);
  let total = 0;
  records.forEach((record) => {
    const digit = String(Math.abs(Number(record.amount) || 0)).replace(/[^0-9]/g, '').replace(/^0+/, '')[0];
    if (digit) {
      actualCounts[Number(digit) - 1] += 1;
      total += 1;
    }
  });
  return actualCounts.map((count, index) => ({ digit: String(index + 1), actual: total ? +(count / total).toFixed(2) : 0, expected: +expected[index].toFixed(2) }));
}

export default function FinancialAnalysis() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [records, setRecords] = useState([]);

  useEffect(() => {
    api.get('/api/customers').then((data) => {
      const list = data.customers || [];
      setCustomers(list);
      setCustomerId(list[0]?.id || '');
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!customerId) return;
    api.get(`/api/customers/${customerId}/financial-records`).then((data) => setRecords(data.records || [])).catch(() => setRecords([]));
  }, [customerId]);

  const benford = useMemo(() => benfordDistribution(records), [records]);
  const suspicious = records.filter((record) => Number(record.amount) > 0 && Number(record.amount) < 1000);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Customer Financial Dashboard</div>
        <label className="inline-field">
          Customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
          </select>
        </label>
      </section>

      <section className="two-column-grid">
        <div className="panel">
          <div className="panel-title">Transaction Timeline</div>
          <div className="timeline-list">
            {records.slice(0, 12).map((record) => (
              <div className="timeline-row" key={record.id}>
                <span>{record.transaction_date}</span>
                <strong>₹{Number(record.amount).toLocaleString('en-IN')}</strong>
                <p>{record.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Salami Attack Detection</div>
          <div className="stack-list">
            {suspicious.length ? suspicious.slice(0, 8).map((record) => (
              <div key={record.id} className="feed-item">
                <AlertBadge severity="high">flag</AlertBadge>
                <div>
                  <strong>₹{Number(record.amount).toLocaleString('en-IN')}</strong>
                  <p>{record.description}</p>
                </div>
              </div>
            )) : <p className="muted">No suspicious micro-transactions detected in the current slice.</p>}
          </div>
        </div>
      </section>

      <section className="panel">
        <BenfordChart data={benford} />
      </section>
    </div>
  );
}
