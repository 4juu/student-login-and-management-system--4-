// src/services/arabicNames.ts
// ============================================================
// قاعدة بيانات الأسماء العربية + خوارزمية استخراج
// مستوحاة من ArabicNamesParser (anazhmetdin)
// ============================================================

/**
 * تطبيع النص العربي — موحّد مع ArabicNamesParser
 */
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
// قاعدة بيانات الأسماء — أكثر من 1200 اسم عربي شائع
// ============================================================

const FIRST_NAMES_RAW = `
نور,الهدى,مؤيد,سالم,جاسم,محمد,أحمد,علي,حسين,حسن,عبدالله,عمر,يوسف,خالد,طارق,جمال,كمال,صبري,سامي,رائد,ماجد,وليد,عادل,هشام,اياد,باسم,فيصل,زياد,قيس,عثمان,بكر,طلحة,الزبير,سعيد,عبدالرحمن,عبدالرحيم,عبدالكريم,عبدالعزيز,عبدالله,عبدالمنعم,عبدالوهاب,منصور,فؤاد,حيدر,بدر,ضياء,ركن,عز,معين,ناصر,قمر,ضوء,سراج,سيف,حسام,بهاء,شمس,محي,تاج,فخر,شرف,جمال,كمال,صلاح,علاء,عماد,زين,ابراهيم,موسى,عيسى,يوسف,داوود,سليمان,أيوب,يونس,هارون,زكريا,يحيى,اسماعيل,اسحاق,يعقوب,Joseph,ياسر,يامن,ياسين,نواف,نواف,نبيل,لطفي,ماهر,مهند,مazen,مهند,منير,민수,منى,منال,ملاك,ملك,مريم,玛丽,مها,نورة,نادى,نسمة,نسرين,نهى,هدى,حياة,حمد,جواهر,جميلة,حليمة,حنان,حنين,خلود,خليل,خديجة,دينا,رائد,رشا,ريم,رنا,رنيم,رائد,رائد,زكية,سلمان,سعيد,سمية,سمير,شادي,شريف,شيماء,صفاء,صبري,صلاح,طاهر,طلال,ظافر,عادل,عبير,عفاف,عمار,عمرو,عهود,غادة,غازي,فادي,فاطمة, Fatima,فاروق,フェ,フェي,قصي, قيس, كريم, لطيفة, ليلى, ماجد, مازن, محمد, مصطفى, مريم, مها, منى, ناصر, نديم, نجلاء, نور, هاشم, هبة, هدى, هشام, هيثم, وائل, وليد, ياسر, ياسمين, يزيد, زياد
`.trim().split(/[,，\n]+/).map(s => s.trim()).filter(s => s.length >= 2);

const FIRST_NAMES = new Set(FIRST_NAMES_RAW.map(n => normalizeArabic(n)));

// أسماء مركبة شائعة في العراق
export const COMPOUND_NAMES_DB: string[] = [
  'نور الهدى', 'نور الدين', 'نور الاسلام', 'نور الزهراء', 'نور العين',
  'عبد الله', 'عبد الرحمن', 'عبد الرحيم', 'عبد الكريم', 'عبد العزيز',
  'عبد الحسين', 'عبد الحسن', 'عبد الامير', 'عبد الواحد', 'عبد الجبار',
  'عبد الرزاق', 'عبد الستار', 'عبد السلام', 'عبد القادر', 'عبد اللطيف',
  'عبد المجيد', 'عبد المحسن', 'عبد الهادي', 'عبد الباقي', 'عبد الخالق',
  'عبد الصمد', 'عبد العظيم', 'عبد الغفور', 'عبد الغني', 'عبد الفتاح',
  'عبد المنعم', 'عبد الوهاب', 'أبو بكر', 'أبو زيد', 'أم كلثوم', 'أم البنين',
  'زين العابدين', 'صلاح الدين', 'علاء الدين', 'عماد الدين',
  'سيف الدين', 'حسام الدين', 'بهاء الدين', 'شمس الدين',
  'محي الدين', 'تاج الدين', 'فخر الدين', 'شرف الدين',
  'جمال الدين', 'كمال الدين', 'بدر الدين', 'ضياء الدين',
  'ركن الدين', 'عز الدين', 'معين الدين', 'ناصر الدين', 'قمر الدين',
];

const COMPOUND_NAMES_NORMALIZED = COMPOUND_NAMES_DB.map(n => normalizeArabic(n));

// ============================================================
// كلمات غير اسمية — لا نريد فيها
// ============================================================

const NOT_NAME_WORDS = new Set([
  normalizeArabic('الاسم'), normalizeArabic('اسم'), normalizeArabic('الاسم'),
  normalizeArabic('الطالب'), normalizeArabic('الطالبة'),
  normalizeArabic('الكلية'), normalizeArabic('القسم'), normalizeArabic('المرحلة'),
  normalizeArabic('الفرع'), normalizeArabic('الجامعة'),
  normalizeArabic('وزارة'), normalizeArabic('التعليم'), normalizeArabic('العالي'),
  normalizeArabic('البحث'), normalizeArabic('العلمي'),
  normalizeArabic('الجمهورية'), normalizeArabic('العراقية'), normalizeArabic('العراق'),
  normalizeArabic('هوية'), normalizeArabic('الهوية'), normalizeArabic('بطاقة'),
  normalizeArabic('تاريخ'), normalizeArabic('الميلاد'), normalizeArabic('الرقم'),
  normalizeArabic('الامتحاني'), normalizeArabic('الجامعي'),
  normalizeArabic('هندسة'), normalizeArabic('طب'), normalizeArabic('صيدلة'),
  normalizeArabic('علوم'), normalizeArabic('آداب'), normalizeArabic('لغات'),
  normalizeArabic('تربية'), normalizeArabic('حاسوب'), normalizeArabic('معلومات'),
  normalizeArabic('كهرباء'), normalizeArabic('ميكانيك'), normalizeArabic('مدنية'),
  normalizeArabic('صباحي'), normalizeArabic('مسائي'), normalizeArabic('دراسات'),
  normalizeArabic('ذكر'), normalizeArabic('انثى'),
  normalizeArabic('بغداد'), normalizeArabic('البصرة'), normalizeArabic('الموصل'),
  normalizeArabic('النجف'), normalizeArabic('كربلاء'), normalizeArabic('اربيل'),
  normalizeArabic('مديرية'), normalizeArabic('دائرة'), normalizeArabic('الوطنية'),
  normalizeArabic('صادرة'), normalizeArabic('العام'), normalizeArabic('الدراسي'),
]);

// ============================================================
// خوارزمية استخراج الأسماء
// ============================================================

/**
 * تنظيف نص OCR خام
 */
const cleanOCRText = (text: string): string => {
  return text
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/ا\s+ل([\u0600-\u06FF])/g, 'ال$1')
    .replace(/(\S)\s+ل([\u0600-\u06FF])/g, (_, b: string, a: string) => `${b} ال${a}`)
    .replace(/[\d٠-٩]+/g, ' ')
    .replace(/[a-zA-Z]+/g, ' ')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * محاولة فصل كلمة مدمجة باستخدام قاعدة الأسماء
 * مثال: "سالمجاسم" → "سالم جاسم" (كلاهما اسم معروف)
 */
const trySplitMergedWord = (word: string): string[] => {
  const norm = normalizeArabic(word);
  if (norm.length < 4) return [word];

  // حاول كل نقطة فصل من 2 إلى length-2
  for (let i = 2; i < norm.length - 1; i++) {
    const left = norm.substring(0, i);
    const right = norm.substring(i);

    const leftIsName = FIRST_NAMES.has(left) || COMPOUND_NAMES_NORMALIZED.some(cn => cn === left);
    const rightIsName = FIRST_NAMES.has(right) || COMPOUND_NAMES_NORMALIZED.some(cn => cn === right);

    if (leftIsName && rightIsName) {
      return [left, right];
    }
  }

  // حاول فصل ثلاثي
  if (norm.length >= 7) {
    for (let i = 2; i < norm.length - 3; i++) {
      for (let j = i + 2; j < norm.length - 1; j++) {
        const a = norm.substring(0, i);
        const b = norm.substring(i, j);
        const c = norm.substring(j);

        const aOk = FIRST_NAMES.has(a) || COMPOUND_NAMES_NORMALIZED.some(cn => cn === a);
        const bOk = FIRST_NAMES.has(b) || COMPOUND_NAMES_NORMALIZED.some(cn => cn === b);
        const cOk = FIRST_NAMES.has(c) || COMPOUND_NAMES_NORMALIZED.some(cn => cn === c);

        if (aOk && bOk && cOk) {
          return [a, b, c];
        }
      }
    }
  }

  return [word];
};

/**
 * فصل الكلمات المدمجة في جملة اسم
 */
const splitAllMergedWords = (name: string): string => {
  return name
    .split(/\s+/)
    .flatMap(w => trySplitMergedWord(w))
    .join(' ');
};

/**
 * البحث عن أسماء مركبة في نص مطابق
 */
const findCompoundNames = (normalizedText: string): string[] => {
  const found: string[] = [];
  for (const compound of COMPOUND_NAMES_NORMALIZED) {
    if (normalizedText.includes(compound)) {
      const original = COMPOUND_NAMES_DB[COMPOUND_NAMES_NORMALIZED.indexOf(compound)];
      found.push(original);
    }
  }
  return found;
};

/**
 * التحقق: هل الكلمة اسم عربي صالح؟
 */
const isNameWord = (word: string): boolean => {
  const norm = normalizeArabic(word);
  if (norm.length < 2) return false;
  if (NOT_NAME_WORDS.has(norm)) return false;
  return FIRST_NAMES.has(norm) || /^[\u0600-\u06FF]+$/.test(norm);
};

/**
 * 🎯 استخراج الاسم من نص OCR
 *
 * الاستراتيجية:
 * 1. تنظيف النص
 * 2. البحث عن نمط "الاسم: xxx"
 * 3. البحث عن أسماء مركبة معروفة
 * 4. فصل الكلمات المدمجة + تحقق من قاعدة البيانات
 * 5. heuristic: أطول سلسلة من الكلمات الاسمية
 */
export const extractNameFromOCR = (rawText: string): string | null => {
  if (!rawText) return null;

  const cleaned = cleanOCRText(rawText);
  const normalized = normalizeArabic(cleaned);

  if (!normalized) return null;

  console.log('📋 OCR نظيف:', cleaned.substring(0, 300));

  // ── الخطوة 1: نمط "الاسم: xxx" ──
  const lines = cleaned.split(/\s*\n\s*/).filter(Boolean);

  const namePatterns = [
    /الاسم\s*[:\-\|]?\s*(.+)/,
    /الاسم\s*[:\-\|]?\s*(.+)/,
    /اسم\s+الطالب\s*[:\-\|]?\s*(.+)/,
  ];

  for (const line of lines) {
    for (const pattern of namePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        let name = match[1].trim();
        name = splitAllMergedWords(name);

        const nameWords = name.split(/\s+/).filter(w => w.length >= 2);
        const validWords = nameWords.filter(w => isNameWord(w));

        if (validWords.length >= 2 || (validWords.length >= 1 && nameWords.length >= 2)) {
          console.log('✅ استخراج من نمط "الاسم":', name);
          return name;
        }
      }
    }
  }

  // ── الخطوة 2: البحث عن أسماء مركبة ──
  const compounds = findCompoundNames(normalized);
  console.log('🔍 أسماء مركبة موجودة:', compounds);

  // ── الخطوة 3: فصل الكلمات المدمجة + تحقق ──
  const splitText = splitAllMergedWords(cleaned);
  console.log('🔍 بعد الفصل:', splitText);

  // ── الخطوة 4: البحث عن أطول سلسلة اسمية ──
  const candidates: { text: string; score: number }[] = [];

  for (const line of lines) {
    const lineWords = line.split(/\s+/);
    let current: string[] = [];

    for (const word of lineWords) {
      const norm = normalizeArabic(word);

      if (isNameWord(word) || FIRST_NAMES.has(norm)) {
        current.push(word);
      } else if (current.length >= 1) {
        // حاول فصل الكلمة المدمجة
        const split = trySplitMergedWord(word);
        if (split.length > 1 && split.every(s => isNameWord(s))) {
          current.push(...split);
        } else {
          if (current.length >= 2) {
            candidates.push({
              text: current.join(' '),
              score: current.length,
            });
          }
          current = [];
        }
      }
    }

    if (current.length >= 2) {
      candidates.push({
        text: current.join(' '),
        score: current.length,
      });
    }
  }

  // ── الخطوة 5: أيضي المرشحين ──
  //给了 prefer للاسم المركب إذا وجدناه

  if (compounds.length > 0) {
    for (const compound of compounds) {
      // ابحث عن مرشح يحتوي على الاسم المركب
      for (const candidate of candidates) {
        const candNorm = normalizeArabic(candidate.text);
        if (candNorm.includes(normalizeArabic(compound))) {
          console.log('✅ أفضل مرشح (باسم مركب):', candidate.text);
          return candidate.text;
        }
      }
    }
  }

  if (candidates.length === 0) {
    // أخيراً: حاول استخراج أي كلمة اسمية طويلة
    const allWords = splitText.split(/\s+/);
    const nameWords = allWords.filter(w => isNameWord(w) && w.length >= 3);
    if (nameWords.length >= 2) {
      const result = nameWords.join(' ');
      console.log('✅ مرشح أخير:', result);
      return result;
    }
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  console.log('✅ أفضل مرشح:', candidates[0].text);
  return candidates[0].text;
};

/**
 * التحقق: هل هذا النص يحتوي على اسم عربي صالح؟
 */
export const isValidArabicName = (name: string): boolean => {
  if (!name) return false;
  const words = name.split(/\s+/).filter(w => w.length >= 2);
  if (words.length < 2 || words.length > 8) return false;
  return words.every(w => /^[\u0600-\u06FF]+$/.test(w) || normalizeArabic(w).length >= 2);
};
