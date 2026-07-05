import { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { api } from '../utils/api';

export default function Dashboard() {
  const [stats, setStats] = useState({ totalDocuments: 0, totalAlerts: 0 });
  const [coverage, setCoverage] = useState({ tier1: 0, tier2: 0, tier3: 0, total: 0 });
  const [trend, setTrend] = useState([]);
  const [topApps, setTopApps] = useState([]);
  const [findings, setFindings] = useState([]);

  useEffect(() => {
    // 1. Fetch top-level stats
    api.get('/api/dashboard/stats').then(setStats).catch(() => null);
    
    // 2. Fetch Findings Feed
    api.get('/api/dashboard/alerts').then(res => setFindings(res.alerts || [])).catch(() => null);
    
    // 3. Fetch & Format Top Applications
    api.get('/api/dashboard/top-applications').then(res => setTopApps(res.topApplications || [])).catch(() => null);

    // 4. Fetch & Calculate Coverage Bar (Mapping db tiers to UI groupings)
    api.get('/api/dashboard/coverage').then(res => {
      const data = res.coverage || [];
      const tier1 = data.find(d => d.tier === 'tier1_checksum')?.count || 0;
      const tier2 = data.find(d => d.tier === 'tier2_format_only')?.count || 0;
      const tier3 = data.find(d => d.tier === 'tier3_no_validator')?.count || 0;
      setCoverage({ tier1, tier2, tier3, total: tier1 + tier2 + tier3 });
    }).catch(() => null);

    // 5. Fetch & Format 7-Day Trend Chart
    api.get('/api/dashboard/trend').then(res => {
      const dbTrend = res.trend || [];
      // Generate the last 7 days iteratively so the chart never breaks if a day has 0 docs
      const last7Days = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateString = d.toISOString().split('T')[0];
        const match = dbTrend.find(t => t.date === dateString);
        return { 
          dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0), 
          count: match ? match.count : 0 
        };
      });
      setTrend(last7Days);
    }).catch(() => null);
  }, []);

  // Helper to calculate percentages safely for the UI bar
  const getPercent = (value, total) => total > 0 ? Math.round((value / total) * 100) : 0;
  const pTier1 = getPercent(coverage.tier1, coverage.total);
  const pTier2 = getPercent(coverage.tier2, coverage.total);
  const pTier3 = getPercent(coverage.tier3, coverage.total);
  const maxTrend = Math.max(...trend.map(t => t.count), 1); // Prevent division by 0

  return (
    <div className="flex-col gap-6 w-full">
      <h2>Portfolio Overview</h2>
      
      {/* Top Metrics Row - Scaled fluidly across the view area */}
      <div className="grid gap-4 w-full" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="panel">
          <p className="text-secondary text-sm mb-2">Documents today</p>
          <span className="text-3xl font-bold">{stats.totalDocuments}</span>
        </div>
        <div className="panel">
          <p className="text-secondary text-sm mb-2">Open alerts</p>
          <span className="text-3xl font-bold text-danger">{stats.totalAlerts}</span>
        </div>
      </div>

      {/* Verification Coverage Bar - Full width row expansion */}
      <div className="panel w-full">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-base font-bold">Verification coverage today</h3>
          <span className="text-sm text-secondary">{coverage.total} documents</span>
        </div>
        
        <div className="flex w-full overflow-hidden rounded-full mb-3" style={{ height: '12px', backgroundColor: 'var(--border-subtle)' }}>
          {coverage.total > 0 ? (
            <>
              <div style={{ width: `${pTier1}%`, backgroundColor: 'var(--color-success)' }} />
              <div style={{ width: `${pTier2}%`, backgroundColor: 'var(--color-warning)' }} />
              <div style={{ width: `${pTier3}%`, backgroundColor: 'var(--border-strong)' }} />
            </>
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: 'var(--border-subtle)' }} />
          )}
        </div>
        
        <div className="flex gap-6 text-sm text-secondary font-medium">
          <div className="flex items-center gap-2">
            <span className="block rounded-sm" style={{ width: '12px', height: '12px', backgroundColor: 'var(--color-success)' }}></span>
            Checksum verified - {pTier1}%
          </div>
          <div className="flex items-center gap-2">
            <span className="block rounded-sm" style={{ width: '12px', height: '12px', backgroundColor: 'var(--color-warning)' }}></span>
            Format plausible - {pTier2}%
          </div>
          <div className="flex items-center gap-2">
            <span className="block rounded-sm" style={{ width: '12px', height: '12px', backgroundColor: 'var(--border-strong)' }}></span>
            No validator - {pTier3}%
          </div>
        </div>
      </div>

      {/* Grid Layout: Auto splits into side-by-side or stacks comfortably depending on page scope */}
      <div className="grid gap-4 w-full" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
        
        {/* Cross-Document Findings */}
        <div className="flex-col gap-3">
          <h3 className="text-base font-bold mb-1">Cross-document findings</h3>
          <div className="flex-col gap-2 w-full">
            {findings.length > 0 ? findings.map(finding => (
               <div key={finding.id} className={`panel ${finding.severity === 'critical' || finding.severity === 'high' ? 'tone-critical' : 'tone-medium'}`} style={{ border: 'none' }}>
                 <div className="flex items-center gap-2 mb-1">
                   <strong className="text-sm">{finding.title}</strong>
                 </div>
                 <p className="text-sm">{finding.description}</p>
               </div>
            )) : (
              <div className="panel flex items-center justify-center p-6 text-secondary text-sm">
                No recent cross-document findings.
              </div>
            )}
          </div>
        </div>

        {/* 7-Day Trend Chart - Fully expanded container padding */}
        <div className="flex-col gap-3">
           <h3 className="text-base font-bold mb-1">Documents this week</h3>
           <div className="panel flex items-end justify-between h-full pt-4" style={{ minHeight: '160px' }}>
             {trend.map((day, idx) => {
               const heightPercent = day.count > 0 ? (day.count / maxTrend) * 100 : 5;
               const isToday = idx === 6;
               return (
                 <div key={idx} className="flex-col items-center gap-2 w-full">
                   <div 
                     className="w-full max-w-[28px] rounded-sm" 
                     style={{ 
                       height: `${heightPercent}px`, 
                       minHeight: '6px',
                       backgroundColor: isToday ? 'var(--color-blue-primary)' : 'var(--border-default)',
                       margin: '0 auto'
                     }}
                   ></div>
                   <span className={`text-xs font-bold ${isToday ? 'text-primary' : 'text-secondary'}`}>
                     {day.dayLabel}
                   </span>
                 </div>
               )
             })}
           </div>
        </div>

      </div>

      {/* Applications Needing Review */}
      <div className="flex-col gap-2 w-full">
        <h3 className="text-base font-bold mb-2">Applications needing review</h3>
        <div className="panel w-full flex-col p-0 overflow-hidden" style={{ borderBottom: 'none' }}>
          {topApps.length > 0 ? topApps.map(app => (
            <div key={app.id} className="flex items-center justify-between py-3 px-4 border-b border-subtle hover:bg-muted">
              <div className="flex items-center gap-4">
                <strong className="text-sm">{app.name}</strong>
                <span className="text-xs text-secondary font-medium uppercase tracking-wide">Application</span>
              </div>
              <div className="flex items-center gap-4">
                <span className={`badge ${app.maxSeverity === 'critical' || app.maxSeverity === 'high' ? 'badge-danger' : app.maxSeverity === 'medium' ? 'badge-warning' : 'badge-success'}`}>
                  {app.openAlerts} {app.maxSeverity}
                </span>
                <button className="flex items-center justify-center rounded-full border border-subtle" style={{ width: '32px', height: '32px', backgroundColor: 'var(--surface-base)' }}>
                  <ArrowDown size={14} className="text-secondary" />
                </button>
              </div>
            </div>
          )) : (
            <p className="text-sm text-secondary p-4">No applications currently require review.</p>
          )}
        </div>
      </div>

    </div>
  );
}