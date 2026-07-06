/**
 * MetadataPanel
 * -------------
 * Renders a key/value list of document metadata.
 *
 * Uses a <dl> grid layout (defined in global.css) so long values wrap
 * cleanly without breaking the panel.
 */
export default function MetadataPanel({ metadata = {} }) {
  // Defensive: if metadata is a string (JSON), parse it; if null/undefined, default to {}
  let entries = [];
  if (metadata && typeof metadata === 'object') {
    entries = Object.entries(metadata);
  } else if (typeof metadata === 'string') {
    try {
      entries = Object.entries(JSON.parse(metadata));
    } catch {
      entries = [[ 'Raw', metadata ]];
    }
  }

  return (
    <div className="metadata-panel">
      <div className="chart-card-title mb-2">Metadata Panel</div>
      {entries.length ? (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {value === null || value === undefined
                  ? '—'
                  : typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>No metadata available.</p>
      )}
    </div>
  );
}