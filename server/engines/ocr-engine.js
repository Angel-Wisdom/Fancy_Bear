import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  const paddle = await extractImageTextWithPaddle(buffer).catch((error) => ({
    error: error.message,
    engine: 'paddleocr+opencv',
  }));
  if (paddle.text) return paddle;

  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(buffer);
    return {
      text: (result.data.text || '').trim(),
      confidence: Math.max(0, Math.min(100, Number(result.data.confidence) || 0)),
      engine: 'tesseract.js',
      fallbackFrom: paddle.error ? { engine: paddle.engine, error: paddle.error } : null,
      pages: 1,
    };
  } finally {
    await worker.terminate();
  }
}

function runPaddleScript(imagePath) {
  const scriptPath = join(__dirname, 'paddle_ocr.py');
  const python = process.env.PYTHON || 'python';

  return new Promise((resolve, reject) => {
    execFile(
      python,
      [scriptPath, imagePath, '--lang', process.env.PADDLE_OCR_LANG || 'en'],
      {
        timeout: Number(process.env.PADDLE_OCR_TIMEOUT_MS || 45000),
        windowsHide: true,
        env: {
          ...process.env,
          PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('PaddleOCR returned unreadable output'));
        }
      },
    );
  });
}

async function extractImageTextWithPaddle(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'suraksha-ocr-'));
  const imagePath = join(dir, 'document-image');

  try {
    await writeFile(imagePath, buffer);
    const result = await runPaddleScript(imagePath);
    if (result.error) throw new Error(result.error);
    return {
      text: String(result.text || '').trim(),
      confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
      engine: result.engine || 'paddleocr+opencv',
      pages: result.pages || 1,
      lines: result.lines || [],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
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
      engine: 'fallback-text-decoder',
      error: error.message,
      pages: 0,
      fields: { source: fileName, mimeType },
    };
  }

  const text = decodePrintableText(buffer);
  return {
    text: text.trim(),
    confidence: text ? 60 : 0,
    engine: 'fallback-text-decoder',
    pages: 0,
    fields: {
      source: fileName,
      mimeType,
    },
  };
}
