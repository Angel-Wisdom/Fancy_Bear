import { useEffect, useState } from 'react';
import { Eye, FileText, Image as ImageIcon } from 'lucide-react';

export default function DocumentPreview({ file, hash }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);

  // Effect 1: produce a blob URL for the file (either local File or remote fetch)
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setLoadError(false);
      return;
    }

    let isCancelled = false;
    let createdObjectUrl = null;

    // CASE 1: Fresh local staging file
    if (file instanceof File || file instanceof Blob) {
      createdObjectUrl = URL.createObjectURL(file);
      setPreviewUrl(createdObjectUrl);
      setLoadError(false);
      return () => {
        isCancelled = true;
        if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
      };
    }

    // CASE 2: Historical database row (Auth-Protected)
    if (file.id || hash) {
      const targetUrl = `/api/documents/${file.id || hash}/file`;
      const token = localStorage.getItem('suraksha_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      fetch(targetUrl, { headers })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          if (isCancelled) return;
          createdObjectUrl = URL.createObjectURL(blob);
          setPreviewUrl(createdObjectUrl);
          setLoadError(false);
        })
        .catch((err) => {
          console.error("Failed to load secure preview:", err);
          if (!isCancelled) {
            setPreviewUrl(null);
            setLoadError(true);
          }
        });

      return () => {
        isCancelled = true;
        if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
      };
    }

    // No usable identifier
    return () => {};
  }, [file, hash]);

  if (!file) {
    return (
      <div className="placeholder-preview">
        <div className="flex-col items-center gap-2">
          <ImageIcon size={32} className="muted" />
          <p className="muted">No file selected for preview</p>
        </div>
      </div>
    );
  }

  const fileName = file.name || file.original_name || 'Unnamed Document';
  const fileType = file.type || file.mime_type || '';
  const fileSize = file.size !== undefined ? file.size : (file.file_size || 0);

  const isImage = fileType.startsWith('image/');
  const isPdf = fileType === 'application/pdf';

  return (
    <div className="document-preview-container">
      {/* Visual area — fills available space, image fits inside */}
      <div className="document-preview-visual">
        {loadError ? (
          <div className="generic-fallback-icon">
            <ImageIcon size={48} />
            <span>Preview load failed</span>
          </div>
        ) : isImage && previewUrl ? (
          <img src={previewUrl} alt={fileName} className="thumbnail-render" />
        ) : isPdf && previewUrl ? (
          <object data={previewUrl} type="application/pdf" className="pdf-render-frame">
            <div className="pdf-fallback-icon">
              <FileText size={48} />
              <span>PDF Preview Available</span>
            </div>
          </object>
        ) : !previewUrl ? (
          <div className="generic-fallback-icon">
            <FileText size={48} />
            <span>Loading preview…</span>
          </div>
        ) : (
          <div className="generic-fallback-icon">
            <ImageIcon size={48} />
            <span>Preview Unavailable</span>
          </div>
        )}
      </div>

      {/* Details footer — fixed height, doesn't shrink */}
      <div className="document-preview-details">
        <div className="file-meta-header">
          <Eye size={16} className="text-accent shrink-0" />
          <strong title={fileName}>{fileName}</strong>
        </div>
        <p className="file-type-label">
          {fileType || 'Unknown Type'} • {(Number(fileSize) / 1024).toFixed(1)} KB
        </p>

        <div className="fingerprint-box">
          <span className="fingerprint-label">SHA-256 Checksum:</span>
          {hash || file.file_hash || file.fingerprint ? (
            <code className="crypto-hash">{hash || file.file_hash || file.fingerprint}</code>
          ) : (
            <span className="crypto-hash-placeholder">Generated upon pipeline ingestion</span>
          )}
        </div>
      </div>
    </div>
  );
}