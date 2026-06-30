import { detectTamperSignals } from './forensics-engine.js';
import { validateAadhaar, validatePan } from './kyc-engine.js';

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
    .filter((value) => Number.isFinite(value) && value > 0);
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

function compareCustomer(fields, customer) {
  const mismatches = [];
  if (fields.pan && customer?.pan_number && fields.pan !== String(customer.pan_number).toUpperCase()) {
    mismatches.push({ field: 'pan', expected: customer.pan_number, actual: fields.pan });
  }
  if (fields.aadhaar && customer?.aadhaar_number && fields.aadhaar !== String(customer.aadhaar_number).replace(/\s+/g, '')) {
    mismatches.push({ field: 'aadhaar', expected: customer.aadhaar_number, actual: fields.aadhaar });
  }
  return mismatches;
}

function scoreFindings(findings) {
  const penalty = findings.reduce((sum, finding) => {
    if (finding.severity === 'critical') return sum + 35;
    if (finding.severity === 'high') return sum + 24;
    if (finding.severity === 'medium') return sum + 13;
    return sum + 6;
  }, 0);
  return Math.max(0, 100 - penalty);
}

export function verifyDocument({ document, customer, ocr, metadata }) {
  const text = compactText(ocr?.text);
  const lowerText = text.toLowerCase();
  const fields = extractFields(text);
  const findings = [];
  const requirement = DOC_REQUIREMENTS[document.doc_type] || null;
  const tamperSignals = detectTamperSignals(document.original_name, document.mime_type);
  const metadataSignals = metadata?.suspicious || [];

  if (!text) addFinding(findings, 'high', 'ocr.empty', 'No readable text could be extracted from the document.');
  if ((ocr?.confidence || 0) < 45) addFinding(findings, 'medium', 'ocr.low_confidence', 'OCR confidence is below the verification threshold.', { confidence: ocr?.confidence || 0 });
  if (tamperSignals.flagged) {
    for (const signal of tamperSignals.suspicious) addFinding(findings, 'high', 'file.mime_mismatch', signal);
  }
  for (const signal of metadataSignals) addFinding(findings, 'medium', 'metadata.suspicious', signal);

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
  if (fields.aadhaar && !validateAadhaar(fields.aadhaar)) addFinding(findings, 'high', 'aadhaar.invalid', 'Extracted Aadhaar failed checksum validation.', { aadhaar: fields.aadhaar });

  const customerMismatches = compareCustomer(fields, customer);
  for (const mismatch of customerMismatches) {
    addFinding(findings, 'high', 'kyc.customer_mismatch', `Extracted ${mismatch.field} does not match the selected customer.`, mismatch);
  }

  const amounts = amountStats(fields.amounts);
  if (amounts.repeatedValues.length) {
    addFinding(findings, 'medium', 'amount.repeated_values', 'Repeated amount values appear unusually often in the document.', amounts.repeatedValues.slice(0, 5));
  }
  if (amounts.highRoundNumberShare > 0.6 && fields.amounts.length >= 8) {
    addFinding(findings, 'medium', 'amount.rounding_bias', 'Most extracted amounts are round thousands, which can indicate fabricated statements.', { share: amounts.highRoundNumberShare });
  }

  const score = scoreFindings(findings);
  const status = score >= 82 ? 'pass' : score >= 55 ? 'warning' : 'fail';

  return {
    status,
    score,
    engine: {
      name: 'document-verification-engine',
      version: '2.1.0',
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
  };
}
