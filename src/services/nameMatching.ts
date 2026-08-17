const ALEF_VARIANTS = /[أإآءؤئ]/g;
const TA_MARBUTA = /ة/g;
const ALEF_MAQURA = /ى/g;
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670]/g;
const WHITESPACE = /\s+/g;

export function normalizeArabic(text: string): string {
  return text
    .replace(DIACRITICS, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(TA_MARBUTA, 'ه')
    .replace(ALEF_MAQURA, 'ي')
    .replace(WHITESPACE, '')
    .trim();
}

export function findNameInOCRText(studentName: string, ocrText: string): { matched: boolean; confidence: number } {
  if (!studentName || !ocrText) return { matched: false, confidence: 0 };

  const normalizedName = normalizeArabic(studentName);
  const normalizedText = normalizeArabic(ocrText);

  if (!normalizedName || !normalizedText) return { matched: false, confidence: 0 };

  if (normalizedText.includes(normalizedName)) {
    return { matched: true, confidence: 1 };
  }

  const nameWords = studentName.split(WHITESPACE).filter(w => normalizeArabic(w).length >= 2);
  if (nameWords.length === 0) return { matched: false, confidence: 0 };

  let found = 0;
  for (const word of nameWords) {
    const nw = normalizeArabic(word);
    if (nw.length >= 2 && normalizedText.includes(nw)) found++;
  }

  const confidence = found / nameWords.length;
  return {
    matched: confidence >= 0.6,
    confidence,
  };
}

export function findStudentByCode(code: string, students: { code: string }[]): { code: string } | null {
  const normalized = code.trim();
  return students.find(s => s.code === normalized) || null;
}
