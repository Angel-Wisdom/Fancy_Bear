import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { sha256 } from '../engines/crypto-engine.js';
import { extractTextFromBuffer } from '../engines/ocr-engine.js';
import { inspectMetadata } from '../engines/forensics-engine.js';
import { verifyDocument } from '../engines/document-verification-engine.js';
import { signReport } from '../engines/crypto-engine.js';
import { writeAuditEntry } from '../utils/audit.js';

const upload = multer({ storage: multer.memoryStorage() });
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
  const documents = docs.map((document) => ({
    ...document,
    verification: (db.__store?.verification_results || [])
      .filter((row) => row.document_id === document.id)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null,
  }));
  res.json({ documents });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const verification = (db.__store?.verification_results || [])
    .filter((row) => row.document_id === document.id)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  res.json({ document: { ...document, verification } });
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

  db.prepare(`
    INSERT INTO verification_results (id, document_id, customer_id, verification_type, status, overall_score, details_json, run_by, run_duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    document.id,
    document.customer_id,
    'forensic',
    result.status,
    result.score,
    JSON.stringify({ ...details, signature: signReport(details) }),
    userId,
    runDurationMs,
    createdAt,
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
  const { customerId, docType = 'other' } = req.body || {};
  const db = getDb();
  const uploaded = [];

  for (const file of files) {
    const startedAt = Date.now();
    const createdAt = new Date().toISOString();
    const hash = sha256(file.buffer);
    const extracted = await extractTextFromBuffer(file.buffer, file.originalname, file.mimetype);
    const metadata = inspectMetadata(file.buffer);
    const id = randomUUID();
    const customerIdToUse = customerId || db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerIdToUse);
    const document = {
      id,
      customer_id: customerIdToUse,
      uploaded_by: req.user.id,
      doc_type: docType,
      original_name: file.originalname,
      stored_path: `memory://${id}`,
      mime_type: file.mimetype,
      file_size: file.size,
      file_hash: hash,
      fingerprint: hash,
      created_at: createdAt,
    };
    const verification = verifyDocument({ document, customer, ocr: extracted, metadata });
    const status = verification.status === 'pass' ? 'verified' : verification.status === 'warning' ? 'flagged' : 'rejected';

    db.prepare(`
      INSERT INTO documents (id, customer_id, uploaded_by, doc_type, original_name, stored_path, mime_type, file_size, file_hash, fingerprint, ocr_text, ocr_confidence, metadata_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      customerIdToUse,
      req.user.id,
      docType,
      file.originalname,
      `memory://${id}`,
      file.mimetype,
      file.size,
      hash,
      hash,
      extracted.text,
      extracted.confidence,
      JSON.stringify(serializeMetadata(metadata.metadata || {})),
      status,
      createdAt,
    );

    const verificationId = storeVerification({
      document,
      result: verification,
      userId: req.user.id,
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
    writeAuditEntry({ userId: req.user.id, action: 'document.upload.verify', resourceType: 'document', resourceId: id, details: { fileName: file.originalname, hash, status, score: verification.score } });
  }

  res.json({ documents: uploaded });
});

export default router;
