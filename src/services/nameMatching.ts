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

const MIN_SEQUENTIAL_SCORE = 0.6;

const hasSequentialMatch = (parts1: string[], parts2: string[]): boolean => {
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
      if (matches >= shorter.length) return true;
    }
  }
  return matches >= shorter.length;
};

export const matchArabicNames = (name1: string, name2: string): number => {
  if (!name1 || !name2) return 0;

  const norm1 = normalizeArabicName(name1);
  const norm2 = normalizeArabicName(name2);
  if (norm1 === norm2) return 90;
  if (deepNormalize(norm1) === deepNormalize(norm2)) return 90;

  // Try smart-split first (preserves compounds like نور الهدى)
  const parts1 = smartSplitName(name1);
  const parts2 = smartSplitName(name2);
  if (hasSequentialMatch(parts1, parts2)) return 90;

  // Fallback: split into individual words (handles OCR that breaks compounds)
  const words1 = norm1.split(/\s+/).filter(Boolean);
  const words2 = norm2.split(/\s+/).filter(Boolean);
  if (hasSequentialMatch(words1, words2)) return 90;

  return 0;
};

export const AUTO_APPROVE_THRESHOLD = 90;
export const MIN_ACCEPTABLE_THRESHOLD = 60;

export type MatchLevel = 'auto-approve' | 'review-needed' | 'rejected';

export const classifyMatch = (percentage: number): MatchLevel => {
  if (percentage >= AUTO_APPROVE_THRESHOLD) return 'auto-approve';
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return 'review-needed';
  return 'rejected';
};

export const getMatchDescription = (percentage: number): { emoji: string; text: string; color: string } => {
  if (percentage >= 95) return { emoji: '✅', text: 'تطابق ممتاز', color: 'green' };
  if (percentage >= AUTO_APPROVE_THRESHOLD) return { emoji: '✅', text: 'تطابق جيد جداً', color: 'green' };
  if (percentage >= 75) return { emoji: '🟡', text: 'تطابق جيد - يحتاج مراجعة', color: 'amber' };
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return { emoji: '⚠️', text: 'تطابق ضعيف - يحتاج مراجعة', color: 'orange' };
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
    { id: 'نور الهدى مؤيد سالم جاسم', system: 'نور الهدى مؤيد سالم', expected: '90' },
    { id: 'نور الهدى مؤيد سالم جاسم', system: 'نور الهدى مؤيد سالم جاسم', expected: '90' },
    { id: 'نور الهدي مويد سالم', system: 'نور الهدى مؤيد سالم', expected: '90' },
    { id: 'عبد الله احمد محمد', system: 'عبدالله احمد محمد', expected: '90' },
    { id: 'احمد علي حسن', system: 'نور الهدى مؤيد سالم', expected: '0' },
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
