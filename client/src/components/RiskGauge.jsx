export default function RiskGauge({ value = 0, label = 'Risk Score' }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const stroke = circumference - (clamped / 100) * circumference;

  return (
    <div className="risk-gauge">
      <svg viewBox="0 0 140 140" className="risk-gauge-svg">
        <circle cx="70" cy="70" r={radius} />
        <circle cx="70" cy="70" r={radius} strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={stroke} />
      </svg>
      <div className="risk-gauge-labels">
        <strong>{clamped}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
