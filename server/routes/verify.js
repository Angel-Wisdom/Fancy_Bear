import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { analyzeBenford, detectSalami, detectOutliers, findDuplicates } from '../engines/anomaly-engine.js';
import { verifyKycFields } from '../engines/kyc-engine.js';
import { verifyLandRecord } from '../engines/land-record-engine.js';
import { crossDocumentCheck } from '../engines/cross-document-engine.js';
import { signReport } from '../engines/crypto-engine.js';
import { randomUUID } from 'node:crypto';
import { writeAuditEntry } from '../utils/audit.js';

const router = Router();
router.use(verifyToken);

function storeResult({ customerId, documentId = null, type, status, score, details, userId }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO verification_results (id, document_id, customer_id, verification_type, status, overall_score, details_json, run_by, run_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, documentId, customerId, type, status, score, JSON.stringify({ ...details, signature: signReport(details) }), userId, 0);
  writeAuditEntry({ userId, action: `verify.${type}`, resourceType: 'verification_results', resourceId: id, details });
  return id;
}

router.post('/kyc', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.body.customerId) || db.prepare('SELECT * FROM customers LIMIT 1').get();
  const result = verifyKycFields(req.body, customer);
  const verificationId = storeResult({ customerId: customer.id, type: 'kyc', status: result.status, score: result.score, details: result, userId: req.user.id });
  res.json({ verificationId, result });
});

router.post('/financial', (req, res) => {
  const db = getDb();
  const customerId = req.body.customerId || db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
  const records = db.prepare('SELECT * FROM financial_records WHERE customer_id = ? ORDER BY transaction_date DESC LIMIT 500').all(customerId);
  const benford = analyzeBenford(records);
  const salami = detectSalami(records);
  const outliers = detectOutliers(records);
  const result = {
    benford,
    salami,
    outliers,
    flagged: benford.flagged || salami.flagged || outliers.flagged,
  };
  const verificationId = storeResult({ customerId, type: 'financial', status: result.flagged ? 'warning' : 'pass', score: result.flagged ? 62 : 94, details: result, userId: req.user.id });
  res.json({ verificationId, result });
});

router.post('/land-record', (req, res) => {
  const db = getDb();
  const customerId = req.body.customerId || db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
  const landRecord = db.prepare('SELECT * FROM land_records WHERE customer_id = ? LIMIT 1').get(customerId) || {};
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const result = verifyLandRecord(landRecord, customer);
  const verificationId = storeResult({ customerId, type: 'land_record', status: result.status, score: result.score, details: result, userId: req.user.id });
  res.json({ verificationId, result });
});

// NEW: Cross-document correlation endpoint.
// Pulls all documents for the customer (with their latest verification
// results joined in) and runs the cross-document engine.
router.post('/cross-document', (req, res) => {
  const db = getDb();
  const customerId = req.body.customerId || db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
  if (!customerId) return res.status(400).json({ message: 'customerId is required' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return res.status(404).json({ message: 'Customer not found' });

  // Fetch documents + their latest verification result (with extractedFields)
  const documents = db.prepare(`
    SELECT d.*, v.details_json AS details_json, v.status AS verification_status, v.overall_score AS verification_score
    FROM documents d
    LEFT JOIN verification_results v ON v.document_id = d.id
      AND v.created_at = (
        SELECT MAX(v2.created_at) FROM verification_results v2 WHERE v2.document_id = d.id
      )
    WHERE d.customer_id = ?
    ORDER BY d.created_at ASC
  `).all(customerId);

  // Wrap into the shape crossDocumentCheck expects.
  const wrappedDocs = documents.map((d) => ({
    id: d.id,
    doc_type: d.doc_type,
    original_name: d.original_name,
    verification: {
      details_json: d.details_json,
      status: d.verification_status,
      overall_score: d.verification_score,
    },
  }));

  const startedAt = Date.now();
  const result = crossDocumentCheck(wrappedDocs, customer);
  const runDurationMs = Date.now() - startedAt;

  const verificationId = storeResult({
    customerId,
    type: 'cross_document',
    status: result.status,
    score: result.score,
    details: result,
    userId: req.user.id,
  });

  res.json({ verificationId, result, runDurationMs });
});

router.post('/full', (req, res) => {
  const db = getDb();
  const customerId = req.body.customerId || db.prepare('SELECT id FROM customers LIMIT 1').get()?.id;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  const documents = db.prepare('SELECT * FROM documents WHERE customer_id = ?').all(customerId);
  const financialRecords = db.prepare('SELECT * FROM financial_records WHERE customer_id = ?').all(customerId);
  const landRecord = db.prepare('SELECT * FROM land_records WHERE customer_id = ? LIMIT 1').get(customerId) || {};

  const kyc = verifyKycFields(req.body, customer);
  const financial = {
    benford: analyzeBenford(financialRecords),
    salami: detectSalami(financialRecords),
    outliers: detectOutliers(financialRecords),
  };
  const land = verifyLandRecord(landRecord, customer);
  const duplicates = findDuplicates(documents);

  // Run cross-document correlation if there are at least 2 documents.
  const wrappedDocs = documents.map((d) => {
    const latestVerification = db.prepare(`
      SELECT details_json FROM verification_results
      WHERE document_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(d.id);
    return {
      id: d.id,
      doc_type: d.doc_type,
      original_name: d.original_name,
      verification: { details_json: latestVerification?.details_json },
    };
  });
  const crossDoc = documents.length >= 2 ? crossDocumentCheck(wrappedDocs, customer) : null;

  // Weighted score: KYC, financial, land, duplicates, and (when present)
  // cross-document findings. If there are no documents yet, the application
  // should be 'pending' rather than artificially inflated.
  if (!documents.length) {
    const result = {
      kyc,
      financial,
      land,
      duplicates,
      crossDocument: null,
      score: 0,
      status: 'pending',
      summary: { documentsAnalyzed: 0, message: 'No documents uploaded yet.' },
    };
    const verificationId = storeResult({ customerId, type: 'full', status: 'pending', score: 0, details: result, userId: req.user.id });
    return res.json({ verificationId, result });
  }

  const components = [
    kyc.score,
    land.score,
    financial.benford.flagged ? 55 : 90,
    duplicates.flagged ? 60 : 95,
  ];
  if (crossDoc) components.push(crossDoc.score);
  const score = components.reduce((sum, value) => sum + value, 0) / components.length;
  const status = score >= 80 ? 'pass' : score >= 60 ? 'warning' : 'fail';

  const result = { kyc, financial, land, duplicates, crossDocument: crossDoc, score, status };
  const verificationId = storeResult({ customerId, type: 'full', status, score, details: result, userId: req.user.id });
  res.json({ verificationId, result });
});

export default router;
