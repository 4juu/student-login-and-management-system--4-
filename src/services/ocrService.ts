import { IDExtractionResult } from '../types/registration';
import { extractQRFromImageFile, extractIdFromQRUrl } from './qrExtractor';

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
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
    canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('فشل المعالجة')); }, 'image/png');
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
    return sum / count;
  } catch {
    return 500;
  }
};

export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void,
): Promise<IDExtractionResult> => {
  onProgress?.('فحص جودة الصورة...', 10);

  const blurScore = await detectBlur(imageFile);
  if (blurScore < 30) {
    return { success: false, error: 'الصورة غير واضحة. حاول التصوير في إضاءة جيدة.', rawText: '' };
  }

  onProgress?.('استخراج رمز QR...', 30);
  let qrText: string | null = null;
  try {
    const upscaled = await upscaleIfNeeded(imageFile, 2000);
    qrText = await extractQRFromImageFile(upscaled);
  } catch (e) {
    console.warn('⚠️ فشل استخراج QR:', e);
  }

  if (!qrText) {
    return {
      success: false,
      error: 'لم يتم التعرف على رمز QR في البطاقة. تأكد من وضوح الصورة.',
      rawText: '',
    };
  }

  onProgress?.('تحليل بيانات QR...', 70);

  const qrUrl = qrText;
  const qrId = extractIdFromQRUrl(qrText) || qrText;
  const nationalId = qrId;

  onProgress?.('اكتمل', 100);

  return {
    success: true,
    qrUrl,
    qrId,
    nationalId,
    rawText: qrText,
  };
};

export const terminateOCR = async () => {};

export const clearImageData = () => {};
