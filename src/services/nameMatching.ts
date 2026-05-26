// src/services/nameMatching.ts
import Fuse from 'fuse.js';

// ============================================================
// 🔤 مطابقة الأسماء العربية الذكية
// ============================================================

/**
 * 🧹 تنظيف الاسم العربي
 * - إزالة التشكيل
 * - توحيد الألف (أ، إ، آ → ا)
 * - توحيد الياء (ى → ي)
 * - توحيد التاء المربوطة (ة → ه)
 * - إزالة المسافات الزائدة
 */
export const normalizeArabicName = (name: string): string => {
  if (!name) return '';
  
  return name
    .trim()
    // إزالة التشكيل
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // توحيد الألف
    .replace(/[أإآ]/g, 'ا')
    // توحيد الياء
    .replace(/ى/g, 'ي')
    // التاء المربوطة → هاء (اختياري - بعض الأنظمة تفرق)
    // .replace(/ة/g, 'ه')
    // الهمزة على الواو
    .replace(/ؤ/g, 'و')
    // الهمزة على الياء
    .replace(/ئ/g, 'ي')
    // إزالة المسافات الزائدة
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * 📊 تقسيم الاسم لكلمات مفردة
 */
const splitNameParts = (name: string): string[] => {
  return normalizeArabicName(name)
    .split(/\s+/)
    .filter(p => p.length > 0);
};

/**
 * 🔍 مطابقة اسم الهوية مع اسم النظام
 * 
 * @param nameFromID اسم من الهوية (مثلاً: "مجتبى حسن علي محمد")
 * @param nameInSystem اسم بالنظام (مثلاً: "مجتبى حسن علي")
 * @returns نسبة التطابق (0-100)
 * 
 * منطق المطابقة:
 * - إذا الاسمان متطابقان كلياً → 100%
 * - إذا الكلمات الأساسية مطابقة (ولو الترتيب مختلف) → 95-100%
 * - إذا اسم أحدهما جزء من الآخر (ثلاثي vs رباعي) → 90-95%
 * - إذا فيه تشابه قوي مع اختلافات بسيطة → 70-90%
 * - غير ذلك → أقل
 */
export const matchArabicNames = (
  nameFromID: string,
  nameInSystem: string
): number => {
  if (!nameFromID || !nameInSystem) return 0;
  
  const normalized1 = normalizeArabicName(nameFromID);
  const normalized2 = normalizeArabicName(nameInSystem);
  
  // تطابق كامل
  if (normalized1 === normalized2) return 100;
  
  const parts1 = splitNameParts(nameFromID);
  const parts2 = splitNameParts(nameInSystem);
  
  if (parts1.length === 0 || parts2.length === 0) return 0;
  
  // 🎯 منطق المطابقة الذكية:
  // نشوف كم كلمة مشتركة بين الاثنين
  
  const set1 = new Set(parts1);
  const set2 = new Set(parts2);
  
  // الكلمات المشتركة
  const intersection = [...set1].filter(p => set2.has(p));
  const minLength = Math.min(parts1.length, parts2.length);
  const maxLength = Math.max(parts1.length, parts2.length);
  
  // إذا كل كلمات الاسم الأقصر موجودة بالأطول → تطابق عالي
  if (intersection.length === minLength) {
    // 100% إذا الكل متطابق
    if (maxLength === minLength) return 100;
    
    // إذا اسم رباعي vs ثلاثي والثلاثي كامل موجود → 95%
    if (maxLength - minLength === 1) return 96;
    
    // إذا الفرق كلمتين أو أكثر → 90%
    return 90;
  }
  
  // 🔄 استخدام Fuse.js للمطابقة الذكية (typos, similar names)
  const fuse = new Fuse([normalized2], {
    includeScore: true,
    threshold: 0.6,
    distance: 100,
    minMatchCharLength: 2,
  });
  
  const fuseResult = fuse.search(normalized1);
  
  // 📏 مطابقة كل كلمة على حدة
  let matchedWords = 0;
  let partialMatches = 0;
  
  for (const part1 of parts1) {
    if (part1.length < 2) continue;
    
    // تطابق كامل
    if (set2.has(part1)) {
      matchedWords++;
      continue;
    }
    
    // مطابقة جزئية (typo بسيط)
    for (const part2 of parts2) {
      if (part2.length < 2) continue;
      
      const similarity = stringSimilarity(part1, part2);
      if (similarity >= 0.85) {
        partialMatches++;
        break;
      }
    }
  }
  
  // حساب النسبة النهائية
  const totalMatched = matchedWords + (partialMatches * 0.7);
  const percentByWords = (totalMatched / maxLength) * 100;
  
  // دمج مع نتيجة Fuse
  const fuseScore = fuseResult.length > 0 ? (1 - (fuseResult[0].score || 1)) * 100 : 0;
  
  // الأخذ بالأعلى مع وزن للكلمات
  const finalScore = Math.round(percentByWords * 0.7 + fuseScore * 0.3);
  
  return Math.min(100, Math.max(0, finalScore));
};

/**
 * 📐 حساب التشابه بين سلسلتين (Levenshtein-based)
 * يرجع رقم بين 0 و 1
 */
const stringSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  const longerLength = longer.length;
  if (longerLength === 0) return 1;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longerLength - distance) / longerLength;
};

/**
 * 📏 خوارزمية Levenshtein لحساب المسافة بين سلسلتين
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
 * ⚙️ عتبة التطابق التلقائي
 * فوق هذه النسبة → موافقة تلقائية
 * تحتها → يحتاج مراجعة أدمن
 */
export const AUTO_APPROVE_THRESHOLD = 90;

/**
 * 🚨 الحد الأدنى المقبول
 * تحت هذه النسبة → رفض مباشر
 */
export const MIN_ACCEPTABLE_THRESHOLD = 60;

/**
 * 📊 تصنيف نتيجة المطابقة
 */
export type MatchLevel = 'auto-approve' | 'review-needed' | 'rejected';

export const classifyMatch = (percentage: number): MatchLevel => {
  if (percentage >= AUTO_APPROVE_THRESHOLD) return 'auto-approve';
  if (percentage >= MIN_ACCEPTABLE_THRESHOLD) return 'review-needed';
  return 'rejected';
};

/**
 * 🎨 وصف النتيجة بالعربي
 */
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