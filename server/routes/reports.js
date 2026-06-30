import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken);

router.get('/:applicationId', (req, res) => {
  const db = getDb();
  const applicationId = req.params.applicationId;
  const report = db.prepare(`
    SELECT v.*, c.full_name AS customer_name
    FROM verification_results v
    JOIN customers c ON c.id = v.customer_id
    WHERE v.customer_id = ?
    ORDER BY v.created_at DESC
    LIMIT 1
  `).get(applicationId);

  if (!report) return res.status(404).json({ message: 'Report not found' });
  const details = JSON.parse(report.details_json || '{}');
  const documents = (db.__store?.documents || []).filter((document) => document.customer_id === applicationId);
  const alerts = (db.__store?.alerts || []).filter((alert) => alert.customer_id === applicationId);

  res.json({
    applicationId,
    generatedAt: new Date().toISOString(),
    report: { ...report, details },
    documents,
    alerts,
    recommendation: report.overall_score >= 80 ? 'Approve' : report.overall_score >= 60 ? 'Review' : 'Reject',
  });
});

router.get('/:applicationId/pdf', (req, res) => {
  const db = getDb();
  const applicationId = req.params.applicationId;
  const report = db.prepare(`
    SELECT v.*, c.full_name AS customer_name
    FROM verification_results v
    JOIN customers c ON c.id = v.customer_id
    WHERE v.customer_id = ?
    ORDER BY v.created_at DESC
    LIMIT 1
  `).get(applicationId);

  if (!report) return res.status(404).json({ message: 'Report not found' });

  const details = JSON.parse(report.details_json || '{}');
  const findings = details.findings || details.duplicates?.duplicates || [];
  const lines = [
    'SURAKSHA 2.0 VERIFICATION REPORT',
    `Customer: ${report.customer_name}`,
    `Application: ${applicationId}`,
    `Verification: ${report.verification_type}`,
    `Status: ${report.status}`,
    `Score: ${Math.round(Number(report.overall_score) || 0)}`,
    `Generated: ${new Date().toISOString()}`,
    `Signature: ${details.signature || 'n/a'}`,
    '',
    'Findings:',
    ...(findings.length ? findings.slice(0, 12).map((finding) => `- ${finding.severity || 'info'} ${finding.code || ''} ${finding.message || JSON.stringify(finding)}`) : ['- No high-confidence anomalies recorded.']),
  ];

  const pdf = createSimplePdf(lines);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="suraksha-report-${applicationId}.pdf"`);
  res.send(pdf);
});

function escapePdfText(value) {
  return String(value).replace(/[\\()]/g, '\\$&').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function createSimplePdf(lines) {
  const content = [
    'BT',
    '/F1 11 Tf',
    '50 780 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '/F1 16 Tf' : index === 1 ? '/F1 11 Tf' : null,
      `(${escapePdfText(line).slice(0, 110)}) Tj`,
      '0 -18 Td',
    ].filter(Boolean)),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join('')));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''));
}

export default router;
