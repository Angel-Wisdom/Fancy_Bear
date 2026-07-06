import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { sha256 } from '../engines/crypto-engine.js';
import { extractTextFromBuffer } from '../engines/ocr-engine.js';
import { inspectMetadata, analyzePixelForensics } from '../engines/forensics-engine.js';
import { verifyDocument } from '../engines/document-verification-engine.js';
import { scanAadhaarQr, cleanAadhaarOcrText } from '../engines/aadhaar-engine.js';
import { signReport } from '../engines/crypto-engine.js';
import { writeAuditEntry } from '../utils/audit.js';
import { getDocTypeMeta } from '../engines/doc-types.js';
import path from 'node:path';
import fs from 'node:fs';

// 25 MB upload limit — matches the `max_upload_size_mb` system setting.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const router = Router();

router.use(verifyToken);

router.get('/', (req, res) => {
  const db = getDb();
  
  const docs = db.prepare(`
    SELECT d.*, c.full_name AS customer_name
    FROM documents d
    JOIN customers c ON c.id = d.customer_id
    ORDER BY d.created_at DESC
    LIMIT 100
  `).all();

  // Prepare the verification query once for performance
  const getVerification = db.prepare(`
    SELECT * FROM verification_results 
    WHERE document_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `);

  const documents = docs.map((document) => {
    const ver = getVerification.get(document.id) || null;
    if (ver?.qr_data) {
      try { ver.qr_data = JSON.parse(ver.qr_data); }
      catch { /* leave as string */ }
    }
    return { ...document, verification: ver };
  });
  
  res.json({ documents });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  
  if (!document) return res.status(404).json({ message: 'Document not found' });
  
  const verification = db.prepare(`
    SELECT * FROM verification_results 
    WHERE document_id = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(document.id) || null;
  
  // Parse qr_data JSON so the frontend receives a structured object
  if (verification?.qr_data) {
    try { verification.qr_data = JSON.parse(verification.qr_data); }
    catch { /* leave as string */ }
  }
  
  res.json({ document: { ...document, verification } });
});

router.get('/:id/file', verifyToken, (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);

  if (!doc) {
    return res.status(404).json({ message: 'Document target record missing' });
  }

  // Check if the document layout tracks an explicit file path on the disk volume
  const actualPath = doc.stored_path || doc.file_path || doc.path;

  // Handle Base64 Data URI from database
  if (actualPath && actualPath.startsWith('data:')) {
    const matches = actualPath.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      const mimeType = matches[1];
      const base64Buffer = Buffer.from(matches[2], 'base64');
      res.setHeader('Content-Type', mimeType);
      return res.send(base64Buffer);
    }
  }

  if (!actualPath || actualPath.startsWith('memory://')) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
        <rect width="100%" height="100%" fill="#1e293b"/>
        <text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#94a3b8">
          Legacy Memory Mock Asset: ${doc.original_name}
        </text>
      </svg>
    `);
  }
  
  const filePath = path.resolve(actualPath);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Binary asset missing from storage disk' });
  }

  // Send the binary data natively with the proper Content-Type header so browser engines can render it
  return res.sendFile(filePath);
});

function serializeMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).slice(0, 80).map(([key, value]) => [
    key,
    value?.description ?? value?.value ?? String(value),
  ]));
}

function storeVerification({ document, result, userId, runDurationMs }) {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const details = {
    ...result,
    document: {
      id: document.id,
      type: document.doc_type,
      name: document.original_name,
      hash: document.file_hash,
      size: document.file_size,
      mimeType: document.mime_type,
    },
  };

  // Resolve the canonical tier for this doc type so the dashboard
  // verification-coverage bar can group results by tier1/tier2/tier3.
  const docMeta = getDocTypeMeta(document.doc_type);
  const tier = docMeta?.tier || null;

  // Serialize QR scan data for dedicated column (independent of details_json)
  const qrDataJson = result.qrScan ? JSON.stringify(result.qrScan) : null;

  db.prepare(`
    INSERT INTO verification_results (id, document_id, customer_id, verification_type, status, overall_score, qr_data, details_json, run_by, run_duration_ms, created_at, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    document.id,
    document.customer_id,
    'forensic',
    result.status,
    result.score,
    qrDataJson,
    JSON.stringify({ ...details, signature: signReport(details) }),
    userId,
    runDurationMs,
    createdAt,
    tier,
  );

  for (const finding of result.findings.filter((item) => ['high', 'critical'].includes(item.severity))) {
    db.prepare(`
      INSERT INTO alerts (id, customer_id, document_id, verification_id, alert_type, severity, title, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      document.customer_id,
      document.id,
      id,
      finding.code.startsWith('metadata') || finding.code.startsWith('file') ? 'metadata_tampering' : 'forged_document',
      finding.severity === 'critical' ? 'critical' : 'high',
      `Document verification finding: ${document.original_name}`,
      finding.message,
      createdAt,
    );
  }

  return id;
}

router.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files || [];
  
  const rawCustomerId = req.body?.customerId || req.body?.customer_id;
  const docType = req.body?.docType || req.body?.doc_type || 'other';

  if (!rawCustomerId) {
    return res.status(400).json({ message: 'Missing required parameter: customerId' });
  }

  const db = getDb();

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(rawCustomerId);
  if (!customer) {
    console.error(`Upload aborted: Customer ID "${rawCustomerId}" does not exist in DB.`);
    return res.status(400).json({ 
      message: `Cannot link document. Customer ID "${rawCustomerId}" was not found in the system database.` 
    });
  }
  
  const customerIdToUse = customer.id;
  const currentUserId = req.user?.id || 'demo-user';

  const uploaded = [];

  for (const file of files) {
    const startedAt = Date.now();
    const createdAt = new Date().toISOString();
    const hash = sha256(file.buffer);

    // ── Run OCR + pixel forensics + Aadhaar QR scan in parallel ──
    const isAadhaarCard = docType === 'aadhaar_card';
    const isPanCard = docType === 'pan_card';

    // Build OCR options per document type:
    //   Aadhaar: eng+hin, PSM 3 (full text) + PSM 11 (Aadhaar number)
    //   PAN:     eng, raw image (no preprocessing), PSM 3
    //   Other:   eng, default preprocessing
    const primaryOcrOpts = isPanCard
      ? { lang: 'eng', psm: 3, skipPreprocess: true }
      : isAadhaarCard
        ? { lang: 'eng+hin', psm: 3 }
        : {};

    const [extracted, pixelForensics, qrScan] = await Promise.all([
      extractTextFromBuffer(file.buffer, file.originalname, file.mimetype, primaryOcrOpts),
      analyzePixelForensics(file.buffer, file.mimetype),
      isAadhaarCard
        ? scanAadhaarQr(file.buffer, file.mimetype)
        : Promise.resolve(null),
    ]);

    // ── Aadhaar: secondary PSM 11 pass to find the 12-digit number ──
    // eng+hin + PSM 11 (sparse text) is the ONLY configuration that
    // reliably reads the Aadhaar number from bilingual cards.
    // PSM 3 often misses it because digits get merged into Hindi text blocks.
    let aadhaarSecondaryText = '';
    if (isAadhaarCard && extracted.engine === 'tesseract.js') {
      try {
        const secondary = await extractTextFromBuffer(
          file.buffer, file.originalname, file.mimetype,
          { lang: 'eng+hin', psm: 11, skipPreprocess: false },
        );
        aadhaarSecondaryText = secondary.text;
        console.log(`[aadhaar] Secondary PSM 11 pass: ${(aadhaarSecondaryText || '').length} chars`);
      } catch (err) {
        console.warn('[aadhaar] Secondary PSM 11 OCR failed:', err.message);
      }
    }

    // ── For Aadhaar cards: clean OCR text (remove Hindi garble) ──
    const metadata = inspectMetadata(file.buffer);
    let ocrTextToStore = extracted.text;
    let ocrTextForVerification = extracted.text;

    if (isAadhaarCard && extracted.engine === 'tesseract.js') {
      const isBilingual = extracted.ocrLang === 'eng+hin';
      const cleaned = cleanAadhaarOcrText(extracted.text, isBilingual);
      ocrTextToStore = cleaned.text;
      ocrTextForVerification = cleaned.text;
    }

    const id = randomUUID();

    const base64Data = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64Data}`;

    const document = {
      id,
      customer_id: customerIdToUse,
      uploaded_by: currentUserId,
      doc_type: docType,
      original_name: file.originalname,
      stored_path: dataUri,
      mime_type: file.mimetype,
      file_size: file.size,
      file_hash: hash,
      fingerprint: hash,
      created_at: createdAt,
    };
    
    const ocrForVerification = {
      ...extracted,
      text: ocrTextForVerification,
      // Pass secondary PSM 11 text for Aadhaar number recovery
      secondaryText: aadhaarSecondaryText || null,
    };
    const verification = verifyDocument({ document, customer, ocr: ocrForVerification, metadata, pixelForensics, qrScan });
    const status = verification.status === 'pass' ? 'verified' : verification.status === 'warning' ? 'flagged' : 'rejected';

    db.prepare(`
      INSERT INTO documents (id, customer_id, uploaded_by, doc_type, original_name, stored_path, mime_type, file_size, file_hash, fingerprint, ocr_text, ocr_confidence, metadata_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      customerIdToUse,
      currentUserId,
      docType,
      file.originalname,
      dataUri,
      file.mimetype,
      file.size,
      hash,
      hash,
      ocrTextToStore,
      extracted.confidence,
      JSON.stringify(serializeMetadata(metadata.metadata || {})),
      status,
      createdAt,
    );

    const verificationId = storeVerification({
      document,
      result: verification,
      userId: currentUserId,
      runDurationMs: Date.now() - startedAt,
    });

    uploaded.push({
      id,
      verificationId,
      originalName: file.originalname,
      hash,
      confidence: extracted.confidence,
      status,
      score: verification.score,
      findings: verification.findings,
    });
    
    writeAuditEntry({ 
      userId: currentUserId, 
      action: 'document.upload.verify', 
      resourceType: 'document', 
      resourceId: id, 
      details: { fileName: file.originalname, hash, status, score: verification.score } 
    });
  }

  res.json({ documents: uploaded });
});

export default router;