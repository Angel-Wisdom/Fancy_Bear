export default function MetadataPanel({ metadata = {} }) {
  const entries = Object.entries(metadata);
  return (
    <div className="metadata-panel">
      <div className="chart-card-title">Metadata Panel</div>
      <dl>
        {entries.length ? entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
          </div>
        )) : <p>No metadata available.</p>}
      </dl>
    </div>
  );
}
