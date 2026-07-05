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

export function verifyDocument({ document, customer, ocr, metadata }) {
  const text = compactText(ocr?.text);
  const lowerText = text.toLowerCase();
  const fields = extractFields(text);
  const findings = [];
  const requirement = DOC_REQUIREMENTS[document.doc_type] || null;
  const tamperSignals = detectTamperSignals(document.original_name, document.mime_type);
  const metadataSignals = metadata?.suspicious || [];
  const syntheticSignals = detectSyntheticImageSignals(document, metadata, ocr, text);
  let forceFail = false;

  if (!text) addFinding(findings, 'high', 'ocr.empty', 'No readable text could be extracted from the document.');
  if ((ocr?.confidence || 0) < 45) addFinding(findings, 'medium', 'ocr.low_confidence', 'OCR confidence is below the verification threshold.', { confidence: ocr?.confidence || 0 });
  if (tamperSignals.flagged) {
    for (const signal of tamperSignals.suspicious) addFinding(findings, 'high', 'file.mime_mismatch', signal);
  }
  for (const signal of metadataSignals) addFinding(findings, 'medium', 'metadata.suspicious', signal);
  for (const signal of syntheticSignals.suspicious) addFinding(findings, 'high', 'image.synthetic_generated', signal);

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
  const status = forceFail ? 'fail' : score >= 82 ? 'pass' : score >= 55 ? 'warning' : 'fail';

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
