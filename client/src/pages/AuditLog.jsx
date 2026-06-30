import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export default function AuditLog() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.get('/api/dashboard/audit-log').then((data) => setRows(data.auditLog || [])).catch(() => null);
  }, []);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Immutable Audit Trail</div>
        <table className="compact-table full-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Resource</th>
              <th>User</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.action}</td>
                <td>{row.resource_type || 'system'}</td>
                <td>{row.user_id || 'system'}</td>
                <td>{row.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
