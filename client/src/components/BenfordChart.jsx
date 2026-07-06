import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * BenfordChart
 * ------------
 * Side-by-side bar chart comparing actual vs expected Benford distribution.
 *
 * Container is responsive: the parent must give it a bounded height
 */
export default function BenfordChart({ data = [] }) {
  return (
    <div className="chart-card h-full"> 
      <div className="chart-card-title">Benford Distribution</div>
      <div className="chart-card-body flex-1"> 
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="digit" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={32} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--surface-raised)',
                border: '1px solid var(--border-default)',
                borderRadius: '6px',
                fontSize: '12px'
              }}
            />
            <Bar dataKey="actual" fill="#0056B3" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expected" fill="#94A3B8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}