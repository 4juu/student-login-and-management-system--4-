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

// ─────────────────────────────────────────────────────────────
// Levenshtein similarity (0-1)
// ─────────────────────────────────────────────────────────────
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length, n = b.length;
  if (m > 300 || n > 300) return a.includes(b) || b.includes(a) ? 0.8 : 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

// ─────────────────────────────────────────────────────────────
// Detect and split merged Arabic compound names
// ─────────────────────────────────────────────────────────────
const ARABIC_PREFIXES = ['عبد', 'أبو', 'ابو', 'آل', 'عي', 'بني'];
const ARABIC_SUFFIXES = ['الله', 'الرحمان', 'الرحيم', 'العزيز', 'الكريم'];

export function splitMergedArabicWords(word: string): string[] {
  if (word.length < 5) return [word];
  for (const prefix of ARABIC_PREFIXES) {
    if (word.startsWith(prefix) && word.length > prefix.length + 1) {
      const rest = word.slice(prefix.length);
      for (const suffix of ARABIC_SUFFIXES) {
        if (rest === suffix) return [prefix, rest];
        if (rest.startsWith(suffix) && rest.length > suffix.length + 1) {
          return [prefix, suffix, rest.slice(suffix.length)];
        }
      }
      if (rest.length >= 2) return [prefix, rest];
    }
  }
  return [word];
}

export function splitMergedName(name: string): string {
  const words = name.split(/\s+/);
  const expanded: string[] = [];
  for (const w of words) {
    const parts = splitMergedArabicWords(w);
    expanded.push(...parts);
  }
  return expanded.join(' ');
}

// ─────────────────────────────────────────────────────────────
// Token-based fuzzy matching (handles word order variation)
// ─────────────────────────────────────────────────────────────
function tokenize(name: string): string[] {
  return splitMergedName(name)
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (!tokensA.length || !tokensB.length) return 0;

  let matched = 0;
  for (const tA of tokensA) {
    let best = 0;
    for (const tB of tokensB) {
      const s = levenshteinSimilarity(tA, tB);
      if (s > best) best = s;
    }
    if (best >= 0.6) matched += best;
  }
  return matched / Math.max(tokensA.length, tokensB.length);
}

// ─────────────────────────────────────────────────────────────
// findNameInOCRText — improved with fuzzy + compound support
// ─────────────────────────────────────────────────────────────
export function findNameInOCRText(studentName: string, ocrText: string): { matched: boolean; confidence: number } {
  if (!studentName || !ocrText) return { matched: false, confidence: 0 };

  const normalizedName = normalizeArabic(studentName);
  const normalizedText = normalizeArabic(ocrText);
  if (!normalizedName || !normalizedText) return { matched: false, confidence: 0 };

  // Exact substring
  if (normalizedText.includes(normalizedName)) {
    return { matched: true, confidence: 1 };
  }

  // Expanded name match (split merged words)
  const expandedName = normalizeArabic(splitMergedName(studentName));
  if (expandedName && normalizedText.includes(expandedName)) {
    return { matched: true, confidence: 0.95 };
  }

  // Token-based word match (original logic, enhanced)
  const nameWords = studentName.split(WHITESPACE).filter(w => normalizeArabic(w).length >= 2);
  if (nameWords.length === 0) return { matched: false, confidence: 0 };

  let found = 0;
  for (const word of nameWords) {
    const nw = normalizeArabic(word);
    // Also check merged splits
    const splits = splitMergedArabicWords(word);
    const anyMatch = splits.some(s => normalizedText.includes(normalizeArabic(s)));
    if (anyMatch || (nw.length >= 2 && normalizedText.includes(nw))) found++;
  }

  const wordConfidence = found / nameWords.length;
  if (wordConfidence >= 0.6) return { matched: true, confidence: wordConfidence };

  // Fuzzy token similarity fallback
  const fuzzy = tokenSimilarity(studentName, ocrText);
  if (fuzzy >= 0.55) return { matched: true, confidence: fuzzy };

  return { matched: wordConfidence >= 0.5, confidence: Math.max(wordConfidence, fuzzy) };
}

// ─────────────────────────────────────────────────────────────
// Database-assisted matching — find student from OCR text
// ─────────────────────────────────────────────────────────────
export function matchStudentFromDatabase(
  ocrText: string,
  students: Array<{ name: string; code?: string }>,
  minConfidence = 0.55,
): { name: string; confidence: number } | null {
  if (!ocrText || !students.length) return null;

  let best: { name: string; confidence: number } | null = null;

  for (const student of students) {
    const result = findNameInOCRText(student.name, ocrText);
    if (result.matched && result.confidence > (best?.confidence ?? 0)) {
      best = { name: student.name, confidence: result.confidence };
    }
  }

  return best && best.confidence >= minConfidence ? best : null;
}

export function findStudentByCode(code: string, students: { code: string }[]): { code: string } | null {
  const normalized = code.trim();
  return students.find(s => s.code === normalized) || null;
}

// ─────────────────────────────────────────────────────────────
// استخراج الاسم الفعلي من نص OCR — يلتقط ما يلي كلمة "الاسم" مباشرة
// ─────────────────────────────────────────────────────────────

const NAME_LABEL_REGEX = /ال[اأإآ]سم\s*[:：]?\s*/;

const STOP_KEYWORDS = [
  'اللقب', 'الجنس', 'تاريخ', 'الميلاد', 'محل', 'الرقم', 'رقم',
  'الجنسية', 'الديانة', 'العنوان', 'الحالة', 'الدائرة', 'مكان',
  'رباعي', 'الكلية', 'القسم', 'المرحلة', 'التولد', 'الولاده',
  'الولادة', 'صباحي', 'مسائي',
];

function keepArabicLettersOnly(text: string): string {
  return text
    .replace(/[0-9\u0660-\u0669]/g, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractNameFromOCR(ocrText: string): string | null {
  if (!ocrText) return null;

  const match = ocrText.match(NAME_LABEL_REGEX);
  if (!match || match.index === undefined) return null;

  const afterMatch = ocrText.slice(match.index + match[0].length);
  const sameLine = afterMatch.split('\n')[0];

  let cut = sameLine;
  for (const kw of STOP_KEYWORDS) {
    const idx = cut.indexOf(kw);
    if (idx !== -1) cut = cut.slice(0, idx);
  }

  const cleaned = keepArabicLettersOnly(cut);
  if (!cleaned || cleaned.length < 3) return null;

  const words = cleaned.split(' ').filter(w => w.length >= 2);
  if (words.length === 0) return null;

  return words.join(' ');
}
