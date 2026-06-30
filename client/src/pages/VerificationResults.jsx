import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudUpload, FileSearch, RefreshCw, ShieldAlert } from 'lucide-react';
import RiskGauge from '../components/RiskGauge';
import MetadataPanel from '../components/MetadataPanel';
import { api } from '../utils/api';

const tabs = ['ocr', 'findings', 'fields', 'metadata', 'report'];

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export default function VerificationResults() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedId, setSelectedId] = useState(documentId || '');
  const [activeTab, setActiveTab] = useState('ocr');
  const [form, setForm] = useState({ customerId: '', docType: 'pan_card' });
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  async function loadDocuments(preferredId = selectedId) {
    const data = await api.get('/api/documents');
    const list = data.documents || [];
    setDocuments(list);
    const nextId = preferredId || list[0]?.id || '';
    setSelectedId(nextId);
    return list;
  }

  useEffect(() => {
    api.get('/api/customers').then((data) => {
      const list = data.customers || [];
      setCustomers(list);
      setForm((current) => ({ ...current, customerId: current.customerId || list[0]?.id || '' }));
    }).catch(() => null);
    loadDocuments(documentId).catch(() => null);
  }, []);

  useEffect(() => {
    if (documentId && documentId !== selectedId) setSelectedId(documentId);
  }, [documentId]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedId) || null,
    [documents, selectedId],
  );

  const details = useMemo(() => (
    parseJson(selectedDocument?.verification?.details_json, null)
  ), [selectedDocument]);

  const metadata = parseJson(selectedDocument?.metadata_json, {
    Status: selectedDocument ? 'Metadata unavailable' : 'No document selected',
  });
  const ocrText = selectedDocument?.ocr_text || 'Upload or select a document to see extracted OCR text.';
  const score = details?.score || selectedDocument?.verification?.overall_score || 0;
  const label = selectedDocument?.verification?.status || selectedDocument?.status || 'pending';

  function selectDocument(id) {
    setSelectedId(id);
    if (id) navigate(`/results/${id}`);
  }

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
      const firstUploaded = result.documents?.[0];
      await loadDocuments(firstUploaded?.id);
      if (firstUploaded?.id) navigate(`/results/${firstUploaded.id}`);
      setFiles([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-title">Upload & Verify Documents</div>
        <form className="upload-layout compact-upload" onSubmit={handleUpload}>
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
              <option value="passport">Passport</option>
              <option value="bank_statement">Bank Statement</option>
              <option value="salary_slip">Salary Slip</option>
              <option value="itr">ITR</option>
              <option value="land_title">Land Title</option>
              <option value="sale_deed">Sale Deed</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="dropzone compact-dropzone">
            <CloudUpload size={22} />
            <strong>{files.length ? `${files.length} file(s) ready` : 'Choose image or PDF documents'}</strong>
            <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>

          <div className="upload-meter">
            <div className="upload-meter-bar" style={{ width: `${progress}%` }} />
          </div>

          <button className="primary-button" type="submit" disabled={busy || !files.length}>
            {busy ? 'Verifying...' : 'Run OCR verification'}
          </button>
        </form>
      </section>

      <section className="results-workbench">
        <div className="panel">
          <div className="panel-title document-list-title">
            Uploaded Documents
            <button className="icon-button" type="button" onClick={() => loadDocuments()} title="Refresh documents">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="document-list">
            {documents.length ? documents.map((document) => {
              const status = document.verification?.status || document.status;
              const documentDetails = parseJson(document.verification?.details_json, {});
              return (
                <button
                  key={document.id}
                  type="button"
                  className={`document-list-item ${document.id === selectedId ? 'active' : ''}`}
                  onClick={() => selectDocument(document.id)}
                >
                  <FileSearch size={17} />
                  <span>
                    <strong>{document.original_name}</strong>
                    <small>{document.customer_name || 'Customer'} | {document.doc_type} | {status}</small>
                  </span>
                  {documentDetails.findings?.length ? <ShieldAlert size={16} /> : null}
                </button>
              );
            }) : <p className="muted">No uploaded documents yet. Upload one above to start verification.</p>}
          </div>
        </div>

        <div className="page-stack">
          <section className="panel">
            <div className="panel-title">Verification Results</div>
            <div className="results-header">
              <div>
                <strong>{selectedDocument?.original_name || 'No document selected'}</strong>
                <p>{selectedDocument?.doc_type || 'Select an uploaded document to review OCR and anomaly findings.'}</p>
              </div>
              <RiskGauge value={score} label={label} />
            </div>
          </section>

          <section className="panel">
            <div className="tabs-row">
              {tabs.map((tab) => (
                <button key={tab} type="button" className={`tab-button ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>

            {activeTab === 'ocr' ? <pre className="code-block">{ocrText}</pre> : null}
            {activeTab === 'findings' ? (
              <div className="stack-list">
                {details?.findings?.length ? details.findings.map((finding) => (
                  <div key={`${finding.code}-${finding.message}`} className="alert-copy">
                    <strong>{finding.severity?.toUpperCase()} | {finding.code}</strong>
                    <p>{finding.message}</p>
                  </div>
                )) : <p className="muted">No anomaly findings are recorded for this document.</p>}
              </div>
            ) : null}
            {activeTab === 'fields' ? <pre className="code-block">{JSON.stringify(details?.extractedFields || {}, null, 2)}</pre> : null}
            {activeTab === 'metadata' ? <MetadataPanel metadata={metadata} /> : null}
            {activeTab === 'report' ? <pre className="code-block">{JSON.stringify(details || selectedDocument?.verification || {}, null, 2)}</pre> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
