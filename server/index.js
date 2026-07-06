import express from 'express';
import { getDb, closeDb } from './db/database.js';
import { applySecurity } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import documentsRoutes from './routes/documents.js';
import verifyRoutes from './routes/verify.js';
import dashboardRoutes from './routes/dashboard.js';
import reportsRoutes from './routes/reports.js';
import aadhaarRoutes from './routes/aadhaar.js';
import auditRoutes from './routes/audit.js';
import reviewRoutes from './routes/review.js';

const app = express();
const port = Number(process.env.PORT || 3001);

getDb();

applySecurity(app);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  // Verify DB connectivity — a 200 here means the API + DB are both alive.
  try {
    const db = getDb();
    db.prepare('SELECT 1 AS one').get();
    res.json({ ok: true, service: 'suraksha-server', mode: 'offline', db: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'suraksha-server', mode: 'offline', db: 'error', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/aadhaar', aadhaarRoutes);
app.use('/api', auditRoutes);
app.use('/api/review', reviewRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found', path: req.path });
});

app.use((error, req, res, next) => {
  console.error('[API]', error);
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[server] Listening on http://0.0.0.0:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}