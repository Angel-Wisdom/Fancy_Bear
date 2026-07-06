import { Router } from 'express';
import { getDb } from '../db/database.js';
import { verifyToken } from '../middleware/auth.js';
import { signReport } from '../engines/crypto-engine.js';

const router = Router();
router.use(verifyToken);

// ──────────────────────────────────────────────────────────
// GET /api/reports
// List all verification reports (most recent first).
// ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const reports = db.prepare(`
    SELECT
      v.id,
      v.customer_id,
      v.document_id,
      v.verification_type,
      v.status,
      v.overall_score,
      v.tier,
      v.run_by,
      v.run_duration_ms,
      v.created_at,
      c.full_name AS customer_name,
      d.original_name AS document_name,
      d.doc_type AS document_type
    FROM verification_results v
    LEFT JOIN customers c ON c.id = v.customer_id
    LEFT JOIN documents d ON d.id = v.document_id
    ORDER BY v.created_at DESC
    LIMIT 200
  `).all();
  res.json({ reports });
});

// ──────────────────────────────────────────────────────────
// GET /api/reports/:applicationId
// Latest verification result for a given customer/application.
// ──────────────────────────────────────────────────────────
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
  // Pull documents + alerts directly from SQLite (was previously using the
  // legacy db.__store property from the old JSON-store pattern, which broke
  // after the migration to node:sqlite).
  const documents = db.prepare('SELECT * FROM documents WHERE customer_id = ?').all(applicationId);
  const alerts = db.prepare('SELECT * FROM alerts WHERE customer_id = ? ORDER BY created_at DESC').all(applicationId);

  res.json({
    applicationId,
    generatedAt: new Date().toISOString(),
    report: { ...report, details },
    documents,
    alerts,
    recommendation: report.overall_score >= 80 ? 'Approve' : report.overall_score >= 60 ? 'Review' : 'Reject',
  });
});

// ──────────────────────────────────────────────────────────
// GET /api/reports/:applicationId/pdf
// Download a multi-page PDF report with proper Unicode support.
// ──────────────────────────────────────────────────────────
router.get('/:applicationId/pdf', async (req, res) => {
  const db = getDb();
  const applicationId = req.params.applicationId;

  const report = db.prepare(`
    SELECT v.*, c.full_name AS customer_name, c.pan_number, c.email, c.phone
    FROM verification_results v
    JOIN customers c ON c.id = v.customer_id
    WHERE v.customer_id = ?
    ORDER BY v.created_at DESC
    LIMIT 1
  `).get(applicationId);

  if (!report) return res.status(404).json({ message: 'Report not found' });

  const details = JSON.parse(report.details_json || '{}');
  const documents = db.prepare('SELECT * FROM documents WHERE customer_id = ? ORDER BY created_at ASC').all(applicationId);
  const alerts = db.prepare('SELECT * FROM alerts WHERE customer_id = ? ORDER BY severity DESC, created_at DESC LIMIT 20').all(applicationId);

  try {
    const pdfBuffer = await buildPdfReport({
      report,
      details,
      documents,
      alerts,
      applicationId,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="suraksha-report-${applicationId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[reports] PDF build failed:', err);
    res.status(500).json({ message: 'Failed to generate PDF report', error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// PDF builder — uses pdfkit for proper Unicode / multi-page support.
// Lazy-loaded so the dependency is only required when this route is hit.
// ──────────────────────────────────────────────────────────
let PDFKit = null;
async function getPdfKit() {
  if (PDFKit) return PDFKit;
  try {
    const mod = await import('pdfkit');
    PDFKit = mod.default || mod;
    return PDFKit;
  } catch (err) {
    throw new Error(
      'pdfkit is not installed. Run `npm install pdfkit` inside the server/ directory. ' +
      `Original error: ${err.message}`
    );
  }
}

function severityColor(doc, severity) {
  if (severity === 'critical') return [0xc0, 0x39, 0x2b];
  if (severity === 'high') return [0xe6, 0x7e, 0x22];
  if (severity === 'medium') return [0xc2, 0x9c, 0x1e];
  return [0x55, 0x55, 0x55];
}

// PDFKit's default Helvetica font doesn't include the Indian Rupee sign (₹,
// U+20B9, added in Unicode 6.0 in 2010). Rather than bundling a TrueType
// fallback font, substitute ₹ with "Rs." in any text we render to the PDF.
// This is a known cosmetic limitation; the on-screen UI keeps ₹.
function pdfSafe(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/₹/g, 'Rs.');
  if (Array.isArray(value)) return value.map(pdfSafe);
  if (typeof value === 'object') {
    try { return JSON.stringify(value).replace(/₹/g, 'Rs.'); } catch { return String(value); }
  }
  return String(value);
}

async function buildPdfReport({ report, details, documents, alerts, applicationId }) {
  const PDFDocument = await getPdfKit();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: `Suraksha 2.0 Verification Report — ${report.customer_name}`,
          Author: 'Suraksha 2.0',
          Subject: 'Document Verification & Fraud Risk Assessment',
          Creator: 'Suraksha 2.0',
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const contentWidth = pageWidth - 100;
      const findings = details.findings || [];
      const score = Math.round(Number(report.overall_score) || 0);
      const recommendation = score >= 80 ? 'APPROVE' : score >= 60 ? 'REVIEW' : 'REJECT';
      const hmacSig = (details.signature || 'n/a').slice(0, 32);

      // Stamp a single footer at the very end of the report. Trying to
      // stamp per-page with switchToPage() or bufferedPageRange() creates
      // duplicate phantom pages in pdfkit 0.15. The footer goes after the
      // last content block on the final page; pdfkit auto-pages content
      // so a long report will still split cleanly across pages.
      function stampFooter() {
        // Add some breathing room before the footer
        doc.moveDown(2);
        const bottomY = Math.min(doc.y + 20, pageHeight - 50);
        doc.save();
        doc.moveTo(50, bottomY - 15).lineTo(pageWidth - 50, bottomY - 15).strokeColor([0xcc, 0xcc, 0xcc]).lineWidth(0.5).stroke();
        doc.fillColor([0x88, 0x88, 0x88]).fontSize(8).font('Helvetica')
          .text(
            `Suraksha 2.0  •  Generated ${new Date().toISOString()}  •  HMAC signature: ${hmacSig}…`,
            50, bottomY, { width: contentWidth }
          );
        doc.restore();
      }

      function newPage() {
        doc.addPage();
        return 60; // top y on the new page
      }

      // ── Header / Title ──────────────────────────────────
      doc
        .fillColor([0x0a, 0x25, 0x40])
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('Suraksha 2.0 — Verification Report', 50, 50, { width: contentWidth });

      doc
        .fillColor([0x55, 0x55, 0x55])
        .fontSize(9)
        .font('Helvetica')
        .text(`Generated ${new Date().toISOString()}`, 50, 78, { width: contentWidth });

      // Divider
      doc.moveTo(50, 95).lineTo(pageWidth - 50, 95).strokeColor([0xcc, 0xcc, 0xcc]).lineWidth(1).stroke();

      // ── Applicant summary box ───────────────────────────
      let y = 110;
      doc.fontSize(11).font('Helvetica-Bold').fillColor([0x0a, 0x25, 0x40]).text('Applicant', 50, y);
      y += 18;
      const summaryLines = [
        ['Name', pdfSafe(report.customer_name) || '—'],
        ['Application ID', applicationId],
        ['PAN', report.pan_number || '—'],
        ['Email', report.email || '—'],
        ['Phone', report.phone || '—'],
        ['Verification type', report.verification_type || '—'],
        ['Status', String(report.status || '—').toUpperCase()],
        ['Overall score', `${score} / 100`],
        ['Recommendation', recommendation],
        ['Run by', report.run_by || '—'],
        ['Run at', report.created_at || '—'],
      ];
      doc.font('Helvetica').fontSize(9);
      for (const [label, value] of summaryLines) {
        doc.fillColor([0x88, 0x88, 0x88]).text(label, 50, y, { width: 130 });
        doc.fillColor([0x22, 0x22, 0x22]).text(String(value), 180, y, { width: contentWidth - 130 });
        y += 14;
      }

      // Score badge
      y += 6;
      const badgeColor = score >= 80 ? [0x27, 0xae, 0x60] : score >= 60 ? [0xe6, 0x7e, 0x22] : [0xc0, 0x39, 0x2b];
      doc
        .roundedRect(50, y, 200, 24, 4)
        .fillColor(badgeColor)
        .fill();
      doc
        .fillColor([0xff, 0xff, 0xff])
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(`Risk score: ${score}/100 — ${recommendation}`, 60, y + 7, { width: 180 });

      y += 40;

      // ── Findings section ────────────────────────────────
      doc
        .fillColor([0x0a, 0x25, 0x40])
        .fontSize(13)
        .font('Helvetica-Bold')
        .text('Findings', 50, y);
      y += 20;

      if (!findings.length) {
        doc
          .fillColor([0x55, 0x55, 0x55])
          .font('Helvetica')
          .fontSize(10)
          .text('No high-confidence anomalies recorded for this application.', 50, y, { width: contentWidth });
        y += 18;
      } else {
        doc.font('Helvetica').fontSize(9);
        for (const finding of findings.slice(0, 30)) {
          // Calculate actual heights BEFORE rendering to avoid overlap.
          // pdfkit's doc.text() at a fixed y does NOT auto-advance y for
          // wrapped text, so we must compute heights manually.
          const codeText = pdfSafe(finding.code || '');
          const messageText = pdfSafe(finding.message || '');
          const hasEvidence = finding.evidence;
          const evidenceStr = hasEvidence ? pdfSafe(safeStringifyEvidence(finding.evidence)) : '';

          // Compute heights for the code + message row (rendered side by side)
          const codeHeight = doc.heightOfString(codeText, { width: 180 });
          const messageHeight = doc.heightOfString(messageText, { width: contentWidth - 270 });
          const rowHeight = Math.max(codeHeight, messageHeight, 14); // min 14 (badge height)

          // Compute evidence height if present
          let evidenceHeight = 0;
          if (evidenceStr && evidenceStr !== '{}') {
            evidenceHeight = doc.heightOfString(`  Evidence: ${evidenceStr}`, { width: contentWidth - 80 });
          }

          const totalBlockHeight = rowHeight + 4 + evidenceHeight + 4; // row + gap + evidence + gap

          // Page break if this block won't fit
          if (y + totalBlockHeight > pageHeight - 80) {
            y = newPage();
          }

          // Severity tag (badge)
          const [r, g, b] = severityColor(doc, finding.severity);
          doc
            .roundedRect(50, y, 70, 14, 3)
            .fillColor([r, g, b])
            .fill();
          doc
            .fillColor([0xff, 0xff, 0xff])
            .fontSize(8)
            .font('Helvetica-Bold')
            .text(String(finding.severity || 'info').toUpperCase(), 50, y + 3, { width: 70, align: 'center' });

          // Code (left column)
          doc
            .fillColor([0x55, 0x55, 0x55])
            .font('Helvetica')
            .fontSize(8)
            .text(codeText, 130, y, { width: 180 });

          // Message (right column)
          doc
            .fillColor([0x22, 0x22, 0x22])
            .fontSize(9)
            .text(messageText, 320, y, { width: contentWidth - 270 });

          // Advance y by the actual row height (not hardcoded 16)
          y += rowHeight + 4;

          // Evidence (indented, on the next line)
          if (evidenceStr && evidenceStr !== '{}') {
            doc
              .fillColor([0x88, 0x88, 0x88])
              .fontSize(8)
              .font('Helvetica-Oblique')
              .text(`  Evidence: ${evidenceStr}`, 130, y, { width: contentWidth - 80 });
            y += evidenceHeight + 4;
          }
        }
      }

      // ── Documents section ───────────────────────────────
      if (documents.length) {
        if (y > pageHeight - 120) { y = newPage(); }
        y += 10;
        doc
          .fillColor([0x0a, 0x25, 0x40])
          .fontSize(13)
          .font('Helvetica-Bold')
          .text('Documents in this application', 50, y);
        y += 20;

        doc.font('Helvetica').fontSize(9).fillColor([0x55, 0x55, 0x55]);
        for (const d of documents) {
          if (y > pageHeight - 80) { y = newPage(); }
          doc.text(pdfSafe(`${d.doc_type} — ${d.original_name} (${d.status}, ${d.file_size || 0} bytes, SHA-256 ${(d.file_hash || '').slice(0, 16)}…)`), 50, y, { width: contentWidth });
          y += 14;
        }
      }

      // ── Alerts section ──────────────────────────────────
      if (alerts.length) {
        if (y > pageHeight - 120) { y = newPage(); }
        y += 10;
        doc
          .fillColor([0x0a, 0x25, 0x40])
          .fontSize(13)
          .font('Helvetica-Bold')
          .text('Open alerts', 50, y);
        y += 20;

        doc.font('Helvetica').fontSize(9);
        for (const a of alerts) {
          if (y > pageHeight - 80) { y = newPage(); }
          const [r, g, b] = severityColor(doc, a.severity);
          doc.fillColor([r, g, b]).font('Helvetica-Bold').text(`[${String(a.severity || '').toUpperCase()}]`, 50, y, { width: 70 });
          doc.fillColor([0x22, 0x22, 0x22]).font('Helvetica').text(pdfSafe(`${a.title} — ${a.description || ''}`), 120, y, { width: contentWidth - 70 });
          y += 16;
        }
      }

      // ── Final footer at the end of the report ──────────
      stampFooter();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function safeStringifyEvidence(evidence) {
  if (!evidence) return '';
  if (typeof evidence === 'string') return evidence;
  try {
    const str = JSON.stringify(evidence);
    return str.length > 200 ? str.slice(0, 200) + '…' : str;
  } catch {
    return String(evidence);
  }
}

export default router;
