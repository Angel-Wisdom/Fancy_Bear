import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanLine, CloudUpload, RefreshCw, Copy, ChevronRight, X } from 'lucide-react';
import { api } from '../utils/api';

/* ─── Aadhaar field labels (mirrors the aadhar/templates/index.html labels) ─── */
const LABELS = {
  name: 'Name', dob: 'Date of Birth', gender: 'Gender',
  aadhaar_last_4_digit: 'Aadhaar (Last 4)', last_4_digits_mobile_no: 'Mobile (Last 4)',
  careof: 'Care Of', co: 'Care Of', house: 'House No.', street: 'Street',
  location: 'Location', loc: 'Location', landmark: 'Landmark', lm: 'Landmark',
  postoffice: 'Post Office', po: 'Post Office', district: 'District', dist: 'District',
  subdistrict: 'Sub-District', subdist: 'Sub-District', vtc: 'Village / Town',
  state: 'State', pincode: 'PIN Code', pc: 'PIN Code',
  referenceid: 'Reference ID', version: 'QR Version', uid: 'UID',
};
const PERSONAL_KEYS = ['name', 'dob', 'gender', 'uid', 'aadhaar_last_4_digit', 'last_4_digits_mobile_no'];
const ADDR_KEYS = ['careof', 'co', 'house', 'street', 'location', 'loc', 'landmark', 'lm',
  'postoffice', 'po', 'district', 'dist', 'subdistrict', 'subdist', 'vtc', 'state', 'pincode', 'pc'];
const TECH_KEYS = ['referenceid', 'version'];
const SKIP_KEYS = new Set(['aadhaar_last_digit', 'email_mobile_status', 'email', 'mobile']);

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function DataTable({ data, keys }) {
  const present = keys.filter((k) => Object.prototype.hasOwnProperty.call(data, k));
  if (!present.length) return null;
  return (
    <table className="aadhaar-table">
      <tbody>
        {present.map((k) => {
          const v = data[k];
          const label = LABELS[k] || k;
          const empty = v === '' || v === null || v === undefined;
          return (
            <tr key={k}>
              <td className="aadhaar-key">{label}</td>
              <td className={`aadhaar-val${empty ? ' empty' : ''}`}>
                {empty ? 'Not available' : String(v)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Badge({ ok }) {
  return ok
    ? <span className="aadhaar-badge badge-yes">Yes</span>
    : <span className="aadhaar-badge badge-no">No</span>;
}

export default function AadhaarVerify() {
  /* ── image / canvas state ── */
  const canvasRef = useRef(null);
  const offscreenRef = useRef(null);
  const imgRef = useRef(null);
  const viewerBodyRef = useRef(null);
  const fileInputRef = useRef(null);
  // Stores the img+b64 that needs canvas setup after hasImage flips to true
  const pendingSetup = useRef(null);

  const [hasImage, setHasImage] = useState(false);
  const [fullB64, setFullB64] = useState(null);
  const [scale, setScale] = useState(1);
  const [dispW, setDispW] = useState(0);
  const [dispH, setDispH] = useState(0);
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);

  /* ── selection ── */
  const [isDragging, setIsDragging] = useState(false);
  const [hasSel, setHasSel] = useState(false);
  const selRef = useRef({ sx: 0, sy: 0, ex: 0, ey: 0 });
  const [autoBbox, setAutoBbox] = useState(null); // { x, y, w, h } in display px

  /* ── status ── */
  const [viewerStatus, setViewerStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [decoding, setDecoding] = useState(false);

  /* ── sidebar state ── */
  const [sidebarMode, setSidebarMode] = useState('placeholder'); // placeholder | hint | error | results
  const [errMsg, setErrMsg] = useState('');
  const [resultData, setResultData] = useState(null);
  const [resultPhoto, setResultPhoto] = useState(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [toast, setToast] = useState('');

  /* ── drag-over on upload zone ── */
  const [dragOver, setDragOver] = useState(false);

  /* ─────────────────── helpers ─────────────────── */
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2400);
  }, []);

  function showSidebar(mode, error = '') {
    setSidebarMode(mode);
    if (error) setErrMsg(error);
    setJsonOpen(false);
  }

  /* ─────────────────── canvas draw ─────────────────── */
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreen = offscreenRef.current;
    if (!canvas || !offscreen) return;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(offscreen, 0, 0);

    const { sx, sy, ex, ey } = selRef.current;

    if (autoBbox) {
      const { x, y, w, h } = autoBbox;
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(34,197,94,.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const lbl = 'QR DETECTED';
      ctx.font = '600 10px system-ui';
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = 'rgba(34,197,94,.9)';
      ctx.fillRect(x, y - 15, tw + 10, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(lbl, x + 5, y - 3);
      ctx.restore();
    }

    if (hasSel) {
      const rx = Math.min(sx, ex), ry = Math.min(sy, ey);
      const rw = Math.abs(ex - sx), rh = Math.abs(ey - sy);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, rx, ry, rw, rh, rx, ry, rw, rh);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
      ctx.restore();
      const cs = 6; ctx.fillStyle = '#fff';
      [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([cx2, cy2]) => {
        ctx.fillRect(cx2 - cs / 2, cy2 - cs / 2, cs, cs);
      });
    }
  }, [autoBbox, hasSel]);

  /* ─────────────────── image load ─────────────────── */

  // Phase 1 — called when the Image has loaded; stores it and shows the viewer panel.
  // The actual canvas setup runs in Phase 2 (useEffect) after React renders the viewer DOM.
  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target.result;
      setFullB64(b64);
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        pendingSetup.current = { img, b64 };
        // Reset all state and flip the panel — the viewer DOM will mount after this render
        setHasSel(false);
        setAutoBbox(null);
        setResultData(null);
        setResultPhoto(null);
        showSidebar('placeholder');
        setViewerStatus('Scanning…');
        setHasImage(true); // triggers re-render; viewerBodyRef becomes available
      };
      img.src = b64;
    };
    reader.readAsDataURL(file);
  }

  // Phase 2 — runs after the viewer DOM has mounted and viewerBodyRef is populated.
  useEffect(() => {
    if (!hasImage || !pendingSetup.current) return;
    const { img, b64 } = pendingSetup.current;
    pendingSetup.current = null;
    initCanvas(img, b64);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasImage]);

  function initCanvas(img, b64) {
    const body = viewerBodyRef.current;
    if (!body) return;
    const maxW = Math.max(body.clientWidth - 12, 200);
    const maxH = Math.min(500, window.innerHeight * 0.55);
    const sc = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const dw = Math.round(img.naturalWidth * sc);
    const dh = Math.round(img.naturalHeight * sc);

    setOrigW(img.naturalWidth); setOrigH(img.naturalHeight);
    setScale(sc); setDispW(dw); setDispH(dh);

    const canvas = canvasRef.current;
    canvas.width = dw; canvas.height = dh;
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';

    const off = document.createElement('canvas');
    off.width = dw; off.height = dh;
    off.getContext('2d').drawImage(img, 0, 0, dw, dh);
    offscreenRef.current = off;

    // Draw the image immediately
    canvas.getContext('2d').drawImage(off, 0, 0);

    runAutoDetect(b64, dw, dh, sc, img);
  }

  /* ─────────────────── auto detect ─────────────────── */
  async function runAutoDetect(b64, dw, dh, sc, img) {
    setLoading(true);
    try {
      const res = await api.post('/api/aadhaar/detect', { image: b64, autodetect: true });
      setLoading(false);
      if (res.found && res.success) {
        const bbox = {
          x: res.bbox.x * dw,
          y: res.bbox.y * dh,
          w: res.bbox.w * dw,
          h: res.bbox.h * dh,
        };
        setAutoBbox(bbox);
        setResultData(res.data);
        setResultPhoto(res.photo || null);
        showSidebar('results');
        setViewerStatus('QR detected and decoded');
      } else if (res.found && !res.success) {
        showSidebar('error', res.error || 'QR detected but could not be decoded.');
        setViewerStatus('Decode failed');
      } else {
        showSidebar('hint');
        setViewerStatus('No QR found — draw a box around it');
      }
    } catch (err) {
      setLoading(false);
      showSidebar('error', err.message || 'Could not reach the server.');
      setViewerStatus('Server error');
    }
  }

  /* ─────────────────── manual decode ─────────────────── */
  async function doManualDecode() {
    if (decoding) return;
    const { sx, sy, ex, ey } = selRef.current;
    const sc = scale;
    const img = imgRef.current;
    const rx = Math.min(sx, ex), ry = Math.min(sy, ey);
    const rw = Math.abs(ex - sx), rh = Math.abs(ey - sy);
    const ox = Math.round(rx / sc), oy = Math.round(ry / sc);
    const ow = Math.round(rw / sc), oh = Math.round(rh / sc);
    const c = document.createElement('canvas');
    c.width = Math.max(1, ow); c.height = Math.max(1, oh);
    c.getContext('2d').drawImage(img, ox, oy, ow, oh, 0, 0, c.width, c.height);
    const cropped = c.toDataURL('image/png');

    setDecoding(true);
    setViewerStatus('Decoding…');
    try {
      const res = await api.post('/api/aadhaar/detect', { image: cropped, autodetect: false });
      if (res.success) {
        setResultData(res.data);
        setResultPhoto(res.photo || null);
        showSidebar('results');
        setViewerStatus('Decoded');
      } else {
        showSidebar('error', res.error || 'Decode failed.');
        setViewerStatus('Decode failed');
      }
    } catch (err) {
      showSidebar('error', err.message || 'Could not reach the server.');
      setViewerStatus('Server error');
    }
    setDecoding(false);
  }

  /* ─────────────────── canvas pointer events ─────────────────── */
  function getPoint(e) {
    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    const scaleX = r.width / canvas.width;
    const scaleY = r.height / canvas.height;
    let px, py;
    if (e.touches && e.touches.length) { px = e.touches[0].clientX; py = e.touches[0].clientY; }
    else if (e.changedTouches && e.changedTouches.length) { px = e.changedTouches[0].clientX; py = e.changedTouches[0].clientY; }
    else { px = e.clientX; py = e.clientY; }
    return {
      x: Math.max(0, Math.min(dispW, (px - r.left) / scaleX)),
      y: Math.max(0, Math.min(dispH, (py - r.top) / scaleY)),
    };
  }

  function onMouseDown(e) {
    if (autoBbox) return;
    e.preventDefault();
    const p = getPoint(e);
    selRef.current = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
    setIsDragging(true);
    setHasSel(false);
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const p = getPoint(e);
    selRef.current.ex = p.x;
    selRef.current.ey = p.y;
    const w = Math.abs(p.x - selRef.current.sx);
    const h = Math.abs(p.y - selRef.current.sy);
    setHasSel(true);
    setViewerStatus(w < 15 || h < 15 ? 'Keep dragging…' : `${Math.round(w / scale)} × ${Math.round(h / scale)} px`);
    drawCanvas();
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    setIsDragging(false);
    const { sx, sy, ex, ey } = selRef.current;
    if (Math.abs(ex - sx) < 15 || Math.abs(ey - sy) < 15) {
      setHasSel(false);
      setViewerStatus('Selection too small');
    } else {
      setViewerStatus(`${Math.round(Math.abs(ex - sx) / scale)} × ${Math.round(Math.abs(ey - sy) / scale)} px — ready`);
    }
    drawCanvas();
  }

  /* ─────────────────── redraw when state changes ─────────────────── */
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, hasSel, autoBbox]);

  /* ─────────────────── key events ─────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && hasSel) {
        setHasSel(false);
        setViewerStatus('Draw a box around the QR code');
        drawCanvas();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasSel, drawCanvas]);

  /* ─────────────────── derived booleans ─────────────────── */
  const selValid = hasSel &&
    Math.abs(selRef.current.ex - selRef.current.sx) >= 15 &&
    Math.abs(selRef.current.ey - selRef.current.sy) >= 15;

  /* ─────────────────── photo src normalisation ─────────────────── */
  function photoSrc(raw) {
    if (!raw) return null;
    if (raw.startsWith('data:')) return raw;
    if (raw.startsWith('/9j/')) return 'data:image/jpeg;base64,' + raw;
    if (raw.startsWith('iVBOR')) return 'data:image/png;base64,' + raw;
    return 'data:image/jpeg;base64,' + raw;
  }

  /* ─────────────────── result rendering ─────────────────── */
  function renderResults() {
    if (!resultData) return null;
    const d = resultData;
    const allKnown = new Set([...PERSONAL_KEYS, ...ADDR_KEYS, ...TECH_KEYS, ...SKIP_KEYS]);
    const extras = Object.keys(d).filter((k) => !allKnown.has(k));

    const photo = photoSrc(resultPhoto);

    return (
      <>
        {photo && (
          <div className="aadhaar-photo-strip">
            <div className="aadhaar-photo-frame">
              <img src={photo} alt="Extracted photo from Aadhaar QR" />
            </div>
          </div>
        )}

        {PERSONAL_KEYS.some((k) => k in d) && (
          <>
            <div className="aadhaar-sec-label">Personal</div>
            <DataTable data={d} keys={PERSONAL_KEYS} />
          </>
        )}

        <div className="aadhaar-sec-label">Registration</div>
        <table className="aadhaar-table">
          <tbody>
            <tr>
              <td className="aadhaar-key">Email registered</td>
              <td className="aadhaar-val"><Badge ok={d.email === true} /></td>
            </tr>
            <tr>
              <td className="aadhaar-key">Mobile registered</td>
              <td className="aadhaar-val"><Badge ok={d.mobile === true} /></td>
            </tr>
          </tbody>
        </table>

        {ADDR_KEYS.some((k) => k in d) && (
          <>
            <div className="aadhaar-sec-label">Address</div>
            <DataTable data={d} keys={ADDR_KEYS} />
          </>
        )}

        {TECH_KEYS.some((k) => k in d) && (
          <>
            <div className="aadhaar-sec-label">Technical</div>
            <DataTable data={d} keys={TECH_KEYS} />
          </>
        )}

        {extras.length > 0 && (
          <>
            <div className="aadhaar-sec-label">Other</div>
            <DataTable data={d} keys={extras} />
          </>
        )}
      </>
    );
  }

  /* ─────────────────── JSX ─────────────────── */
  return (
    <div className="page-stack">
      <style>{`
        /* ── Aadhaar page scoped styles ── */
        .aadhaar-header { margin-bottom: 1.25rem; }
        .aadhaar-title { display: flex; align-items: center; gap: 0.5rem; font-size: 1.15rem; font-weight: 700; }
        .aadhaar-sub { font-size: 0.8rem; color: var(--muted); margin-top: 0.15rem; }

        /* Upload zone */
        .aadhaar-dropzone {
          border: 2px dashed var(--border);
          border-radius: 10px;
          background: var(--surface);
          padding: 3.5rem 2rem;
          text-align: center;
          cursor: pointer;
          display: flex; flex-direction: column; align-items: center; gap: 0.65rem;
          transition: border-color 0.2s, background 0.2s;
        }
        .aadhaar-dropzone:hover, .aadhaar-dropzone.over {
          border-color: var(--accent);
          background: color-mix(in srgb, var(--accent) 5%, var(--surface));
        }
        .aadhaar-dropzone-icon {
          width: 44px; height: 44px; border-radius: 50%;
          background: var(--surface-raised); border: 1px solid var(--border);
          display: grid; place-items: center; color: var(--muted);
        }
        .aadhaar-dropzone-title { font-size: 1rem; font-weight: 700; }
        .aadhaar-dropzone-sub { font-size: 0.78rem; color: var(--muted); line-height: 1.5; }
        .aadhaar-fmt-pills { display: flex; gap: 0.3rem; flex-wrap: wrap; justify-content: center; margin-top: 0.2rem; }
        .aadhaar-fmt-pill {
          font-size: 0.62rem; font-weight: 600; padding: 0.1rem 0.45rem;
          border-radius: 999px; background: var(--surface-raised);
          color: var(--muted); border: 1px solid var(--border);
          text-transform: uppercase; letter-spacing: 0.06em;
        }

        /* Viewer layout */
        .aadhaar-viewer-layout {
          display: grid;
          grid-template-columns: 1fr 320px;
          gap: 1.25rem;
          align-items: start;
        }
        @media (max-width: 760px) { .aadhaar-viewer-layout { grid-template-columns: 1fr; } }

        /* Image card */
        .aadhaar-img-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px; overflow: hidden;
        }
        .aadhaar-img-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.5rem 0.85rem;
          border-bottom: 1px solid var(--border);
          background: var(--surface-raised);
        }
        .aadhaar-img-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
        .aadhaar-img-body {
          padding: 0.5rem;
          background: var(--surface-raised);
          display: flex; justify-content: center;
          min-height: 140px; position: relative;
        }
        .aadhaar-canvas { display: block; cursor: crosshair; border-radius: 4px; max-width: 100%; height: auto; }
        .aadhaar-load-overlay {
          position: absolute; inset: 0.5rem;
          display: grid; place-items: center;
          background: rgba(0,0,0,0.4);
          z-index: 5; border-radius: 4px;
        }
        .aadhaar-spin {
          width: 26px; height: 26px;
          border: 2.5px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: aadhaar-sp 0.65s linear infinite;
        }
        @keyframes aadhaar-sp { to { transform: rotate(360deg); } }
        .aadhaar-img-foot {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.45rem 0.85rem;
          border-top: 1px solid var(--border);
          background: var(--surface); gap: 0.5rem; min-height: 40px;
        }
        .aadhaar-status { font-size: 0.73rem; color: var(--muted); }

        /* Sidebar states */
        .aadhaar-sidebar { display: flex; flex-direction: column; gap: 0.75rem; }
        .aadhaar-state-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: 1.5rem 1.1rem;
        }
        .aadhaar-state-eyebrow { font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.25rem; }
        .aadhaar-state-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.25rem; }
        .aadhaar-state-body { font-size: 0.78rem; color: var(--muted); line-height: 1.55; }
        .aadhaar-hint-pills { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.4rem; }
        .aadhaar-hint-pill { font-size: 0.62rem; color: var(--muted); background: var(--surface-raised); padding: 0.1rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); }

        /* Error card */
        .aadhaar-err-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; overflow: hidden;
        }
        .aadhaar-err-head { padding: 0.4rem 0.85rem; background: var(--surface-raised); border-bottom: 1px solid var(--border); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #f87171; }
        .aadhaar-err-body { padding: 0.85rem; }
        .aadhaar-err-box { padding: 0.7rem 0.9rem; border-radius: 6px; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.25); color: #f87171; font-size: 0.79rem; font-weight: 500; line-height: 1.55; }

        /* Results card */
        .aadhaar-results-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; overflow: hidden;
        }
        .aadhaar-results-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.5rem 0.85rem;
          border-bottom: 1px solid var(--border);
          background: var(--surface-raised);
        }
        .aadhaar-results-title { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }

        /* Photo */
        .aadhaar-photo-strip { display: flex; justify-content: center; padding: 0.85rem; background: var(--surface-raised); border-bottom: 1px solid var(--border); }
        .aadhaar-photo-frame { border: 1.5px solid var(--border); border-radius: 6px; overflow: hidden; line-height: 0; }
        .aadhaar-photo-frame img { max-height: 130px; width: auto; display: block; }

        /* Data table */
        .aadhaar-sec-label { padding: 0.3rem 0.85rem; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); background: var(--surface-raised); border-bottom: 1px solid var(--border); border-top: 1px solid var(--border); }
        .aadhaar-table { width: 100%; border-collapse: collapse; }
        .aadhaar-table tr { border-bottom: 1px solid var(--border); }
        .aadhaar-table tr:last-child { border-bottom: none; }
        .aadhaar-table td { padding: 0.38rem 0.85rem; font-size: 0.77rem; vertical-align: top; }
        .aadhaar-key { color: var(--muted); font-weight: 500; width: 44%; white-space: nowrap; }
        .aadhaar-val { font-weight: 500; word-break: break-word; }
        .aadhaar-val.empty { color: var(--muted); font-style: italic; font-weight: 400; }

        /* Badges */
        .aadhaar-badge { display: inline-flex; align-items: center; padding: 0.1rem 0.5rem; font-size: 0.69rem; font-weight: 600; border-radius: 999px; }
        .badge-yes { background: rgba(34,197,94,0.15); color: #16a34a; }
        .badge-no { background: var(--surface-raised); color: var(--muted); }

        /* JSON toggle */
        .aadhaar-json-toggle {
          display: flex; align-items: center; gap: 0.4rem;
          width: 100%; padding: 0.42rem 0.85rem;
          border: none; border-top: 1px solid var(--border);
          background: none; cursor: pointer;
          font-size: 0.73rem; font-weight: 500; color: var(--muted);
          transition: color 0.15s; text-align: left;
          font-family: inherit;
        }
        .aadhaar-json-toggle:hover { color: var(--fg); }
        .aadhaar-chv { width: 12px; height: 12px; transition: transform 0.2s; flex-shrink: 0; }
        .aadhaar-json-toggle.open .aadhaar-chv { transform: rotate(90deg); }
        .aadhaar-json-block { display: none; padding: 0.6rem 0.85rem 0.75rem; border-top: 1px solid var(--border); }
        .aadhaar-json-block.open { display: block; }
        .aadhaar-json-pre {
          font-family: monospace; font-size: 0.69rem; line-height: 1.55;
          background: var(--surface-raised); padding: 0.65rem 0.75rem;
          border-radius: 5px; overflow-x: auto; white-space: pre-wrap;
          word-break: break-all; max-height: 220px; overflow-y: auto;
        }

        /* Toast */
        .aadhaar-toast {
          position: fixed; bottom: 1.25rem; left: 50%;
          transform: translateX(-50%) translateY(12px);
          background: var(--fg); color: var(--bg);
          padding: 0.35rem 1rem; border-radius: 6px;
          font-size: 0.76rem; font-weight: 600;
          opacity: 0; pointer-events: none;
          transition: opacity 0.2s, transform 0.2s; z-index: 300;
        }
        .aadhaar-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

        /* Buttons */
        .aadhaar-btn {
          display: inline-flex; align-items: center; gap: 0.3rem;
          padding: 0.32rem 0.75rem;
          font-size: 0.76rem; font-weight: 600;
          border-radius: 6px; border: 1px solid transparent;
          cursor: pointer; transition: background 0.15s, opacity 0.15s;
          line-height: 1.4; white-space: nowrap; font-family: inherit;
        }
        .aadhaar-btn-primary { background: var(--accent); color: #fff; }
        .aadhaar-btn-primary:hover:not(:disabled) { opacity: 0.87; }
        .aadhaar-btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }
        .aadhaar-btn-ghost { background: transparent; color: var(--fg); border-color: var(--border); }
        .aadhaar-btn-ghost:hover { background: var(--surface-raised); }
        .aadhaar-ico-btn {
          background: none; border: 1px solid transparent; color: var(--muted);
          cursor: pointer; display: grid; place-items: center;
          width: 26px; height: 26px; border-radius: 5px;
          transition: color 0.15s, background 0.15s;
        }
        .aadhaar-ico-btn:hover { color: var(--fg); background: var(--surface-raised); border-color: var(--border); }
      `}</style>

      <div className="aadhaar-header">
        <div className="aadhaar-title">
          <ScanLine size={20} />
          Aadhaar QR Verification
        </div>
        <div className="aadhaar-sub">Upload an Aadhaar card image — QR decoded entirely on your machine via the local microservice.</div>
      </div>

      {/* ── Upload stage ── */}
      {!hasImage && (
        <div
          className={`aadhaar-dropzone${dragOver ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Upload Aadhaar image"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f && f.type.startsWith('image/')) loadFile(f);
          }}
        >
          <div className="aadhaar-dropzone-icon"><CloudUpload size={20} /></div>
          <div className="aadhaar-dropzone-title">Drop your Aadhaar image here</div>
          <div className="aadhaar-dropzone-sub"><strong>Click to browse</strong> or drag &amp; drop — processed locally</div>
          <div className="aadhaar-fmt-pills">
            {['JPG', 'PNG', 'BMP', 'WebP'].map((f) => <span key={f} className="aadhaar-fmt-pill">{f}</span>)}
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files[0]) loadFile(e.target.files[0]); }}
      />

      {/* ── Viewer stage ── */}
      {hasImage && (
        <div className="aadhaar-viewer-layout">
          {/* Image column */}
          <div className="aadhaar-img-card">
            <div className="aadhaar-img-head">
              <span className="aadhaar-img-label">
                {autoBbox ? 'Image — Auto-detected' : 'Image'}
              </span>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  className="aadhaar-ico-btn"
                  title="Upload a different image"
                  onClick={() => {
                    setHasImage(false); setFullB64(null); setAutoBbox(null);
                    setHasSel(false); setResultData(null); setResultPhoto(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="aadhaar-img-body" ref={viewerBodyRef}>
              <canvas
                ref={canvasRef}
                className="aadhaar-canvas"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onTouchStart={onMouseDown}
                onTouchMove={onMouseMove}
                onTouchEnd={onMouseUp}
              />
              {loading && (
                <div className="aadhaar-load-overlay">
                  <div className="aadhaar-spin" />
                </div>
              )}
            </div>

            <div className="aadhaar-img-foot">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {autoBbox && !hasSel && (
                  <button
                    className="aadhaar-btn aadhaar-btn-ghost"
                    style={{ fontSize: '0.73rem', padding: '0.26rem 0.6rem' }}
                    onClick={() => { setAutoBbox(null); showSidebar('hint'); setViewerStatus('Draw a box around the QR code'); drawCanvas(); }}
                  >
                    Manual mode
                  </button>
                )}
                {hasSel && (
                  <button
                    className="aadhaar-btn aadhaar-btn-ghost"
                    style={{ fontSize: '0.73rem', padding: '0.26rem 0.6rem' }}
                    onClick={() => { setHasSel(false); drawCanvas(); setViewerStatus('Draw a box around the QR code'); }}
                  >
                    Clear
                  </button>
                )}
                <span className="aadhaar-status">{viewerStatus}</span>
              </div>
              <div>
                {selValid && !decoding && (
                  <button className="aadhaar-btn aadhaar-btn-primary" onClick={doManualDecode}>
                    Decode
                    <ChevronRight size={13} />
                  </button>
                )}
                {decoding && (
                  <button className="aadhaar-btn aadhaar-btn-primary" disabled>
                    <span className="aadhaar-spin" style={{ width: 12, height: 12, borderWidth: 2 }} /> Decoding…
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="aadhaar-sidebar">
            {/* Placeholder */}
            {sidebarMode === 'placeholder' && (
              <div className="aadhaar-state-card">
                <div className="aadhaar-state-eyebrow">Waiting</div>
                <div className="aadhaar-state-title">Scanning for a QR code</div>
                <div className="aadhaar-state-body">
                  The QR will be found and decoded automatically. If that fails, draw a rectangle around it.
                </div>
                <div className="aadhaar-hint-pills">
                  {['Secure QR V2', 'Secure QR V1', 'Old XML QR'].map((t) => <span key={t} className="aadhaar-hint-pill">{t}</span>)}
                </div>
              </div>
            )}

            {/* Hint: not found */}
            {sidebarMode === 'hint' && (
              <div className="aadhaar-state-card">
                <div className="aadhaar-state-eyebrow">Not detected</div>
                <div className="aadhaar-state-title">No QR found automatically</div>
                <div className="aadhaar-state-body">
                  Draw a rectangle around the QR code in the image to the left, then hit <strong>Decode</strong>.
                </div>
              </div>
            )}

            {/* Error */}
            {sidebarMode === 'error' && (
              <div className="aadhaar-err-card">
                <div className="aadhaar-err-head">Error</div>
                <div className="aadhaar-err-body">
                  <div className="aadhaar-err-box">{errMsg}</div>
                </div>
              </div>
            )}

            {/* Results */}
            {sidebarMode === 'results' && resultData && (
              <div className="aadhaar-results-card">
                <div className="aadhaar-results-head">
                  <span className="aadhaar-results-title">Decoded data</span>
                  <button
                    className="aadhaar-ico-btn"
                    title="Copy JSON"
                    onClick={() => {
                      const t = JSON.stringify(resultData, null, 2);
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(t).then(() => showToast('Copied')).catch(() => showToast('Copy failed'));
                      }
                    }}
                  >
                    <Copy size={13} />
                  </button>
                </div>

                {renderResults()}

                <button
                  className={`aadhaar-json-toggle${jsonOpen ? ' open' : ''}`}
                  onClick={() => setJsonOpen((v) => !v)}
                >
                  <ChevronRight className="aadhaar-chv" size={12} />
                  Raw JSON
                </button>
                <div className={`aadhaar-json-block${jsonOpen ? ' open' : ''}`}>
                  <pre className="aadhaar-json-pre">{JSON.stringify(resultData, null, 2)}</pre>
                </div>
              </div>
            )}

            {/* Re-scan button when done */}
            {sidebarMode === 'results' && (
              <button
                className="aadhaar-btn aadhaar-btn-ghost"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  setHasImage(false); setFullB64(null); setAutoBbox(null);
                  setHasSel(false); setResultData(null); setResultPhoto(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <RefreshCw size={14} /> Scan another card
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`aadhaar-toast${toast ? ' show' : ''}`}>{toast}</div>
    </div>
  );
}
