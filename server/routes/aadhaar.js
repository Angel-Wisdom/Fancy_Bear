import { Router } from 'express';
import http from 'node:http';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken);

// Flask app.py is hardcoded to port 5000 — do NOT pass --port flag when starting it
// In Docker, set AADHAAR_SERVICE_HOST=aadhaar (the compose service name)
const FLASK_HOST = process.env.AADHAAR_SERVICE_HOST || '127.0.0.1';
const FLASK_PORT = Number(process.env.AADHAAR_SERVICE_PORT || 5000);

/**
 * Small http helper that avoids depending on global fetch (Node <18 compatibility).
 * Returns { status, body } where body is already parsed JSON.
 */
function postJson(host, port, path, payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: host,
      port,
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
    req.setTimeout(30_000, () => { req.destroy(new Error('Flask request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * POST /api/aadhaar/detect
 *
 * Body (JSON):
 *   { image: "<data:image/...;base64,...>", autodetect: true|false }
 *
 * Proxies the request to the Flask Aadhaar microservice (aadhar/app.py)
 * which runs on port 5000 by default (hardcoded in app.py).
 * Returns 503 with a clear message if the Flask service is not running.
 */
router.post('/detect', async (req, res) => {
  const { image, autodetect } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'image field is required and must be a base64 string.' });
  }

  try {
    const { status, body } = await postJson(
      FLASK_HOST,
      FLASK_PORT,
      '/detect',
      { image, autodetect: Boolean(autodetect) }
    );
    return res.status(status).json(body);
  } catch (err) {
    console.error('[aadhaar] Flask microservice unreachable:', err.message);
    return res.status(503).json({
      error:
        `The Aadhaar QR microservice is not reachable on port ${FLASK_PORT}. ` +
        'Start it with: cd aadhar && python app.py',
    });
  }
});

export default router;
