import { useState, useEffect, useMemo, useRef } from 'react';
import { CloudUpload, RefreshCw, ShieldAlert, FileText, Camera, RotateCcw, ScanLine, CheckCircle2, XCircle, MinusCircle, Info } from 'lucide-react';
import { api } from '../utils/api';
import RiskGauge from './RiskGauge';
import MetadataPanel from './MetadataPanel';
import DocumentPreview from './DocumentPreview'; 

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

const BASE_TABS = ['ocr', 'findings', 'fields', 'metadata', 'report'];

export default function DocumentsTab({ customerId }) {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [activeDocViewTab, setActiveDocViewTab] = useState('ocr');
  const [formDocType, setFormDocType] = useState('pan_card');
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  // --- Live capture state -------------------------------------------------
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'camera'
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  function stopCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  async function startCameraStream() {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera capture is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser to capture a document.'
          : 'Could not access a camera on this device.',
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const capturedFile = new File([blob], `document-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setFiles([capturedFile]);
      setCapturedPreviewUrl(URL.createObjectURL(blob));
      stopCameraStream();
    }, 'image/jpeg', 0.92);
  }

  function retakePhoto() {
    if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
    setCapturedPreviewUrl(null);
    setFiles([]);
  }

  function switchInputMode(mode) {
    if (mode === inputMode) return;
    stopCameraStream();
    if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
    setCapturedPreviewUrl(null);
    setFiles([]);
    setCameraError('');
    setInputMode(mode);
  }

  useEffect(() => {
    // Start the camera whenever we're in camera mode with no photo captured
    // yet -- covers both the initial mode switch and a "Retake" action.
    if (inputMode === 'camera' && !capturedPreviewUrl && !cameraActive) {
      startCameraStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, capturedPreviewUrl]);

  useEffect(() => {
    // Stop the camera if the component unmounts while a stream is open.
    return () => stopCameraStream();
  }, []);
  // -------------------------------------------------------------------------

  async function loadDocuments(preferredId = selectedDocumentId) {
    try {
      const data = await api.get('/api/documents');
      const customerDocs = (data.documents || []).filter(d => d.customer_id === customerId);
      setDocuments(customerDocs);
      
      const nextId = preferredId || customerDocs[0]?.id || '';
      if (nextId !== selectedDocumentId) setSelectedDocumentId(nextId);
    } catch (err) {
      console.error("Failed to load documents", err);
    }
  }

  useEffect(() => {
    if (customerId) loadDocuments();
  }, [customerId]);

  const selectedDocument = useMemo(() => {
    const doc = documents.find((doc) => doc.id === selectedDocumentId) || null;
    return doc;
  }, [documents, selectedDocumentId]);
  const activeFileObject = useMemo(() => files.length > 0 ? files[0] : selectedDocument || null, [files, selectedDocument]);
  const details = useMemo(() => parseJson(selectedDocument?.verification?.details_json, null), [selectedDocument]);
  const metadata = parseJson(selectedDocument?.metadata_json, { Status: selectedDocument ? 'Metadata unavailable' : 'No document selected' });
  const ocrText = selectedDocument?.ocr_text || 'Select a document to see extracted OCR text.';
  const score = details?.score || selectedDocument?.verification?.overall_score || 0;
  const label = selectedDocument?.verification?.status || selectedDocument?.status || 'pending';
  // QR data: prefer dedicated column (verification.qr_data), fallback to details_json
  const qrData = selectedDocument?.verification?.qr_data || details?.qrScan || null;
  const hasQrData = !!(qrData);
  const matchSummary = details?.qrMatchSummary || null;
  const documentTabs = useMemo(() => {
    if (hasQrData) return [...BASE_TABS.slice(0, 4), 'qr', ...BASE_TABS.slice(4)];
    return BASE_TABS;
  }, [hasQrData]);

  // Auto-switch to QR tab when an Aadhaar card with QR data is selected
  useEffect(() => {
    if (hasQrData && !BASE_TABS.includes(activeDocViewTab)) {
      setActiveDocViewTab('ocr');
    }
  }, [hasQrData]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(event) {
    event.preventDefault();
    if (!files.length) return;

    const formData = new FormData();
    formData.append('customerId', customerId); 
    formData.append('docType', formDocType);
    files.forEach((file) => formData.append('files', file));

    setBusy(true); setProgress(0);
    try {
      const result = await api.upload('/api/documents/upload', formData, setProgress);
      const firstUploaded = result.documents?.[0] || result.document;
      await loadDocuments(firstUploaded?.id);
      setFiles([]);
      if (capturedPreviewUrl) URL.revokeObjectURL(capturedPreviewUrl);
      setCapturedPreviewUrl(null);
    } catch (error) {
      console.error("Upload failure:", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-col gap-4 w-full h-full pb-8">
      
      {/* =========================================
          TOP ROW: Upload & Document List
          ========================================= */}
      <div className="grid gap-4 w-full" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(400px, 2fr)' }}>
        
        {/* TOP LEFT: Upload Box */}
        <form className="panel flex-col gap-4 justify-between h-full" onSubmit={handleUpload}>
          <div>
            <h3 className="text-base font-bold mb-3">Upload New Document</h3>
            <select value={formDocType} onChange={(e) => setFormDocType(e.target.value)} className="w-full text-sm mb-3">
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

            {/* Choose: pick a file, or capture live with the camera */}
            <div className="flex gap-2 mb-3" role="tablist" aria-label="Document input method">
              <button
                type="button"
                onClick={() => switchInputMode('file')}
                className={`flex items-center justify-center gap-2 text-sm font-bold px-3 py-2 rounded-md border transition-colors w-full ${inputMode === 'file' ? 'bg-muted border-accent text-primary' : 'border-default text-secondary hover:bg-muted'}`}
              >
                <CloudUpload size={16} /> Upload File
              </button>
              <button
                type="button"
                onClick={() => switchInputMode('camera')}
                className={`flex items-center justify-center gap-2 text-sm font-bold px-3 py-2 rounded-md border transition-colors w-full ${inputMode === 'camera' ? 'bg-muted border-accent text-primary' : 'border-default text-secondary hover:bg-muted'}`}
              >
                <Camera size={16} /> Capture Live
              </button>
            </div>

            {inputMode === 'file' ? (
              /* Styled File Input to hide ugly default browser button */
              <label className="flex-col items-center justify-center border-2 border-dashed border-default rounded-md p-6 cursor-pointer hover:bg-muted transition-colors w-full" style={{ minHeight: '120px' }}>
                <CloudUpload size={28} className="text-tertiary mb-2" />
                <strong className="text-sm text-center text-primary">{files.length ? `${files.length} file ready` : 'Click to select file'}</strong>
                <input type="file" className="hidden" multiple accept="image/*,.pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              </label>
            ) : (
              <div className="border-2 border-dashed border-default rounded-md p-3 w-full" style={{ minHeight: '120px' }}>
                {cameraError ? (
                  <div className="flex-col items-center justify-center text-center gap-2 py-4">
                    <p className="text-sm text-danger">{cameraError}</p>
                    <button type="button" className="btn-secondary text-sm" onClick={startCameraStream}>Try Again</button>
                  </div>
                ) : capturedPreviewUrl ? (
                  <div className="flex-col items-center gap-2">
                    <img src={capturedPreviewUrl} alt="Captured document" className="rounded-md w-full" style={{ maxHeight: 220, objectFit: 'contain' }} />
                    <div className="flex gap-2 w-full">
                      <button type="button" className="btn-secondary text-sm w-full flex items-center justify-center gap-2" onClick={retakePhoto}>
                        <RotateCcw size={14} /> Retake
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-col items-center gap-2">
                    <div className="relative w-full rounded-md overflow-hidden bg-black" style={{ minHeight: 180 }}>
                      <video ref={videoRef} playsInline muted className="w-full" style={{ maxHeight: 220, display: cameraActive ? 'block' : 'none' }} />
                      {!cameraActive && <p className="text-sm text-secondary text-center py-8">Starting camera…</p>}
                    </div>
                    <button
                      type="button"
                      className="btn-primary text-sm w-full flex items-center justify-center gap-2"
                      onClick={capturePhoto}
                      disabled={!cameraActive}
                    >
                      <Camera size={16} /> Capture Photo
                    </button>
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}
          </div>

          <div>
            {progress > 0 && (
              <div className="w-full bg-subtle rounded-full overflow-hidden h-2 mb-2">
                <div className="bg-accent h-full" style={{ width: `${progress}%` }} />
              </div>
            )}
            <button className="btn-primary w-full" type="submit" disabled={busy || !files.length}>
              {busy ? 'Processing...' : 'Upload & Verify'}
            </button>
          </div>
        </form>

        {/* TOP RIGHT: Document List */}
        <div className="panel p-0 flex-col overflow-hidden h-full">
          <div className="flex items-center justify-between p-4 border-b border-subtle bg-surface-base">
            <span className="font-bold text-sm uppercase tracking-wide text-secondary">Applicant Documents</span>
            <button className="text-secondary hover:text-primary" onClick={() => loadDocuments()} title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
          
          <div className="grid gap-2 p-3 overflow-y-auto" style={{ maxHeight: '250px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {documents.length ? documents.map((doc) => {
              const status = doc.verification?.status || doc.status;
              const hasFindings = parseJson(doc.verification?.details_json, {}).findings?.length > 0;
              const isActive = doc.id === selectedDocumentId;
              
              return (
                <button
                  key={doc.id} type="button"
                  onClick={() => setSelectedDocumentId(doc.id)}
                  className={`flex items-center gap-3 p-3 rounded-md border text-left transition-colors ${isActive ? 'bg-muted border-accent text-primary shadow-sm' : 'border-default hover:bg-muted text-secondary'}`}
                >
                  <FileText size={18} className={isActive ? 'text-accent' : 'text-tertiary'} />
                  <div className="flex-col w-full overflow-hidden">
                    <strong className="text-sm truncate">{doc.original_name}</strong>
                    <div className="flex items-center gap-2 text-xs mt-1">
                      <span className="uppercase">{doc.doc_type.replace('_', ' ')}</span>
                      <span className="text-tertiary">•</span>
                      <span className={status === 'flagged' ? 'text-danger font-bold' : ''}>{status}</span>
                    </div>
                  </div>
                  {hasFindings && <ShieldAlert size={16} className="text-danger shrink-0" />}
                </button>
              );
            }) : <p className="text-sm text-secondary p-4 col-span-full">No documents uploaded.</p>}
          </div>
        </div>

      </div>

      {/* =========================================
          BOTTOM ROW: Preview & Results
          ========================================= */}
      <div className="grid gap-4 w-full mt-2" style={{ gridTemplateColumns: 'minmax(400px, 1fr) minmax(400px, 1fr)' }}>
        
        {/* BOTTOM LEFT: Original Image Preview */}
        <div className="panel p-0 flex-col overflow-hidden">
          <div className="p-4 border-b border-subtle bg-surface-base">
            <span className="text-sm font-bold text-secondary">Original Document Preview</span>
          </div>
          <div className="p-4 bg-surface-input flex items-center justify-center overflow-hidden" style={{ minHeight: '400px', maxHeight: '600px' }}>
            {activeFileObject ? (
               <div className="image-contain-wrapper w-full h-full flex items-center justify-center">
                 <DocumentPreview file={activeFileObject} hash={selectedDocument?.hash} />
               </div>
            ) : (
               <span className="text-sm text-secondary">No document selected.</span>
            )}
          </div>
        </div>

        {/* BOTTOM RIGHT: Verification Results & Tabs */}
        {selectedDocument ? (
          <div className="panel flex-col gap-0 p-0 overflow-hidden h-full">
            <div className="flex justify-between items-center px-6 py-5 border-b border-subtle bg-surface-base">
              <div className="flex-col">
                <h3 className="text-lg font-bold">{selectedDocument.original_name}</h3>
                <p className="text-sm text-secondary uppercase tracking-wide mt-1">{selectedDocument.doc_type.replace('_', ' ')}</p>
              </div>
              <RiskGauge value={score} label={label} />
            </div>
            
            <div className="px-6 pt-3 bg-surface-raised">
              <div className="flex gap-6 border-b border-subtle">
                {documentTabs.map((tab) => (
                  <button 
                    key={tab} type="button" 
                    onClick={() => setActiveDocViewTab(tab)}
                    className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeDocViewTab === tab ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'}`} 
                  >{tab.toUpperCase()}</button>
                ))}
              </div>
            </div>
            
            <div className="document-tab-content" style={{ maxHeight: "450px" }}>
              {activeDocViewTab === 'ocr' && <pre className="document-pre">{ocrText}</pre>}
              {activeDocViewTab === 'findings' && (
                <div className="flex-col gap-3">
                  {details?.findings?.length ? details.findings.map((f) => {
                    const isInfo = f.severity === 'info';
                    const isLow = f.severity === 'low';
                    return (
                      <div key={`${f.code}-${f.message}`} className={`p-4 border rounded-md ${isInfo ? 'border-accent-border bg-accent-bg' : isLow ? 'border-default bg-muted' : 'border-danger-border bg-danger-bg'}`}>
                        <strong className={`text-sm block mb-2 ${isInfo ? 'text-accent' : isLow ? 'text-secondary' : 'text-danger'}`}>{f.severity?.toUpperCase()} | {f.code}</strong>
                        <p className="text-sm text-primary">{f.message}</p>
                      </div>
                    );
                  }) : <p className="text-sm text-secondary">No anomaly findings recorded.</p>}
                </div>
              )}
              {activeDocViewTab === 'fields' && <pre className="document-pre">{JSON.stringify(details?.extractedFields || {}, null, 2)}</pre>}
              {activeDocViewTab === 'metadata' && <MetadataPanel metadata={metadata} />}
              {activeDocViewTab === 'qr' && (
                <QrDataPanel qrScan={qrData} matchSummary={matchSummary} />
              )}
              {activeDocViewTab === 'report' && <pre className="document-pre">{JSON.stringify(details || selectedDocument?.verification || {}, null, 2)}</pre>}
            </div>
          </div>
        ) : (
          <div className="panel flex items-center justify-center p-8 text-secondary text-sm h-[400px]">Select a document to review results.</div>
        )}

      </div>
    </div>
  );
}

// ── QR Data Panel ────────────────────────────────────────────

function maskAadhaar(value) {
  if (!value) return 'N/A';
  const digits = String(value).replace(/\s+/g, '');
  return digits.length >= 4 ? '**** **** ' + digits.slice(-4) : '****';
}

function CheckIcon({ status }) {
  if (status === 'match') return <CheckCircle2 size={16} className="text-green-500 shrink-0" />;
  if (status === 'mismatch' || status === 'critical_mismatch') return <XCircle size={16} className="text-red-500 shrink-0" />;
  if (status === 'invalid_format' || status === 'unparseable') return <MinusCircle size={16} className="text-yellow-500 shrink-0" />;
  return <Info size={16} className="text-tertiary shrink-0" />;
}

function QrDataPanel({ qrScan, matchSummary }) {
  if (!qrScan) return <p className="text-sm text-secondary p-4">No QR scan data available.</p>;

  const scanned = qrScan.scanned;
  const data = qrScan.data || {};

  return (
    <div className="flex-col gap-4 p-4 overflow-y-auto" style={{ maxHeight: '440px' }}>
      {/* Status banner */}
      <div className={`flex items-center gap-3 p-4 rounded-md border ${scanned ? (matchSummary?.overall === 'match' ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5') : 'border-default bg-muted'}`}>
        <ScanLine size={20} className={scanned ? (matchSummary?.overall === 'match' ? 'text-green-500' : 'text-red-500') : 'text-tertiary'} />
        <div className="flex-col">
          <strong className="text-sm">
            {scanned ? (matchSummary?.overall === 'match' ? 'QR Verified — All checks passed' : 'QR Scanned — Mismatches detected') : 'QR Not Scannable'}
          </strong>
          {!scanned && <span className="text-xs text-secondary">{qrScan.reason}</span>}
        </div>
      </div>

      {scanned && (
        <>
          {/* Photo + decoded data side by side */}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'auto 1fr' }}>
            {/* QR Photo */}
            {qrScan.photo && (
              <div className="flex-col items-center gap-2">
                <img
                  src={`data:image/jpeg;base64,${qrScan.photo}`}
                  alt="QR-extracted photo"
                  className="rounded-md border border-default"
                  style={{ width: 100, height: 125, objectFit: 'cover' }}
                />
                <span className="text-xs text-secondary">QR Photo</span>
              </div>
            )}

            {/* Decoded fields */}
            <div className="flex-col gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-secondary">QR-Decoded Details</h4>
              <QrField label="Name" value={data.name || data.Name} />
              <QrField label="Aadhaar No." value={maskAadhaar(data.uid || data.aadhaar_number)} />
              <QrField label="DOB" value={data.dob || data.date_of_birth || data.DOB} />
              <QrField label="Gender" value={data.gender || data.Gender} />
              <QrField label="Care Of" value={data.care_of || data.co || data.CareOf} />
              <QrField label="Address" value={data.address || data.Address} />
            </div>
          </div>

          {/* Cross-check results */}
          {matchSummary && (
            <div className="flex-col gap-2 mt-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-secondary">Cross-Check Results</h4>
              <div className="grid gap-1">
                <CheckRow label="Name vs Customer" status={matchSummary.checks?.nameVsCustomer} />
                <CheckRow label="Aadhaar vs Customer" status={matchSummary.checks?.aadhaarVsCustomer} />
                <CheckRow label="Name vs OCR" status={matchSummary.checks?.nameVsOcr} />
                <CheckRow label="Aadhaar vs OCR" status={matchSummary.checks?.aadhaarVsOcr} />
                <CheckRow label="DOB vs Customer" status={matchSummary.checks?.dobVsCustomer} />
                <CheckRow label="Gender vs Customer" status={matchSummary.checks?.genderVsCustomer} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QrField({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-secondary shrink-0" style={{ minWidth: 90 }}>{label}:</span>
      <span className="text-primary font-medium">{value}</span>
    </div>
  );
}

function CheckRow({ label, status }) {
  if (!status) return null;
  return (
    <div className="flex items-center gap-2 text-sm py-1 px-2 rounded" style={{ background: 'var(--surface-base, #0f172a)' }}>
      <CheckIcon status={status} />
      <span className="text-primary">{label}</span>
      <span className="ml-auto text-xs font-mono uppercase">{status}</span>
    </div>
  );
}