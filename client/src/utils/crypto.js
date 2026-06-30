/**
 * Suraksha 2.0 — Client-side Crypto Utility
 * SHA-256 hashing via Web Crypto API for document fingerprinting.
 */

/**
 * Compute SHA-256 hash of an ArrayBuffer
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} hex-encoded hash
 */
export async function sha256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute SHA-256 hash of a File object
 * @param {File} file
 * @returns {Promise<string>} hex-encoded hash
 */
export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  return sha256(buffer);
}

/**
 * Compute SHA-256 hash of a string
 * @param {string} text
 * @returns {Promise<string>} hex-encoded hash
 */
export async function hashString(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  return sha256(data);
}

/**
 * Generate a random hex string (for nonces, request IDs)
 * @param {number} length - byte length (output will be 2x in hex chars)
 * @returns {string}
 */
export function randomHex(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
