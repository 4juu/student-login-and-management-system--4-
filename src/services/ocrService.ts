// src/services/ocrService.ts
import Tesseract from 'tesseract.js';
import { extractQRFromImageFile, analyzeQR } from './qrExtractor';
import { IDExtractionResult } from '../types/registration';

// ============================================================
// 📷 استخراج البيانات من صورة الهوية - نسخة محسّنة
// ============================================================

let ocrWorker: Tesseract.Worker | null = null;
let workerLoading: Promise<Tesseract.Worker> | null = null;

const getWorker = async (): Promise<Tesseract.Worker> => {
  if (ocrWorker) return ocrWorker;
  if (workerLoading) return workerLoading;

  workerLoading = (async () => {
    console.log('📦 تحميل OCR Worker...');
    const worker = await Tesseract.createWorker(['ara', 'eng'], 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`📖 OCR: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '6' as any,
      preserve_interword_spaces: '1',
    });

    ocrWorker = worker;
    workerLoading = null;
    console.log('✅ OCR جاهز');
    return worker;
  })();

  return workerLoading;
};

export const terminateOCR = async (): Promise<void> => {
  if (ocrWorker) {
    try {
      await ocrWorker.terminate();
    } catch {}
    ocrWorker = null;
  }
};

/**
 * 🖼️ تحسين الصورة قبل OCR
 */
const preprocessImage = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('فشل إنشاء canvas'));
          return;
        }

        const minWidth = 2000;
        let scale = 1;
        if (img.width < minWidth) {
          scale = minWidth / img.width;
        }

        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const contrast = 1.5;
          let adjusted = ((gray - 128) * contrast) + 128;

          if (adjusted > 180) adjusted = 255;
          else if (adjusted < 80) adjusted = 0;

          const final = Math.max(0, Math.min(255, adjusted));
          data[i] = final;
          data[i + 1] = final;
          data[i + 2] = final;
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('فشل تحويل الصورة'));
        }, 'image/jpeg', 0.98);
      };

      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsDataURL(file);
  });
};

/**
 * 🔧 إصلاح أخطاء OCR الشائعة في العربي
 */
const fixCommonOCRErrors = (text: string): string => {
  return text
    .replace(/ا\s+ل([\u0600-\u06FF])/g, 'ال$1')
    .replace(/(\S)\s+ل([\u0600-\u06FF])/g, (_, before, after) => {
      return `${before} ال${after}`;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
};

/**
 * 🧹 تنظيف الاسم المستخرج
 */
const cleanExtractedName = (text: string): string => {
  return text
    .split(/[:|]/)[0]
    .replace(/\d+/g, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * ✅ التحقق من أن الاسم منطقي
 */
const isValidName = (name: string): boolean => {
  if (!name) return false;
  // ✅ السماح بكلمات من حرفين (مثل "نور")
  const words = name.split(/\s+/).filter(w => w.length >= 2);
  return words.length >= 2 && words.every(w => /^[\u0600-\u06FF]+$/.test(w));
};

/**
 * 🔗 دمج الأسماء المركبة
 *
 * أمثلة:
 * "عبد الله احمد محمد"  → "عبد الله احمد محمد"
 * "صلاح الدين خالد"     → "صلاح الدين خالد"
 * "نور الهدى مؤيد سالم" → "نور الهدى مؤيد سالم"
 */
const mergeArabicCompoundNames = (name: string): string => {
  if (!name) return name;

  // الجزء الثاني من الأسماء المركبة المعروفة
  const compoundSecondParts = new Set([
    'الله', 'الرحمن', 'الرحيم', 'الكريم', 'الامير', 'الحسين', 'الحسن',
    'العزيز', 'الواحد', 'الجبار', 'الرزاق', 'الستار', 'السلام', 'القادر',
    'اللطيف', 'المجيد', 'المحسن', 'الهادي', 'الباقي', 'الخالق', 'الصمد',
    'العظيم', 'الغفور', 'الغني', 'الفتاح', 'المنعم', 'الوهاب',
    'الهدى', 'الهدي', 'الدين', 'الاسلام',
    'العابدين', 'العالي',
  ]);

  // الجزء الأول من الأسماء المركبة المعروفة
  const compoundFirstParts = new Set([
    'عبد', 'ابو', 'ام', 'زين', 'صلاح', 'علاء', 'عماد', 'سيف', 'حسام',
    'بهاء', 'شمس', 'محي', 'تاج', 'فخر', 'شرف', 'جمال', 'كمال', 'بدر',
    'ضياء', 'ركن', 'عز', 'معين', 'ناصر', 'قمر', 'نور', 'ضوء', 'سراج',
  ]);

  const words = name.split(/\s+/).filter(Boolean);
  const result: string[] = [];

  let i = 0;
  while (i < words.length) {
    const current = words[i];
    const next = words[i + 1];

    // الجزء الأول معروف + التالي يبدأ بـ "ال"
    if (next && next.startsWith('ال') && compoundFirstParts.has(current)) {
      result.push(current + ' ' + next);
      i += 2;
      continue;
    }

    // التالي موجود في قائمة الأجزاء الثانية المعروفة
    if (next && compoundSecondParts.has(next)) {
      result.push(current + ' ' + next);
      i += 2;
      continue;
    }

    result.push(current);
    i++;
  }

  return result.join(' ');
};

/**
 * 🎯 استخراج الاسم من نص OCR - نسخة محسّنة
 */
export const extractArabicName = (rawText: string): string | null => {
  if (!rawText) return null;

  const fixedText = fixCommonOCRErrors(rawText);
  const lines = fixedText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  console.log('📋 أسطر OCR:', lines);

  // ============================================================
  // الاستراتيجية 1: البحث عن "الاسم" + ما بعدها
  // ============================================================
  const arabicNamePatterns = [
    /الاسم\s*[:\-]?\s*(.+)/,
    /الأسم\s*[:\-]?\s*(.+)/,
    /الإسم\s*[:\-]?\s*(.+)/,
    /اسم\s+الطالب\s*[:\-]?\s*(.+)/,
  ];

  for (const line of lines) {
    for (const pattern of arabicNamePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const cleaned = cleanExtractedName(match[1]);
        if (isValidName(cleaned)) {
          console.log('✅ وجدنا الاسم من نمط "الاسم":', cleaned);
          return cleaned;
        }
      }
    }
  }

  // ============================================================
  // الاستراتيجية 2: السطر اللي بعد سطر يحوي "الاسم"
  // ============================================================
  for (let i = 0; i < lines.length; i++) {
    if (/^(الاسم|الأسم|الإسم|اسم)\s*[:\-]?\s*$/.test(lines[i])) {
      if (i + 1 < lines.length) {
        const cleaned = cleanExtractedName(lines[i + 1]);
        if (isValidName(cleaned)) {
          console.log('✅ وجدنا الاسم من السطر التالي لـ "الاسم":', cleaned);
          return cleaned;
        }
      }
    }
  }

  // ============================================================
  // الاستراتيجية 3: البحث في كل سطر عن اسم محتمل
  // ============================================================
  const ignoreWords = new Set([
    'الاسم', 'اسم', 'الأسم', 'الإسم',
    'الطالب', 'الطالبة',
    'الكلية', 'القسم', 'المرحلة', 'الفرع', 'الجامعة',
    'وزارة', 'التعليم', 'العالي', 'البحث', 'العلمي',
    'الجمهورية', 'العراقية', 'العراق', 'جمهورية',
    'هوية', 'الهوية', 'بطاقة', 'البطاقة',
    'تاريخ', 'الميلاد', 'المولد', 'التولد', 'تولد',
    'صادرة', 'الرقم', 'الامتحاني', 'الجامعي',
    'العام', 'الدراسي', 'الفصل', 'سنة',
    'مديرية', 'دائرة', 'الوطنية',
    'بغداد', 'البصرة', 'الموصل', 'النجف', 'كربلاء', 'اربيل',
    'هندسة', 'طب', 'صيدلة', 'الصيدلة', 'علوم', 'آداب', 'لغات', 'تربية',
    'حاسوب', 'معلومات', 'كهرباء', 'ميكانيك', 'مدنية',
    'صباحي', 'مسائي', 'دراسات', 'ذكر', 'انثى', 'انثي',
    'ايقاف', 'ايقافه', 'تخرج', 'مستمر',
    'الاولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة',
    'المرحله', 'النفاذ', 'الانتهاء',
  ]);

  // ✅ السماح بأسماء من 2 أحرف (مثل "نور")
  const isArabicWord = (w: string) => /^[\u0600-\u06FF]+$/.test(w) && w.length >= 2;
  const isLikelyNamePart = (w: string) => isArabicWord(w) && !ignoreWords.has(w);

  const candidates: { text: string; lineIndex: number; wordCount: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const words = line.split(/\s+/);

    let current: string[] = [];

    for (const word of words) {
      if (isLikelyNamePart(word)) {
        current.push(word);
      } else {
        if (current.length >= 2) {
          candidates.push({
            text: current.join(' '),
            lineIndex: i,
            wordCount: current.length,
          });
        }
        current = [];
      }
    }

    if (current.length >= 2) {
      candidates.push({
        text: current.join(' '),
        lineIndex: i,
        wordCount: current.length,
      });
    }
  }

  console.log('🔍 المرشحون للاسم:', candidates);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.wordCount !== b.wordCount) return b.wordCount - a.wordCount;
    return b.text.length - a.text.length;
  });

  const best = candidates[0];
  if (best.wordCount < 2) return null;

  // ✅ دمج الأسماء المركبة (عبد الله، نور الهدى، صلاح الدين...)
  const processed = mergeArabicCompoundNames(best.text);

  console.log('✅ أفضل مرشح:', best.text);
  console.log('✅ بعد دمج الأسماء المركبة:', processed);
  return processed;
};

/**
 * 🎯 الدالة الرئيسية: استخراج كل البيانات
 */
export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void
): Promise<IDExtractionResult> => {
  try {
    onProgress?.('🔍 جاري تحليل الصورة...', 5);

    onProgress?.('📷 جاري قراءة رمز QR...', 15);
    const qrPromise = extractQRFromImageFile(imageFile).catch(() => null);

    onProgress?.('✨ جاري تحسين جودة الصورة...', 25);
    const enhanced = await preprocessImage(imageFile);

    onProgress?.('📖 جاري قراءة النص العربي...', 40);
    const worker = await getWorker();

    const ocrResult = await worker.recognize(enhanced);
    const rawText = ocrResult.data.text;

    console.log('📜 النص الخام من OCR:\n', rawText);

    onProgress?.('🔤 جاري استخراج الاسم...', 75);
    const extractedName = extractArabicName(rawText);

    console.log('🎯 الاسم المستخرج:', extractedName);

    onProgress?.('🔳 جاري معالجة رمز QR...', 90);
    const qrText = await qrPromise;

    if (!qrText) {
      return {
        success: false,
        name: extractedName || undefined,
        rawText,
        error: 'لم يتم العثور على رمز QR في الصورة. تأكد من وضوح صورة الهوية.',
      };
    }

    const qrInfo = analyzeQR(qrText);

    if (!qrInfo.id) {
      return {
        success: false,
        name: extractedName || undefined,
        qrUrl: qrText,
        rawText,
        error: 'رمز QR غير صالح. تأكد من أن الصورة لهوية وزارة التعليم الرسمية.',
      };
    }

    if (!extractedName) {
      return {
        success: false,
        qrUrl: qrText,
        qrId: qrInfo.id,
        rawText,
        error: 'لم نتمكن من قراءة الاسم من الهوية. حاول رفع صورة أوضح.',
      };
    }

    onProgress?.('✅ تم بنجاح!', 100);

    return {
      success: true,
      name: extractedName,
      qrUrl: qrText,
      qrId: qrInfo.id,
      rawText,
    };

  } catch (error: any) {
    console.error('❌ فشل استخراج بيانات الهوية:', error);
    return {
      success: false,
      error: error.message || 'حدث خطأ أثناء قراءة الهوية',
    };
  }
};

export const clearImageData = (imageUrl?: string): void => {
  if (imageUrl && imageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(imageUrl);
  }
};