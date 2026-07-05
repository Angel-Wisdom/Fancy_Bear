import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Make sure this matches the route you added above
    api.get('/api/audit-logs') 
      .then(res => {
        console.log("Audit Logs Response:", res); // Debug check
        setLogs(res.logs || []);
      })
      .catch(console.error);
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
            {logs.map(log => (
              <tr key={log.id}>
                <td className="text-xs text-secondary">{log.created_at}</td>
                <td><code className="text-xs">{log.action}</code></td>
                <td className="text-xs font-mono">{log.resource_id}</td>
                <td className="text-xs text-secondary truncate max-w-xs">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}