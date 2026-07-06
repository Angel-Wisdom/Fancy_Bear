import { sha256 } from './crypto-engine.js';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_HASH_SALT = process.env.AADHAAR_HASH_SALT || 'suraksha-aadhaar-salt-dev-only';

// ── Verhoeff (Aadhaar checksum) ──────────────────────────────

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

// ── PAN Validation ───────────────────────────────────────────

/**
 * Valid 4th-character holder type codes on Indian PAN cards.
 * C = Company, P = Person, H = HUF, F = Firm, A = AOP,
 * T = Trust, B = BOI, L = Local Authority, J = Artificial Juridical Person,
 * G = Government
 */
const PAN_HOLDER_TYPES = new Set(['C','P','H','F','A','T','B','L','J','G']);

const PAN_HOLDER_TYPE_NAMES = {
  C: 'Company', P: 'Person', H: 'HUF', F: 'Firm',
  A: 'Association of Persons', T: 'Trust', B: 'Body of Individuals',
  L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government',
};

/**
 * PAN check-digit algorithm (NSDL specification).
 *
 * Letter values: A=10, B=11, C=12 … Z=35 (consecutive base-10).
 * Weights:       [1, 2, 1, 2, 1, 2, 1, 2, 1]  (positions 1–9).
 * For each product ≥ 10, digit-sum it (e.g. 24 → 2+4 = 6).
 * Sum all adjusted products, check = (10 − sum%10) % 10.
 * Check-digit char: 0→A, 1→B, 2→C … 9→J.
 */
function computePanCheckDigit(pan9) {
  const WEIGHTS = [1, 2, 1, 2, 1, 2, 1, 2, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const ch = pan9[i].toUpperCase();
    const val = ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 65) + 10 : Number(ch);
    let product = val * WEIGHTS[i];
    if (product >= 10) product = Math.floor(product / 10) + (product % 10);
    sum += product;
  }
  const checkVal = (10 - (sum % 10)) % 10;
  return String.fromCharCode(65 + checkVal); // 0→A, 1→B, …, 9→J
}

/**
 * Basic format check only — used for quick regex gating.
 * Returns true if the string matches [A-Z]{5}[0-9]{4}[A-Z].
 */
export function validatePan(pan) {
  return PAN_REGEX.test(String(pan || '').toUpperCase());
}

/**
 * Deep PAN structure validation.
 *
 * Returns { valid, formatOk, holderType, holderTypeName, holderTypeValid,
 *           surnameInitial, checkDigitValid, checkDigitExpected, errors[] }
 *
 * - formatOk:        regex match
 * - holderTypeValid: 4th char is in the known set (C,P,H,F,A,T,B,L,J,G)
 * - checkDigitValid: 10th char matches the computed check digit
 * - surnameInitial:  5th character (first letter of surname per PAN spec)
 * - checkDigitExpected: what the 10th char should be
 */
export function validatePanStructure(pan) {
  const upper = String(pan || '').toUpperCase().replace(/\s+/g, '');
  const result = {
    valid: false,
    formatOk: false,
    holderType: null,
    holderTypeName: null,
    holderTypeValid: false,
    surnameInitial: null,
    checkDigitValid: false,
    checkDigitExpected: null,
    errors: [],
  };

  if (!PAN_REGEX.test(upper)) {
    result.errors.push('PAN does not match required format [A-Z]{5}[0-9]{4}[A-Z]');
    return result;
  }
  result.formatOk = true;

  // 4th char — holder type
  result.holderType = upper[3];
  result.holderTypeName = PAN_HOLDER_TYPE_NAMES[result.holderType] || 'Unknown';
  result.holderTypeValid = PAN_HOLDER_TYPES.has(result.holderType);
  if (!result.holderTypeValid) {
    result.errors.push(`Invalid holder type "${result.holderType}" at position 4`);
  }

  // 5th char — surname initial
  result.surnameInitial = upper[4];

  // 10th char — check digit
  const expected = computePanCheckDigit(upper.slice(0, 9));
  result.checkDigitExpected = expected;
  result.checkDigitValid = upper[9] === expected;
  if (!result.checkDigitValid) {
    result.errors.push(`Check digit mismatch: expected "${expected}", got "${upper[9]}"`);
  }

  result.valid = result.formatOk && result.holderTypeValid && result.checkDigitValid;
  return result;
}

// ── Aadhaar Validation ───────────────────────────────────────

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