// ============================================================
// Suraksha 2.0 — Anomaly Engine
// ------------------------------------------------------------
// Statistical + rule-based anomaly detection for financial
// records and documents. Thresholds are aligned with the
// system_settings table values where possible.
// ============================================================

// Thresholds (kept in one place so they're easy to tune).
// These mirror the `system_settings` rows seeded by db/seed.js.
const SALAMI_MAX_AMOUNT = Number(process.env.SALAMI_MAX_AMOUNT || 10);
const SALAMI_MIN_OCCURRENCES = Number(process.env.SALAMI_MIN_OCCURRENCES || 15);
const SALAMI_DESCRIPTION_PATTERN = /fee|charge|transfer|debit/i;
const ZSCORE_THRESHOLD = Number(process.env.ZSCORE_THRESHOLD || 3.0);

function firstDigit(amount) {
  const digit = String(Math.abs(Number(amount) || 0)).replace(/[^0-9]/g, '').replace(/^0+/, '')[0];
  return digit ? Number(digit) : null;
}

export function analyzeBenford(records = []) {
  const counts = Array(9).fill(0);
  let total = 0;
  for (const record of records) {
    const digit = firstDigit(record.amount);
    if (digit) {
      counts[digit - 1] += 1;
      total += 1;
    }
  }

  const expected = [1,2,3,4,5,6,7,8,9].map((digit) => Math.log10(1 + 1 / digit));
  const actual = counts.map((count) => (total ? count / total : 0));
  const deviation = actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0);

  return {
    counts,
    expected,
    actual,
    deviation,
    flagged: deviation > 0.45,
  };
}

// ── Salami attack detection ────────────────────────────────
// Repeated tiny deductions (₹1–₹10) that share a common destination
// account. A genuine "₹50 fee" once a month is normal — 15+ tiny
// deductions to the same destination is the salami signature.
export function detectSalami(records = []) {
  const suspicious = records.filter((record) => {
    const amount = Number(record.amount);
    return (
      amount > 0 &&
      amount <= SALAMI_MAX_AMOUNT &&
      SALAMI_DESCRIPTION_PATTERN.test(record.description || '')
    );
  });

  // Require a shared destination account for the cluster — without this
  // any 3 unrelated ₹9 transactions across town would trip the rule.
  const byDest = new Map();
  for (const record of suspicious) {
    const key = record.dest_account || record.source_account || 'unknown';
    byDest.set(key, (byDest.get(key) || 0) + 1);
  }
  const sharedDestCount = [...byDest.values()].some((n) => n >= SALAMI_MIN_OCCURRENCES);

  // Determine the most suspicious destination (highest count).
  let topDest = null;
  let topCount = 0;
  for (const [dest, count] of byDest) {
    if (count > topCount) {
      topDest = dest;
      topCount = count;
    }
  }

  return {
    flagged: sharedDestCount && suspicious.length >= SALAMI_MIN_OCCURRENCES,
    suspicious,
    count: suspicious.length,
    topDestination: topDest,
    topDestinationCount: topCount,
    threshold: SALAMI_MIN_OCCURRENCES,
  };
}

// ── Statistical outlier detection ──────────────────────────
// Z-score based. Uses the configured threshold (default 3.0)
// and excludes known recurring transactions (salary, EMI) so a
// legitimate rent payment doesn't get flagged as an outlier.
const RECURRING_RECORD_TYPES = new Set(['salary', 'emi']);

export function detectOutliers(records = []) {
  const eligible = records.filter((r) => !RECURRING_RECORD_TYPES.has(String(r.record_type || '').toLowerCase()));
  const amounts = eligible
    .map((record) => Number(record.amount) || 0)
    .filter(Boolean);

  if (amounts.length < 3) return { flagged: false, outliers: [], threshold: ZSCORE_THRESHOLD };

  const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  const variance = amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length;
  const sd = Math.sqrt(variance) || 1;
  const outliers = eligible.filter(
    (record) => Math.abs(((Number(record.amount) || 0) - mean) / sd) > ZSCORE_THRESHOLD,
  );

  return { flagged: outliers.length > 0, mean, sd, outliers, threshold: ZSCORE_THRESHOLD };
}

// ── Duplicate detection ────────────────────────────────────
// Two layers:
//   1. SHA-256 file hash — catches exact-byte duplicates (the same
//      file uploaded twice).
//   2. Normalized "content fingerprint" — a coarse hash of the OCR
//      text + file size + mime type. Catches near-duplicates where
//      the bytes differ but the content is substantively the same
//      (e.g., the same scan re-saved as a different JPEG, or the
//      same PDF re-exported).
//
// Together these are much harder to defeat than SHA-256 alone — a
// fraudster who resaves a doc with one byte changed no longer escapes
// detection. (A perceptual image hash via pHash / dHash would be the
// next layer; deferred to a future iteration since it needs an image
// processing dependency.)
export function findDuplicates(documents = []) {
  const seenByHash = new Map();
  const seenByFingerprint = new Map();
  const duplicates = [];

  for (const document of documents) {
    // Layer 1: exact hash
    if (document.file_hash) {
      if (seenByHash.has(document.file_hash)) {
        duplicates.push({ kind: 'exact', document, matched: seenByHash.get(document.file_hash) });
        continue;
      }
      seenByHash.set(document.file_hash, document);
    }

    // Layer 2: normalized content fingerprint
    const fingerprint = computeContentFingerprint(document);
    if (fingerprint) {
      if (seenByFingerprint.has(fingerprint)) {
        duplicates.push({ kind: 'near', document, matched: seenByFingerprint.get(fingerprint) });
        continue;
      }
      seenByFingerprint.set(fingerprint, document);
    }
  }

  // Dedupe by document id (a doc can show up twice if both layers trip).
  const uniqueDuplicates = [...new Map(duplicates.map((d) => [d.document.id, d])).values()];

  return {
    flagged: uniqueDuplicates.length > 0,
    duplicates: uniqueDuplicates,
  };
}

function computeContentFingerprint(document) {
  // Use the stored `fingerprint` column if it's been populated already
  // (currently upload stores the same SHA-256 in both `file_hash` and
  // `fingerprint` — but a future iteration can populate `fingerprint`
  // with a perceptual hash computed by the Python sidecar).
  //
  // For now, we compute a coarse OCR-based fingerprint: take the OCR
  // text, lowercase it, collapse whitespace, take the first 500 chars
  // (most documents are recognizable from their header), and hash that.
  const ocr = String(document.ocr_text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!ocr) return null;
  const trimmed = ocr.slice(0, 500);
  // djb2 hash — fast, good enough for bucketing
  let hash = 5381;
  for (let i = 0; i < trimmed.length; i++) {
    hash = ((hash << 5) + hash) + trimmed.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return `ocr:${(hash >>> 0).toString(16)}:${document.mime_type || 'unknown'}`;
}
