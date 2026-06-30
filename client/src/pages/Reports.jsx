import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import RiskGauge from '../components/RiskGauge';

export default function Reports() {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    api.get('/api/customers').then((data) => {
      const list = data.customers || [];
      setCustomers(list);
      setCustomerId(list[0]?.id || '');
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (!customerId) return;
    api.get(`/api/reports/${customerId}`).then((data) => setReport(data)).catch(() => setReport(null));
  }, [customerId]);

  async function downloadPdf() {
    if (!customerId) return;
    const response = await fetch(`/api/reports/${customerId}/pdf`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('suraksha_token')}` },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `suraksha-report-${customerId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const details = report?.report?.details || null;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Comprehensive Report View</div>
        <label className="inline-field">
          Application
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
          </select>
        </label>
      </section>

      <section className="two-column-grid">
        <div className="panel">
          <div className="panel-title">Decision Support</div>
          <RiskGauge value={report?.report?.overall_score || 68} label={report?.recommendation || 'Review'} />
          {customerId ? <button className="primary-button report-download" type="button" onClick={downloadPdf}>Download PDF Report</button> : null}
        </div>
        <div className="panel">
          <div className="panel-title">Verification Payload</div>
          <p className="muted">Signed report generated from the latest stored verification result.</p>
          <pre className="code-block">{JSON.stringify(details || report, null, 2)}</pre>
        </div>
      </section>

      {report?.alerts?.length ? (
        <section className="panel">
          <div className="panel-title">Report Alerts</div>
          <div className="stack-list">
            {report.alerts.map((alert) => (
              <div className="alert-copy" key={alert.id}>
                <strong>{alert.severity?.toUpperCase()} · {alert.title}</strong>
                <p>{alert.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
