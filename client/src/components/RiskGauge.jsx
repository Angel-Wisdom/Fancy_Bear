/**
 * RiskGauge
 * ---------
 * Circular SVG meter that visualises a 0-100 risk/verification score.
 *
 * Visual contract:
 *   - 90×90 px circular gauge
 *   - Background track + colored arc whose length = score%
 *   - Numeric score centered, label below
 *   - Arc color shifts by score (low/medium/high) via data-tone attribute
 *
 * Pure presentational component — no logic, no API calls.
 */
export default function RiskGauge({ value = 0, label = 'Risk Score' }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const stroke = circumference - (clamped / 100) * circumference;

  // Tone thresholds (kept here so the component is self-documenting)
  const tone = clamped >= 75 ? 'low' : clamped >= 40 ? 'medium' : 'high';

  return (
    <div className="risk-gauge" data-tone={tone} aria-label={`Risk score ${clamped} out of 100`}>
      <svg viewBox="0 0 140 140" className="risk-gauge-svg" aria-hidden="true">
        <circle cx="70" cy="70" r={radius} />
        <circle
          cx="70"
          cy="70"
          r={radius}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={stroke}
        />
      </svg>
      <div className="risk-gauge-labels">
        <strong>{clamped}</strong>
        <span title={label}>{label}</span>
      </div>
    </div>
  );
}
