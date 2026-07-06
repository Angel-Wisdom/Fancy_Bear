// ============================================================
// Cross-Document Correlation Engine
// ------------------------------------------------------------
// Suraksha 2.0 — Section H of REBUILD_GUIDE.md
//
// Builds a unified entity graph across all documents uploaded
// for a single loan application and surfaces contradictions
// that are invisible when documents are reviewed individually.
//
// Inputs:
//   documents: array of document rows (with .doc_type, .ocr_text,
//     .verification.details_json containing extractedFields).
//   customer:  the applicant row (full_name, pan_number,
//     aadhaar_hash, date_of_birth, address_line1).
//
// Output:
//   { status, score, findings, summary, entityGraph }
//   - findings use the same {severity, code, message, evidence}
//     shape as document-verification-engine.js so they merge
//     seamlessly into the existing Findings UI.
// ============================================================

import { validateAadhaar, validatePan, hashAadhaar } from './kyc-engine.js';

function safeParseDetails(doc) {
  if (!doc) return null;
  // Accept either a pre-parsed object (from a joined verification row)
  // or a JSON string (from documents.verification?.details_json).
  const raw = doc.verification?.details_json ?? doc.details_json;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(mr|mrs|ms|miss|shri|sri|smt|dr|prof|name|applicant|customer|holder)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = na.split(' ').filter((t) => t.length > 1);
  const tokensB = nb.split(' ').filter((t) => t.length > 1);
  if (!tokensA.length || !tokensB.length) return false;
  const matched = tokensA.filter((t) => tokensB.includes(t));
  // Lower threshold (0.6) than the per-doc check because Indian middle
  // names are commonly dropped between documents.
  return matched.length / Math.max(tokensA.length, tokensB.length) >= 0.6;
}

function addFinding(findings, severity, code, message, evidence = null) {
  findings.push({ severity, code, message, evidence });
}

/**
 * Run cross-document correlation across all documents for an applicant.
 */
export function crossDocumentCheck(documents = [], customer = null) {
  const findings = [];
  const entityGraph = { nodes: [], edges: [] };

  // Collect extracted fields per document.
  const docEntries = documents
    .map((doc) => {
      const details = safeParseDetails(doc) || {};
      const fields = details.extractedFields || {};
      return {
        id: doc.id,
        doc_type: doc.doc_type,
        original_name: doc.original_name,
        fields,
        verification: details,
      };
    })
    .filter((entry) => entry.fields && Object.keys(entry.fields).length > 0);

  // ── Check 1: PAN consistency across all docs that mention a PAN ──
  const panSources = [];
  for (const entry of docEntries) {
    if (entry.fields.pan) {
      panSources.push({ docId: entry.id, docType: entry.doc_type, pan: String(entry.fields.pan).toUpperCase() });
    }
  }
  const uniquePans = new Set(panSources.map((s) => s.pan));
  if (uniquePans.size > 1) {
    addFinding(
      findings,
      'critical',
      'cross_doc.pan_mismatch',
      `PAN number differs across documents: ${panSources.map((s) => `${s.docType}=${s.pan}`).join(', ')}.`,
      { sources: panSources },
    );
  }

  // ── Check 2: Aadhaar consistency across all docs ──
  const aadhaarSources = [];
  for (const entry of docEntries) {
    if (entry.fields.aadhaar && validateAadhaar(entry.fields.aadhaar)) {
      aadhaarSources.push({ docId: entry.id, docType: entry.doc_type, aadhaar: entry.fields.aadhaar });
    }
  }
  const uniqueAadhaars = new Set(aadhaarSources.map((s) => s.aadhaar));
  if (uniqueAadhaars.size > 1) {
    addFinding(
      findings,
      'critical',
      'cross_doc.aadhaar_mismatch',
      `Aadhaar number differs across documents: ${aadhaarSources.map((s) => `${s.docType}=****${s.aadhaar.slice(-4)}`).join(', ')}.`,
      { sources: aadhaarSources.map((s) => ({ ...s, aadhaar: `****${s.aadhaar.slice(-4)}` })) },
    );
  }

  // ── Check 3: Customer-vs-document field consistency ──
  if (customer) {
    // PAN
    if (customer.pan_number && panSources.length) {
      const customerPan = String(customer.pan_number).toUpperCase();
      const mismatched = panSources.filter((s) => s.pan !== customerPan);
      if (mismatched.length) {
        addFinding(
          findings,
          'high',
          'cross_doc.pan_customer_mismatch',
          `PAN on document(s) does not match customer record (${mismatched.map((s) => s.docType).join(', ')}).`,
          { customerPan, mismatched },
        );
      }
    }

    // Aadhaar (compare via hash — never store/compare the raw number)
    if (customer.aadhaar_hash && aadhaarSources.length) {
      const mismatched = aadhaarSources.filter((s) => hashAadhaar(s.aadhaar) !== customer.aadhaar_hash);
      if (mismatched.length) {
        addFinding(
          findings,
          'high',
          'cross_doc.aadhaar_customer_mismatch',
          `Aadhaar on document(s) does not match the customer's stored Aadhaar hash (${mismatched.map((s) => s.docType).join(', ')}).`,
          { mismatched: mismatched.map((s) => ({ ...s, aadhaar: `****${s.aadhaar.slice(-4)}` })) },
        );
      }
    }

    // Applicant name on each doc's OCR text vs customer record
    // (uses the per-doc verification.findings — if a doc already flagged
    //  kyc.customer_name_mismatch, we re-surface it here for cross-doc context)
    const nameMismatches = docEntries.filter((entry) => {
      const nameFinding = (entry.verification?.findings || []).find((f) => f.code === 'kyc.customer_name_mismatch');
      return Boolean(nameFinding);
    });
    if (nameMismatches.length) {
      addFinding(
        findings,
        'high',
        'cross_doc.applicant_name_inconsistent',
        `Applicant name on ${nameMismatches.length} document(s) does not match the customer record: ${nameMismatches.map((s) => s.doc_type).join(', ')}.`,
        { customerName: customer.full_name, documents: nameMismatches.map((s) => s.doc_type) },
      );
    }
  }

  // ── Check 4: Income figure cross-check ──
  // If both a salary slip and an ITR are present, the salary on the slip
  // should be in the same ballpark as the income declared on the ITR
  // (annualized salary vs total income — typically within ±25%).
  const salaryEntries = docEntries.filter((e) => e.doc_type === 'salary_slip');
  const itrEntries = docEntries.filter((e) => e.doc_type === 'itr');
  if (salaryEntries.length && itrEntries.length) {
    for (const salary of salaryEntries) {
      const salaryAmounts = (salary.fields.amounts || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (!salaryAmounts.length) continue;
      // Heuristic: largest amount is likely the gross monthly salary.
      const monthlySalary = Math.max(...salaryAmounts);
      const annualized = monthlySalary * 12;

      for (const itr of itrEntries) {
        const itrAmounts = (itr.fields.amounts || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (!itrAmounts.length) continue;
        // Largest amount on ITR is typically the gross total income.
        const totalIncome = Math.max(...itrAmounts);
        const tolerance = Math.max(annualized, totalIncome) * 0.25;
        if (Math.abs(annualized - totalIncome) > tolerance) {
          addFinding(
            findings,
            'high',
            'cross_doc.income_mismatch',
            `Annualized salary from salary slip (₹${annualized.toLocaleString('en-IN')}) differs materially from ITR total income (₹${totalIncome.toLocaleString('en-IN')}).`,
            { salaryDoc: salary.original_name, itrDoc: itr.original_name, annualizedSalary: annualized, itrTotalIncome: totalIncome },
          );
        }
      }
    }
  }

  // ── Check 5: Survey number consistency for property docs ──
  const surveySources = docEntries
    .filter((e) => ['land_title', 'sale_deed', 'encumbrance_cert'].includes(e.doc_type))
    .map((e) => ({ docId: e.id, docType: e.doc_type, survey: e.fields.surveyNumber }))
    .filter((s) => s.survey);
  if (surveySources.length >= 2) {
    const uniqueSurveys = new Set(surveySources.map((s) => String(s.survey).toLowerCase()));
    if (uniqueSurveys.size > 1) {
      addFinding(
        findings,
        'medium',
        'cross_doc.survey_number_mismatch',
        `Survey numbers differ across property documents: ${surveySources.map((s) => `${s.docType}=${s.survey}`).join(', ')}.`,
        { sources: surveySources },
      );
    }
  }

  // ── Check 6: Date consistency ──
  // Documents within a single application should have internally consistent
  // dates (e.g., salary slip month should be inside the bank statement period).
  // Lightweight check: if any two docs share the same date field type, flag
  // when they conflict by more than 6 months.
  // (Skipped for now — needs OCR date parsing refinement to be reliable.)

  // ── Build entity graph for visualization ──
  if (customer) {
    entityGraph.nodes.push({ id: `customer:${customer.id}`, type: 'customer', label: customer.full_name });
  }
  for (const entry of docEntries) {
    entityGraph.nodes.push({ id: `doc:${entry.id}`, type: 'document', label: entry.doc_type, name: entry.original_name });
    if (customer) {
      entityGraph.edges.push({ from: `customer:${customer.id}`, to: `doc:${entry.id}`, relation: 'submitted' });
    }
    if (entry.fields.pan) {
      const panNodeId = `pan:${entry.fields.pan}`;
      if (!entityGraph.nodes.find((n) => n.id === panNodeId)) {
        entityGraph.nodes.push({ id: panNodeId, type: 'pan', label: entry.fields.pan });
      }
      entityGraph.edges.push({ from: `doc:${entry.id}`, to: panNodeId, relation: 'mentions_pan' });
    }
    if (entry.fields.aadhaar && validateAadhaar(entry.fields.aadhaar)) {
      const aadhaarNodeId = `aadhaar:****${entry.fields.aadhaar.slice(-4)}`;
      if (!entityGraph.nodes.find((n) => n.id === aadhaarNodeId)) {
        entityGraph.nodes.push({ id: aadhaarNodeId, type: 'aadhaar', label: `****${entry.fields.aadhaar.slice(-4)}` });
      }
      entityGraph.edges.push({ from: `doc:${entry.id}`, to: aadhaarNodeId, relation: 'mentions_aadhaar' });
    }
  }

  // ── Score & summarize ──
  const penalty = findings.reduce((sum, f) => {
    if (f.severity === 'critical') return sum + 35;
    if (f.severity === 'high') return sum + 22;
    if (f.severity === 'medium') return sum + 11;
    return sum + 5;
  }, 0);
  const score = Math.max(0, 100 - penalty);
  const status = findings.some((f) => f.severity === 'critical') ? 'fail'
    : findings.some((f) => f.severity === 'high') ? 'warning'
    : 'pass';

  const summary = {
    documentsAnalyzed: docEntries.length,
    uniquePans: uniquePans.size,
    uniqueAadhaars: uniqueAadhaars.size,
    crossDocFindings: findings.length,
    criticalCount: findings.filter((f) => f.severity === 'critical').length,
    highCount: findings.filter((f) => f.severity === 'high').length,
  };

  return {
    status,
    score,
    findings,
    summary,
    entityGraph,
  };
}

export default { crossDocumentCheck };
