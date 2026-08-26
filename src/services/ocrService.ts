import { IDExtractionResult } from '../types/registration';
import { extractQRFromImageFile, extractIdFromQRUrl } from './qrExtractor';
import { findNameInOCRText } from './nameMatching';

// ============================================================
// 🔗 عنوان خادم استخراج الأسماء (Flask + OpenCV + Tesseract)
// غيّره حسب بيئة التشغيل: localhost:5000 للتطوير، أو رابط السيرفر للإنتاج
// ============================================================
const NAME_API_URL = (import.meta as any).env?.VITE_NAME_API_URL || 'http://localhost:5000';

// ============================================================
// 🖼️ أدوات معالجة الصورة ( cliente-side — QR + تمويه)
// ============================================================

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

// ============================================================
// 🔗 استدعاء خادم استخراج الأسماء
// ============================================================

interface NameAPIResponse {
  name_en?: string | null;
  name_ar?: string | null;
  error?: string;
}

const callNameExtractionAPI = async (imageFile: File): Promise<NameAPIResponse> => {
  const formData = new FormData();
  formData.append('id_card', imageFile);

  const res = await fetch(`${NAME_API_URL}/extract-name`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `فشل استخراج الاسم (${res.status})`);
  }

  return res.json();
};

// ============================================================
// 🎯 الدالة الرئيسية: استخراج بيانات الهوية
// ============================================================

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

  onProgress?.('استخراج الاسم من البطاقة...', 50);

  let extractedName = '';
  let nameEn = '';
  let nameAr = '';
  try {
    const apiResult = await callNameExtractionAPI(imageFile);
    nameEn = apiResult.name_en || '';
    nameAr = apiResult.name_ar || '';
    extractedName = nameAr || nameEn;
  } catch (e: any) {
    console.warn('⚠️ استخراج الأسماء عبر API فشل:', e?.message);
  }

  onProgress?.('تحليل البيانات...', 85);

  const qrUrl = qrText || undefined;
  const qrId = qrText ? (extractIdFromQRUrl(qrText) || qrText) : undefined;
  const nationalId = qrId || undefined;

  // بناء ocrText بنيوي لأغراض العرض في واجهة التحقق
  const ocrText = [nameEn && `Name: ${nameEn}`, nameAr && `الاسم: ${nameAr}`].filter(Boolean).join('\n');

  // مطابقة الاسم المعروف (اسم الطالب بالنظام) مع الاسم المستخرج — للتحقق فقط
  let nameFromCard = '';
  if (knownName && extractedName) {
    const result = findNameInOCRText(knownName, extractedName);
    if (result.matched) {
      nameFromCard = knownName;
    }
  }

  onProgress?.('اكتمل', 100);

  if (!qrText && !extractedName) {
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
    ocrText: ocrText || undefined,
    nameFromCard,
    extractedName: extractedName || undefined,
  };
};

// ============================================================
// 🔳 تجهيز QR (للقراءة عبر html5-qrcode)
// ============================================================

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
  // لا يوجد محرك OCR محلي — الاستخراج عبر الخادم فقط
};
