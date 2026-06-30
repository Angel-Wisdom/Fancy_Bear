import { useEffect, useMemo, useState } from 'react';
import { CloudUpload, Fingerprint, FileCheck2, ShieldAlert } from 'lucide-react';
import { api } from '../utils/api';
import DocumentPreview from '../components/DocumentPreview';

export default function UploadVerify() {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customerId: '', docType: 'pan_card' });
  const [files, setFiles] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/customers').then((data) => setCustomers(data.customers || [])).catch(() => null);
  }, []);

  const activePreview = useMemo(() => files[0] || null, [files]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!files.length) return;
    const formData = new FormData();
    formData.append('customerId', form.customerId);
    formData.append('docType', form.docType);
    files.forEach((file) => formData.append('files', file));

    setBusy(true);
    setProgress(0);
    try {
      const result = await api.upload('/api/documents/upload', formData, setProgress);
      setUploads(result.documents || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Upload & Verify</div>
        <form className="upload-layout" onSubmit={handleUpload}>
          <label>
            Customer
            <select value={form.customerId} onChange={(e) => setForm((current) => ({ ...current, customerId: e.target.value }))}>
              <option value="">Select customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
            </select>
          </label>

          <label>
            Document Type
            <select value={form.docType} onChange={(e) => setForm((current) => ({ ...current, docType: e.target.value }))}>
              <option value="pan_card">PAN Card</option>
              <option value="aadhaar_card">Aadhaar Card</option>
              <option value="bank_statement">Bank Statement</option>
              <option value="salary_slip">Salary Slip</option>
              <option value="land_title">Land Title</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="dropzone">
            <CloudUpload size={26} />
            <strong>Drag files here or choose them</strong>
            <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>

          <div className="upload-meter">
            <div className="upload-meter-bar" style={{ width: `${progress}%` }} />
          </div>

          <button className="primary-button" type="submit" disabled={busy || !files.length}>
            {busy ? 'Processing...' : 'Upload and verify'}
          </button>
        </form>
      </section>

      <section className="two-column-grid">
        <div className="panel">
          <div className="panel-title">File Preview</div>
          <DocumentPreview file={activePreview} hash={uploads[0]?.hash} />
        </div>
        <div className="panel">
          <div className="panel-title">Verification Findings</div>
          <div className="stack-list">
            {uploads.length ? uploads.map((item) => (
              <div key={item.id} className="hash-row">
                {item.findings?.length ? <ShieldAlert size={16} /> : <FileCheck2 size={16} />}
                <div>
                  <strong>{item.originalName} · {item.status} · {Math.round(item.score)}%</strong>
                  <p><Fingerprint size={14} /> {item.hash}</p>
                  {item.findings?.length ? (
                    <ul className="finding-list">
                      {item.findings.slice(0, 4).map((finding) => (
                        <li key={`${finding.code}-${finding.message}`}>
                          <span className={`badge badge-${finding.severity === 'high' || finding.severity === 'critical' ? 'danger' : 'warning'}`}>{finding.severity}</span>
                          {finding.message}
                        </li>
                      ))}
                    </ul>
                  ) : <p>Verified with no high-confidence anomaly findings.</p>}
                </div>
              </div>
            )) : <p className="muted">Uploaded document verification results will appear here.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
