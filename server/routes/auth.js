import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/database.js';
import { signToken, verifyToken } from '../middleware/auth.js';
import { writeAuditEntry } from '../utils/audit.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const role = 'verifier';
  const token = signToken({ id: user.id, username: user.username, role, name: user.full_name });
  writeAuditEntry({ userId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, details: { username: user.username } });

  return res.json({
    token,
    refreshToken: signToken({ id: user.id, type: 'refresh' }, '7d'),
    user: {
      id: user.id,
      username: user.username,
      name: user.full_name,
      role,
      email: user.email,
    },
  });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token is required' });
  return res.json({ token: refreshToken, refreshed: true });
});

router.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

export default router;
