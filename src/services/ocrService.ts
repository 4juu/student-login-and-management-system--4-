import { IDExtractionResult } from '../types/registration';
import { extractQRFromImageFile, extractIdFromQRUrl } from './qrExtractor';
import { findNameInOCRText, extractNameFromOCR } from './nameMatching';

let worker: any = null;
let workerReady = false;

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('فشل تحميل الصورة')); };
    img.src = url;
  });

const upscaleIfNeeded = async (file: File, minWidth = 2000): Promise<File> => {
  const img = await loadImageFromFile(file);
  if (img.width >= minWidth) return file;

  const scale = minWidth / img.width;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise<File>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
      else resolve(file);
    }, 'image/jpeg', 0.95);
  });
};

const preprocessForOCR = async (file: File): Promise<Blob> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;

  const gray = new Float32Array(d.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  }

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;

  let variance = 0;
  for (let i = 0; i < gray.length; i++) variance += (gray[i] - mean) * (gray[i] - mean);
  const std = Math.sqrt(variance / gray.length);

  const low = Math.max(0, mean - std);
  const high = Math.min(255, mean + std);

  for (let i = 0; i < gray.length; i++) {
    const val = gray[i] < low ? 0 : gray[i] > high ? 255 : ((gray[i] - low) / (high - low)) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = val;
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('')); }, 'image/png');
  });
};

const detectBlur = async (file: File): Promise<number> => {
  try {
    const img = await loadImageFromFile(file);
    const canvas = document.createElement('canvas');
    const w = Math.min(img.width, 400);
    const h = Math.round((w / img.width) * img.height);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    let sum = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const laplacian = -4 * gray[y * w + x] + gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1];
        sum += laplacian * laplacian;
        count++;
      }
    }
    return count > 0 ? sum / count : 500;
  } catch {
    return 500;
  }
};

async function initWorker(): Promise<void> {
  if (workerReady && worker) return;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('ara+eng', 1, {
      logger: () => {},
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '3',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    workerReady = true;
  } catch (e) {
    console.warn('⚠️ فشل تحميل Tesseract:', e);
    workerReady = false;
  }
}

async function runOCR(file: File): Promise<string> {
  await initWorker();
  if (!worker) return '';

  try {
    const processed = await preprocessForOCR(file);
    const { data } = await worker.recognize(processed);
    return data?.text || '';
  } catch (e) {
    console.warn('⚠️ OCR فشل:', e);
    return '';
  }
}

export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void,
  knownName?: string,
): Promise<IDExtractionResult> => {
  onProgress?.('فحص جودة الصورة...', 5);

  const blurScore = await detectBlur(imageFile);
  if (blurScore < 25) {
    return { success: false, error: 'الصورة غير واضحة جداً. حاول التصوير في إضاءة جيدة.' };
  }

  onProgress?.('استخراج رمز QR...', 15);
  let qrText: string | null = null;
  try {
    const upscaled = await upscaleIfNeeded(imageFile, 2000);
    qrText = await extractQRFromImageFile(upscaled);
  } catch (e) {
    console.warn('⚠️ QR فشل:', e);
  }

  onProgress?.('قراءة نص البطاقة...', 40);
  let ocrText = '';
  try {
    const upscaled = await upscaleIfNeeded(imageFile, 1800);
    ocrText = await runOCR(upscaled);
  } catch (e) {
    console.warn('⚠️ OCR فشل:', e);
  }

  onProgress?.('تحليل البيانات...', 75);

  const qrUrl = qrText || undefined;
  const qrId = qrText ? (extractIdFromQRUrl(qrText) || qrText) : undefined;
  const nationalId = qrId || undefined;

  let nameFromCard = '';
  if (knownName && ocrText) {
    const result = findNameInOCRText(knownName, ocrText);
    if (result.matched) {
      nameFromCard = knownName;
    }
  }

  const extractedName = extractNameFromOCR(ocrText);

  onProgress?.('اكتمل', 100);

  if (!qrText && !ocrText.trim()) {
    return {
      success: false,
      error: 'لم نتمكن من قراءة البطاقة. تأكد من وضوح الصورة وإضاءتها.',
    };
  }

  return {
    success: true,
    qrUrl,
    qrId,
    nationalId,
    ocrText,
    nameFromCard,
    extractedName,
  };
};

export const preprocessForQR = async (file: File): Promise<Blob> => {
  const upscaled = await upscaleIfNeeded(file, 2000);
  const img = await loadImageFromFile(upscaled);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const val = gray > 140 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('')); }, 'image/png');
  });
};

export const terminateOCR = async () => {
  if (worker) {
    try { await worker.terminate(); } catch {}
    worker = null;
    workerReady = false;
  }
};
