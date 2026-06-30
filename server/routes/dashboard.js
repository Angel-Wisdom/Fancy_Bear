import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken);

router.get('/stats', (req, res) => {
  const db = getDb();
  const totalDocuments = db.prepare('SELECT COUNT(*) AS count FROM documents').get().count;
  const totalAlerts = db.prepare('SELECT COUNT(*) AS count FROM alerts').get().count;
  const passRate = db.prepare(`SELECT COALESCE(ROUND(100.0 * SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1), 0) AS value FROM verification_results`).get().value;
  const avgProcessingTime = db.prepare('SELECT COALESCE(ROUND(AVG(run_duration_ms), 1), 0) AS value FROM verification_results').get().value;
  res.json({ totalDocuments, totalAlerts, passRate, avgProcessingTime });
});

router.get('/alerts', (req, res) => {
  const db = getDb();
  const alerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 20').all();
  res.json({ alerts });
});

router.get('/audit-log', (req, res) => {
  const db = getDb();
  const auditLog = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all();
  res.json({ auditLog });
});

export default router;
