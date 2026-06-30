import ExifReader from 'exifreader';

export function inspectMetadata(buffer) {
  try {
    const metadata = ExifReader.load(buffer);
    const suspicious = [];
    const software = metadata?.Software?.description || metadata?.Software?.value;
    if (software && /photoshop|gimp|canva|paint/i.test(String(software))) {
      suspicious.push(`Editing software signature: ${software}`);
    }
    return { metadata, suspicious, flagged: suspicious.length > 0 };
  } catch {
    return { metadata: {}, suspicious: ['Metadata unavailable'], flagged: false };
  }
}

export function detectTamperSignals(fileName, mimeType) {
  const suspicious = [];
  if (/\.jpg$|\.jpeg$|\.png$/i.test(fileName || '') && !/^image\//.test(mimeType || '')) {
    suspicious.push('Image extension and MIME type mismatch');
  }
  if (/pdf/i.test(mimeType || '') && /\.(png|jpg|jpeg)$/i.test(fileName || '')) {
    suspicious.push('Rasterized PDF or image conversion suspected');
  }
  return { flagged: suspicious.length > 0, suspicious };
}
