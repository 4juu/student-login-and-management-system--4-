// src/services/arabicNames.ts
// ============================================================
// قاعدة بيانات الأسماء العربية + خوارزمية استخراج
// مستوحاة من ArabicNamesParser + قاعدة بيانات 2000+ هوية عراقية
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
// قاعدة بيانات الأسماء — شاملة جداً
// ============================================================

// أسماء رجالية شائعة في العراق
const MALE_NAMES = `
محمد,أحمد,علي,حسين,حسن,عمر,يوسف,خالد,طارق,جمال,كمال,صبري,سامي,رائد,
ماجد,وليد,عادل,هشام,اياد,باسم,فيصل,زياد,قيس,عثمان,بكر,طلحة,الزبير,
سعيد,منصور,فؤاد,حيدر,بدر,ضياء,ركن,عز,معين,ناصر,قمر,ضوء,سراج,سيف,
حسام,بهاء,شمس,محي,تاج,فخر,شرف,صلاح,علاء,عماد,زين,ابراهيم,موسى,عيسى,
داوود,سليمان,أيوب,يونس,هارون,زكريا,يحيى,اسماعيل,اسحاق,يعقوب,ياسر,
يامن,ياسين,نواف,نبيل,لطفي,ماهر,مهند,منير,فاروق,قصي,كريم,جاسم,سالم,
مؤيد,كاظم,جعفر,مصطفى,حسام,orest,بشير,باقر,تيسير,ثامر,جاسم,حاتم,
حمزة,خالد,ديما,راغب,رياض,زهير,سامي,شادى,عامر,عباس,عمار,عمرو,غازي,
قاسم,قيس,لؤي,مأمون,مراد,مصطفى,نايف,هشام,واثق,وليد,ياسر,ياسين,يزيد,
خالد,راشد,صالح,طارق,عادل,عامر,فؤاد,ماجد,منير,ناصر,هاني,وليد,
حسن,حسين,هادي,هيثم,وائل,وسام,يامن,يوسف,زياد,سلمان,سمير,شريف,
 Basil,سفيان,شادي,صابر,طلال,ظافر,عمار,عماد,فادي,فلاح,قاسم,
 كريم,مازن,منال,هبة,هيثم,وليد,وسيم,ياسر,يامن,يزيد,يونس
`.trim().split(/[,，\n]+/).map(s => s.trim()).filter(s => s.length >= 2);

// أسماء نسائية شائعة
const FEMALE_NAMES = `
نور,هدى,منى,مريم,فاطمة,آمنة,سمية,خديجة,عائشة,زينب,رقية,سارة,هدى,
حياة,منال,نادية,نهى,رنا,ريم,شيماء,صفاء,عبير,عفاف,غادة,لبنى,ليلى,
مها,نورة,هدى,هيا,ياسمين,نجلاء,سلمى,دانا,رنيم,جنى,دانة,لينا,ميساء,
رائد,آلاء,أماني,بثينة,تغريد,حنان,حنين,خلود,دينا,رشا,زكية,سمير,
سمية,شمس,صابرة,ظبية,غدير,فيروز,كريمة,لطيفة,ملاك,منار,نسرين,وفاء
`.trim().split(/[,，\n]+/).map(s => s.trim()).filter(s => s.length >= 2);

// أسماء مركبة — عبد + أسماء الله الحسنى
const ABD_COMPOUNDS = [
  'عبدالله', 'عبدالرحمان', 'عبدالرحيم', 'عبدالكريم', 'عبدالعزيز',
  'عبدالحسين', 'عبدالحسن', 'عبدالامير', 'عبدالواحد', 'عبدالجبار',
  'عبدالرزاق', 'عبدالستار', 'عبدالسلام', 'عبدالقادر', 'عبداللطيف',
  'عبدالمجيد', 'عبدالمحسن', 'عبدالهادي', 'عبدالباقي', 'عبدالخالق',
  'عبدالصمد', 'عبدالعظيم', 'عبدالغفور', 'عبدالغني', 'عبدالفتاح',
  'عبدالمنعم', 'عبدالوهاب', 'عبدالنور', 'عبدالناصر', 'عبدالملك',
  'عبدالباقر', 'عبدالمجيد', 'عبدالمتعالي', 'عبدالمعطي', 'عبدالمعبود',
  'عبدالمنير', 'عبدالودود', 'عبدالتواب', 'عبدالحفيظ', 'عبدالمنصور',
  'عبدالرحمن', 'عبدالرشيد', 'عبدالرسول', 'عبدالسميع', 'عبدال善良',
];

// أسماء مركبة — نور + X
const NOOR_COMPOUNDS = [
  'نورالهدى', 'نورالدين', 'نورالاسلام', 'نورالزهراء', 'نورالعين',
  'نورالهدى', 'نورالحياه', 'نورالقلوب', 'نورالسما', 'نورالنبى',
];

// أسماء مركبة — X + الدين
const ALDEEN_COMPOUNDS = [
  'صلاحالدين', 'علاءالدين', 'عمادالدين', 'سيفالدين', 'حسامالدين',
  'بهاءالدين', 'شمسالدين', 'محيالدين', 'تاجالدين', 'فخراالدين',
  'شرفالدين', 'جمالالدين', 'كمالالدين', 'بدرالدين', 'ضياءالدين',
  'ركنالدين', 'عزالدين', 'معينالدين', 'ناصرالدين', 'قمرالدين',
];

// أسماء مركبة — أبو + X
const ABU_COMPOUNDS = [
  'ابوبكر', 'ابوزيد', 'ابومحمد', 'ابوطالب', 'ابوهريره',
  'ابوالياس', 'ابوعبدالله', 'ابوحسن', 'ابوحسين', 'ابوحمزه',
  'ابوريحاب', 'ابوعلي', 'ابوسعيد', 'ابوذر', 'ابوالفتح',
  'ابوالمجد', 'ابوالعباس', 'ابوالقاسم', 'ابوالقاسم', 'ابوطالب',
];

// أسماء مركبة — أم + X
const UMM_COMPOUNDS = [
  'امكلثوم', 'امالبنين', 'امخالد', 'ام علي', 'ام حبيب',
  'ام سعيد', 'ام ابراهيم', 'ام المؤمنين', 'ام عبدالرحمن',
];

// أسماء مركبة — زين + X
const ZAIN_COMPOUNDS = [
  'زينالعابدين', 'زينب', 'زينب',
];

// جمع كل الأسماء المركبةNormalized
const ALL_COMPOUND_NAMES = [
  ...ABD_COMPOUNDS,
  ...NOOR_COMPOUNDS,
  ...ALDEEN_COMPOUNDS,
  ...ABU_COMPOUNDS,
  ...UMM_COMPOUNDS,
  ...ZAIN_COMPOUNDS,
].map(n => normalizeArabic(n));

// بناء مجموعة الأسماء الأولى
const ALL_FIRST_NAMES = [
  ...MALE_NAMES,
  ...FEMALE_NAMES,
].map(n => normalizeArabic(n));

const FIRST_NAMES = new Set(ALL_FIRST_NAMES);

// ============================================================
// كلمات غير اسمية
// ============================================================

const NOT_NAME_WORDS = new Set([
  normalizeArabic('الاسم'), normalizeArabic('اسم'),
  normalizeArabic('الطالب'), normalizeArabic('الطالبة'),
  normalizeArabic('الكلية'), normalizeArabic('القسم'), normalizeArabic('المرحلة'),
  normalizeArabic('الفرع'), normalizeArabic('الجامعة'),
  normalizeArabic('وزارة'), normalizeArabic('التعليم'), normalizeArabic('العالي'),
  normalizeArabic('البحث'), normalizeArabic('العلمي'),
  normalizeArabic('الجمهورية'), normalizeArabic('العراقية'), normalizeArabic('العراق'),
  normalizeArabic('هويه'), normalizeArabic('الهويه'), normalizeArabic('بطاقه'),
  normalizeArabic('تاريخ'), normalizeArabic('الميلاد'), normalizeArabic('الرقم'),
  normalizeArabic('الامتحاني'), normalizeArabic('الجامعي'),
  normalizeArabic('هندسه'), normalizeArabic('طب'), normalizeArabic('صيدله'),
  normalizeArabic('علوم'), normalizeArabic('آداب'), normalizeArabic('لغات'),
  normalizeArabic('تربيه'), normalizeArabic('حاسوب'), normalizeArabic('معلومات'),
  normalizeArabic('كهرباء'), normalizeArabic('ميكانيك'), normalizeArabic('مدنين'),
  normalizeArabic('صباحي'), normalizeArabic('مسائي'), normalizeArabic('دراسات'),
  normalizeArabic('ذكر'), normalizeArabic('انثي'),
  normalizeArabic('بغداد'), normalizeArabic('البصره'), normalizeArabic('الموصل'),
  normalizeArabic('النجف'), normalizeArabic('كربلاء'), normalizeArabic('اربيل'),
  normalizeArabic('مدريه'), normalizeArabic('دوائر'), normalizeArabic('الوطنيه'),
  normalizeArabic('صادره'), normalizeArabic('العام'), normalizeArabic('الدراسي'),
  normalizeArabic('المجتمعه'), normalizeArabic('العراقيه'),
  normalizeArabic('الهندسه'), normalizeArabic('التربية'), normalizeArabic('الاصلاحيه'),
  normalizeArabic('البتروليه'), normalizeArabic('ال TECHNIC'), normalizeArabic('التجاريه'),
  normalizeArabic('الرئيسيه'), normalizeArabic('الثانويه'), normalizeArabic('الابتدائيه'),
]);

// ============================================================
// خوارزمية استخراج الأسماء — محسّنة جداً
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
 * التحقق: هل هذا الاسم معروف في قاعدة البيانات؟
 */
const isKnownName = (word: string): boolean => {
  const norm = normalizeArabic(word);
  if (norm.length < 2) return false;
  if (NOT_NAME_WORDS.has(norm)) return false;
  return FIRST_NAMES.has(norm);
};

/**
 * محاولة فصل كلمة مدمجة باستخدام قاعدة الأسماء
 * يجرب كل نقطة فصل ممكنة ويرجع أفضل خيار
 * مثال: "سالمجاسم" → "سالم جاسم" (كلاهما اسم معروف)
 */
const trySplitMergedWord = (word: string): string[] => {
  const norm = normalizeArabic(word);
  if (norm.length < 4) return [word];

  // حاول فصل ثنائي
  for (let i = 2; i < norm.length - 1; i++) {
    const left = norm.substring(0, i);
    const right = norm.substring(i);

    if (isKnownName(left) && isKnownName(right)) {
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

        if (isKnownName(a) && isKnownName(b) && isKnownName(c)) {
          return [a, b, c];
        }
      }
    }
  }

  // حاول فصل رباعي
  if (norm.length >= 10) {
    for (let i = 2; i < norm.length - 6; i++) {
      for (let j = i + 2; j < norm.length - 4; j++) {
        for (let k = j + 2; k < norm.length - 1; k++) {
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
  for (let i = 0; i < ALL_COMPOUND_NAMES.length; i++) {
    if (normalizedText.includes(ALL_COMPOUND_NAMES[i])) {
      found.push(ALL_COMPOUND_NAMES[i]);
    }
  }
  return found;
};

/**
 * التحقق: هل الكلمة اسم عربي صالح؟ (ليس في قائمة الاستثناءات)
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
  if (compounds.length > 0) {
    for (const compound of compounds) {
      for (const candidate of candidates) {
        const candNorm = normalizeArabic(candidate.text);
        if (candNorm.includes(compound)) {
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
