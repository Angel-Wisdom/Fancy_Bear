// Canonical document-type registry — single source of truth (fixes Bug B.4 from REBUILD_GUIDE.md).
// Import this everywhere a doc-type list, dropdown, or validation is needed:
// UploadVerify.jsx, VerificationResults.jsx, document-verification-engine.js, etc.
//
// `tier` is a starting classification per REBUILD_GUIDE.md Section F — refine as each
// module actually gets built. `group` is just for organizing the UI dropdown into sections.

export const DOC_TYPES = [
  // --- Identity ---
  { id: 'aadhaar_card', label: 'Aadhaar Card', group: 'Identity', tier: 'tier1_checksum' },
  { id: 'pan_card', label: 'PAN Card', group: 'Identity', tier: 'tier2_format_only' },
  { id: 'passport', label: 'Passport', group: 'Identity', tier: 'tier3_no_validator' },
  { id: 'photograph', label: 'Photograph', group: 'Identity', tier: 'tier3_no_validator' },
  { id: 'address_proof', label: 'Address Proof (other)', group: 'Identity', tier: 'tier3_no_validator' },

  // --- Income & tax ---
  { id: 'salary_slip', label: 'Salary Slip', group: 'Income & Tax', tier: 'tier3_no_validator' },
  { id: 'form_16', label: 'Form 16', group: 'Income & Tax', tier: 'tier3_no_validator' },
  { id: 'itr', label: 'ITR / Income Tax Return', group: 'Income & Tax', tier: 'tier3_no_validator' },
  { id: 'net_worth_certificate', label: 'Net Worth / CA Certificate', group: 'Income & Tax', tier: 'tier2_format_only' },
  { id: 'employer_id_card', label: 'Employer ID Card', group: 'Income & Tax', tier: 'tier3_no_validator' },
  { id: 'appointment_letter', label: 'Appointment Letter', group: 'Income & Tax', tier: 'tier3_no_validator' },

  // --- Banking ---
  { id: 'bank_statement', label: 'Bank Statement', group: 'Banking', tier: 'tier1_checksum' },
  { id: 'cheque', label: 'Cheque', group: 'Banking', tier: 'tier1_checksum' },
  { id: 'demand_draft', label: 'Demand Draft', group: 'Banking', tier: 'tier3_no_validator' },

  // --- Business / GST ---
  { id: 'gst_certificate', label: 'GST Registration Certificate', group: 'Business', tier: 'tier1_checksum' },
  { id: 'gstr3b', label: 'GSTR-3B Return', group: 'Business', tier: 'tier3_no_validator' },
  { id: 'udyam_certificate', label: 'Udyam / MSME Certificate', group: 'Business', tier: 'tier2_format_only' },

  // --- Property ---
  { id: 'land_title', label: 'Land Title Record', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'plan_approval', label: 'Plan Approval Letter', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'occupancy_certificate', label: 'Occupancy Certificate (OC)', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'sale_deed', label: 'Sale Deed', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'chain_document', label: 'Chain of Title Document', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'encumbrance_certificate', label: 'Encumbrance Certificate', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'khata_certificate', label: 'Khata Certificate', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'property_tax_receipt', label: 'Property Tax Receipt', group: 'Property', tier: 'tier3_no_validator' },
  { id: 'rent_lease_agreement', label: 'Rent / Lease Agreement', group: 'Property', tier: 'tier3_no_validator' },

  // --- Legal ---
  { id: 'power_of_attorney', label: 'Power of Attorney', group: 'Legal', tier: 'tier3_no_validator' },
  { id: 'general_agreement', label: 'General Agreement', group: 'Legal', tier: 'tier3_no_validator' },
  { id: 'acknowledgement_of_debt', label: 'Acknowledgement / Assignment of Debt (AOD)', group: 'Legal', tier: 'tier3_no_validator' }, // name TBC — see REBUILD_GUIDE.md open question 1
  { id: 'compliance_freeze_letter', label: 'Compliance / Freeze Letter (Police/ED/IT/Court)', group: 'Legal', tier: 'tier3_no_validator' },
  { id: 'death_certificate', label: 'Death Certificate', group: 'Legal', tier: 'tier3_no_validator' },
  { id: 'legal_heir_certificate', label: 'Legal Heir Certificate', group: 'Legal', tier: 'tier3_no_validator' },
  { id: 'digital_signature_cert', label: 'Digitally Signed / e-Stamped Document', group: 'Legal', tier: 'tier1_checksum' },

  // --- Assets ---
  { id: 'vehicle_rc', label: 'Vehicle RC', group: 'Assets', tier: 'tier3_no_validator' },
  { id: 'vehicle_insurance', label: 'Vehicle Insurance', group: 'Assets', tier: 'tier3_no_validator' },

  // --- NRI ---
  { id: 'nri_salary_certificate', label: 'NRI Salary Certificate', group: 'NRI', tier: 'tier3_no_validator' },
  { id: 'foreign_bank_statement', label: 'Foreign Bank Statement', group: 'NRI', tier: 'tier3_no_validator' },

  { id: 'other', label: 'Other', group: 'Other', tier: 'tier3_no_validator' },
];

export const DOC_TYPE_IDS = DOC_TYPES.map((d) => d.id);

export function isValidDocType(id) {
  return DOC_TYPE_IDS.includes(id);
}

export function getDocTypeMeta(id) {
  return DOC_TYPES.find((d) => d.id === id) || null;
}

// Grouped shape, convenient for a <select> with <optgroup>
export function docTypesByGroup() {
  const groups = {};
  for (const dt of DOC_TYPES) {
    if (!groups[dt.group]) groups[dt.group] = [];
    groups[dt.group].push(dt);
  }
  return groups;
}
