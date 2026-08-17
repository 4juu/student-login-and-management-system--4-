// src/services/ocrService.ts
import Tesseract from 'tesseract.js';
import { extractQRFromImageFile, analyzeQR } from './qrExtractor';
import { IDExtractionResult } from '../types/registration';
import { extractNameFromOCR } from './arabicNames';

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
 * معالجة ثنائية — تباين عالي + عكس (مستوحاة من arabic-ocr)
 * تحوّل الصورة إلى أسود/أبيض فقط ثم تعكسها
 */
const preprocessBinary = (img: HTMLImageElement): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas, 2000);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const sorted = Array.from(gray).sort((a, b) => a - b);
  const p30 = sorted[Math.floor(sorted.length * 0.3)];
  const p85 = sorted[Math.floor(sorted.length * 0.85)];
  const threshold = (p30 + p85) / 2;

  for (let i = 0; i < gray.length; i++) {
    const px = i * 4;
    const v = gray[i] < threshold ? 0 : 255;
    d[px] = d[px + 1] = d[px + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * معالجة ثنائية + تكبير + تمويه خفيف (لتحسين فصل النص)
 */
const preprocessBinaryDilated = (img: HTMLImageElement): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas, 2000);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const sorted = Array.from(gray).sort((a, b) => a - b);
  const p30 = sorted[Math.floor(sorted.length * 0.3)];
  const p85 = sorted[Math.floor(sorted.length * 0.85)];
  const threshold = (p30 + p85) / 2;

  const binary = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] < threshold ? 1 : 0;
  }

  const dilated = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (binary[idx] === 1 || binary[idx - 1] === 1 || binary[idx + 1] === 1 ||
          binary[(y - 1) * w + x] === 1 || binary[(y + 1) * w + x] === 1) {
        dilated[idx] = 1;
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    const px = i * 4;
    const v = dilated[i] === 1 ? 0 : 255;
    d[px] = d[px + 1] = d[px + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * إضافة إطار أبيض حول الصورة (Tesseract docs: يحسن OCR للنصوص المحصورة)
 */
const addWhiteBorder = (img: HTMLImageElement, borderPx = 20): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.width + borderPx * 2;
  canvas.height = img.height + borderPx * 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, borderPx, borderPx);
  return blobFromCanvas(canvas);
};

/**
 * معالجة تكيفية (Sauvola-inspired) — أفضل من العتبة الثابتة للإضاءة غير المتجانسة
 * مستوحاة من Tesseract 5 Adaptive Otsu / Sauvola binarization
 */
const preprocessAdaptive = (img: HTMLImageElement): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  upscaleIfNeeded(img, ctx, canvas, 2000);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  const blockSize = 31;
  const k = 0.15;
  const R = 128;
  const integral = new Float64Array((w + 1) * (h + 1));
  const integralSq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rowSum += v;
      rowSumSq += v * v;
      integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)];
      integralSq[(y + 1) * (w + 1) + (x + 1)] = rowSumSq + integralSq[y * (w + 1) + (x + 1)];
    }
  }

  const half = Math.floor(blockSize / 2);
  for (let i = 0; i < gray.length; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const x1 = Math.max(0, x - half);
    const y1 = Math.max(0, y - half);
    const x2 = Math.min(w - 1, x + half);
    const y2 = Math.min(h - 1, y + half);
    const count = (x2 - x1 + 1) * (y2 - y1 + 1);

    const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)]
      - integral[y1 * (w + 1) + (x2 + 1)]
      - integral[(y2 + 1) * (w + 1) + x1]
      + integral[y1 * (w + 1) + x1];
    const sumSq = integralSq[(y2 + 1) * (w + 1) + (x2 + 1)]
      - integralSq[y1 * (w + 1) + (x2 + 1)]
      - integralSq[(y2 + 1) * (w + 1) + x1]
      + integralSq[y1 * (w + 1) + x1];

    const mean = sum / count;
    const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    const threshold = mean * (1 + k * (std / R - 1));

    const px = i * 4;
    const v = gray[i] > threshold ? 255 : 0;
    d[px] = d[px + 1] = d[px + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return blobFromCanvas(canvas);
};

/**
 * تصحيح ميل الصورة باستخدام minAreaRect (مستوحى من arabic-ocr deskew)
 */
const deskewImage = (img: HTMLImageElement): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const w = img.width;
  const h = img.height;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < d.length; i += 4) {
    gray[i / 4] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;
  const threshold = mean * 0.8;

  const foregroundX: number[] = [];
  const foregroundY: number[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (gray[y * w + x] < threshold) {
        foregroundX.push(x);
        foregroundY.push(y);
      }
    }
  }

  if (foregroundX.length < 50) {
    return blobFromCanvas(canvas);
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < foregroundX.length; i++) {
    if (foregroundX[i] < minX) minX = foregroundX[i];
    if (foregroundX[i] > maxX) maxX = foregroundX[i];
    if (foregroundY[i] < minY) minY = foregroundY[i];
    if (foregroundY[i] > maxY) maxY = foregroundY[i];
  }

  const size = 8;
  const gridW = Math.ceil((maxX - minX) / size) + 1;
  const gridH = Math.ceil((maxY - minY) / size) + 1;
  const grid = new Uint8Array(gridW * gridH);

  for (let i = 0; i < foregroundX.length; i++) {
    const gx = Math.floor((foregroundX[i] - minX) / size);
    const gy = Math.floor((foregroundY[i] - minY) / size);
    if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
      grid[gy * gridW + gx] = 1;
    }
  }

  let bestAngle = 0;
  let bestVariance = 0;

  for (let angle = -8; angle <= 8; angle += 0.5) {
    const rad = (angle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const projection = new Float32Array(gridW + gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy * gridW + gx] === 0) continue;
        const ry = -sinA * (gx - gridW / 2) + cosA * (gy - gridH / 2) + gridH / 2;
        const iy = Math.round(ry);
        if (iy >= 0 && iy < projection.length) {
          projection[iy]++;
        }
      }
    }

    let s = 0, s2 = 0, count = 0;
    for (let i = 0; i < projection.length; i++) {
      if (projection[i] > 0) {
        s += projection[i];
        s2 += projection[i] * projection[i];
        count++;
      }
    }
    if (count === 0) continue;
    const mean2 = s / count;
    const variance = s2 / count - mean2 * mean2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  if (Math.abs(bestAngle) < 0.3) {
    return blobFromCanvas(canvas);
  }

  console.log(`📐 تصحيح الميل: ${bestAngle}°`);

  const rad = (bestAngle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.round(w * cos + h * sin);
  const newH = Math.round(w * sin + h * cos);

  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d')!;
  outCanvas.width = newW;
  outCanvas.height = newH;

  outCtx.translate(newW / 2, newH / 2);
  outCtx.rotate(rad);
  outCtx.drawImage(img, -w / 2, -h / 2);

  return blobFromCanvas(outCanvas);
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
    textord_script_is_rtl: '1',
    textord_space_size_is_variable: '1',
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

    // ── المرحلة 1: تصحيح الميل + تدوير متعدد الزوايا ──
    onProgress?.('', 25);
    const worker = await getWorker();

    // محاولة تصحيح الميل أولاً
    let deskewedImg: HTMLImageElement | null = null;
    try {
      const deskewedBlob = await deskewImage(img);
      deskewedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(deskewedBlob);
        const im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
        im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('')); };
        im.src = url;
      });
    } catch { deskewedImg = null; }

    const ROTATION_ANGLES = [0, 90, 180, 270, 5, -5, 10, -10];
    const rotationAttempts: OCRAttempt[] = [];

    console.log(`🔄 تجربة ${ROTATION_ANGLES.length} زوايا تدوير...`);

    const sourceImg = deskewedImg || img;
    const rotationPromises = ROTATION_ANGLES.map((angle) =>
      tryOCRWithRotation(worker, sourceImg, angle, `rotation-${angle}°`)
    );
    const rotationResults = await Promise.all(rotationPromises);
    rotationAttempts.push(...rotationResults);

    // اختيار أفضل نتيجة من التدوير
    let bestRotationName: string | null = null;
    let bestRotationScore = 0;

    for (const attempt of rotationAttempts) {
      const name = extractNameFromOCR(attempt.text);
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
    const [lightBlob, mediumBlob, strongBlob, binaryBlob, binaryDilBlob, adaptiveBlob, borderedBlob] = await Promise.all([
      preprocessLight(img),
      preprocessMedium(img),
      preprocessStrong(img),
      preprocessBinary(img),
      preprocessBinaryDilated(img),
      preprocessAdaptive(img),
      addWhiteBorder(img),
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

    const e7 = await tryOCR(worker, binaryBlob, '3', 'ثنائية+PSM3');
    extraAttempts.push(e7);

    const e8 = await tryOCR(worker, binaryBlob, '4', 'ثنائية+PSM4');
    extraAttempts.push(e8);

    const e9 = await tryOCR(worker, binaryDilBlob, '3', 'ثنائيةموسطة+PSM3');
    extraAttempts.push(e9);

    // ── معالجات إضافية مستوحاة من Tesseract docs ──
    // PSM 13 (raw line) — يتجاوز تقسيم Tesseract، يعمل جيداً للصور المعالجة مسبقاً
    const e10 = await tryOCR(worker, mediumBlob, '13', 'متوسطة+PSM13');
    extraAttempts.push(e10);

    // PSM 7 (single line) — مثالي لحقول الاسم على الهوية
    const e11 = await tryOCR(worker, mediumBlob, '7', 'متوسطة+PSM7');
    extraAttempts.push(e11);

    // Adaptive thresholding — أفضل للإضاءة غير المتجانسة
    const e12 = await tryOCR(worker, adaptiveBlob, '3', 'تكيفية+PSM3');
    extraAttempts.push(e12);

    const e13 = await tryOCR(worker, adaptiveBlob, '6', 'تكيفية+PSM6');
    extraAttempts.push(e13);

    // صورة مع إطار أبيض — يحسن OCR للنصوص المحصورة (Tesseract docs)
    const e14 = await tryOCR(worker, borderedBlob, '3', 'إطار+PSM3');
    extraAttempts.push(e14);

    const e15 = await tryOCR(worker, borderedBlob, '13', 'إطار+PSM13');
    extraAttempts.push(e15);

    // ── الجمع والتقييم ──
    const allAttempts = [...rotationAttempts, ...extraAttempts];

    let bestText = '';
    let bestName: string | null = null;
    let bestScore = 0;

    for (const attempt of allAttempts) {
      const name = extractNameFromOCR(attempt.text);
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
      bestName = extractNameFromOCR(bestText);
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
