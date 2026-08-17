// ============================================================
// 🔤 مطابقة الأسماء العربية - هويات جامعية عراقية
// ============================================================

const COMPOUND_NAMES: string[] = [
  'نور الهدى', 'نور الدين', 'نور الاسلام',
  'عبد الله', 'عبد الرحمن', 'عبد الرحيم', 'عبد الكريم',
  'عبد الامير', 'عبد الحسين', 'عبد الحسن', 'عبد العزيز',
  'عبد الواحد', 'عبد الجبار', 'عبد الرزاق', 'عبد الستار',
  'عبد السلام', 'عبد القادر', 'عبد اللطيف', 'عبد المجيد',
  'عبد المحسن', 'عبد الهادي', 'عبد الباقي', 'عبد الخالق',
  'عبد الصمد', 'عبد العظيم', 'عبد الغفور', 'عبد الغني',
  'عبد الفتاح', 'عبد المنعم', 'عبد الوهاب',
  'ابو بكر', 'ابو زيد', 'ام كلثوم', 'ام البنين',
  'زين العابدين', 'صلاح الدين', 'علاء الدين', 'عماد الدين',
  'سيف الدين', 'حسام الدين', 'بهاء الدين', 'شمس الدين',
  'محي الدين', 'تاج الدين', 'فخر الدين', 'شرف الدين',
  'جمال الدين', 'كمال الدين', 'بدر الدين', 'ضياء الدين',
  'ركن الدين', 'عز الدين', 'معين الدين', 'ناصر الدين',
  'قمر الدين',
];

export const normalizeArabicName = (name: string): string => {
  if (!name) return '';
  return name
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
};

const deepNormalize = (name: string): string => {
  return normalizeArabicName(name)
    .replace(/\bال/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const smartSplitName = (name: string): string[] => {
  if (!name) return [];
  let normalized = normalizeArabicName(name);
  const parts: string[] = [];
  const sortedCompounds = [...COMPOUND_NAMES]
    .map(n => normalizeArabicName(n))
    .sort((a, b) => b.length - a.length);
  for (const compound of sortedCompounds) {
    const index = normalized.indexOf(compound);
    if (index !== -1) {
      const before = normalized.substring(0, index).trim();
      if (before) parts.push(...before.split(/\s+/).filter(p => p.length > 0));
      parts.push(compound);
      normalized = normalized.substring(index + compound.length).trim();
    }
  }
  if (normalized.length > 0) {
    parts.push(...normalized.split(/\s+/).filter(p => p.length > 0));
  }
  return parts;
};

const stringSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const na = deepNormalize(a);
  const nb = deepNormalize(b);
  if (na === nb) return 1;
  const longer = na.length > nb.length ? na : nb;
  const shorter = na.length > nb.length ? nb : na;
  if (longer.length === 0) return 1;
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
};

const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
};

const MIN_SEQUENTIAL_SCORE = 0.5;

/**
 * مطابقة تسلسلية مع دعم التطابق الجزئي
 * تُرجع عدد التطابقات (0 = لا شيء، shorter.length = كامل)
 */
const sequentialMatchCount = (parts1: string[], parts2: string[]): number => {
  const shorter = parts1.length <= parts2.length ? parts1 : parts2;
  const longer = parts1.length <= parts2.length ? parts2 : parts1;

  let longerIdx = 0;
  let matches = 0;

  for (let i = 0; i < shorter.length; i++) {
    let bestScore = 0;
    let bestJ = -1;
    for (let j = longerIdx; j < longer.length; j++) {
      const sim = stringSimilarity(shorter[i], longer[j]);
      if (sim > bestScore) { bestScore = sim; bestJ = j; }
    }
    if (bestScore >= MIN_SEQUENTIAL_SCORE && bestJ !== -1) {
      matches++;
      longerIdx = bestJ + 1;
    }
  }
  return matches;
};

/**
 * حساب درجة التطابق بناءً على الكلمات المتطابقة
 * يُرجع 0-90
 */
const computeMatchScore = (name1: string, name2: string): number => {
  if (!name1 || !name2) return 0;

  const norm1 = normalizeArabicName(name1);
  const norm2 = normalizeArabicName(name2);
  if (norm1 === norm2) return 90;
  if (deepNormalize(norm1) === deepNormalize(norm2)) return 90;

  // محاولة 1: smart-split (يحافظ على الأسماء المركبة)
  const parts1 = smartSplitName(name1);
  const parts2 = smartSplitName(name2);
  const smartMatches = sequentialMatchCount(parts1, parts2);
  if (smartMatches >= parts1.length && smartMatches >= parts2.length) return 90;
  if (smartMatches > 0) {
    const ratio = smartMatches / Math.max(parts1.length, parts2.length);
    if (ratio >= 0.9) return 90;
  }

  // محاولة 2: تقسيم لكلمات فردية (يعالج OCR الذي يكسر المركبات)
  const words1 = norm1.split(/\s+/).filter(Boolean);
  const words2 = norm2.split(/\s+/).filter(Boolean);
  const wordMatches = sequentialMatchCount(words1, words2);
  if (wordMatches >= words1.length && wordMatches >= words2.length) return 90;
  if (wordMatches > 0) {
    const ratio = wordMatches / Math.max(words1.length, words2.length);
    if (ratio >= 0.9) return 90;
  }

  // محاولة 3: التطابق الجزئي (أي كلمة من الاسم تطابق أي كلمة في النظام)
  const allWords1 = new Set<string>();
  const allWords2 = new Set<string>();
  for (const p of parts1) {
    for (const w of p.split(/\s+/).filter(Boolean)) {
      allWords1.add(deepNormalize(w));
    }
  }
  for (const p of parts2) {
    for (const w of p.split(/\s+/).filter(Boolean)) {
      allWords2.add(deepNormalize(w));
    }
  }

  // حساب عدد الكلمات المتطابقة بشكل غير تسلسلي
  let looseMatches = 0;
  const usedWords2 = new Set<number>();
  for (const w1 of allWords1) {
    let bestSim = 0;
    let bestIdx = -1;
    let idx = 0;
    for (const w2 of allWords2) {
      if (usedWords2.has(idx)) { idx++; continue; }
      const sim = stringSimilarity(w1, w2);
      if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
      idx++;
    }
    if (bestSim >= MIN_SEQUENTIAL_SCORE && bestIdx !== -1) {
      looseMatches++;
      usedWords2.add(bestIdx);
    }
  }

  if (looseMatches >= 3) return 85;
  if (looseMatches === 2) {
    const ratio = looseMatches / Math.max(allWords1.size, allWords2.size);
    if (ratio >= 0.66) return 80;
  }
  if (looseMatches === 1) {
    // كلمة واحدة فقط — لا نعتبرها تطابق كافي
  }

  return 0;
};

export const matchArabicNames = (name1: string, name2: string): number => {
  return computeMatchScore(name1, name2);
};

export const AUTO_APPROVE_THRESHOLD = 80;
export const MIN_ACCEPTABLE_THRESHOLD = 70;

export type MatchLevel = 'auto-approve' | 'review-needed' | 'rejected';

export const classifyMatch = (percentage: number): MatchLevel => {
  if (percentage >= AUTO_APPROVE_THRESHOLD) return 'auto-approve';
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return 'review-needed';
  return 'rejected';
};

export const getMatchDescription = (percentage: number): { emoji: string; text: string; color: string } => {
  if (percentage >= 90) return { emoji: '✅', text: 'تطابق ممتاز', color: 'green' };
  if (percentage >= AUTO_APPROVE_THRESHOLD) return { emoji: '✅', text: 'تطابق جيد', color: 'green' };
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return { emoji: '🟡', text: 'تطابق مقبول - يحتاج مراجعة', color: 'amber' };
  return { emoji: '❌', text: 'لا يوجد تطابق', color: 'red' };
};

export const fixOCRErrors = (ocrText: string): string => {
  if (!ocrText) return '';
  return ocrText
    .replace(/\s+/g, ' ')
    .replace(/[^\u0600-\u06FF\u0750-\u077F\s]/g, '')
    .replace(/ا\s+ل/g, 'ال')
    .replace(/عبدال/g, 'عبد ال')
    .trim();
};

export const extractNameFromOCR = (ocrText: string): string | null => {
  if (!ocrText) return null;
  const arabicPatterns = [
    /الاسم\s*[:\-]\s*(.+?)(?:\n|$)/,
    /الأسم\s*[:\-]\s*(.+?)(?:\n|$)/,
    /الإسم\s*[:\-]\s*(.+?)(?:\n|$)/,
    /اسم\s*[:\-]\s*(.+?)(?:\n|$)/,
  ];
  const englishPatterns = [
    /Name\s*[:\-]\s*(.+?)(?:\n|$)/i,
  ];
  const fixedText = fixOCRErrors(ocrText);
  for (const pattern of arabicPatterns) {
    const match = fixedText.match(pattern) || ocrText.match(pattern);
    if (match && match[1]) {
      const name = match[1].replace(/[^\u0600-\u06FF\u0750-\u077F\s]/g, '').trim();
      if (name.length >= 4) return name;
    }
  }
  for (const pattern of englishPatterns) {
    const match = ocrText.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
};

export const runMatchTests = () => {
  const tests = [
    { id: 'نور الهدى مؤيد سالم جاسم', system: 'نور الهدى مؤيد سالم', expected: '85-90' },
    { id: 'نور الهدى مؤيد سالم جاسم', system: 'نور الهدى مؤيد سالم جاسم', expected: '90' },
    { id: 'نور الهدي مويد سالم', system: 'نور الهدى مؤيد سالم', expected: '90' },
    { id: 'عبد الله احمد محمد', system: 'عبدالله احمد محمد', expected: '90' },
    { id: 'احمد علي حسن', system: 'نور الهدى مؤيد سالم', expected: '0' },
    { id: 'نور الدين مؤيد', system: 'نور الهدى مؤيد', expected: '80-90' },
    { id: 'مؤيد سالم', system: 'نور الهدى مؤيد سالم', expected: '80-85' },
  ];

  console.log('🧪 === اختبارات مطابقة الأسماء ===\n');
  for (const test of tests) {
    const result = matchArabicNames(test.id, test.system);
    const desc = getMatchDescription(result);
    console.log(`📝 هوية:  "${test.id}"`);
    console.log(`💾 نظام:  "${test.system}"`);
    console.log(`📊 نتيجة: ${result}% ${desc.emoji} (متوقع: ${test.expected}%)`);
    console.log(`🏷️ تصنيف: ${classifyMatch(result)}`);
    console.log('---');
  }
};
