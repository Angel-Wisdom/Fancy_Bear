import { detectTamperSignals } from './forensics-engine.js';
import { validateAadhaar, validatePan, hashAadhaar } from './kyc-engine.js';
import { extractNameFromAadhaarOcr, crossCheckQrData } from './aadhaar-engine.js';

const DOC_REQUIREMENTS = {
  pan_card: {
    fields: ['pan'],
    keywords: ['income tax', 'permanent account', 'pan'],
  },
  aadhaar_card: {
    fields: ['aadhaar'],
    keywords: ['aadhaar', 'uidai', 'government of india'],
  },
  passport: {
    fields: ['passport'],
    keywords: ['passport', 'republic of india'],
  },
  bank_statement: {
    fields: ['amounts', 'dates'],
    keywords: ['statement', 'account', 'balance', 'transaction'],
  },
  salary_slip: {
    fields: ['amounts', 'dates'],
    keywords: ['salary', 'earnings', 'deduction', 'net pay'],
  },
  itr: {
    fields: ['pan', 'amounts'],
    keywords: ['income tax return', 'assessment year', 'gross total income'],
  },
  land_title: {
    fields: ['surveyNumber'],
    keywords: ['survey', 'registration', 'owner', 'land'],
  },
  encumbrance_cert: {
    fields: ['surveyNumber'],
    keywords: ['encumbrance', 'certificate', 'property'],
  },
  sale_deed: {
    fields: ['surveyNumber', 'dates'],
    keywords: ['sale deed', 'seller', 'purchaser', 'registration'],
  },
};

function compactText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function addFinding(findings, severity, code, message, evidence = null) {
  findings.push({ severity, code, message, evidence });
}

function extractFields(text) {
  const normalized = compactText(text).toUpperCase();
  const aadhaarMatches = [...normalized.matchAll(/\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/g)].map((match) => match[0].replace(/\s+/g, ''));
  const panMatches = [...normalized.matchAll(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g)].map((match) => match[0]);
  const passportMatches = [...normalized.matchAll(/\b[A-Z][0-9]{7}\b/g)].map((match) => match[0]);
  const dateMatches = [...normalized.matchAll(/\b(?:\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[0]);
  const amountMatches = [...normalized.matchAll(/(?:INR|RS\.?|₹)?\s?([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\b/g)]
    .map((match) => Number(String(match[1]).replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value >= 100);
  const surveyNumber = normalized.match(/\b(?:SURVEY|SY|S\.NO|SURVEY NO)\.?\s*[:#-]?\s*([0-9]+(?:\/[0-9A-Z-]+)?)\b/)?.[1] || null;

  return {
    pan: panMatches[0] || null,
    aadhaar: aadhaarMatches[0] || null,
    passport: passportMatches[0] || null,
    dates: [...new Set(dateMatches)],
    amounts: amountMatches.slice(0, 50),
    surveyNumber,
  };
}

function amountStats(amounts) {
  if (!amounts.length) return { repeatedValues: [], highRoundNumberShare: 0 };
  const counts = new Map();
  for (const amount of amounts) counts.set(amount, (counts.get(amount) || 0) + 1);
  const repeatedValues = [...counts.entries()].filter(([, count]) => count >= 3).map(([amount, count]) => ({ amount, count }));
  const roundNumbers = amounts.filter((amount) => amount >= 1000 && amount % 1000 === 0).length;
  return { repeatedValues, highRoundNumberShare: roundNumbers / amounts.length };
}

function compareCustomer(fields, customer, qrConfirmed = {}) {
  const mismatches = [];
  if (fields.pan && customer?.pan_number && fields.pan !== String(customer.pan_number).toUpperCase()) {
    mismatches.push({ field: 'pan', expected: customer.pan_number, actual: fields.pan });
  }
  // Aadhaar hash comparison — skip if QR already confirmed the match
  if (fields.aadhaar && customer?.aadhaar_hash && validateAadhaar(fields.aadhaar) && hashAadhaar(fields.aadhaar) !== customer.aadhaar_hash && !qrConfirmed.aadhaarMatch) {
    mismatches.push({ field: 'aadhaar', expected: `hash:${customer.aadhaar_hash.slice(0, 8)}…`, actual: fields.aadhaar });
  }
  return mismatches;
}

function normalizePersonName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(mr|mrs|ms|miss|shri|sri|smt|dr|prof|name|applicant|customer|holder)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareApplicantName(text, customer) {
  const expectedName = normalizePersonName(customer?.full_name);
  if (!expectedName) return null;

  const normalizedText = normalizePersonName(text);
  if (!normalizedText) {
    return {
      matched: false,
      reason: 'OCR text was empty, so the applicant name could not be verified.',
      evidence: { expected: customer.full_name },
    };
  }

  if (normalizedText.includes(expectedName)) {
    return { matched: true, evidence: { expected: customer.full_name, match: customer.full_name } };
  }

  const expectedTokens = expectedName.split(' ').filter((token) => token.length > 1);
  const matchedTokens = expectedTokens.filter((token) => normalizedText.includes(token));
  const matchRatio = expectedTokens.length ? matchedTokens.length / expectedTokens.length : 0;

  return {
    // Lowered from 0.75 → 0.6 — Indian middle names are commonly dropped
    // between documents (e.g., "Aarav Kumar Sharma" on Aadhaar, "Aarav Sharma"
    // on a salary slip). The previous threshold flagged ~30% of legitimate
    // applications as name mismatches.
    matched: matchRatio >= 0.6 && matchedTokens.length >= 2,
    reason: 'OCR text does not contain the selected applicant name.',
    evidence: {
      expected: customer.full_name,
      matchedTokens,
      matchRatio: Number(matchRatio.toFixed(2)),
    },
  };
}

function scoreFindings(findings) {
  const penalty = findings.reduce((sum, finding) => {
    // 'info' severity is a positive/neutral signal (e.g. QR verified, dual-source
    // name confirmation) — zero penalty.
    if (finding.severity === 'info') return sum;
    if (finding.code === 'pixel.content_credentials_detected') return sum + 48;
    if (finding.severity === 'critical') return sum + 35;
    if (finding.severity === 'high') return sum + 24;
    if (finding.severity === 'medium') return sum + 13;
    return sum + 6;
  }, 0);
  return Math.max(0, 100 - penalty);
}

function extractAmountEntries(text, pattern) {
  return compactText(text)
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean)
    .flatMap((line) => {
      if (pattern && !pattern.test(line)) return [];
      const values = [...line.matchAll(/(?:INR|RS\.?|RUPEES|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)]
        .map((match) => Number(String(match[1]).replace(/,/g, '')))
        .filter((value) => Number.isFinite(value));
      if (!values.length) return [];

      const lowerLine = line.toLowerCase();
      let category = 'other';
      if (/net pay|take home|net salary|net taxable|tax payable|refund/i.test(lowerLine)) {
        category = 'net';
      } else if (/deduction|tds|pf|epf|pt|tax|cess|advance/i.test(lowerLine)) {
        category = 'deduction';
      } else if (/gross|total earnings|total income|ctc/i.test(lowerLine)) {
        category = 'gross';
      } else if (/basic|hra|allowance|bonus|arrear|salary|income/i.test(lowerLine)) {
        category = 'earning';
      }

      return [{ line, value: values[values.length - 1], category }];
    });
}

function findAmountFromLine(text, matchers) {
  const lines = compactText(text).split(/\n+/).map((line) => compactText(line)).filter(Boolean);
  for (const line of lines) {
    if (!matchers.some((matcher) => matcher.test(line))) continue;
    const values = [...line.matchAll(/(?:INR|RS\.?|RUPEES|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi)]
      .map((match) => Number(String(match[1]).replace(/,/g, '')))
      .filter((value) => Number.isFinite(value));
    if (values.length) return values[values.length - 1];
  }
  return null;
}

function sumEntries(entries, categories) {
  return entries
    .filter((entry) => categories.includes(entry.category) && Number(entry.value) > 0)
    .reduce((sum, entry) => sum + Number(entry.value), 0);
}

function detectSyntheticImageSignals(document, metadata, ocr, text) {
  const suspicious = [];
  const metadataValues = Object.values(metadata?.metadata || {}).flatMap((entry) => {
    if (entry && typeof entry === 'object') {
      return [entry.description, entry.value, entry.rawValue].filter(Boolean).map((value) => String(value));
    }
    return entry ? [String(entry)] : [];
  }).join(' | ');
  const combined = [document?.original_name, document?.mime_type, metadataValues].filter(Boolean).join(' | ');

  if (/(midjourney|dall[- ]?e|stable diffusion|firefly|imagefx|dreamstudio|photoshop|gimp|canva|openai|generative|ai-generated|synthetic)/i.test(combined)) {
    suspicious.push('Metadata or embedded software hints at AI-generated or heavily edited image content.');
  }

  const aiTextSignals = /(generated by ai|ai generated|synthetic image|create with ai|sdxl|stable diffusion|midjourney|dall[- ]?e|firefly|imagefx)/i.test(text);
  if (aiTextSignals) {
    suspicious.push('OCR text contains AI-generation or synthetic-image markers.');
  }

  if (/^image\//i.test(document?.mime_type || '') && (ocr?.confidence || 0) < 25 && text.length > 40) {
    suspicious.push('Low OCR confidence on a text-heavy image can indicate a synthetic or altered document.');
  }

  if (/^image\//i.test(document?.mime_type || '') && ocr?.engine === 'fallback-text-decoder') {
    suspicious.push('Image parsing fell back to text decoding, which is unusual for a clean source image.');
  }

  return { flagged: suspicious.length > 0, suspicious };
}

function analyzeSalarySlip(text) {
  const entries = extractAmountEntries(text, /(salary|pay|gross|basic|hra|allowance|bonus|arrear|deduction|pf|epf|tds|pt|net|take home|ctc|income)/i);
  const amounts = entries.map((entry) => Number(entry.value) || 0);
  const positiveAmounts = amounts.filter((value) => value > 0);
  const gross = findAmountFromLine(text, [/gross earnings/i, /gross salary/i, /total earnings/i, /gross pay/i, /ctc/i]) || sumEntries(entries, ['gross', 'earning']) || 0;
  const deductions = sumEntries(entries, ['deduction']);
  const netPay = findAmountFromLine(text, [/net pay/i, /take home/i, /total net payable/i, /net salary/i]) || entries.find((entry) => entry.category === 'net')?.value || 0;
  const findings = [];
  let forceFail = false;

  if (!entries.length || !positiveAmounts.length || amounts.every((value) => value === 0)) {
    findings.push({
      severity: 'critical',
      code: 'salary.amounts.zero_or_missing',
      message: 'Salary slip does not contain any positive monetary values, so it should be rejected.',
      evidence: entries.slice(0, 10),
    });
    return { findings, forceFail: true };
  }

  const meaningfulAmounts = positiveAmounts.filter((value) => value >= 100);
  if (!meaningfulAmounts.length) {
    findings.push({
      severity: 'critical',
      code: 'salary.amounts.subthreshold',
      message: 'Salary slip only exposes trivial amounts and should be rejected.',
      evidence: entries.slice(0, 10),
    });
    return { findings, forceFail: true };
  }

  const expectedGross = findAmountFromLine(text, [/gross earnings/i, /gross salary/i, /total earnings/i]) || gross;
  if (!expectedGross) {
    findings.push({
      severity: 'high',
      code: 'salary.gross_missing',
      message: 'Salary slip does not expose a gross earnings row in the OCR text.',
      evidence: entries.slice(0, 10),
    });
    forceFail = true;
  }

  if (!netPay) {
    findings.push({
      severity: 'high',
      code: 'salary.net_pay_missing',
      message: 'Salary slip does not expose a net pay or take-home amount in the OCR text.',
      evidence: entries.slice(0, 10),
    });
    forceFail = true;
  }

  if (expectedGross && netPay) {
    const expectedNet = Math.max(0, expectedGross - deductions);
    const tolerance = Math.max(50, Math.max(expectedNet, netPay) * 0.05);
    if (Math.abs(expectedNet - netPay) > tolerance) {
      findings.push({
        severity: 'critical',
        code: 'salary.total.mismatch',
        message: 'Salary slip totals do not reconcile between gross earnings, deductions, and net pay.',
        evidence: { gross: expectedGross, deductions, netPay, expectedNet },
      });
      forceFail = true;
    }
  }

  return { findings, forceFail };
}

function analyzeItr(text) {
  const entries = extractAmountEntries(text, /(income|tax|refund|deduction|salary|gross total|total income|taxable|assessment year|tds|cess)/i);
  const amounts = entries.map((entry) => Number(entry.value) || 0);
  const positiveAmounts = amounts.filter((value) => value > 0);
  const totalIncome = findAmountFromLine(text, [/^total income/i, /gross total income/i, /taxable income/i, /adjusted total income/i]) || sumEntries(entries, ['gross', 'earning']) || 0;
  const taxesPaid = findAmountFromLine(text, [/^taxes paid/i, /^tax paid/i, /tax paid/i]) || 0;
  const netTaxPayable = findAmountFromLine(text, [/net tax payable/i, /tax payable/i, /refund/i]) || sumEntries(entries, ['deduction', 'net']) || 0;
  const ayMatch = text.match(/assessment year\s+([0-9]{4}-[0-9]{2})/i)?.[1] || null;
  const findings = [];
  let forceFail = false;

  if (!entries.length || !positiveAmounts.length || amounts.every((value) => value === 0)) {
    findings.push({
      severity: 'critical',
      code: 'itr.amounts.zero_or_missing',
      message: 'ITR OCR does not contain any positive monetary values, so it should be rejected.',
      evidence: entries.slice(0, 10),
    });
    return { findings, forceFail: true };
  }

  if (!ayMatch) {
    findings.push({
      severity: 'medium',
      code: 'itr.assessment_year_missing',
      message: 'ITR acknowledgement does not clearly expose an assessment year.',
      evidence: entries.slice(0, 10),
    });
  }

  if (totalIncome <= 0) {
    findings.push({
      severity: 'critical',
      code: 'itr.total_income_invalid',
      message: 'ITR total income is missing or zero, so the document should be rejected.',
      evidence: entries.slice(0, 10),
    });
    return { findings, forceFail: true };
  }

  if (!netTaxPayable && !taxesPaid) {
    findings.push({
      severity: 'high',
      code: 'itr.tax_summary_missing',
      message: 'ITR text does not expose a usable tax summary row.',
      evidence: entries.slice(0, 10),
    });
    forceFail = true;
  }

  if (taxesPaid && netTaxPayable && Math.abs(Math.abs(netTaxPayable) - taxesPaid) > Math.max(100, taxesPaid * 0.1)) {
    findings.push({
      severity: 'critical',
      code: 'itr.total.mismatch',
      message: 'ITR tax paid and net tax payable/refundable values do not reconcile.',
      evidence: { taxesPaid, netTaxPayable },
    });
    forceFail = true;
  }

  if (totalIncome && taxesPaid && taxesPaid > totalIncome * 0.5) {
    findings.push({
      severity: 'medium',
      code: 'itr.tax_burden_high',
      message: 'ITR tax paid is unusually high relative to declared income.',
      evidence: { totalIncome, taxesPaid },
    });
  }

  return { findings, forceFail };
}

/**
 * QR-guided name extraction: given the QR-decoded name, try to find
 * matching tokens in the OCR text. This handles garbled OCR output
 * where the heuristic extractor fails completely.
 *
 * Strategy: take the QR name tokens, look for them (or fuzzy matches)
 * in the OCR text lines. Reconstruct the best-matching name from OCR.
 *
 * Returns the matched name string, or null.
 */
function findNameByQrGuidance(ocrText, qrName) {
  if (!ocrText || !qrName) return null;

  const qrTokens = qrName
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);

  if (!qrTokens.length) return null;

  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  // For each line, check how many QR name tokens appear in it
  let bestLine = null;
  let bestMatchCount = 0;

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    let matchCount = 0;
    for (const token of qrTokens) {
      if (lineLower.includes(token)) matchCount++;
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestLine = line;
    }
  }

  if (!bestLine || bestMatchCount < Math.ceil(qrTokens.length * 0.5)) {
    return null;
  }

  // Try to extract the name portion from the best line
  // Look for title-case word sequences that overlap with QR tokens
  const wordRe = /\b[A-Z][a-z]{1,}\b/g;
  const words = [];
  let m;
  while ((m = wordRe.exec(bestLine)) !== null) {
    words.push(m[0]);
  }

  if (!words.length) return null;

  // Filter to words that match or are substrings of QR tokens
  const matchedWords = words.filter(w => {
    const wl = w.toLowerCase();
    return qrTokens.some(qt => wl === qt || qt.includes(wl) || wl.includes(qt));
  });

  if (matchedWords.length >= Math.ceil(qrTokens.length * 0.5)) {
    // Reconstruct name in QR token order
    const ordered = [];
    for (const qt of qrTokens) {
      const found = matchedWords.find(w => {
        const wl = w.toLowerCase();
        return wl === qt || qt.includes(wl) || wl.includes(qt);
      });
      if (found && !ordered.includes(found)) ordered.push(found);
    }
    if (ordered.length) return ordered.join(' ');
  }

  // Fallback: return the best matching words from the line
  if (matchedWords.length) return matchedWords.join(' ');
  return null;
}

/**
 * Check if two names share enough tokens to be considered the same person.
 * More lenient than full string match — handles OCR variations.
 */
function nameTokensOverlap(nameA, nameB) {
  const normA = nameA.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  const normB = nameB.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  if (!normA.length || !normB.length) return false;
  const matched = normA.filter(t => normB.includes(t) || normB.some(b => b.includes(t) || t.includes(b)));
  return matched.length >= Math.ceil(Math.min(normA.length, normB.length) * 0.6);
}

export function verifyDocument({ document, customer, ocr, metadata, pixelForensics, qrScan }) {
  const text = compactText(ocr?.text);
  const lowerText = text.toLowerCase();
  const fields = extractFields(text);
  const findings = [];
  const requirement = DOC_REQUIREMENTS[document.doc_type] || null;
  const tamperSignals = detectTamperSignals(document.original_name, document.mime_type);
  const metadataSignals = metadata?.suspicious || [];
  const syntheticSignals = detectSyntheticImageSignals(document, metadata, ocr, text);
  let forceFail = false;

  // ── Aadhaar-specific: extract name from OCR ──
  // Two-pass strategy:
  //  Pass 1: Try standard heuristic extraction from OCR text.
  //  Pass 2: If QR decoded successfully, try QR-guided matching — find the
  //          QR name (or its tokens) within the OCR text, which is far more
  //          reliable than blind heuristic extraction when OCR is garbled.
  let ocrExtractedName = null;
  let ocrNameSource = null; // 'heuristic' | 'qr_guided'
  if (document.doc_type === 'aadhaar_card') {
    // Pass 1: heuristic extraction
    const nameResult = extractNameFromAadhaarOcr(text);
    if (nameResult) {
      ocrExtractedName = nameResult.name;
      ocrNameSource = 'heuristic';
    }
  }

  // ── QR cross-checks (Aadhaar only) ──
  let qrCrossCheck = null;
  let qrConfirmed = { aadhaarMatch: false, nameMatch: false, dobMatch: false };
  const hasNameOcrMismatch = (code) => findings.some(f => f.code === code);

  if (qrScan && qrScan.scanned) {
    // ── QR-guided name extraction (Pass 2) ──
    // If QR has a name and we haven't found a good OCR name yet,
    // try to find QR name tokens in the OCR text. This handles short
    // names like "Om" that the 3+ char heuristic would miss.
    if (document.doc_type === 'aadhaar_card') {
      const qrName = qrScan.data?.name || qrScan.data?.Name || '';
      if (qrName && !ocrExtractedName) {
        const guided = findNameByQrGuidance(text, qrName);
        if (guided) {
          ocrExtractedName = guided;
          ocrNameSource = 'qr_guided';
        }
      }
      // Even if heuristic found a name, if QR is available, verify the
      // heuristic name actually matches QR. If not, try QR-guided.
      if (qrName && ocrExtractedName && ocrNameSource === 'heuristic') {
        const similar = nameTokensOverlap(ocrExtractedName, qrName);
        if (!similar) {
          // Heuristic found garbage (e.g. "Te Ry"), discard and try QR-guided
          const guided = findNameByQrGuidance(text, qrName);
          if (guided) {
            ocrExtractedName = guided;
            ocrNameSource = 'qr_guided';
          } else {
            // QR-guided also failed — use QR name directly as the best source
            ocrExtractedName = qrName;
            ocrNameSource = 'qr_only';
          }
        }
      }
      // If no OCR name at all and QR available, use QR name
      if (!ocrExtractedName && qrName) {
        ocrExtractedName = qrName;
        ocrNameSource = 'qr_only';
      }
    }

    fields.name = ocrExtractedName;

    qrCrossCheck = crossCheckQrData(qrScan, customer, fields, ocrExtractedName);
    findings.push(...qrCrossCheck.findings);

    // Build confirmation flags — when QR verifies a field, skip the
    // corresponding OCR-based check (QR is ground truth, OCR is noisy).
    const checks = qrCrossCheck.matchSummary?.checks || {};
    qrConfirmed = {
      aadhaarMatch: checks.aadhaarVsCustomer === 'match',
      nameMatch: checks.nameVsCustomer === 'match',
      dobMatch: checks.dobVsCustomer === 'match',
    };

    // Positive finding: QR verified successfully
    if (qrCrossCheck.matchSummary?.overall === 'match') {
      findings.push({
        severity: 'info',
        code: 'aadhaar.qr_verified',
        message: 'Aadhaar QR code scanned and decoded successfully. All QR data cross-checks against customer record passed.',
        evidence: { checks: qrCrossCheck.matchSummary.checks },
      });
    }
  } else if (qrScan && !qrScan.scanned && document.doc_type === 'aadhaar_card') {
    // QR scan was attempted but failed — informational, no penalty
    findings.push({
      severity: 'low',
      code: 'aadhaar.qr_not_scannable',
      message: 'Aadhaar QR code could not be scanned: ' + (qrScan.reason || 'unknown reason') + '. Verification relied on OCR only.',
    });
  }

  if (!text) addFinding(findings, 'high', 'ocr.empty', 'No readable text could be extracted from the document.');
  if ((ocr?.confidence || 0) < 45) addFinding(findings, 'medium', 'ocr.low_confidence', 'OCR confidence is below the verification threshold.', { confidence: ocr?.confidence || 0 });
  if (tamperSignals.flagged) {
    for (const signal of tamperSignals.suspicious) addFinding(findings, 'high', 'file.mime_mismatch', signal);
  }
  for (const signal of metadataSignals) addFinding(findings, 'medium', 'metadata.suspicious', signal);
  for (const signal of syntheticSignals.suspicious) addFinding(findings, 'high', 'image.synthetic_generated', signal);

  // Pixel-level forensics (ELA, copy-move/clone detection, noise
  // inconsistency, JPEG requantization) from the OpenCV microservice. These
  // findings already arrive in {severity, code, message, evidence} shape.
  if (pixelForensics?.applicable && !pixelForensics.unavailable) {
    for (const finding of pixelForensics.findings || []) findings.push(finding);
  } else if (pixelForensics?.unavailable) {
    addFinding(
      findings,
      'low',
      'pixel.forensics_unavailable',
      'Pixel-level forensic analysis (ELA/clone/noise) could not run because the forensics microservice was unreachable; only metadata-based checks were applied.',
      { error: pixelForensics.error },
    );
  }

  if (requirement) {
    const keywordHits = requirement.keywords.filter((keyword) => lowerText.includes(keyword));
    if (text && keywordHits.length === 0) {
      addFinding(findings, 'medium', 'document.type_mismatch', `OCR text does not contain expected ${document.doc_type.replaceAll('_', ' ')} markers.`);
    }

    for (const requiredField of requirement.fields) {
      const value = fields[requiredField];
      const missing = Array.isArray(value) ? value.length === 0 : !value;
      if (missing) addFinding(findings, 'high', `field.missing.${requiredField}`, `Required ${requiredField} evidence was not found.`);
    }
  }

  if (fields.pan && !validatePan(fields.pan)) addFinding(findings, 'high', 'pan.invalid', 'Extracted PAN has an invalid format.', { pan: fields.pan });
  // Aadhaar checksum: skip if QR already confirmed the Aadhaar matches customer
  if (fields.aadhaar && !validateAadhaar(fields.aadhaar) && !qrConfirmed.aadhaarMatch) {
    addFinding(findings, 'high', 'aadhaar.invalid', 'Extracted Aadhaar failed checksum validation.', { aadhaar: fields.aadhaar });
  }

  if (document.doc_type === 'salary_slip') {
    const salaryAnalysis = analyzeSalarySlip(text);
    findings.push(...salaryAnalysis.findings);
    forceFail = forceFail || salaryAnalysis.forceFail;
  }

  if (document.doc_type === 'itr') {
    const itrAnalysis = analyzeItr(text);
    findings.push(...itrAnalysis.findings);
    forceFail = forceFail || itrAnalysis.forceFail;
  }

  // Customer field comparison — skip Aadhaar hash check if QR already confirmed it
  const customerMismatches = compareCustomer(fields, customer, qrConfirmed);
  for (const mismatch of customerMismatches) {
    addFinding(findings, 'high', 'kyc.customer_mismatch', `Extracted ${mismatch.field} does not match the selected customer.`, mismatch);
  }

  // Name comparison — skip if QR already confirmed name matches customer
  const nameCheck = compareApplicantName(text, customer);
  if (nameCheck && !nameCheck.matched && !qrConfirmed.nameMatch) {
    addFinding(
      findings,
      text ? 'high' : 'medium',
      'kyc.customer_name_mismatch',
      nameCheck.reason,
      nameCheck.evidence,
    );
  } else if (
    nameCheck && nameCheck.matched && qrConfirmed.nameMatch && ocrExtractedName &&
    !hasNameOcrMismatch('aadhaar.qr_name_ocr_mismatch') &&
    ocrNameSource !== 'qr_only' &&
    (qrCrossCheck?.matchSummary?.checks?.nameVsOcr === 'match' || ocrNameSource === 'qr_guided')
  ) {
    // Both OCR and QR confirm the name AND they agree with each other.
    // Only fire when all three sources (OCR, QR, customer) are in agreement
    // AND there's no OCR-vs-QR name mismatch finding.
    findings.push({
      severity: 'info',
      code: 'aadhaar.name_confirmed_dual_source',
      message: `Applicant name "${ocrExtractedName}" confirmed by both OCR extraction and QR code scan.`,
      evidence: { ocrName: ocrExtractedName, qrName: qrScan?.data?.name || qrScan?.data?.Name, source: ocrNameSource },
    });
  }

  // DOB cross-check: skip if QR already confirmed DOB matches customer
  if (customer?.date_of_birth && fields.dates.length && !qrConfirmed.dobMatch) {
    const customerDob = String(customer.date_of_birth); // YYYY-MM-DD
    // Accept either ISO (YYYY-MM-DD) or DD-MM-YYYY / DD/MM/YYYY forms.
    const dobMatch = fields.dates.find((d) => {
      if (d === customerDob) return true;
      // Try DD-MM-YYYY → YYYY-MM-DD
      const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (m) {
        const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return iso === customerDob;
      }
      return false;
    });
    if (!dobMatch) {
      addFinding(
        findings,
        'medium',
        'kyc.dob_not_found',
        'Customer DOB was not found in the document text.',
        { expected: customer.date_of_birth, foundDates: fields.dates.slice(0, 5) },
      );
    }
  }

  // Address cross-check: if the customer has an address on file, ensure
  // at least the pincode (last 6 digits of address) appears in the OCR text.
  if (customer?.pincode) {
    const pincode = String(customer.pincode);
    if (text && !text.includes(pincode)) {
      addFinding(
        findings,
        'medium',
        'kyc.address_pincode_not_found',
        `Customer pincode (${pincode}) was not found in the document text.`,
        { expectedPincode: pincode },
      );
    }
  }

  // Amount analysis — only relevant for financial documents
  const FINANCIAL_DOC_TYPES = new Set(['bank_statement', 'salary_slip', 'itr', 'sale_deed']);
  if (FINANCIAL_DOC_TYPES.has(document.doc_type)) {
    const amounts = amountStats(fields.amounts);
    if (amounts.repeatedValues.length) {
      addFinding(findings, 'medium', 'amount.repeated_values', 'Repeated amount values appear unusually often in the document.', amounts.repeatedValues.slice(0, 5));
    }
    if (amounts.highRoundNumberShare > 0.6 && fields.amounts.length >= 8) {
      addFinding(findings, 'medium', 'amount.rounding_bias', 'Most extracted amounts are round thousands, which can indicate fabricated statements.', { share: amounts.highRoundNumberShare });
    }
  }

  let score = scoreFindings(findings);

  // QR verification bonus: if QR scanned and all cross-checks passed,
  // the Aadhaar data is cryptographically verified by UIDAI — the most
  // reliable verification source. Add a small score boost.
  if (qrScan?.scanned && qrCrossCheck?.matchSummary?.overall === 'match') {
    score = Math.min(100, score + 5);
  }

  const status = forceFail ? 'fail' : score >= 75 ? 'pass' : score >= 55 ? 'warning' : 'fail';

  return {
    status,
    score,
    engine: {
      name: 'document-verification-engine',
      version: '2.2.0',
      ocrEngine: ocr?.engine || 'unknown',
    },
    ocr: {
      confidence: ocr?.confidence || 0,
      pages: ocr?.pages || 0,
      textLength: text.length,
      error: ocr?.error || null,
    },
    extractedFields: fields,
    findings,
    anomalyCount: findings.length,
    pixelForensics: pixelForensics?.applicable ? {
      unavailable: Boolean(pixelForensics.unavailable),
      error: pixelForensics.error || null,
      ela: pixelForensics.ela || null,
      elaImageBase64: pixelForensics.elaImageBase64 || null,
      cloneDetection: pixelForensics.cloneDetection || null,
      noiseAnalysis: pixelForensics.noiseAnalysis || null,
      quantization: pixelForensics.quantization || null,
      globalNoiseFloor: pixelForensics.globalNoiseFloor || null,
      contentCredentials: pixelForensics.contentCredentials || null,
    } : { applicable: false },
    // Aadhaar QR scan results (null for non-Aadhaar docs)
    qrScan: qrScan || null,
    qrMatchSummary: qrCrossCheck?.matchSummary || null,
  };
}