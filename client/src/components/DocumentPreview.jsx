export default function DocumentPreview({ file, hash }) {
  return (
    <div className="document-preview">
      <div className="document-preview-plate">{file?.type?.startsWith('image/') ? 'Image' : 'PDF'}</div>
      <div>
        <strong>{file?.name || 'Document preview'}</strong>
        <p>{file?.type || 'Unknown type'}</p>
        {hash ? <code>{hash}</code> : <span>SHA-256 fingerprint appears after upload.</span>}
      </div>
    </div>
  );
}
