// src/services/nameMatching.ts
import Fuse from 'fuse.js';

// ============================================================
// 🔤 مطابقة الأسماء العربية الذكية - هويات جامعية عراقية
// ============================================================

/**
 * 📝 قائمة الأسماء المركبة الشائعة
 */
const COMPOUND_NAMES: string[] = [
  'نور الهدى',
  'نور الدين',
  'نور الاسلام',
  'عبد الله',
  'عبد الرحمن',
  'عبد الرحيم',
  'عبد الكريم',
  'عبد الامير',
  'عبد الحسين',
  'عبد الحسن',
  'عبد العزيز',
  'عبد الواحد',
  'عبد الجبار',
  'عبد الرزاق',
  'عبد الستار',
  'عبد السلام',
  'عبد القادر',
  'عبد اللطيف',
  'عبد المجيد',
  'عبد المحسن',
  'عبد الهادي',
  'عبد الباقي',
  'عبد الخالق',
  'عبد الصمد',
  'عبد العظيم',
  'عبد الغفور',
  'عبد الغني',
  'عبد الفتاح',
  'عبد المنعم',
  'عبد الوهاب',
  'ابو بكر',
  'ابو زيد',
  'ام كلثوم',
  'ام البنين',
  'زين العابدين',
  'صلاح الدين',
  'علاء الدين',
  'عماد الدين',
  'سيف الدين',
  'حسام الدين',
  'بهاء الدين',
  'شمس الدين',
  'محي الدين',
  'تاج الدين',
  'فخر الدين',
  'شرف الدين',
  'جمال الدين',
  'كمال الدين',
  'بدر الدين',
  'ضياء الدين',
  'ركن الدين',
  'عز الدين',
  'معين الدين',
  'ناصر الدين',
  'قمر الدين',
];

/**
 * 🧹 تنظيف الاسم العربي
 */
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

/**
 * 🧹 تنظيف أعمق - يشيل "ال" التعريف للمقارنة
 */
const deepNormalize = (name: string): string => {
  return normalizeArabicName(name)
    .replace(/\bال/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * 📊 تقسيم الاسم لأجزاء ذكية
 */
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
      if (before) {
        parts.push(...before.split(/\s+/).filter(p => p.length > 0));
      }

      parts.push(compound);
      normalized = normalized.substring(index + compound.length).trim();
    }
  }

  if (normalized.length > 0) {
    parts.push(...normalized.split(/\s+/).filter(p => p.length > 0));
  }

  return parts;
};

/**
 * 📐 حساب التشابه بين كلمتين
 */
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

/**
 * 📏 Levenshtein Distance
 */
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * 🔧 إصلاح أخطاء OCR الشائعة بالعربي
 */
export const fixOCRErrors = (ocrText: string): string => {
  if (!ocrText) return '';

  return ocrText
    .replace(/\s+/g, ' ')
    .replace(/[^\u0600-\u06FF\u0750-\u077F\s]/g, '')
    .replace(/ا\s+ل/g, 'ال')
    .replace(/عبدال/g, 'عبد ال')
    .trim();
};

/**
 * 🎯 استخراج الاسم من نص OCR للهوية
 */
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
      const name = match[1]
        .replace(/[^\u0600-\u06FF\u0750-\u077F\s]/g, '')
        .trim();
      if (name.length >= 4) return name;
    }
  }

  for (const pattern of englishPatterns) {
    const match = ocrText.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
};

// ============================================================
// 🔍 المطابقة الرئيسية
// ============================================================

export const matchArabicNames = (
  nameFromID: string,
  nameInSystem: string
): number => {
  if (!nameFromID || !nameInSystem) return 0;

  // ===== المرحلة 1: التنظيف =====
  const norm1 = normalizeArabicName(nameFromID);
  const norm2 = normalizeArabicName(nameInSystem);

  if (norm1 === norm2) return 100;
  if (deepNormalize(norm1) === deepNormalize(norm2)) return 99;

  // ===== المرحلة 2: التقسيم الذكي =====
  const parts1 = smartSplitName(nameFromID);
  const parts2 = smartSplitName(nameInSystem);

  if (parts1.length === 0 || parts2.length === 0) return 0;

  // ===== المرحلة 3: مطابقة الأجزاء =====
  const minLen = Math.min(parts1.length, parts2.length);
  const maxLen = Math.max(parts1.length, parts2.length);

  const similarityMatrix: number[][] = [];
  for (let i = 0; i < parts1.length; i++) {
    similarityMatrix[i] = [];
    for (let j = 0; j < parts2.length; j++) {
      similarityMatrix[i][j] = stringSimilarity(parts1[i], parts2[j]);
    }
  }

  // ===== المرحلة 4: المطابقة بالترتيب =====
  let orderedMatchScore = 0;
  let orderedMatches = 0;

  const shorter = parts1.length <= parts2.length ? parts1 : parts2;
  const longer  = parts1.length <= parts2.length ? parts2 : parts1;

  let longerIndex = 0;
  const matchDetails: { part: string; matchedWith: string; score: number }[] = [];

  for (let i = 0; i < shorter.length; i++) {
    let bestScore = 0;
    let bestJ = -1;

    for (let j = longerIndex; j < longer.length; j++) {
      const sim = stringSimilarity(shorter[i], longer[j]);
      if (sim > bestScore) {
        bestScore = sim;
        bestJ = j;
      }
    }

    if (bestScore >= 0.7 && bestJ !== -1) {
      orderedMatchScore += bestScore;
      orderedMatches++;
      longerIndex = bestJ + 1;

      matchDetails.push({
        part: shorter[i],
        matchedWith: longer[bestJ],
        score: bestScore,
      });
    }
  }

  // ===== المرحلة 5: حساب النسبة =====
  let percentage = 0;

  if (orderedMatches === 0) {
    percentage = 0;
  } else if (orderedMatches === minLen && minLen === maxLen) {
    percentage = Math.round((orderedMatchScore / orderedMatches) * 100);
  } else if (orderedMatches === minLen) {
    const avgScore = orderedMatchScore / orderedMatches;
    const lengthPenalty = (maxLen - minLen) * 2;
    percentage = Math.round(avgScore * 100 - lengthPenalty);
  } else {
    const avgScore = orderedMatchScore / orderedMatches;
    const coverageRatio = orderedMatches / maxLen;
    percentage = Math.round(avgScore * coverageRatio * 100);
  }

  // ===== 🎁 Bonus: الأسماء المركبة =====
  // إذا كل أجزاء الاسم الأقصر متطابقة، وفيه اسم مركب مشترك
  if (orderedMatches === minLen && minLen >= 3) {
    const hasCompoundMatch = parts1.some(p1 =>
      p1.startsWith('ال') && parts2.some(p2 => p2.includes(p1))
    );
    if (hasCompoundMatch) {
      percentage = Math.min(100, percentage + 5);
      console.log('🎁 Bonus +5% للاسم المركب المشترك');
    }
  }

  // ===== المرحلة 6: تعزيز بـ Fuse.js =====
  try {
    const fuse = new Fuse([norm2], {
      includeScore: true,
      threshold: 0.6,
      distance: 200,
      minMatchCharLength: 2,
    });

    const fuseResult = fuse.search(norm1);
    if (fuseResult.length > 0 && fuseResult[0].score !== undefined) {
      const fuseScore = Math.round((1 - fuseResult[0].score) * 100);
      percentage = Math.round(
        Math.max(percentage, percentage * 0.75 + fuseScore * 0.25)
      );
    }
  } catch {
    // إذا Fuse فشل، نكمل بدونه
  }

  return Math.min(100, Math.max(0, percentage));
};

// ============================================================
// ⚙️ إعدادات وعتبات
// ============================================================

export const AUTO_APPROVE_THRESHOLD = 90;
export const MIN_ACCEPTABLE_THRESHOLD = 60;

export type MatchLevel = 'auto-approve' | 'review-needed' | 'rejected';

export const classifyMatch = (percentage: number): MatchLevel => {
  if (percentage >= AUTO_APPROVE_THRESHOLD) return 'auto-approve';
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return 'review-needed';
  return 'rejected';
};

export const getMatchDescription = (percentage: number): {
  emoji: string;
  text: string;
  color: string;
} => {
  if (percentage >= 95) {
    return { emoji: '✅', text: 'تطابق ممتاز', color: 'green' };
  }
  if (percentage >= AUTO_APPROVE_THRESHOLD) {
    return { emoji: '✅', text: 'تطابق جيد جداً', color: 'green' };
  }
  if (percentage >= 75) {
    return { emoji: '🟡', text: 'تطابق جيد - يحتاج مراجعة', color: 'amber' };
  }
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) {
    return { emoji: '⚠️', text: 'تطابق ضعيف - يحتاج مراجعة', color: 'orange' };
  }
  return { emoji: '❌', text: 'لا يوجد تطابق', color: 'red' };
};

// ============================================================
// 🧪 اختبار سريع
// ============================================================

export const runMatchTests = () => {
  const tests = [
    {
      id: 'نور الهدى مؤيد سالم جاسم',
      system: 'نور الهدى مؤيد سالم',
      expected: '90+',
    },
    {
      id: 'نور الهدى مؤيد سالم جاسم',
      system: 'نور الهدى مؤيد سالم جاسم',
      expected: '100',
    },
    {
      id: 'نور الهدي مويد سالم',
      system: 'نور الهدى مؤيد سالم',
      expected: '90+',
    },
    {
      id: 'عبد الله احمد محمد',
      system: 'عبدالله احمد محمد',
      expected: '95+',
    },
    {
      id: 'احمد علي حسن',
      system: 'نور الهدى مؤيد سالم',
      expected: '0-10',
    },
  ];

  console.log('🧪 === اختبارات مطابقة الأسماء ===');
  console.log('');

  for (const test of tests) {
    const result = matchArabicNames(test.id, test.system);
    const classification = classifyMatch(result);
    const desc = getMatchDescription(result);

    console.log(`📝 هوية:  "${test.id}"`);
    console.log(`💾 نظام:  "${test.system}"`);
    console.log(`📊 نتيجة: ${result}% ${desc.emoji} (متوقع: ${test.expected}%)`);
    console.log(`🏷️ تصنيف: ${classification}`);
    console.log('---');
  }
};