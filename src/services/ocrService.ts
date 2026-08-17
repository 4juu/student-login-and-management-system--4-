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
// 🖼️ تحميل الصورة وفحص الجودة
// ============================================================

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('فشل تحميل الصورة'));
    };
    img.src = url;
  });

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

// ============================================================
// 🔄 تدوير الصورة
// ============================================================

/**
 * تدوير HTMLImageElement بزاوية معينة وإرجاع Blob
 */
const rotateImageToBlob = (
  img: HTMLImageElement,
  degrees: number
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));

  canvas.width = Math.round(img.width * cos + img.height * sin);
  canvas.height = Math.round(img.width * sin + img.height * cos);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  return blobFromCanvas(canvas);
};

// ============================================================
// 🔍 كشف جودة الصورة
// ============================================================

const detectBlur = (img: HTMLImageElement): number => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const maxDim = 400;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  let sum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const center = gray[y * w + x] * 4;
      const neighbors =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + x - 1] +
        gray[y * w + x + 1];
      const laplacian = center - neighbors;
      sum += laplacian * laplacian;
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
};

const detectBrightness = (
  img: HTMLImageElement
): { mean: number; isDark: boolean; isBright: boolean } => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const maxDim = 200;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }
  const mean = sum / (d.length / 4);

  return { mean, isDark: mean < 40, isBright: mean > 230 };
};

// ============================================================
// 🖼️ معالجة الصورة — مستويات متعددة
// ============================================================

const blobFromCanvas = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('فشل تحويل الصورة'));
    }, 'image/jpeg', 0.95);
  });

const preprocessLight = (img: HTMLImageElement): Promise<Blob> => {
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
    let adj = (gray - mean) * 1.2 + mean;
    adj = Math.max(0, Math.min(255, adj));
    d[i] = d[i + 1] = d[i + 2] = adj;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

const preprocessMedium = (img: HTMLImageElement): Promise<Blob> => {
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

  let sum = 0,
    sumSq = 0;
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
      const neighbors =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + x - 1] +
        gray[y * w + x + 1];
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

const preprocessStrong = (img: HTMLImageElement): Promise<Blob> => {
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
      const neighbors =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + x - 1] +
        gray[y * w + x + 1];
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
    d[i] = d[i + 1] = d[i + 2] = gray > 140 ? 255 : 0;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

// ============================================================
// 🔧 إصلاح أخطاء OCR الشائعة
// ============================================================

const fixCommonOCRErrors = (text: string): string => {
  return text
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
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
    .replace(/[\d٠-٩]+/g, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const isValidName = (name: string): boolean => {
  if (!name) return false;
  const words = name.split(/\s+/).filter((w) => w.length >= 2);
  return (
    words.length >= 2 &&
    words.length <= 8 &&
    words.every((w) => /^[\u0600-\u06FF]+$/.test(w))
  );
};

/**
 * 🎯 استخراج الاسم من نص OCR
 */
export const extractArabicName = (rawText: string): string | null => {
  if (!rawText) return null;

  const fixedText = fixCommonOCRErrors(rawText);
  const lines = fixedText
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  console.log('📋 أسطر OCR:', lines);

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

  for (let i = 0; i < lines.length; i++) {
    if (/^(الاسم|الأسم|الإسم|اسم)\s*[:\-]?\s*$/.test(lines[i])) {
      if (i + 1 < lines.length) {
        const cleaned = cleanExtractedName(lines[i + 1]);
        if (isValidName(cleaned)) {
          console.log(
            '✅ وجدنا الاسم من السطر التالي لـ "الاسم":',
            cleaned
          );
          return cleaned;
        }
      }
    }
  }

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
    'صباحي', 'مسائي', 'دراسات', 'ذكر', 'انثى', 'انثي', 'أنثى',
    'ايقاف', 'ايقافه', 'تخرج', 'مستمر',
    'الاولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة',
    'المرحله', 'النفاذ', 'الانتهاء',
    'المهنة', 'العنوان', 'الديانة', 'الجنس',
  ]);

  const isArabicWord = (w: string) =>
    /^[\u0600-\u06FF]+$/.test(w) && w.length >= 2;
  const isLikelyNamePart = (w: string) =>
    isArabicWord(w) && !ignoreWords.has(w);

  const candidates: {
    text: string;
    lineIndex: number;
    wordCount: number;
  }[] = [];

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

  console.log('✅ أفضل مرشح:', best.text);
  return best.text;
};

// ============================================================
// 🎯 OCR مع تدوير متعدد الزوايا
// ============================================================

interface OCRAttempt {
  text: string;
  confidence: number;
  label: string;
}

const tryOCR = async (
  worker: Tesseract.Worker,
  image: Blob,
  psm: string,
  label: string
): Promise<OCRAttempt> => {
  await worker.setParameters({
    tessedit_pageseg_mode: psm as any,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const result = await worker.recognize(image);
  const text = result.data.text;
  const confidence = result.data.confidence;
  console.log(
    `📋 OCR (${label}, PSM ${psm}, ثقة: ${confidence.toFixed(1)}%):`,
    text.substring(0, 200)
  );
  return { text, confidence, label };
};

/**
 * تجربة OCR مع تدوير الصورة بزاوية معينة
 */
const tryOCRWithRotation = async (
  worker: Tesseract.Worker,
  img: HTMLImageElement,
  degrees: number,
  label: string
): Promise<OCRAttempt> => {
  const blob =
    degrees === 0
      ? await preprocessMedium(img)
      : await rotateImageToBlob(img, degrees);
  const processed = degrees === 0 ? blob : await preprocessMediumFromBlob(blob);
  return tryOCR(worker, processed, '3', label);
};

/**
 * معالجة متوسطة من Blob (للتداول)
 */
const preprocessMediumFromBlob = (blob: Blob): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      preprocessMedium(img).then(resolve, reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('فشل تحميل الصورة'));
    };
    img.src = url;
  });

// ============================================================
// 🎯 الدالة الرئيسية
// ============================================================

export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void
): Promise<IDExtractionResult> => {
  try {
    onProgress?.('', 5);

    const img = await loadImageFromFile(imageFile);

    // ── فحص جودة الصورة ──
    const blurScore = detectBlur(img);
    const brightness = detectBrightness(img);
    console.log(
      `🔍 درجة التشويش: ${blurScore.toFixed(1)} (أعلى = أوضح)`
    );
    console.log(
      `☀️ السطوع: ${brightness.mean.toFixed(1)} (داكن: ${brightness.isDark}, مشع: ${brightness.isBright})`
    );

    if (blurScore < 50) {
      onProgress?.('⚠️ الصورة مشوشة جداً', 100);
      return {
        success: false,
        error: 'الصورة مشوشة جداً. أعد التصوير بشكل أوضح.',
      };
    }

    if (brightness.isDark) {
      onProgress?.('⚠️ الصورة مظلمة جداً', 100);
      return {
        success: false,
        error: 'الصورة مظلمة جداً. ضع الهوية بإضاءة واضحة.',
      };
    }

    // ── QR ──
    onProgress?.('', 15);
    const qrPromise = extractQRFromImageFile(imageFile).catch(() => null);

    // ── المرحلة 1: تدوير متعدد الزوايا (للصور المائلة) ──
    onProgress?.('', 25);
    const worker = await getWorker();

    const ROTATION_ANGLES = [0, 90, 180, 270, 5, -5, 10, -10];
    const rotationAttempts: OCRAttempt[] = [];

    console.log(`🔄 تجربة ${ROTATION_ANGLES.length} زوايا تدوير...`);

    // تجربة كل زاوية بالتوازي
    const rotationPromises = ROTATION_ANGLES.map((angle) =>
      tryOCRWithRotation(worker, img, angle, `rotation-${angle}°`)
    );
    const rotationResults = await Promise.all(rotationPromises);
    rotationAttempts.push(...rotationResults);

    // اختيار أفضل نتيجة من التدوير
    let bestRotationName: string | null = null;
    let bestRotationScore = 0;

    for (const attempt of rotationAttempts) {
      const name = extractArabicName(attempt.text);
      if (name) {
        const score =
          attempt.confidence * Math.min(name.length / 10, 1);
        if (score > bestRotationScore) {
          bestRotationScore = score;
          bestRotationName = name;
          console.log(
            `🎯 أفضل نتيجة تدوير من ${attempt.label} (نقطة: ${score.toFixed(1)}):`,
            name
          );
        }
      }
    }

    // إذا وجدنا اسماً بعد التدوير، نكمل مع معالجات إضافية
    if (bestRotationName && bestRotationScore > 50) {
      console.log('✅ وجدنا اسم من التدوير، نكمل المعالجة...');
    }

    // ── المرحلة 2: معالجات إضافية على الصورة الأصلية ──
    onProgress?.('', 50);
    const [lightBlob, mediumBlob, strongBlob] = await Promise.all([
      preprocessLight(img),
      preprocessMedium(img),
      preprocessStrong(img),
    ]);

    const extraAttempts: OCRAttempt[] = [];

    const e1 = await tryOCR(worker, mediumBlob, '6', 'متوسطة+PSM6');
    extraAttempts.push(e1);

    const e2 = await tryOCR(worker, mediumBlob, '4', 'متوسطة+PSM4');
    extraAttempts.push(e2);

    const e3 = await tryOCR(worker, mediumBlob, '11', 'متوسطة+PSM11');
    extraAttempts.push(e3);

    const e4 = await tryOCR(worker, lightBlob, '3', 'خفيفة+PSM3');
    extraAttempts.push(e4);

    const e5 = await tryOCR(worker, strongBlob, '3', 'قوية+PSM3');
    extraAttempts.push(e5);

    const e6 = await tryOCR(worker, strongBlob, '6', 'قوية+PSM6');
    extraAttempts.push(e6);

    // ── الجمع والتقييم ──
    const allAttempts = [...rotationAttempts, ...extraAttempts];

    let bestText = '';
    let bestName: string | null = null;
    let bestScore = 0;

    for (const attempt of allAttempts) {
      const name = extractArabicName(attempt.text);
      if (name) {
        const score =
          attempt.confidence * Math.min(name.length / 10, 1);
        if (score > bestScore) {
          bestScore = score;
          bestName = name;
          bestText = attempt.text;
          console.log(
            `🎯 أفضل نتيجة من ${attempt.label} (نقطة: ${score.toFixed(1)}):`,
            name
          );
        }
      }
    }

    // إذا لم نجد اسماً، جرّب النص الأطول
    if (!bestName) {
      bestText =
        allAttempts.sort((a, b) => b.text.length - a.text.length)[0]
          ?.text || '';
      bestName = extractArabicName(bestText);
    }

    console.log('📜 أفضل نص OCR:', bestText.substring(0, 300));
    console.log('🎯 الاسم المستخرج:', bestName);

    onProgress?.('', 85);
    const qrText = await qrPromise;

    if (!qrText) {
      return {
        success: false,
        name: bestName || undefined,
        rawText: bestText,
        error:
          'لم يتم العثور على رمز QR في الصورة. تأكد من وضوح صورة الهوية.',
      };
    }

    const qrInfo = analyzeQR(qrText);

    if (!qrInfo.id) {
      return {
        success: false,
        name: bestName || undefined,
        qrUrl: qrText,
        rawText: bestText,
        error:
          'رمز QR غير صالح. تأكد من أن الصورة لهوية وزارة التعليم الرسمية.',
      };
    }

    if (!bestName) {
      return {
        success: false,
        qrUrl: qrText,
        qrId: qrInfo.id,
        rawText: bestText,
        error:
          'لم نتمكن من قراءة الاسم من الهوية. حاول رفع صورة أوضح.',
      };
    }

    onProgress?.('', 100);

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
