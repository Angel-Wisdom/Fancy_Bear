import { useState, useEffect, useMemo, useRef } from 'react';
import { CloudUpload, RefreshCw, ShieldAlert, FileText, Camera, RotateCcw } from 'lucide-react';
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

const documentTabs = ['ocr', 'findings', 'fields', 'metadata', 'report'];

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
                  {hasFindings && <ShieldAlert size={16} className="text-danger flex-shrink-0" />}
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
            <div className="flex justify-between items-center p-5 border-b border-subtle bg-surface-base">
              <div className="flex-col">
                <h3 className="text-lg font-bold">{selectedDocument.original_name}</h3>
                <p className="text-sm text-secondary uppercase tracking-wide mt-1">{selectedDocument.doc_type.replace('_', ' ')}</p>
              </div>
              <RiskGauge value={score} label={label} />
            </div>
            
            <div className="px-5 pt-3 bg-surface-raised">
              <div className="flex gap-4 border-b border-subtle">
                {documentTabs.map((tab) => (
                  <button 
                    key={tab} type="button" 
                    onClick={() => setActiveDocViewTab(tab)}
                    className={`pb-2 text-sm font-bold border-b-2 transition-colors ${activeDocViewTab === tab ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'}`} 
                  >{tab.toUpperCase()}</button>
                ))}
              </div>
            </div>
            
            <div className="p-5 bg-surface-raised overflow-y-auto" style={{ maxHeight: '450px' }}>
              {activeDocViewTab === 'ocr' && <pre className="text-sm text-secondary font-mono whitespace-pre-wrap break-words">{ocrText}</pre>}
              {activeDocViewTab === 'findings' && (
                <div className="flex-col gap-3">
                  {details?.findings?.length ? details.findings.map((f) => (
                    <div key={`${f.code}-${f.message}`} className="p-4 border border-danger-border bg-danger-bg rounded-md">
                      <strong className="text-sm text-danger block mb-2">{f.severity?.toUpperCase()} | {f.code}</strong>
                      <p className="text-sm text-primary">{f.message}</p>
                    </div>
                  )) : <p className="text-sm text-secondary">No anomaly findings recorded.</p>}
                </div>
              )}
              {activeDocViewTab === 'fields' && <pre className="text-sm text-secondary font-mono">{JSON.stringify(details?.extractedFields || {}, null, 2)}</pre>}
              {activeDocViewTab === 'metadata' && <MetadataPanel metadata={metadata} />}
              {activeDocViewTab === 'report' && <pre className="text-sm text-secondary font-mono">{JSON.stringify(details || selectedDocument?.verification || {}, null, 2)}</pre>}
            </div>
          </div>
        ) : (
          <div className="panel flex items-center justify-center p-8 text-secondary text-sm h-[400px]">Select a document to review results.</div>
        )}

      </div>
    </div>
  );
}