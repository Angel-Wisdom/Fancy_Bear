import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { analyzeBenford, detectSalami, detectOutliers, findDuplicates } from '../engines/anomaly-engine.js';
import { verifyKycFields } from '../engines/kyc-engine.js';
import { verifyLandRecord } from '../engines/land-record-engine.js';
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
  const score = [kyc.score, land.score, financial.benford.flagged ? 55 : 90, duplicates.flagged ? 60 : 95].reduce((sum, value) => sum + value, 0) / 4;
  const status = score >= 80 ? 'pass' : score >= 60 ? 'warning' : 'fail';
  const result = { kyc, financial, land, duplicates, score, status };
  const verificationId = storeResult({ customerId, type: 'full', status, score, details: result, userId: req.user.id });
  res.json({ verificationId, result });
});

export default router;
