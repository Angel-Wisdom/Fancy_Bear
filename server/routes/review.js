import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

router.get('/review-queue', verifyToken, (req, res) => {
  const db = getDb();
  try {
    const alerts = db.prepare(`
      SELECT 
          a.*, 
          c.full_name as applicant_name,
          d.original_name as document_name
      FROM alerts a
      LEFT JOIN customers c ON a.customer_id = c.id
      LEFT JOIN documents d ON a.document_id = d.id
      WHERE a.is_resolved = 0
      ORDER BY CASE a.severity 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
          ELSE 5 END ASC, 
          a.created_at DESC
    `).all();
    res.json({ alerts });
  } catch (err) {
    console.error("Review queue fetch error:", err);
    res.status(500).json({ message: "Failed to load review queue" });
  }
});

export default router;