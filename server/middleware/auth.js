import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'suraksha-dev-secret';

export function signToken(payload, expiresIn = '2h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing bearer token' });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
