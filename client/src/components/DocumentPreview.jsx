import { useEffect, useState } from 'react';
import { Eye, FileText, Image as ImageIcon } from 'lucide-react';

export default function DocumentPreview({ file, hash }) {
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    // CASE 1: Fresh local staging file
    if (file instanceof File || file instanceof Blob) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    // CASE 2: Historical database row (Auth-Protected)
    if (file.id || hash) {
      let isCancelled = false;
      const targetUrl = `/api/documents/${file.id || hash}/file`;

      // Retrieve your token (adjust if you use cookies/sessionStorage)
      const token = localStorage.getItem('suraksha_token')
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      fetch(targetUrl, { headers })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          if (isCancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        })
        .catch((err) => {
          console.error("Failed to load secure preview:", err);
          if (!isCancelled) setPreviewUrl(null);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [file, hash]);

  // Prevent memory leaks by cleaning up the network blobs when the component unmounts or changes
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!file) {
    return (
      <div className="document-preview placeholder-preview">
        <p className="muted">No file selected for preview</p>
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
      <div className="document-preview-visual">
        {isImage && previewUrl ? (
          <img src={previewUrl} alt={fileName} className="thumbnail-render" />
        ) : isPdf && previewUrl ? (
          <object data={previewUrl} type="application/pdf" className="pdf-render-frame">
            <div className="pdf-fallback-icon">
              <FileText size={48} />
              <span>PDF Preview Available</span>
            </div>
          </object>
        ) : (
          <div className="generic-fallback-icon">
            <ImageIcon size={48} />
            <span>Preview Unavailable</span>
          </div>
        )}
      </div>

      <div className="document-preview-details">
        <div className="file-meta-header">
          <Eye size={16} className="text-accent" />
          <strong>{fileName}</strong>
        </div>
        <p className="file-type-label">
          {fileType || 'Unknown Type'} • {(fileSize / 1024).toFixed(1)} KB
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