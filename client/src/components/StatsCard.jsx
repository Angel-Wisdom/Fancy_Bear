export default function StatsCard({ label, value, delta, icon: Icon }) {
  return (
    <article className="stats-card">
      <div className="stats-card-icon">{Icon ? <Icon size={20} /> : null}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {delta ? <span>{delta}</span> : null}
      </div>
    </article>
  );
}
