/**
 * Aadhaar-specific processing engine.
 *
 * Provides:
 *  - QR code scanning  (native jsqr, Flask fallback for Secure QR)
 *  - OCR text cleanup   (strips garbled Hindi from Tesseract bilingual output)
 *  - Name extraction    (locates applicant name in OCR text)
 *  - QR cross-checking  (QR data vs customer record vs OCR fields)
 *
 * Architecture change (v2.1):
 *   QR scanning now runs NATIVELY in Node.js using jsqr + sharp.
 *   The Flask microservice is no longer called for QR detection.
 *   Flask is still used for pixel forensics (ELA, clone detection, etc.)
 *   via forensics-engine.js.
 */

import jsqr from 'jsqr';
import sharp from 'sharp';
import http from 'node:http';
import { validateAadhaar, hashAadhaar } from './kyc-engine.js';

// ── Flask microservice connection (fallback only) ────────────
const FLASK_HOST = process.env.AADHAAR_SERVICE_HOST || '127.0.0.1';
const FLASK_PORT = Number(process.env.AADHAAR_SERVICE_PORT || 5000);

function postJson(path, payload, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: FLASK_HOST,
        port: FLASK_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Aadhaar QR scan timed out')));
    req.write(bodyStr);
    req.end();
  });
}

// ── 1. QR Code Scanning (Native jsqr) ───────────────────────

/**
 * Decode the image buffer to raw RGBA pixels using sharp,
 * then run jsqr to detect and extract QR code data.
 *
 * Returns { found: true, data: '<raw qr string>' } or { found: false }.
 */
async function nativeQrDetect(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const code = jsqr(new Uint8ClampedArray(data), info.width, info.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (code && code.data) {
      return { found: true, data: code.data, bbox: code.location };
    }
    return { found: false };
  } catch (err) {
    console.warn('[aadhaar-qr] Native jsqr detection failed:', err.message);
    return { found: false, error: err.message };
  }
}

/**
 * Parse the Aadhaar QR XML format.
 *
 * Most Aadhaar cards in circulation encode QR data as:
 *   <PrintLetterBarcodeData uid="…" name="…" gender="…" yob="…"
 *     co="…" house="…" street="…" loc="…" vtc="…" po="…"
 *     dist="…" state="…" pc="…" dob="…"/>
 *
 * Returns a structured object { name, uid, dob, gender, co, address, … }
 * or null if the string doesn't look like Aadhaar QR XML.
 */
function parseAadhaarQrXml(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const str = raw.trim();

  // Must contain the Aadhaar XML root element
  if (!/<PrintLetterBarcodeData\b/i.test(str)) return null;

  const result = {};

  // Extract known attributes using a simple regex sweep
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(str)) !== null) {
    const [, key, value] = match;
    if (!value.trim()) continue;

    switch (key.toLowerCase()) {
      case 'uid':
        result.uid = value.replace(/\s+/g, '');
        break;
      case 'name':
        result.name = value.trim();
        break;
      case 'gender':
        result.gender = value.trim().toUpperCase();
        break;
      case 'dob':
        result.dob = value.trim();           // DD/MM/YYYY
        break;
      case 'yob':
        result.yob = value.trim();           // YYYY (fallback when dob absent)
        break;
      case 'co':
      case 'careof':
        result.care_of = value.trim();
        result.co = value.trim();
        break;
      case 'house':
        result.house = value.trim();
        break;
      case 'street':
        result.street = value.trim();
        break;
      case 'loc':
        result.loc = value.trim();
        break;
      case 'vtc':
        result.vtc = value.trim();
        break;
      case 'po':
        result.po = value.trim();
        break;
      case 'dist':
        result.district = value.trim();
        break;
      case 'state':
        result.state = value.trim();
        break;
      case 'pc':
        result.pincode = value.trim();
        break;
      default:
        result[key] = value.trim();
    }
  }

  // Build a full address string from components
  const addressParts = [
    result.house, result.street, result.loc,
    result.vtc, result.po, result.district, result.state,
    result.pincode,
  ].filter(Boolean);
  if (addressParts.length) {
    result.address = addressParts.join(', ');
  }

  // Normalize DOB: if only YOB, construct a partial date
  if (!result.dob && result.yob) {
    result.dob = `${result.yob}-01-01`;
  }

  // Must have at least a UID and name to be considered valid
  if (!result.uid || !result.name) return null;

  return result;
}

/**
 * Attempt to scan an Aadhaar card's QR code.
 *
 * Strategy:
 *  1. Detect QR natively with jsqr (zero HTTP hops).
 *  2. If found, try to parse as Aadhaar XML format.
 *  3. If XML parse succeeds → return structured data (no Flask needed).
 *  4. If XML parse fails (Secure QR or unknown format) → fall back to Flask
 *     microservice which has pyaadhaar for all formats.
 *  5. If no QR found at all → return { scanned: false, reason: '…' }.
 *
 * Returns on success:
 *   { scanned: true, source: 'native'|'flask', data: { name, uid, dob, … }, photo: null, bbox }
 *
 * Returns on failure (never throws):
 *   { scanned: false, reason: "…" }
 */
export async function scanAadhaarQr(buffer, mimeType) {
  const imageTypes = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp',
  ]);
  if (!imageTypes.has(String(mimeType || '').toLowerCase())) {
    return { scanned: false, reason: 'QR scan requires a raster image (received ' + (mimeType || 'unknown') + ').' };
  }

  // ── Step 1: Native jsqr detection ──
  const qrResult = await nativeQrDetect(buffer);

  if (qrResult.found && qrResult.data) {
    // ── Step 2: Try Aadhaar XML parsing ──
    const parsed = parseAadhaarQrXml(qrResult.data);

    if (parsed) {
      console.log('[aadhaar-qr] Native scan + XML parse successful. UID:', parsed.uid?.slice(-4));
      return {
        scanned: true,
        source: 'native',
        data: parsed,
        photo: null,          // XML format doesn't embed photo
        bbox: qrResult.bbox || null,
      };
    }

    // ── Step 3: QR found but not parseable XML → try Flask fallback ──
    console.log('[aadhaar-qr] QR found but not XML-parseable, falling back to Flask…');
    return await flaskQrFallback(buffer, mimeType);
  }

  // ── Step 4: No QR found natively → try Flask as last resort ──
  // (jsqr's detection is thorough, but pyzbar sometimes finds QR codes
  //  in lower-quality images that jsqr misses.)
  console.log('[aadhaar-qr] No QR found natively, trying Flask fallback…');
  return await flaskQrFallback(buffer, mimeType);
}

/**
 * Flask microservice fallback for QR scanning.
 * Used when native jsqr either doesn't find a QR, or finds one
 * in a non-XML format (Secure QR) that pyaadhaar can handle.
 */
async function flaskQrFallback(buffer, mimeType) {
  try {
    const base64Data = buffer.toString('base64');
    const { status, body } = await postJson('/detect', {
      image: `data:${mimeType};base64,${base64Data}`,
      autodetect: true,
    });

    if (status === 200 && body?.found && body?.success) {
      return {
        scanned: true,
        source: 'flask',
        data: body.data || null,
        photo: body.photo || null,
        bbox: body.bbox || null,
      };
    }

    if (body?.found && !body?.success) {
      return { scanned: false, reason: 'QR code detected but could not be decoded — image may be unclear.' };
    }

    return { scanned: false, reason: 'No QR code found on this document.' };
  } catch (err) {
    return { scanned: false, reason: 'QR scan unavailable (both native and microservice failed): ' + err.message };
  }
}

// ── 2. OCR Text Cleanup ───────────────────────────────────────

/**
 * Aadhaar cards are bilingual (Hindi + English).
 *
 * With eng+hin Tesseract (v2.3+): Hindi text is proper Devanagari,
 * not garbled Latin. The cleanup now focuses on:
 *  - Removing stray single-char lines and non-printable noise
 *  - Keeping both English and Devanagari content (both are valid)
 *  - Filtering the trailing noise that Tesseract sometimes produces
 *    from the card edges (single characters, symbols)
 *
 * With eng-only Tesseract (legacy fallback): Hindi text becomes
 * garbled Latin noise. The old aggressive filter is applied to
 * strip these garbage lines.
 *
 * Returns { text: string, removedLines: number }.
 */
const AADHAAR_USEFUL_PATTERNS = [
  /\d{4}\s?\d{4}\s?\d{4}/,                    // Aadhaar number
  /\d{2}[\/-]\d{2}[\/-]\d{4}/,                // Date
  /\d{6}/,                                      // PIN code / enrollment number
  /\d{10}/,                                     // Mobile number
  /aadhaar|uidai|unique\s*identification/i,
  /enrollment/i,
  /dob|date\s*of\s*birth/i,
  /gender|male|female/i,
  /c\/o\b/i,
  /pin\s*code/i,
  /mobile|phone/i,
  /government\s*of\s*india/i,
  /\bstate\b|\bdistrict\b|\bvillage\b|\btaluk\b|\bvtc\b|\bpo:/i,
  /identification\s*authority/i,
  /your\s*aadhaar/i,
  /proof\s*of\s*identity/i,
  /citizenship/i,
];

// Matches a plausible Indian name: 1–5 title-case words, each word 2+ chars
// (allows short names like "Om", "Raj"). Minimum total length 5 chars.
const NAME_LINE_RE = /\b[A-Z][a-z]{1,}(\s+[A-Z][a-z]{1,}){0,4}\b/;

// Address-like: contains known address words
const ADDRESS_WORD_RE = /road|street|nagar|colony|west|east|north|south|pvt|ltd|chs|apartment|flat|room|building|plot|sector|block|milap/i;

export function cleanAadhaarOcrText(rawText, bilingual = false) {
  if (!rawText) return { text: '', removedLines: 0 };

  const lines = rawText.split('\n');
  const kept = [];
  let removed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (bilingual) {
      // ── eng+hin mode: Hindi is proper Devanagari, keep it ──
      // Just filter out pure-noise lines (very short, no alphanumeric)
      const hasLetter = /[a-zA-Z\u0900-\u097F]/.test(trimmed); // Latin or Devanagari
      const hasDigit = /\d/.test(trimmed);
      const isTooShort = trimmed.length < 2;

      if (isTooShort || (!hasLetter && !hasDigit)) {
        removed++;
        continue;
      }

      // Filter lines that are only stray symbols (no letters or digits)
      const alphaNumChars = (trimmed.match(/[a-zA-Z\u0900-\u097F0-9]/g) || []).length;
      if (alphaNumChars < 2) {
        removed++;
        continue;
      }

      kept.push(trimmed);
    } else {
      // ── eng-only mode: Hindi is garbled Latin noise, aggressive filter ──
      // Strip non-ASCII / non-printable characters
      const cleaned = trimmed.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned || cleaned.length < 2) { removed++; continue; }

      const matchesPattern = AADHAAR_USEFUL_PATTERNS.some((p) => p.test(cleaned));
      const containsName = NAME_LINE_RE.test(cleaned);
      const hasAddressWords = ADDRESS_WORD_RE.test(cleaned);

      const tokens = cleaned.split(/\s+/);
      const singleCharTokens = tokens.filter((t) => t.length === 1).length;
      const noiseRatio = tokens.length ? singleCharTokens / tokens.length : 0;

      const totalChars = cleaned.length;
      const noiseChars = (cleaned.match(/[^A-Za-z0-9\s]/g) || []).length;
      const specialCharRatio = totalChars ? noiseChars / totalChars : 0;

      const hasSignal = matchesPattern || containsName || hasAddressWords;
      const isNotNoise = noiseRatio < 0.5 && specialCharRatio < 0.4;

      const isAddress = hasAddressWords && cleaned.length > 20;

      if (hasSignal && (isNotNoise || isAddress)) {
        kept.push(cleaned);
      } else {
        removed++;
      }
    }
  }

  return { text: kept.join('\n'), removedLines: removed };
}

// ── 3. Name Extraction ────────────────────────────────────────

const NAME_STOP_WORDS = new Set([
  'aadhaar', 'uidai', 'unique', 'identification', 'authority', 'india',
  'government', 'enrollment', 'number', 'your', 'dob', 'date', 'birth',
  'gender', 'male', 'female', 'address', 'pin', 'code', 'mobile', 'photo',
  'card', 'proof', 'citizenship', 'not', 'of', 'the', 'to', 'and', 'is',
  'district', 'state', 'village', 'taluk', 'sub', 'vtc', 'po', 'road',
  'west', 'east', 'north', 'south', 'ltd', 'chs', 'verification', 'identity',
  'downloaded', 'online', 'no', 'c', 'o', 'b', 'd', 'f', 'g', 'h', 'j',
  'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'a', 'e', 'i', 'fee', 'sed', 'arfr', 'arn', 'nod', 'gen', 'said',
  'under', 'regulations', 'issued', 'qr', 'xml',
  // Common OCR garbage words from garbled Hindi
  'te', 'ry', 'fe', 'bs', 'ty', 'shin', 'afeof', 'arr', 'jthuty', 'thut',
  'al', 'pe', 'het', 'hth', 'said',
]);

/**
 * Extract the applicant's name from Aadhaar OCR text.
 *
 * Strategy (heuristic, used when QR is not available):
 *  1. Find all lines containing a plausible name (1–5 title-case words, 2+ chars each).
 *  2. Prefer candidates near "DOB" or "Your Aadhaar No." markers.
 *  3. Fall back to the longest plausible name.
 *
 * Note: When QR data IS available, the caller (document-verification-engine.js)
 * uses findNameByQrGuidance() for a second pass that is far more reliable.
 *
 * Returns { name: string | null, confidence: 'high' | 'medium' | 'low' }.
 */
export function extractNameFromAadhaarOcr(text) {
  if (!text) return null;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let dobLineIndex = -1;
  let aadhaarNoLineIndex = -1;
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (/dob|date\s*of\s*birth/i.test(lower)) dobLineIndex = i;
    if (/your\s*aadhaar|aadhaar\s*no/i.test(lower)) aadhaarNoLineIndex = i;

    // Extract all name-like substrings from this line (each word 2+ chars)
    const matches = line.match(/\b[A-Z][a-z]{1,}(\s+[A-Z][a-z]{1,}){0,4}\b/g);
    if (!matches) continue;

    for (const m of matches) {
      const words = m.split(/\s+/);
      const lowerWords = words.map((w) => w.toLowerCase());
      if (lowerWords.some((w) => NAME_STOP_WORDS.has(w))) continue;
      if (m.length < 5) continue;  // Minimum 5 chars total — rejects "Te Ry" (5 chars borderline, caught by stop words)
      // For 2-word names, require each word to be 3+ chars unless a known short name
      if (words.length === 2 && words.every(w => w.length === 2)) continue; // "Te Ry" pattern

      candidates.push({ name: m, lineIndex: i, wordCount: words.length });
    }
  }

  if (!candidates.length) return null;

  // Prefer names near the DOB or Aadhaar No. markers
  for (const c of candidates) {
    if (dobLineIndex >= 0 && Math.abs(c.lineIndex - dobLineIndex) <= 4) {
      return { name: c.name, confidence: 'high', source: 'near_dob_marker' };
    }
  }
  for (const c of candidates) {
    if (aadhaarNoLineIndex >= 0 && Math.abs(c.lineIndex - aadhaarNoLineIndex) <= 4) {
      return { name: c.name, confidence: 'high', source: 'near_aadhaar_marker' };
    }
  }

  // Deduplicate (case-insensitive) and pick the longest
  const unique = [...new Map(candidates.map((c) => [c.name.toLowerCase(), c])).values()];
  unique.sort((a, b) => b.name.length - a.name.length);
  return { name: unique[0].name, confidence: 'low', source: 'heuristic' };
}

// ── 4. QR Cross-Checking ──────────────────────────────────────

/**
 * Cross-check QR-decoded data against the customer record and
 * OCR-extracted fields.  Returns { findings[], matchSummary }.
 *
 * Only called when qrResult.scanned === true.
 */
export function crossCheckQrData(qrResult, customer, ocrFields, ocrName) {
  const findings = [];
  const qrData = qrResult.data;
  const summary = { qrUsed: true, checks: {} };

  // ── QR Name vs Customer Record ──
  const qrName = qrData.name || qrData.Name || '';
  if (qrName && customer?.full_name) {
    const match = nameSimilar(qrName, customer.full_name);
    summary.checks.nameVsCustomer = match ? 'match' : 'mismatch';
    if (!match) {
      findings.push({
        severity: 'critical',
        code: 'aadhaar.qr_name_customer_mismatch',
        message: `QR-decoded name "${qrName}" does not match customer record "${customer.full_name}".`,
        evidence: { qrName, customerName: customer.full_name },
      });
    }
  }

  // ── QR Aadhaar vs Customer Hash ──
  const qrAadhaar = String(qrData.uid || qrData.aadhaar_number || '').replace(/\s+/g, '');
  if (qrAadhaar && customer?.aadhaar_hash) {
    const valid = validateAadhaar(qrAadhaar);
    const hashMatch = valid && hashAadhaar(qrAadhaar) === customer.aadhaar_hash;
    summary.checks.aadhaarVsCustomer = (!valid) ? 'invalid_format' : hashMatch ? 'match' : 'mismatch';

    if (valid && !hashMatch) {
      findings.push({
        severity: 'critical',
        code: 'aadhaar.qr_aadhaar_customer_mismatch',
        message: `QR-decoded Aadhaar (****${qrAadhaar.slice(-4)}) does not match the customer's stored Aadhaar hash.`,
        evidence: { last4: qrAadhaar.slice(-4) },
      });
    }
  }

  // ── QR Name vs OCR-Extracted Name ──
  if (qrName && ocrName) {
    const match = nameSimilar(qrName, ocrName);
    summary.checks.nameVsOcr = match ? 'match' : 'mismatch';
    if (!match) {
      findings.push({
        severity: 'medium',
        code: 'aadhaar.qr_name_ocr_mismatch',
        message: `QR-decoded name "${qrName}" differs from OCR-extracted name "${ocrName}". OCR may be inaccurate.`,
        evidence: { qrName, ocrName },
      });
    }
  }

  // ── QR Aadhaar vs OCR Aadhaar ──
  if (qrAadhaar && ocrFields?.aadhaar) {
    const ocrAadhaar = String(ocrFields.aadhaar).replace(/\s+/g, '');
    const match = qrAadhaar === ocrAadhaar;
    summary.checks.aadhaarVsOcr = match ? 'match' : 'mismatch';
    if (!match) {
      findings.push({
        severity: 'medium',
        code: 'aadhaar.qr_aadhaar_ocr_mismatch',
        message: `QR Aadhaar (****${qrAadhaar.slice(-4)}) differs from OCR-extracted Aadhaar (****${ocrAadhaar.slice(-4)}). OCR may have misread.`,
        evidence: { qrLast4: qrAadhaar.slice(-4), ocrLast4: ocrAadhaar.slice(-4) },
      });
    }
  }

  // ── QR DOB vs Customer DOB ──
  const qrDob = qrData.dob || qrData.date_of_birth || qrData.DOB || '';
  if (qrDob && customer?.date_of_birth) {
    const qrNorm = normalizeDate(qrDob);
    const custDob = customer.date_of_birth; // YYYY-MM-DD
    const match = qrNorm && qrNorm === custDob;
    summary.checks.dobVsCustomer = (!qrNorm) ? 'unparseable' : match ? 'match' : 'mismatch';
    if (qrNorm && !match) {
      findings.push({
        severity: 'high',
        code: 'aadhaar.qr_dob_customer_mismatch',
        message: `QR DOB (${qrDob}) does not match customer DOB (${custDob}).`,
        evidence: { qrDob: qrNorm, customerDob: custDob },
      });
    }
  }

  // ── QR Gender vs Customer Gender ──
  const qrGender = String(qrData.gender || qrData.Gender || '').trim().toUpperCase();
  if (qrGender && customer?.gender) {
    const custGender = customer.gender.toUpperCase();
    const match = qrGender[0] === custGender[0];
    summary.checks.genderVsCustomer = match ? 'match' : 'mismatch';
    if (!match) {
      findings.push({
        severity: 'medium',
        code: 'aadhaar.qr_gender_customer_mismatch',
        message: `QR gender (${qrGender}) does not match customer gender (${custGender}).`,
        evidence: { qrGender, customerGender: custGender },
      });
    }
  }  // ← FIX: was missing this closing brace for the gender block

  // ── Overall ──
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');
  summary.overall = hasCritical ? 'critical_mismatch' : hasHigh ? 'mismatch' : 'match';

  return { findings, matchSummary: summary };
}

// ── Helpers ────────────────────────────────────────────────────

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameSimilar(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Token overlap ≥ 60% (handles middle name differences)
  const ta = na.split(' ').filter((w) => w.length > 1);
  const tb = nb.split(' ').filter((w) => w.length > 1);
  if (!ta.length || !tb.length) return false;
  const matched = ta.filter((w) => tb.includes(w));
  return matched.length / Math.max(ta.length, tb.length) >= 0.6;
}

function normalizeDate(value) {
  const str = String(value || '').trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const m1 = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return '';
}