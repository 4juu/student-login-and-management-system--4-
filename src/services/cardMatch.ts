// ============================================================
// 🔤 مطابقة أسماء بطاقات الهوية — استخراج الاسم + نسبة التطابق
// للمطابقة مع قائمة طلاب قاعدة البيانات (بدل قائمة ثابتة)
// ============================================================

import type { Student } from '../types/student';
import {
  extractNameFromOCR,
  findNameInOCRText,
  levenshteinSimilarity,
  normalizeArabic,
  splitMergedName,
} from './nameMatching';

export interface StudentMatch {
  student: Student;
  /** نسبة التطابق من 0 إلى 100 */
  score: number;
}

/** حد التطابق الافتراضي (قابل للتعديل) */
export const MATCH_THRESHOLD = 80;

const ARABIC_ONLY = /[^\u0600-\u06FF\s]/g;
const DIGITS = /[0-9\u0660-\u0669]/g;

// كلمات مستبعدة من سطر الاسم الاحتياطي (تقريبياً ما تُقرأ بهواتف/هويات)
const STOP_WORDS = [
  'الجمهورية', 'جمهورية', 'العراق', 'العراقية', 'وزارة', 'التعليم',
  'العالي', 'البحث', 'العلمي', 'الجامعة', 'الكلية', 'القسم',
  'المرحلة', 'اسم', 'الاسم', 'التاريخ', 'تاريخ', 'الشهادة',
  'الثانوية', 'الولادة', 'الولاده', 'التولد', 'الميلاد', 'المحل',
  'الجنسية', 'الديانة', 'الحالة', 'اللقب', 'الجنس', 'رقم', 'الرقم',
  'كود', 'الكود', 'الباركود', 'ستيج', 'لايت', 'قبول', 'المقبول',
  'صباحي', 'مسائي', 'national', 'name', 'university', 'college',
  'civil', 'status', 'sex', 'dob',
];

function cleanLine(line: string): string {
  return line
    .replace(DIGITS, ' ')
    .replace(/[a-zA-Z]/g, ' ')
    .replace(ARABIC_ONLY, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsStopWord(text: string): boolean {
  const norm = normalizeArabic(text);
  return STOP_WORDS.some(w => norm.includes(normalizeArabic(w)));
}

// ─────────────────────────────────────────────────────────────
// استخراج الاسم من نص OCR — مرحلتان
// المرحلة 1: السطر الذي يحتوي "الاسم" (تُعيده nameMatching)
// المرحلة 2 (احتياطية): أول سطر نظيف بدون أرقام/كلمات مستبعدة
//    وعدد كلماته 3-6 (طول اسم شخص رباعي)
// ─────────────────────────────────────────────────────────────
export function extractFallbackName(ocrText: string): string | null {
  if (!ocrText) return null;

  for (const rawLine of ocrText.split('\n')) {
    const line = cleanLine(rawLine);
    if (!line || containsStopWord(line)) continue;
    const words = line.split(' ').filter(w => w.length >= 2);
    if (words.length >= 3 && words.length <= 6) return words.join(' ');
  }
  return null;
}

export function extractStudentName(ocrText: string): string | null {
  const stage1 = extractNameFromOCR(ocrText);
  if (stage1) return stage1;
  return extractFallbackName(ocrText);
}

// ─────────────────────────────────────────────────────────────
// نسبة تشابه اسمين (أسلوب مشابه لـ fuzzball.ratio لكن واعٍ بالعربية)
// ─────────────────────────────────────────────────────────────
function levenshteinRatio(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  const maxLen = Math.max(m, n);
  if (maxLen < 2) return a === b ? 1 : 0;
  if (m === 1 || n === 1) return a === b ? 1 : 0;

  // نافذة DP موفّرة للمساحة (الصفان الأخيران فقط)
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return 1 - prev[n] / maxLen;
}

function tokenCoverage(wordsA: string[], wordsB: string[]): number {
  if (!wordsA.length || !wordsB.length) return 0;
  let sum = 0;
  for (const wA of wordsA) {
    let best = 0;
    for (const wB of wordsB) best = Math.max(best, levenshteinRatio(wA, wB));
    sum += best;
  }
  return sum / wordsA.length;
}

/** نسبة تطابق بين اسمين نصيين (0-100) — مطبّع عربياً + كلمات مندمجة */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;

  const ea = normalizeArabic(splitMergedName(na));
  const eb = normalizeArabic(splitMergedName(nb));
  if (ea === eb) return 98;
  if (ea.includes(nb) || eb.includes(na)) return 94;

  const wordsA = na.split(' ').filter(w => w.length >= 2);
  const wordsB = nb.split(' ').filter(w => w.length >= 2);
  if (!wordsA.length || !wordsB.length) return 0;

  if (wordsA.length === 1 || wordsB.length === 1) {
    return Math.round(levenshteinRatio(wordsA.join(''), wordsB.join('')) * 100);
  }

  const forward = tokenCoverage(wordsA, wordsB);
  const reverse = tokenCoverage(wordsB, wordsA);
  return Math.round(Math.max(forward, reverse) * 100);
}

// ─────────────────────────────────────────────────────────────
// ترتيب طلاب القائمة حسب تطابق نص OCR
// ممران: بوابة سريعة (أي جزء من الاسم موجود بالنص) ثم المطابق الفازي فقط للمرشحين
// ─────────────────────────────────────────────────────────────
export function rankStudents(ocrText: string, roster: Student[]): StudentMatch[] {
  if (!ocrText || !roster.length) return [];

  const normText = normalizeArabic(ocrText);

  return roster
    .map(s => {
      // بوابة سريعة: كلمة كاملة (مطّبعة) من اسم الطالب تظهر بالنص؟
      const tokens = normalizeArabic(s.name)
        .split(' ')
        .filter(w => w.length >= 2);
      if (!tokens.length || !tokens.some(t => normText.includes(t))) return null;
      // النتيجة: أقصى قيمة بين التشابه النصي (يسمح بوجود كلمات زائدة في النص —
      // مثل «مجتبى هيثم محمد محسن» مقابل «مجتبى هيثم») ودقة مطابقة OCR
      const simScore = nameSimilarity(s.name, ocrText);
      const ocrScore = Math.round((findNameInOCRText(s.name, ocrText).confidence || 0) * 100);
      return {
        student: s,
        score: Math.max(simScore, ocrScore),
      };
    })
    .filter((m): m is StudentMatch => m !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// ─────────────────────────────────────────────────────────────
// مطابقة الأسماء الثلاثة: الطالب + الأب + الجد
// البطاقة العراقية تحمل الاسم الرباعي: اسم الطالب، اسم الأب، اسم الجد،有时 الجد الرابع
// نقسم اسم الطالب في القائمة ونص OCR، ونطابق كل جزء لحاله
// القاعدة: إذا طابق جزئان من ثلاثة على الأقل ← تطابق قوي
// ─────────────────────────────────────────────────────────────
export function tripleNameMatch(
  ocrText: string,
  roster: Student[],
  minPartsMatch: number = 2,
): Array<{ student: Student; score: number; matchedParts: number; totalParts: number }> {
  if (!ocrText || !roster.length) return [];

  // نقسم أولاً ثم نطبعق كل كلمة على حدة (لأن normalizeArabic يزيل المسافات)
  const textTokens = ocrText.split(/\s+/).filter(w => w.length >= 2);
  if (!textTokens.length) return [];
  const textTokensNorm = textTokens.map(normalizeArabic);

  const results: Array<{ student: Student; score: number; matchedParts: number; totalParts: number }> = [];

  for (const student of roster) {
    const namePartsRaw = student.name.split(/\s+/).filter(w => w.length >= 2);
    if (namePartsRaw.length < 2) continue;
    const nameParts = namePartsRaw.map(normalizeArabic);

    let matchedParts = 0;
    for (const part of nameParts) {
      if (textTokensNorm.some(t => t === part || levenshteinSimilarity(t, part) >= 0.75)) {
        matchedParts++;
      }
    }

    if (matchedParts >= minPartsMatch) {
      results.push({
        student,
        score: Math.round((matchedParts / nameParts.length) * 100),
        matchedParts,
        totalParts: nameParts.length,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || b.matchedParts - a.matchedParts);
}

/** ترتيب الطلاب حسب اسم مكتوب يدوياً (إعادة حساب أثناء الكتابة) */
export function rankByNameInput(typed: string, roster: Student[]): StudentMatch[] {
  if (!typed || !typed.trim() || !roster.length) return [];
  return roster
    .map(s => ({ student: s, score: nameSimilarity(typed, s.name) }))
    .filter(m => m.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}