const toneMap = {
  critical: 'tone-critical',
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
};

export default function AlertBadge({ severity = 'low', children }) {
  return <span className={`alert-badge ${toneMap[severity] || toneMap.low}`}>{children || severity}</span>;
}
