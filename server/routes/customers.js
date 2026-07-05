import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { verifyLandRecord } from '../engines/land-record-engine.js';
import { writeAuditEntry } from '../utils/audit.js';

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

router.post('/', (req, res) => {
  const db = getDb();
  const fullName = String(req.body?.fullName || req.body?.name || '').trim();

  if (!fullName) {
    return res.status(400).json({ message: 'Applicant name is required.' });
  }

  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const customer = {
    id,
    full_name: fullName,
    date_of_birth: String(req.body?.dateOfBirth || ''),
    gender: req.body?.gender || null,
    pan_number: req.body?.panNumber || null,
    aadhaar_last4: null,
    aadhaar_hash: null,
    phone: req.body?.phone || null,
    email: req.body?.email || null,
    address_line1: req.body?.addressLine1 || null,
    address_line2: req.body?.addressLine2 || null,
    city: req.body?.city || null,
    state: req.body?.state || null,
    pincode: req.body?.pincode || null,
    occupation: req.body?.occupation || null,
    annual_income: req.body?.annualIncome ?? null,
    risk_score: Number(req.body?.riskScore) || 0,
    created_at: createdAt,
    updated_at: createdAt,
  };

  db.prepare(`
    INSERT INTO customers (
      id, full_name, date_of_birth, gender, pan_number, aadhaar_last4, aadhaar_hash,
      phone, email, address_line1, address_line2, city, state, pincode, occupation,
      annual_income, risk_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customer.id,
    customer.full_name,
    customer.date_of_birth,
    customer.gender,
    customer.pan_number,
    customer.aadhaar_last4,
    customer.aadhaar_hash,
    customer.phone,
    customer.email,
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.pincode,
    customer.occupation,
    customer.annual_income,
    customer.risk_score,
    customer.created_at,
    customer.updated_at,
  );

  writeAuditEntry({
    userId: req.user?.id || null,
    action: 'customer.create',
    resourceType: 'customer',
    resourceId: id,
    details: { fullName },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(201).json({ customer });
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
