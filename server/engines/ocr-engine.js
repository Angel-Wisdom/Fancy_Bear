import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';

function isPdf(fileName, mimeType) {
  return /pdf/i.test(mimeType || '') || /\.pdf$/i.test(fileName || '');
}

function isImage(fileName, mimeType) {
  return /^image\//i.test(mimeType || '') || /\.(png|jpe?g|bmp|webp|tiff?)$/i.test(fileName || '');
}

function decodePrintableText(buffer) {
  const text = Buffer.from(buffer || '').toString('utf8');
  const printable = text.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
  const ratio = text.length ? printable.length / text.length : 0;
  return ratio > 0.65 ? printable : '';
}

// ── Image Preprocessing (sharp) ──────────────────────────────
// Aadhaar cards are often photos of printed cards — skewed lighting,
// JPEG compression artifacts, low contrast.  Preprocessing the image
// before Tesseract dramatically improves OCR accuracy.
//
// Pipeline:  grayscale → normalize contrast → mild sharpen → PNG output
// PNG avoids introducing additional JPEG compression noise that confuses
// Tesseract's character segmentation.

/**
 * Preprocess a raster image buffer for better OCR results.
 *
 * - Grayscale: removes color noise that Tesseract's eng trained data
 *   doesn't expect (Aadhaar cards have blue/red Aadhaar logo etc.).
 * - Normalize: stretches the histogram so dark text on light background
 *   gets maximum contrast — critical for photos taken under uneven lighting.
 * - Sharpen (sigma 0.5, mild): crisps up character edges without
 *   amplifying noise.
 * - Output as PNG: lossless so Tesseract receives clean pixels.
 *
 * Falls back to the original buffer if sharp fails (e.g. corrupt image).
 */
async function preprocessImageForOcr(buffer) {
  try {
    const preprocessed = await sharp(buffer)
      .grayscale()
      .normalize()
      .sharpen({ sigma: 0.5, m1: 0.5, m2: 0.3 })
      .png()
      .toBuffer();
    return preprocessed;
  } catch (err) {
    console.warn('[ocr] Image preprocessing failed, using raw buffer:', err.message);
    return buffer;
  }
}

async function extractPdfText(buffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(' '));
  }

  const text = pages.join('\n\n').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return {
    text,
    confidence: text.length > 30 ? 92 : text.length ? 70 : 0,
    engine: 'pdfjs-dist',
    pages: pdf.numPages,
  };
}

async function extractImageText(buffer) {
  // Preprocess image for better OCR accuracy
  const preprocessed = await preprocessImageForOcr(buffer);
  const preprocessedSizeKB = Math.round(preprocessed.length / 1024);
  const originalSizeKB = Math.round(buffer.length / 1024);
  console.log(`[ocr] Image preprocessing: ${originalSizeKB}KB → ${preprocessedSizeKB}KB (PNG)`);

  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(preprocessed);
    return {
      text: (result.data.text || '').trim(),
      confidence: Math.max(0, Math.min(100, Number(result.data.confidence) || 0)),
      engine: 'tesseract.js',
      pages: 1,
      preprocessed: true,
    };
  } catch (err) {
    console.error('[ocr] Tesseract failure:', err.message || err);
    throw err;
  } finally {
    await worker.terminate();
  }
}

export async function extractTextFromBuffer(buffer, fileName = 'document', mimeType = '') {
  try {
    if (isPdf(fileName, mimeType)) {
      const extracted = await extractPdfText(buffer);
      return { ...extracted, fields: { source: fileName, mimeType } };
    }

    if (isImage(fileName, mimeType)) {
      const extracted = await extractImageText(buffer);
      return { ...extracted, fields: { source: fileName, mimeType } };
    }
  } catch (error) {
    const fallbackText = decodePrintableText(buffer);
    return {
      text: fallbackText.trim(),
      confidence: fallbackText ? 35 : 0,
      engine: 'tesseract.js',
      error: error.message,
      pages: 0,
      fields: { source: fileName, mimeType },
    };
  }

  const text = decodePrintableText(buffer);
  return {
    text: text.trim(),
    confidence: text ? 60 : 0,
    engine: 'tesseract.js',
    pages: 0,
    fields: {
      source: fileName,
      mimeType,
    },
  };
}