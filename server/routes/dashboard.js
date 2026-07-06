import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken);

// 1. Top-line metrics (Current Day & Unresolved)
router.get('/stats', (req, res) => {
  const db = getDb();
  // Use localtime so the dashboard's 'today' matches the user's timezone
  // (SQLite's DATE('now') defaults to UTC, which would show stale data
  // in the morning in IST). 
  const totalDocuments = db.prepare("SELECT COUNT(*) AS count FROM documents WHERE DATE(created_at) = DATE('now', 'localtime')").get().count;
  const totalAlerts = db.prepare("SELECT COUNT(*) AS count FROM alerts WHERE is_resolved = 0").get().count;
  res.json({ totalDocuments, totalAlerts });
});

// 2. Verification Coverage (Grouped by Tier) for the progress bar
router.get('/coverage', (req, res) => {
  const db = getDb();
  // Using COALESCE to capture legacy or pending records that haven't been tiered yet
  const coverage = db.prepare(`
    SELECT COALESCE(tier, 'unverified') as tier, COUNT(*) as count 
    FROM verification_results 
    WHERE DATE(created_at) = DATE('now', 'localtime') 
    GROUP BY tier
  `).all();
  res.json({ coverage });
});

// 3. Document volume over the last 7 days for the mini bar chart
router.get('/trend', (req, res) => {
  const db = getDb();
  const trend = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count 
    FROM documents 
    WHERE created_at >= date('now', '-6 days') 
    GROUP BY DATE(created_at) 
    ORDER BY date ASC
  `).all();
  res.json({ trend });
});

// 4. Top 3 customers requiring underwriter review (Sorted by severity weight)
router.get('/top-applications', (req, res) => {
  const db = getDb();
  const apps = db.prepare(`
    SELECT
        c.id,
        c.full_name as name,
        COUNT(a.id) as openAlerts,
        (SELECT severity FROM alerts WHERE customer_id = c.id AND is_resolved = 0 ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC LIMIT 1) as maxSeverity
    FROM customers c
    JOIN alerts a ON c.id = a.customer_id
    WHERE a.is_resolved = 0
    GROUP BY c.id
    ORDER BY 
        MAX(CASE a.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) DESC, 
        openAlerts DESC
    LIMIT 3
  `).all();
  res.json({ topApplications: apps });
});

// Keeping a streamlined alerts endpoint to feed the "Cross-document findings" block
router.get('/alerts', (req, res) => {
  const db = getDb();
  const alerts = db.prepare("SELECT * FROM alerts WHERE is_resolved = 0 AND alert_type != 'system' ORDER BY created_at DESC LIMIT 2").all();
  res.json({ alerts });
});

export default router;