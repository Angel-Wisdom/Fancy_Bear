import ExifReader from 'exifreader';
import http from 'node:http';

// The Flask microservice in `aadhar/` also exposes pixel-level tamper
// analysis (ELA, copy-move/clone detection, noise inconsistency, JPEG
// requantization) at POST /forensics/analyze. Same service, same host/port
// env vars as routes/aadhaar.js already uses.
const FLASK_HOST = process.env.AADHAAR_SERVICE_HOST || '127.0.0.1';
const FLASK_PORT = Number(process.env.AADHAAR_SERVICE_PORT || 5000);

const PIXEL_ANALYZABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/bmp',
]);

export function isPixelAnalyzable(mimeType) {
  return PIXEL_ANALYZABLE_MIME_TYPES.has(String(mimeType || '').toLowerCase());
}

function postJson(path, payload, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: FLASK_HOST,
      port: FLASK_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Pixel forensics request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Runs pixel-level tamper analysis (ELA, copy-move detection, noise
 * inconsistency, JPEG requantization) via the Python/OpenCV microservice.
 * Only applicable to raster images — PDFs and other formats return
 * { applicable: false } without an error.
 *
 * Fails soft: if the microservice is unreachable, returns
 * { unavailable: true } with an explanatory error rather than throwing, so
 * document upload never breaks because the forensics sidecar is down.
 */
export async function analyzePixelForensics(buffer, mimeType) {
  if (!isPixelAnalyzable(mimeType)) {
    return { applicable: false, flagged: false, findings: [] };
  }

  try {
    const base64Data = buffer.toString('base64');
    const { status, body } = await postJson('/forensics/analyze', {
      image: `data:${mimeType};base64,${base64Data}`,
    });

    if (status !== 200 || body?.error) {
      return {
        applicable: true,
        unavailable: true,
        flagged: false,
        findings: [],
        error: body?.error || `Pixel forensics service returned status ${status}`,
      };
    }

    return { applicable: true, unavailable: false, ...body };
  } catch (err) {
    return {
      applicable: true,
      unavailable: true,
      flagged: false,
      findings: [],
      error: `Pixel forensics microservice unreachable on port ${FLASK_PORT}: ${err.message}`,
    };
  }
}

export function inspectMetadata(buffer) {
  try {
    const metadata = ExifReader.load(buffer);
    const suspicious = [];
    const software = metadata?.Software?.description || metadata?.Software?.value;
    if (software && /photoshop|gimp|canva|paint/i.test(String(software))) {
      suspicious.push(`Editing software signature: ${software}`);
    }
    return { metadata, suspicious, flagged: suspicious.length > 0 };
  } catch {
    return { metadata: {}, suspicious: ['Metadata unavailable'], flagged: false };
  }
}

export function detectTamperSignals(fileName, mimeType) {
  const suspicious = [];
  if (/\.jpg$|\.jpeg$|\.png$/i.test(fileName || '') && !/^image\//.test(mimeType || '')) {
    suspicious.push('Image extension and MIME type mismatch');
  }
  if (/pdf/i.test(mimeType || '') && /\.(png|jpg|jpeg)$/i.test(fileName || '')) {
    suspicious.push('Rasterized PDF or image conversion suspected');
  }
  return { flagged: suspicious.length > 0, suspicious };
}
