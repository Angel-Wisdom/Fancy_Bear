import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { api } from '../utils/api';
import StatsCard from '../components/StatsCard';
import AlertBadge from '../components/AlertBadge';

const trendSeed = [
  { day: 'Mon', value: 18 },
  { day: 'Tue', value: 14 },
  { day: 'Wed', value: 21 },
  { day: 'Thu', value: 17 },
  { day: 'Fri', value: 10 },
  { day: 'Sat', value: 13 },
  { day: 'Sun', value: 9 },
];

export default function Dashboard() {
  const [stats, setStats] = useState({ totalDocuments: 0, totalAlerts: 0, passRate: 0, avgProcessingTime: 0 });
  const [alerts, setAlerts] = useState([]);
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    api.get('/api/dashboard/stats').then(setStats).catch(() => null);
    api.get('/api/dashboard/alerts').then((data) => setAlerts(data.alerts || [])).catch(() => null);
    api.get('/api/dashboard/audit-log').then((data) => setAudit(data.auditLog || [])).catch(() => null);
  }, []);

  const statusData = [
    { name: 'Verified', value: Math.max(0, stats.totalDocuments - stats.totalAlerts) },
    { name: 'Suspicious', value: Math.round(stats.totalAlerts * 0.6) || 4 },
    { name: 'Rejected', value: Math.round(stats.totalAlerts * 0.4) || 2 },
  ];

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Real-time underwriting intelligence</p>
          <h1>Risk orchestration for offline document verification.</h1>
          <p>Live stats, tamper alerts, and verification trails for KYC, financial statements, and land records.</p>
        </div>
        <div className="hero-metric">
          <strong>{stats.passRate || 0}%</strong>
          <span>Pass rate</span>
        </div>
      </section>

      <section className="stats-grid">
        <StatsCard label="Documents Processed" value={stats.totalDocuments} delta="Offline queue" icon={FileText} />
        <StatsCard label="Alerts Detected" value={stats.totalAlerts} delta="Auto-flagged" icon={AlertTriangle} />
        <StatsCard label="Pass Rate" value={`${stats.passRate || 0}%`} delta="Verification result" icon={CheckCircle2} />
        <StatsCard label="Avg Processing Time" value={`${stats.avgProcessingTime || 0} ms`} delta="Per document batch" icon={Activity} />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <div className="panel-title">Anomaly Trend</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendSeed}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#d8b15b" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chart-panel">
          <div className="panel-title">Document Status Breakdown</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4}>
                {statusData.map((entry, index) => (
                  <Cell key={entry.name} fill={['#d8b15b', '#e77756', '#7893ff'][index % 3]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="dashboard-grid narrow">
        <div className="panel">
          <div className="panel-title">Alert Feed</div>
          <div className="stack-list scroll-list">
            {alerts.length ? alerts.map((alert) => (
              <article className="feed-item" key={alert.id}>
                <AlertBadge severity={alert.severity}>{alert.severity}</AlertBadge>
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.description}</p>
                </div>
              </article>
            )) : <p className="muted">No alerts yet.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Recent Activity</div>
          <table className="compact-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.slice(0, 6).map((row) => (
                <tr key={row.id}>
                  <td>{row.action}</td>
                  <td>{row.resource_type || 'system'}</td>
                  <td>{row.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
