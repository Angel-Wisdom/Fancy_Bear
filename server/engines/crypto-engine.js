import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY = createHash('sha256').update(process.env.AES_SECRET || 'suraksha-aes-secret').digest();

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function signReport(payload) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', process.env.HMAC_SECRET || 'suraksha-hmac-secret').update(data).digest('hex');
}

export function encryptText(text) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(encoded) {
  const [ivHex, payloadHex] = String(encoded).split(':');
  const decipher = createDecipheriv('aes-256-cbc', KEY, Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payloadHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
