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

const app = express();
const port = Number(process.env.PORT || 3001);

getDb();

applySecurity(app);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'suraksha-server', mode: 'offline' });
});

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/aadhaar', aadhaarRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found', path: req.path });
});

app.use((error, req, res, next) => {
  console.error('[API]', error);
  res.status(error.status || 500).json({ message: error.message || 'Internal server error' });
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`[server] Listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
