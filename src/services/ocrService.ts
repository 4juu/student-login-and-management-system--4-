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

// ============================================================
// 🖼️ معالجة الصورة — مستويات متعددة
// ============================================================

/**
 * تحميل الصورة من File إلى HTMLImageElement
 */
const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsDataURL(file);
  });

/**
 * تكبير الصورة إذا كانت صغيرة
 */
const upscaleIfNeeded = (
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  minWidth = 1800
) => {
  let scale = 1;
  if (img.width < minWidth) {
    scale = minWidth / img.width;
  }
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
};

/**
 * 🟢 خفيفة — grayscale + تباين بسيط (للصور النظيفة)
 */
const preprocessLight = async (file: File): Promise<Blob> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;

  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }
  const mean = sum / (d.length / 4);

  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const factor = 1.2;
    let adj = ((gray - mean) * factor) + mean;
    adj = Math.max(0, Math.min(255, adj));
    d[i] = d[i + 1] = d[i + 2] = adj;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * 🟡 متوسطة — grayscale + تباين ذكي + حدة (للصور العادية)
 */
const preprocessMedium = async (file: File): Promise<Blob> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  let sum = 0, sumSq = 0;
  for (let i = 0; i < gray.length; i++) {
    sum += gray[i];
    sumSq += gray[i] * gray[i];
  }
  const mean = sum / gray.length;
  const std = Math.sqrt(sumSq / gray.length - mean * mean) || 1;

  const low = Math.max(0, mean - 2 * std);
  const high = Math.min(255, mean + 2 * std);
  const range = high - low || 1;

  for (let i = 0; i < gray.length; i++) {
    let adj = ((gray[i] - low) / range) * 255;
    adj = Math.max(0, Math.min(255, adj));
    gray[i] = adj;
  }

  const sharpened = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const center = gray[idx] * 5;
      const neighbors = gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1] + gray[y * w + x + 1];
      sharpened[idx] = Math.max(0, Math.min(255, center - neighbors));
    }
  }
  sharpened[0] = gray[0];

  for (let i = 0; i < sharpened.length; i++) {
    const px = i * 4;
    d[px] = d[px + 1] = d[px + 2] = sharpened[i];
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * 🔴 قوية — percentile stretching + حدة أقوى (للصور السيئة/الإضاءة الضعيفة)
 */
const preprocessStrong = async (file: File): Promise<Blob> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const sorted = Array.from(gray).sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const range = p95 - p5 || 1;

  for (let i = 0; i < gray.length; i++) {
    let adj = ((gray[i] - p5) / range) * 255;
    adj = Math.max(0, Math.min(255, adj));
    gray[i] = adj;
  }

  const sharpened = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const center = gray[idx] * 6;
      const neighbors = gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1] + gray[y * w + x + 1];
      sharpened[idx] = Math.max(0, Math.min(255, center - neighbors * 1.5));
    }
  }
  sharpened[0] = gray[0];

  for (let i = 0; i < sharpened.length; i++) {
    const px = i * 4;
    d[px] = d[px + 1] = d[px + 2] = sharpened[i];
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * تحويل Canvas إلى Blob
 */
const blobFromCanvas = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('فشل تحويل الصورة'));
    }, 'image/jpeg', 0.95);
  });

/**
 * تحسين الصورة للاستخراج QR (تباين عالي + تكبير)
 */
export const preprocessForQR = async (file: File): Promise<Blob> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas, 2000);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;

  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let adj = gray > 140 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = adj;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

// ============================================================
// 🔧 إصلاح أخطاء OCR الشائعة في العربي
// ============================================================

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

const cleanExtractedName = (text: string): string => {
  return text
    .split(/[:|]/)[0]
    .replace(/\d+/g, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const isValidName = (name: string): boolean => {
  if (!name) return false;
  const words = name.split(/\s+/).filter(w => w.length >= 2);
  return words.length >= 2 && words.every(w => /^[\u0600-\u06FF]+$/.test(w));
};

const mergeArabicCompoundNames = (name: string): string => {
  if (!name) return name;

  const compoundSecondParts = new Set([
    'الله', 'الرحمن', 'الرحيم', 'الكريم', 'الامير', 'الحسين', 'الحسن',
    'العزيز', 'الواحد', 'الجبار', 'الرزاق', 'الستار', 'السلام', 'القادر',
    'اللطيف', 'المجيد', 'المحسن', 'الهادي', 'الباقي', 'الخالق', 'الصمد',
    'العظيم', 'الغفور', 'الغني', 'الفتاح', 'المنعم', 'الوهاب',
    'الهدى', 'الهدي', 'الدين', 'الاسلام',
    'العابدين', 'العالي',
  ]);

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

    if (next && next.startsWith('ال') && compoundFirstParts.has(current)) {
      result.push(current + ' ' + next);
      i += 2;
      continue;
    }

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
 * 🎯 استخراج الاسم من نص OCR
 */
export const extractArabicName = (rawText: string): string | null => {
  if (!rawText) return null;

  const fixedText = fixCommonOCRErrors(rawText);
  const lines = fixedText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

  console.log('📋 أسطر OCR:', lines);

  // الاستراتيجية 1: البحث عن "الاسم" + ما بعدها
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

  // الاستراتيجية 2: السطر اللي بعد سطر يحوي "الاسم"
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

  // الاستراتيجية 3: البحث في كل سطر عن اسم محتمل
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

  const processed = mergeArabicCompoundNames(best.text);

  console.log('✅ أفضل مرشح:', best.text);
  console.log('✅ بعد دمج الأسماء المركبة:', processed);
  return processed;
};

// ============================================================
// 🎯 الدالة الرئيسية: استخراج كل البيانات (multi-pass)
// ============================================================

/**
 * تجربة OCR على صورة معينة مع إعدادات معينة
 */
const tryOCR = async (
  worker: Tesseract.Worker,
  image: Blob,
  psm: string,
  label: string
): Promise<string> => {
  await worker.setParameters({
    tessedit_pageseg_mode: psm as any,
    preserve_interword_spaces: '1',
  });
  const result = await worker.recognize(image);
  const text = result.data.text;
  console.log(`📋 OCR (${label}, PSM ${psm}):`, text.substring(0, 200));
  return text;
};

export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void
): Promise<IDExtractionResult> => {
  try {
    onProgress?.('🔍 جاري تحليل الصورة...', 5);

    // ── QR: محاولات متعددة ──
    onProgress?.('🔳 جاري قراءة رمز QR...', 10);
    const qrPromise = extractQRFromImageFile(imageFile).catch(() => null);

    // ── OCR: معالجة متعددة المحاولات ──
    onProgress?.('✨ جاري تحسين جودة الصورة...', 20);
    const [lightBlob, mediumBlob, strongBlob] = await Promise.all([
      preprocessLight(imageFile),
      preprocessMedium(imageFile),
      preprocessStrong(imageFile),
    ]);

    onProgress?.('📖 جاري قراءة النص العربي...', 40);
    const worker = await getWorker();

    // تجربة على الصور المحسّنة مع PSM 3 (أوتوماتيكي) أولاً
    const attempts: { text: string; label: string }[] = [];

    const texts = await Promise.all([
      tryOCR(worker, mediumBlob, '3', 'متوسطة+PSM3'),
      tryOCR(worker, lightBlob, '3', 'خفيفة+PSM3'),
      tryOCR(worker, strongBlob, '3', 'قوية+PSM3'),
      tryOCR(worker, mediumBlob, '6', 'متوسطة+PSM6'),
    ]);

    attempts.push(
      { text: texts[0], label: 'متوسطة+PSM3' },
      { text: texts[1], label: 'خفيفة+PSM3' },
      { text: texts[2], label: 'قوية+PSM3' },
      { text: texts[3], label: 'متوسطة+PSM6' },
    );

    // اختيار أفضل نتيجة: الأكثر طولاً الذي يحتوي على كلمات عربية
    let bestText = '';
    let bestName: string | null = null;

    for (const attempt of attempts) {
      const name = extractArabicName(attempt.text);
      if (name && name.length > (bestName?.length || 0)) {
        bestName = name;
        bestText = attempt.text;
        console.log(`🎯 أفضل نتيجة من ${attempt.label}:`, name);
      }
    }

    // إذا لم نجد اسماً، جرّب النص الأطول
    if (!bestName) {
      bestText = attempts.sort((a, b) => b.text.length - a.text.length)[0].text;
      bestName = extractArabicName(bestText);
    }

    console.log('📜 أفضل نص OCR:', bestText.substring(0, 300));
    console.log('🎯 الاسم المستخرج:', bestName);

    onProgress?.('🔳 جاري معالجة رمز QR...', 85);
    const qrText = await qrPromise;

    if (!qrText) {
      return {
        success: false,
        name: bestName || undefined,
        rawText: bestText,
        error: 'لم يتم العثور على رمز QR في الصورة. تأكد من وضوح صورة الهوية.',
      };
    }

    const qrInfo = analyzeQR(qrText);

    if (!qrInfo.id) {
      return {
        success: false,
        name: bestName || undefined,
        qrUrl: qrText,
        rawText: bestText,
        error: 'رمز QR غير صالح. تأكد من أن الصورة لهوية وزارة التعليم الرسمية.',
      };
    }

    if (!bestName) {
      return {
        success: false,
        qrUrl: qrText,
        qrId: qrInfo.id,
        rawText: bestText,
        error: 'لم نتمكن من قراءة الاسم من الهوية. حاول رفع صورة أوضح.',
      };
    }

    onProgress?.('✅ تم بنجاح!', 100);

    return {
      success: true,
      name: bestName,
      qrUrl: qrText,
      qrId: qrInfo.id,
      rawText: bestText,
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
