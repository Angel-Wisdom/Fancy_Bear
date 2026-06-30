export function verifyLandRecord(record = {}, customer = null) {
  const issues = [];
  if (!/^\d{1,3}\/[A-Z]?\/?\d{0,3}$/i.test(String(record.survey_number || ''))) {
    issues.push('Survey number format is unusual');
  }
  if (customer?.full_name && record.registered_owner && customer.full_name.toLowerCase() !== String(record.registered_owner).toLowerCase()) {
    issues.push('Owner name mismatch');
  }
  if (Number(record.total_area) <= 0) {
    issues.push('Invalid property area');
  }
  if (record.has_encumbrance) {
    issues.push('Encumbrance flagged');
  }
  return {
    status: issues.length ? 'warning' : 'pass',
    score: Math.max(0, 100 - issues.length * 25),
    issues,
  };
}
