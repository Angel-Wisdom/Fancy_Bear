import { sha256 } from './crypto-engine.js';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_HASH_SALT = process.env.AADHAAR_HASH_SALT || 'suraksha-aadhaar-salt-dev-only';

const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];
const VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9];

function verhoeffChecksum(num) {
  let c = 0;
  const digits = String(num).split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digits[i]]];
  }
  return VERHOEFF_INV[c];
}

export function validatePan(pan) {
  return PAN_REGEX.test(String(pan || '').toUpperCase());
}

export function validateAadhaar(aadhaar) {
  const value = String(aadhaar || '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(value)) return false;
  return verhoeffChecksum(value.slice(0, 11)) === Number(value[11]);
}

// NEW: replaces plaintext storage/comparison of the full Aadhaar number.
// Use this to derive what gets stored (customers.aadhaar_hash) and to compare
// an OCR'd/QR-decoded number against a stored hash without ever holding the
// full number anywhere except transiently in memory during the request.
export function hashAadhaar(aadhaar) {
  const value = String(aadhaar || '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(value)) return null;
  return sha256(value + AADHAAR_HASH_SALT);
}

export function verifyKycFields({ name, pan, aadhaar, dob, address }, customer) {
  const mismatches = [];
  if (pan && !validatePan(pan)) mismatches.push('Invalid PAN format');
  if (aadhaar && !validateAadhaar(aadhaar)) mismatches.push('Invalid Aadhaar checksum');
  // CHANGED: customer.aadhaar_number no longer exists (masked storage — see schema.sql v2).
  // Compare hashes instead of plaintext numbers.
  if (aadhaar && customer?.aadhaar_hash && validateAadhaar(aadhaar) && hashAadhaar(aadhaar) !== customer.aadhaar_hash) {
    mismatches.push('Aadhaar does not match customer record');
  }
  if (customer?.full_name && name && customer.full_name.toLowerCase() !== String(name).toLowerCase()) mismatches.push('Name mismatch');
  if (customer?.date_of_birth && dob && customer.date_of_birth !== dob) mismatches.push('Date of birth mismatch');
  if (customer?.address_line1 && address && !String(address).toLowerCase().includes(customer.address_line1.split(',')[0].toLowerCase())) mismatches.push('Address mismatch');
  return {
    status: mismatches.length ? 'warning' : 'pass',
    score: Math.max(0, 100 - mismatches.length * 20),
    mismatches,
  };
}