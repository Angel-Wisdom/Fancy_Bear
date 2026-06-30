export default function ELAViewer({ intensity = [] }) {
  return (
    <div className="ela-viewer">
      <div className="chart-card-title">ELA Heatmap</div>
      <div className="ela-grid">
        {Array.from({ length: 24 }).map((_, index) => {
          const level = intensity[index % Math.max(intensity.length, 1)] || (index % 7) / 6;
          return <span key={index} style={{ opacity: 0.2 + level * 0.8 }} />;
        })}
      </div>
    </div>
  );
}
