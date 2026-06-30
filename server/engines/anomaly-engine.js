function firstDigit(amount) {
  const digit = String(Math.abs(Number(amount) || 0)).replace(/[^0-9]/g, '').replace(/^0+/, '')[0];
  return digit ? Number(digit) : null;
}

export function analyzeBenford(records = []) {
  const counts = Array(9).fill(0);
  let total = 0;
  for (const record of records) {
    const digit = firstDigit(record.amount);
    if (digit) {
      counts[digit - 1] += 1;
      total += 1;
    }
  }

  const expected = [1,2,3,4,5,6,7,8,9].map((digit) => Math.log10(1 + 1 / digit));
  const actual = counts.map((count) => (total ? count / total : 0));
  const deviation = actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0);

  return {
    counts,
    expected,
    actual,
    deviation,
    flagged: deviation > 0.45,
  };
}

export function detectSalami(records = []) {
  const suspicious = records.filter((record) => Number(record.amount) > 0 && Number(record.amount) < 1000 && /fee|charge|transfer|debit/i.test(record.description || ''));
  return {
    flagged: suspicious.length >= 3,
    suspicious,
    count: suspicious.length,
  };
}

export function detectOutliers(records = []) {
  const amounts = records.map((record) => Number(record.amount) || 0).filter(Boolean);
  if (amounts.length < 3) return { flagged: false, outliers: [] };

  const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  const variance = amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length;
  const sd = Math.sqrt(variance) || 1;
  const outliers = records.filter((record) => Math.abs(((Number(record.amount) || 0) - mean) / sd) > 2.5);

  return { flagged: outliers.length > 0, mean, sd, outliers };
}

export function findDuplicates(documents = []) {
  const seen = new Map();
  const duplicates = [];
  for (const document of documents) {
    if (!document.file_hash) continue;
    if (seen.has(document.file_hash)) {
      duplicates.push(document);
      duplicates.push(seen.get(document.file_hash));
    } else {
      seen.set(document.file_hash, document);
    }
  }
  return { flagged: duplicates.length > 0, duplicates: [...new Map(duplicates.map((item) => [item.id, item])).values()] };
}
