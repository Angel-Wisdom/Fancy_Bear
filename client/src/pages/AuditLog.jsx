import { useEffect, useState } from 'react';
import { api } from '../utils/api';

function formatDetails(value) {
  if (!value) return '—';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Object.keys(parsed).length ? JSON.stringify(parsed) : value;
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/audit-logs')
      .then(res => setLogs(res.logs || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex-col gap-4 w-full">
      <h2 className="text-2xl font-bold">System Audit Log</h2>
      <div className="panel p-0 overflow-hidden">
        <table className="compact-table w-full">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Resource ID</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" className="py-4 text-center text-secondary text-sm">Loading audit trail…</td>
              </tr>
            ) : logs.length ? (
              logs.map(log => (
                <tr key={log.id}>
                  <td className="text-xs text-secondary tabular-nums">{log.created_at}</td>
                  <td><code className="text-xs">{log.action}</code></td>
                  <td className="text-xs font-mono">{log.resource_id || '—'}</td>
                  <td className="text-xs text-secondary truncate" style={{ maxWidth: '320px' }} title={formatDetails(log.details_json)}>
                    {formatDetails(log.details_json)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" className="py-4 text-center text-secondary text-sm">No audit entries yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}