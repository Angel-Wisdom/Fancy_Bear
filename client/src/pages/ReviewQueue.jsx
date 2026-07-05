import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import AlertBadge from '../components/AlertBadge';

export default function ReviewQueue() {
  const [alerts, setAlerts] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/review/review-queue')
      .then(res => setAlerts(res.alerts || []))
      .catch(console.error);
  }, []);

  return (
    <div className="flex-col gap-4 w-full">
      <h2 className="text-2xl font-bold">Review Queue</h2>
      <div className="panel p-0 overflow-hidden">
        <table className="compact-table w-full">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Applicant</th>
              <th>Issue</th>
              <th>Resource</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map(a => (
              <tr key={a.id}>
                <td><AlertBadge severity={a.severity}>{a.severity}</AlertBadge></td>
                <td className="font-bold">{a.applicant_name}</td>
                <td>{a.title}</td>
                <td className="text-secondary text-sm">{a.document_name || 'System'}</td>
                <td>
                  <button 
                    className="btn-text" 
                    onClick={() => navigate(`/applications/${a.customer_id}`)}
                  >
                    View Case
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}