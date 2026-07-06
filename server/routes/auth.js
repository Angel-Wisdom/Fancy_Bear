import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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

// Exchange a refresh token for a fresh short-lived access token.
// Previously this just echoed the refresh token back as an access token,
// which defeated the purpose of having short-lived access tokens.
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'suraksha-dev-secret';
    const payload = jwt.verify(refreshToken, JWT_SECRET);

    if (payload.type !== 'refresh') {
      return res.status(401).json({ message: 'Not a refresh token' });
    }

    // Look the user up so we always sign with the current name/role.
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id);
    if (!user) {
      return res.status(401).json({ message: 'User no longer active' });
    }

    const role = 'verifier';
    const newAccessToken = signToken({ id: user.id, username: user.username, role, name: user.full_name });
    writeAuditEntry({ userId: user.id, action: 'auth.refresh', resourceType: 'user', resourceId: user.id });

    return res.json({ token: newAccessToken, refreshed: true });
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
});

router.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

export default router;
