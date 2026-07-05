import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

router.get('/audit-logs', verifyToken, (req, res) => {
  const db = getDb();
  const logs = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC').all();
  res.json({ logs });
});

export default router;