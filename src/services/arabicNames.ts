// src/services/arabicNames.ts
// ============================================================
// قاعدة بيانات الأسماء العربية + خوارزمية استخراج
// مستوحاة من ArabicNamesParser + قاعدة بيانات 2000+ هوية عراقية
//
// المنطق الأساسي:
// 1. ايجاد حقل "الاسم" بـ fuzzy matching
// 2. استخراج النص من بعد "الاسم" فقط
// 3. تصفية صارم: فقط الكلمات الموجودة في قاعدة الأسماء
// 4. فصل الكلمات المدمجة
// ============================================================

// ============================================================
// تطبيع النص العربي
// ============================================================

export const normalizeArabic = (text: string): string => {
  return text
    .trim()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// ============================================================
// قاعدة بيانات الأسماء الشاملة
// ============================================================

const MALE_NAMES_RAW = [
  // أسماء إسلامية أساسية
  'محمد', 'أحمد', 'علي', 'حسن', 'حسين', 'عمر', 'عثمان', 'أبو بكر',
  'إسماعيل', 'إسحاق', 'يعقوب', 'يوسف', 'موسى', 'عيسى', 'داوود',
  'سليمان', 'إبراهيم', 'هارون', 'زكريا', 'يحيى', 'يونس', 'أيوب',
  'نوح', 'لوط', 'هود', 'صالح', 'شعيب', 'ذو الكفل',
  // أسماء عربية شائعة
  'خالد', 'طارق', 'جمال', 'كمال', 'صبري', 'سامي', 'رائد', 'ماجد',
  'وليد', 'عادل', 'هشام', 'اياد', 'باسم', 'فيصل', 'زياد', 'قيس',
  'بكر', 'طلحة', 'الزبير', 'سعيد', 'منصور', 'فؤاد', 'حيدر', 'بدر',
  'ضياء', 'ركن', 'عز', 'معين', 'ناصر', 'قمر', 'ضوء', 'سراج', 'سيف',
  'حسام', 'بهاء', 'شمس', 'محي', 'تاج', 'فخر', 'شرف', 'صلاح', 'علاء',
  'عماد', 'زين', 'ياسر', 'يامن', 'ياسين', 'نواف', 'نبيل', 'لطفي',
  'ماهر', 'مهند', 'منير', 'فاروق', 'قصي', 'كريم', 'جاسم', 'سالم',
  'مؤيد', 'كاظم', 'جعفر', 'مصطفى', 'بشير', 'باقر', 'تيسير', 'ثامر',
  'حاتم', 'حمزة', 'راغب', 'رياض', 'زهير', 'عامر', 'عباس', 'عمار',
  'عمرو', 'غازي', 'قاسم', 'لؤي', 'مأمون', 'مراد', 'نايف', 'واثق',
  'راشد', 'هاني', 'هادي', 'هيثم', 'وائل', 'وسام',
  'سلمان', 'سمير', 'شريف', 'سفيان', 'شادي', 'صابر', 'طلال',
  'ظافر', 'فادي', 'فلاح', 'مازن', 'وسيم', 'يزيد',
  'تامر', 'ديما', 'سراج',
  'غانم', 'مناف', 'هلال',
  // أسماء عراقية محددة
  'رشيد', 'نبال', 'حازم', 'دانיאל', 'رفيق', 'صلاح', 'عادل', 'فارس',
  'لطيف', 'هشام', 'وليد',
  'أنس', 'أسامة', 'فراس', 'اشرف', 'منعم', 'وليد', 'بسام',
  'حليم', 'بسام',
];

const FEMALE_NAMES_RAW = [
  'نور', 'هدى', 'منى', 'مريم', 'فاطمة', 'آمنة', 'سمية', 'خديجة',
  'عائشة', 'زينب', 'رقية', 'سارة', 'حياة', 'منال', 'نادية', 'نهى',
  'رنا', 'ريم', 'شيماء', 'صفاء', 'عبير', 'عفاف', 'غادة', 'لبنى',
  'ليلى', 'مها', 'نورة', 'هيا', 'ياسمين', 'نجلاء', 'سلمى', 'دانا',
  'رنيم', 'جنى', 'دانة', 'لينا', 'ميساء', 'آلاء', 'أماني', 'بثينة',
  'تغريد', 'حنان', 'حنين', 'خلود', 'دينا', 'رشا', 'زكية', 'سمير',
  'شمس', 'صابرة', 'ظبية', 'غدير', 'فيروز', 'كريمة', 'لطيفة', 'ملاك',
  'منار', 'نسرين', 'وفاء', 'آيه', 'بسمة', 'ثريا', 'حور', 'ديمة',
  'راغب', 'زهراء', 'سلمان', 'شمس', 'عمران', 'غادة', 'فيروز',
  'قمر', 'كريمة', 'لمياء', 'مريم', 'نادى', 'هبة', 'ياسمين',
];

const ABD_COMPOUNDS_RAW = [
  ['عبد', 'الله'], ['عبد', 'الرحمن'], ['عبد', 'الرحيم'], ['عبد', 'الكريم'],
  ['عبد', 'العزيز'], ['عبد', 'الحسين'], ['عبد', 'الحسن'], ['عبد', 'الامير'],
  ['عبد', 'الواحد'], ['عبد', 'الجبار'], ['abd', 'al', 'razzak'],
  ['عبد', 'الرزاق'], ['عبد', 'الستار'], ['abd', 'al', 'salam'],
  ['عبد', 'السلام'], ['abd', 'al', 'qadir'], ['عبد', 'القادر'],
  ['abd', 'al', 'latif'], ['عبد', 'اللطيف'], ['abd', 'al', 'majid'],
  ['عبد', 'المجيد'], ['abd', 'al', 'muhson'], ['عبد', 'المحسن'],
  ['abd', 'al', 'hadi'], ['عبد', 'الهادي'], ['abd', 'al', 'baqi'],
  ['عبد', 'الباقي'], ['abd', 'al', 'khaliq'], ['عبد', 'الخالق'],
  ['abd', 'al', 'samad'], ['عبد', 'الصمد'], ['abd', 'al', 'azim'],
  ['عبد', 'العظيم'], ['abd', 'al', 'ghafur'], ['عبد', 'الغفور'],
  ['abd', 'al', 'ghani'], ['عبد', 'الغني'], ['abd', 'al', 'fattah'],
  ['عبد', 'الفتاح'], ['abd', 'al', 'munim'], ['عبد', 'المنعم'],
  ['abd', 'al', 'wahhab'], ['عبد', 'الوهاب'], ['abd', 'al', 'nur'],
  ['عبد', 'النور'], ['abd', 'al', 'nasir'], ['عبد', 'الناصر'],
  ['abd', 'al', 'malik'], ['عبد', 'الملك'], ['abd', 'al', 'barr'],
  ['عبد', 'البر'], ['abd', 'al', 'matin'], ['عبد', 'المتين'],
  ['abd', 'al', 'daim'], ['abd', 'al', 'kafi'], ['abd', 'الكافي'],
  ['abd', 'al', 'shakur'], ['abd', 'الشكور'], ['abd', 'al', 'qayyum'],
  ['abd', 'القيوم'], ['abd', 'al', 'wadud'], ['abd', 'الودود'],
  ['abd', 'al', 'tawwab'], ['abd', 'التواب'], ['abd', 'al', 'hafiz'],
  ['abd', 'الحفيظ'], ['abd', 'al', 'mumin'], ['abd', 'المؤمن'],
  ['abd', 'al', 'hayy'], ['abd', 'الحي'], ['abd', 'al', 'qahhar'],
  ['abd', 'القهار'], ['abd', 'al', 'jabbar'], ['عبد', 'الجبار'],
];

const NOOR_COMPOUNDS_RAW = [
  ['نور', 'الهدى'], ['نور', 'الدين'], ['نور', 'الاسلام'],
  ['نور', 'الزهراء'], ['نور', 'العين'], ['نور', 'الحياه'],
  ['نور', 'القلوب'], ['نور', 'السما'], ['نور', 'النبى'],
  ['نور', 'الرحمن'], ['نور', 'الرحيم'], ['نور', 'الكريم'],
  ['نور', 'الศักดิ์สิทธิ์'],
];

const ALDEEN_COMPOUNDS_RAW = [
  ['صلاح', 'الدين'], ['علاء', 'الدين'], ['عماد', 'الدين'],
  ['سيف', 'الدين'], ['حسام', 'الدين'], ['بهاء', 'الدين'],
  ['شمس', 'الدين'], ['محي', 'الدين'], ['تاج', 'الدين'],
  ['فخر', 'الدين'], ['شرف', 'الدين'], ['جمال', 'الدين'],
  ['كمال', 'الدين'], ['بدر', 'الدين'], ['ضياء', 'الدين'],
  ['ركن', 'الدين'], ['عز', 'الدين'], ['معين', 'الدين'],
  ['ناصر', 'الدين'], ['قمر', 'الدين'], ['عماد', 'الدين'],
  ['نور', 'الدين'], ['عزالدين'],
];

const ABU_COMPOUNDS_RAW = [
  ['ابو', 'بكر'], ['ابو', 'زيد'], ['ابو', 'محمد'], ['ابو', 'طالب'],
  ['ابو', 'هريره'], ['ابو', 'الياس'], ['ابو', 'عبدالله'],
  ['ابو', 'حسن'], ['ابو', 'حسين'], ['ابو', 'حمزه'],
  ['ابو', 'رياحاب'], ['ابو', 'علي'], ['ابو', 'سعيد'],
  ['ابو', 'ذر'], ['ابو', 'الفتح'], ['ابو', 'المجد'],
  ['ابو', 'العباس'], ['ابو', 'القاسم'],
];

const UMM_COMPOUNDS_RAW = [
  ['ام', 'كلثوم'], ['ام', 'البنين'], ['ام', 'خالد'],
  ['ام', 'علي'], ['ام', 'حبيب'], ['ام', 'سعيد'],
  ['ام', 'ابراهيم'], ['ام', 'المؤمنين'], ['ام', 'عبدالرحمن'],
];

const ZAIN_COMPOUNDS_RAW = [
  ['زين', 'العابدين'],
];

// ============================================================
// بناء القوائم النهائية
// ============================================================

// أسماء أولى — Set للبحث السريع
const ALL_SINGLE_NAMES = [
  ...MALE_NAMES_RAW, ...FEMALE_NAMES_RAW,
].map(n => normalizeArabic(n)).filter(n => n.length >= 2);

const SINGLE_NAMES_SET = new Set(ALL_SINGLE_NAMES);

// أسماء مركبة — كل جزء يُبحث عنه بشكل مستقل
// المصفوفة: [name1, name2, name3?, name4?]
const ALL_COMPOUND_PARTS: string[][] = [
  ...ABD_COMPOUNDS_RAW,
  ...NOOR_COMPOUNDS_RAW,
  ...ALDEEN_COMPOUNDS_RAW,
  ...ABU_COMPOUNDS_RAW,
  ...UMM_COMPOUNDS_RAW,
  ...ZAIN_COMPOUNDS_RAW,
].map(parts => parts.map(p => normalizeArabic(p)).filter(p => p.length >= 2));

// جمع كل الأجزاء في Set واحد للبحث السريع
const ALL_COMPOUND_PARTS_SET = new Set<string>();
for (const parts of ALL_COMPOUND_PARTS) {
  for (const part of parts) {
    ALL_COMPOUND_PARTS_SET.add(part);
  }
}

// كلمات university / metadata — لا تُعتبر أسماء أبداً
const NON_NAME_WORDS = new Set([
  'الاسم', 'اسم', 'الطالب', 'الطالبة', 'الطالب',
  'الكليه', 'القسم', 'المرحله', 'الفرع', 'الجامعه',
  'وزاره', 'التعليم', 'العالي', 'البحث', 'العلمي',
  'الجمهوري', 'العراقي', 'العراق', 'جمهوري',
  'هويه', 'الهويه', 'بطاقه', 'البطاقه',
  'تاريخ', 'الميلاد', 'الرقم', 'الرقمي',
  'الامتحاني', 'الجامعي',
  'هندسه', 'طب', 'صيدله', 'الصيدله', 'علوم', 'اداب', 'لغات', 'تربيه',
  'حاسوب', 'معلومات', 'كهرباء', 'ميكانيك', 'مدنين',
  'صباحي', 'مسائي', 'دراسات', 'ذكر', 'انثي',
  'بغداد', 'البصره', 'الموصل', 'النجف', 'كربلاء', 'اربيل',
  'مدريه', 'دوائر', 'الوطنيه',
  'صادره', 'العام', 'الدراسي',
  'المجتمعه', 'العراقيه', 'الهندسه', 'التربيه',
  'الاصلاحيه', 'البترولي', 'التجاريه',
  'الرئيسيه', 'الثانويه', 'الابتدائيه',
  'التعليم العالي', 'البحث العلمي', 'التعليم العالي للبحث العلمي',
  // أسماء جامعات عراقية
  'جامعه', 'جامعة', 'الموصل', ' Baghdad', ' tikrit',
  'ال tecnic', 'المعلوماتيه',
]);

// ============================================================
// خوارزمية الاستخراج
// ============================================================

/**
 * تنظيف نص OCR خام
 */
const cleanOCRText = (text: string): string => {
  return text
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/ا\s+ل([\u0600-\u06FF])/g, 'ال$1')
    .replace(/ل\s+ل([\u0600-\u06FF])/g, 'لل$1')
    .replace(/[\d٠-٩]+/g, ' ')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * فحص: هل الكلمة اسم معروف في قاعدة البيانات؟
 * يتعامل مع "ال" المقدمة (OCR يقرأ "الهدى" مو "هدى")
 */
const stripAl = (word: string): string => {
  if (word.startsWith('ال') && word.length > 3) return word.substring(2);
  if (word.startsWith('ل') && word.length > 2) return word.substring(1);
  return word;
};

const isKnownName = (word: string): boolean => {
  const norm = normalizeArabic(word);
  if (norm.length < 2) return false;
  if (NON_NAME_WORDS.has(norm)) return false;
  if (SINGLE_NAMES_SET.has(norm)) return true;
  const stripped = stripAl(norm);
  if (stripped.length >= 2 && SINGLE_NAMES_SET.has(stripped)) return true;
  if (ALL_COMPOUND_PARTS_SET.has(norm)) return true;
  if (ALL_COMPOUND_PARTS_SET.has(stripped)) return true;
  return false;
};

/**
 * فصل كلمة مدمجة باستخدام قاعدة الأسماء
 * مثال: "سالمجاسم" → ["سالم", "جاسم"]
 */
const trySplitMergedWord = (word: string): string[] => {
  const norm = normalizeArabic(word);
  if (norm.length < 4) return [word];

  // فصل ثنائي
  for (let i = 2; i <= norm.length - 2; i++) {
    const left = norm.substring(0, i);
    const right = norm.substring(i);
    if (isKnownName(left) && isKnownName(right)) {
      return [left, right];
    }
  }

  // فصل ثلاثي
  if (norm.length >= 6) {
    for (let i = 2; i <= norm.length - 4; i++) {
      for (let j = i + 2; j <= norm.length - 2; j++) {
        const a = norm.substring(0, i);
        const b = norm.substring(i, j);
        const c = norm.substring(j);
        if (isKnownName(a) && isKnownName(b) && isKnownName(c)) {
          return [a, b, c];
        }
      }
    }
  }

  // فصل رباعي
  if (norm.length >= 8) {
    for (let i = 2; i <= norm.length - 6; i++) {
      for (let j = i + 2; j <= norm.length - 4; j++) {
        for (let k = j + 2; k <= norm.length - 2; k++) {
          const a = norm.substring(0, i);
          const b = norm.substring(i, j);
          const c = norm.substring(j, k);
          const d = norm.substring(k);
          if (isKnownName(a) && isKnownName(b) && isKnownName(c) && isKnownName(d)) {
            return [a, b, c, d];
          }
        }
      }
    }
  }

  return [word];
};

/**
 * فصل الكلمات المدمجة في جملة
 */
const splitAllMergedWords = (text: string): string => {
  return text
    .split(/\s+/)
    .flatMap(w => trySplitMergedWord(w))
    .join(' ');
};

/**
 * 🔍 fuzzy match لكتابة "الاسم" في نص OCR
 * Tesseract يقرأها بطرق مختلفة
 */
const NAME_LABEL_PATTERNS = [
  'الاسم', 'الاسهم', 'الاسهمي', 'الاسهمي', 'الاسمي',
  'الاسمي', 'الاسامي', 'الاسمي', 'الاسامي',
  'اسم الطالب', 'اسم الطالبه', 'اسم الطالبة',
  'اسم', 'الاسمه',
];

/**
 * ايجاد موقع "الاسم" في النص واستخراج ما بعدها
 */
const findNameField = (rawText: string): string | null => {
  const cleaned = cleanOCRText(rawText);
  const lines = cleaned.split(/\s+/);

  // حاول إيجاد أي صيغة من "الاسم"
  for (const label of NAME_LABEL_PATTERNS) {
    const labelNorm = normalizeArabic(label);

    for (let i = 0; i < lines.length; i++) {
      const wordNorm = normalizeArabic(lines[i]);

      // تطابق مباشر
      if (wordNorm === labelNorm || wordNorm.includes(labelNorm)) {
        // أخذ كل ما بعد هذا الكلمة في نفس السطر + الأسطر التالية
        const afterLabel = lines.slice(i + 1).join(' ');
        if (afterLabel.length > 0) {
          console.log(`✅ وجدنا "${label}" في الموقع ${i}`);
          return afterLabel;
        }
      }

      // تطابق جزئي (كلمة تبدأ بنفس الحروف)
      if (labelNorm.length >= 4 && wordNorm.substring(0, 4) === labelNorm.substring(0, 4)) {
        const afterLabel = lines.slice(i + 1).join(' ');
        if (afterLabel.length > 0) {
          console.log(`✅ fuzzy match "${label}" → "${lines[i]}" في الموقع ${i}`);
          return afterLabel;
        }
      }
    }
  }

  // حاول البحث في النص كاملاً (بما في ذلك الأسطر المتعددة)
  const fullText = cleaned;
  for (const label of NAME_LABEL_PATTERNS) {
    const labelNorm = normalizeArabic(label);
    const idx = normalizeArabic(fullText).indexOf(labelNorm);

    if (idx !== -1) {
      const afterLabel = fullText.substring(idx + label.length).trim();
      if (afterLabel.length > 0) {
        console.log(`✅ وجدنا "${label}" في النص الكامل`);
        return afterLabel;
      }
    }
  }

  return null;
};

/**
 * 🎯 استخراج الاسم من نص OCR
 *
 * الاستراتيجية:
 * 1. ايجاد حقل "الاسم" بـ fuzzy matching
 * 2. استخراج النص من بعد "الاسم" فقط
 * 3. تصفية صارم: فقط الكلمات في قاعدة الأسماء
 * 4. فصل الكلمات المدمجة
 */
export const extractNameFromOCR = (rawText: string): string | null => {
  if (!rawText) return null;

  const cleaned = cleanOCRText(rawText);
  if (!cleaned) return null;

  console.log('📋 OCR كامل:', cleaned.substring(0, 400));

  // ── الخطوة 1: ايجاد حقل "الاسم" ──
  let nameField = findNameField(rawText);

  if (nameField) {
    console.log('📋 نص حقل الاسم:', nameField.substring(0, 200));

    // فصل الكلمات المدمجة
    const split = splitAllMergedWords(nameField);
    console.log('🔍 بعد الفصل:', split.substring(0, 200));

    // تصفية صارمة: فقط الأسماء المعروفة
    const words = split.split(/\s+/);
    const nameWords = words.filter(w => isKnownName(w));

    if (nameWords.length >= 2) {
      const inferred = inferCompoundNames(nameWords);
      const result = inferred.join(' ');
      console.log('✅ استخراج من حقل الاسم:', result);
      return result;
    }

    // إذا التصفية الصارمة ما نتجت، حاول مع تفكيك الكلمات المدمجة
    const allSplitWords = words.flatMap(w => trySplitMergedWord(w));
    const filteredWords = allSplitWords.filter(w => isKnownName(w));

    if (filteredWords.length >= 2) {
      const inferred = inferCompoundNames(filteredWords);
      const result = inferred.join(' ');
      console.log('✅ استخراج من حقل الاسم (بعد فصل):', result);
      return result;
    }
  }

  // ── الخطوة 2: fallback — بحث في كل النص ──
  console.log('⚠️ ما لقينا حقل "الاسم"، نبحث في كل النص...');

  const split = splitAllMergedWords(cleaned);
  const words = split.split(/\s+/);

  // تصفية صارمة: فقط الأسماء المعروفة
  const nameWords = words.filter(w => isKnownName(w));

  if (nameWords.length >= 2) {
    const inferred = inferCompoundNames(nameWords);
    const result = inferred.join(' ');
    console.log('✅ استخراج من fallback:', result);
    return result;
  }

  console.log('❌ ما لقينا أي اسم في النص');
  return null;
};

/**
 * محاولة استكمال الأسماء المركبة الناقصة
 * مثال: "هدى مؤيد سالم" → نضيف "نور" قبل "هدى" إذا "نور الهدى" مركبة معروفة
 */
const COMPOUND_FIRST_PARTS: Record<string, string[]> = {
  'هدى': ['نور'],
  'الهدى': ['نور'],
  'الدين': ['نور', 'صلاح', 'علاء', 'عماد', 'سيف', 'حسام', 'بهاء', 'شمس', 'محي', 'تاج', 'فخر', 'شرف', 'جمال', 'كمال', 'بدر', 'ضياء', 'ركن', 'عز', 'معين', 'ناصر', 'قمر'],
  'الاسلام': ['نور'],
  'الزهراء': ['نور'],
  'العين': ['نور'],
  'الرحمن': ['عبد', 'نور'],
  'الرحيم': ['عبد', 'نور'],
  'الكريم': ['عبد', 'نور'],
  'العزيز': ['عبد'],
  'الحسين': ['عبد'],
  'الحسن': ['عبد'],
  'الهادي': ['عبد'],
  'الباقي': ['عبد'],
  'الخالق': ['عبد'],
  'الصمد': ['عبد'],
  'العظيم': ['عبد'],
  'الغفور': ['عبد'],
  'الغني': ['عبد'],
  'الفتاح': ['عبد'],
  'المنعم': ['عبد'],
  'الوهاب': ['عبد'],
  'النور': ['عبد'],
  'الناصر': ['عبد'],
  'الملك': ['عبد'],
  'البر': ['عبد'],
  'المتين': ['عبد'],
  'الكافي': ['عبد'],
  'الشكور': ['عبد'],
  'القيوم': ['عبد'],
  'الودود': ['عبد'],
  'التواب': ['عبد'],
  'الحفيظ': ['عبد'],
  'المؤمن': ['عبد'],
  'الحي': ['عبد'],
  'القهار': ['عبد'],
  'الجبار': ['عبد'],
  'الرزاق': ['عبد'],
  'الستار': ['عبد'],
  'السلام': ['عبد'],
  'القادر': ['عبد'],
  'اللطيف': ['عبد'],
  'المجيد': ['عبد'],
  'المحسن': ['عبد'],
  'بكر': ['ابو'],
  'زيد': ['ابو'],
  'محمد': ['ابو'],
  'طالب': ['ابو'],
  'الياس': ['ابو'],
  'حسن': ['ابو', 'ام'],
  'حسين': ['ابو'],
  'علي': ['ابو', 'ام'],
  'سعيد': ['ابو', 'ام'],
  'كلثوم': ['ام'],
  'البنين': ['ام'],
  'خالد': ['ام'],
  'حبيب': ['ام'],
  'ابراهيم': ['ابو', 'ام'],
  'المؤمنين': ['ام'],
  'عبدالرحمن': ['ام'],
  'العباس': ['ابو'],
  'القاسم': ['ابو'],
};

const inferCompoundNames = (nameWords: string[]): string[] => {
  const result = [...nameWords];
  for (let i = 0; i < result.length; i++) {
    const norm = normalizeArabic(result[i]);
    const stripped = stripAl(norm);
    const firstParts = COMPOUND_FIRST_PARTS[norm] || COMPOUND_FIRST_PARTS[stripped];
    if (firstParts && i === 0) {
      for (const prefix of firstParts) {
        const compoundNorm = normalizeArabic(prefix + result[i]);
        if (ALL_COMPOUND_PARTS_SET.has(compoundNorm) || SINGLE_NAMES_SET.has(normalizeArabic(prefix))) {
          console.log(`🔮 استكمال مركبة: "${prefix} ${result[i]}"`);
          result.unshift(prefix);
          break;
        }
      }
    }
  }
  return result;
};

/**
 * التحقق: هل هذا النص يحتوي على اسم عربي صالح؟
 */
export const isValidArabicName = (name: string): boolean => {
  if (!name) return false;
  const words = name.split(/\s+/).filter(w => w.length >= 2);
  if (words.length < 2 || words.length > 8) return false;
  return words.every(w => isKnownName(w));
};
