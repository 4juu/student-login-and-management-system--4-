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

// ─────────────────────────────────────────────────────────────
// 🆕 استخراج الاسم الفعلي من نص OCR — يلتقط ما يلي كلمة "الاسم" مباشرة
// ─────────────────────────────────────────────────────────────

// قائمة الكلمات المفتاحية التي قد تلي "الاسم" في بطاقات الهوية العراقية — تُستخدم كحد لوقف الاستخراج
const STOP_KEYWORDS = [
  'اللقب',
  'الجنس',
  'تاريخ',
  'الميلاد',
  'محل',
  'الرقم',
  'رقم',
  'الجنسية',
  'الديانة',
  'العنوان',
  'الحالة',
  'الدائرة',
  'مكان',
  'رباعي',
];

/** يبقي الحروف العربية والمسافات فقط، ويحذف الأرقام (عربية/إنكليزية) والرموز والحروف الإنكليزية */
function keepArabicLettersOnly(text: string): string {
  return text
    .replace(/[0-9\u0660-\u0669]/g, '')      // أرقام إنكليزية وعربية
    .replace(/[a-zA-Z]/g, '')                 // حروف إنكليزية
    .replace(/[^\u0600-\u06FF\s]/g, ' ')      // أي رمز غير عربي وغير مسافة
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * يستخرج الاسم الذي يلي كلمة "الاسم" مباشرة من نص OCR الخام لبطاقة الهوية.
 * يتوقف عند: نهاية السطر، أو أول كلمة مفتاحية أخرى (اللقب/الجنس/تاريخ الميلاد...)، أو أول رقم.
 * يرجّع null إذا لم توجد كلمة "الاسم" في النص أو كان الناتج فارغاً بعد التنظيف.
 */
export function extractNameFromOCR(ocrText: string): string | null {
  if (!ocrText) return null;

  // نبحث عن "الاسم" مع دعم وجود ":" اختيارية بعدها ومسافات متفاوتة (شائعة بمخرجات OCR)
  const nameRegex = /الاسم\s*[:：]?\s*/;
  const match = ocrText.match(nameRegex);
  if (!match || match.index === undefined) return null;

  // النص بعد كلمة "الاسم" مباشرة، حتى نهاية نفس السطر
  const afterMatch = ocrText.slice(match.index + match[0].length);
  const sameLine = afterMatch.split('\n')[0];

  // نقطع عند أول كلمة مفتاحية أخرى إن وُجدت بنفس السطر (تحسباً لالتصاق الحقول ببعض)
  let cut = sameLine;
  for (const kw of STOP_KEYWORDS) {
    const idx = cut.indexOf(kw);
    if (idx !== -1) cut = cut.slice(0, idx);
  }

  const cleaned = keepArabicLettersOnly(cut);
  if (!cleaned || cleaned.length < 3) return null;

  // حماية إضافية: اسم حقيقي عادة ثلاث كلمات على الأقل (اسم + اسم أب والجد على الأقل)
  const words = cleaned.split(' ').filter(w => w.length >= 3);
  if (words.length === 0) return null;

  return words.join(' ');
}
