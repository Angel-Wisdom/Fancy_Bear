import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { verifyLandRecord } from '../engines/land-record-engine.js';

const router = Router();

router.use(verifyToken);

router.get('/', (req, res) => {
  const db = getDb();
  const customers = db.prepare(`
    SELECT id, full_name, date_of_birth, city, state, occupation, annual_income, risk_score
    FROM customers
    ORDER BY full_name ASC
    LIMIT 200
  `).all();

  res.json({ customers });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }
  res.json({ customer });
});

router.get('/:id/financial-records', (req, res) => {
  const db = getDb();
  const records = db.prepare(`
    SELECT *
    FROM financial_records
    WHERE customer_id = ?
    ORDER BY transaction_date DESC
    LIMIT 500
  `).all(req.params.id);
  res.json({ records });
});

router.get('/:id/land-record', (req, res) => {
  const db = getDb();
  
  // Grab the raw record from the SQLite database
  const record = db.prepare('SELECT * FROM land_records WHERE customer_id = ? LIMIT 1').get(req.params.id);
  
  if (!record) {
    return res.status(404).json({ message: 'Land record not found' });
  }

  // FETCH THE CUSTOMER PROFILE DATA (Fixes the missing signature object)
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

  try {
    // Feed the record into the engine to compute issues, status, and scores dynamically
    const verificationOutput = verifyLandRecord(record, customer);

    // Merge the engine telemetry directly into the response payload
    const completeRecord = {
      ...record,
      status: verificationOutput.status, // e.g., 'flagged', 'verified'
      score: verificationOutput.score,   // Risk rating
      issues: verificationOutput.issues   // The critical array your frontend loops over!
    };

    return res.json({ record: completeRecord });
  } catch (error) {
    console.error('Land engine processing failure:', error);
    return res.json({ 
      record: { 
        ...record, 
        issues: [{ severity: 'medium', type: 'system', message: 'Engine analysis unavailable' }] 
      } 
    });
  }
});

export default router;
