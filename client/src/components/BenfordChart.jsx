import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function BenfordChart({ data = [] }) {
  return (
    <div className="chart-card">
      <div className="chart-card-title">Benford Distribution</div>
      <div className="chart-card-body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="digit" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="actual" fill="#d8b15b" radius={[8, 8, 0, 0]} />
            <Bar dataKey="expected" fill="#5d738f" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
