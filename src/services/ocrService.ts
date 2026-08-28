import { IDExtractionResult } from '../types/registration';
import { extractQRFromImageFile, extractIdFromQRUrl } from './qrExtractor';
import { findNameInOCRText, extractNameFromOCR } from './nameMatching';

// ============================================================
// 🔗 عنوان خادم استخراج الأسماء (Flask + OpenCV + Tesseract)
// غيّره في ملف .env عبر VITE_NAME_API_URL — أو افتراضياً localhost:5000 للتطوير
// ============================================================
const NAME_API_URL = (import.meta as any).env?.VITE_NAME_API_URL || 'http://localhost:5000';

// ============================================================
// 🖼️ أدوات معالجة الصورة ( client-side — QR + تمويه + قص منطقة الاسم)
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
// 🔗 استدعاء خادم استخراج الأسماء (الأولوية الأولى)
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
// 🔤 Fallback: OCR محلي عبر Tesseract.js في المتصفح
// يستخدم فقط إذا فشل خادم Flask — يشمل قص منطقة الاسم المخصص لبطاقات
// وزارة التعليم العالي العراقية (الاسم يمين البطاقة عمودياً 38%-60%)
// ============================================================

let tesseractWorker: any = null;

const initTesseractWorker = async (): Promise<any> => {
  if (tesseractWorker) return tesseractWorker;
  const { createWorker } = await import('tesseract.js');
  tesseractWorker = await createWorker('ara+eng', 1, { logger: () => {} });
  await tesseractWorker.setParameters({
    tessedit_pageseg_mode: '3',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return tesseractWorker;
};

const preprocessForLocalOCR = async (file: File): Promise<Blob> => {
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

/** قص منطقة الاسم من بطاقة الهوية الجامعية العراقية — الاسم يمين البطاقة تقريباً 38%-60% عمودياً */
const cropNameRegion = async (file: File): Promise<File> => {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const w = img.width;
  const h = img.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const nameRegion = ctx.getImageData(
    Math.round(w * 0.35),
    Math.round(h * 0.38),
    Math.round(w * 0.65),
    Math.round(h * 0.22)
  );

  const canvas2 = document.createElement('canvas');
  canvas2.width = nameRegion.width;
  canvas2.height = nameRegion.height;
  const ctx2 = canvas2.getContext('2d')!;
  ctx2.putImageData(nameRegion, 0, 0);

  return new Promise<File>((resolve) => {
    canvas2.toBlob((blob) => {
      if (blob) resolve(new File([blob], 'name-region.jpg', { type: 'image/jpeg' }));
      else resolve(file);
    }, 'image/jpeg', 0.95);
  });
};

const extractEnglishName = (text: string): string => {
  for (const line of text.split('\n')) {
    const match = line.match(/name\s*[:\-]?\s*(.+)/i);
    if (match) {
      const name = match[1].replace(/[^A-Za-z .'\-]/g, '').trim();
      if (name.length >= 3) return name;
    }
  }
  return '';
};

const runLocalOCR = async (imageFile: File): Promise<{ nameEn: string; nameAr: string; ocrText: string }> => {
  const worker = await initTesseractWorker();

  // OCR كامل البطاقة
  const processedFull = await preprocessForLocalOCR(imageFile);
  const fullRes = await worker.recognize(processedFull);
  const fullText = fullRes?.data?.text || '';

  // OCR منطقة الاسم المخصوصة (أدق للعراقية)
  let nameRegionText = '';
  try {
    const cropped = await cropNameRegion(imageFile);
    const processedCrop = await preprocessForLocalOCR(cropped);
    const cropRes = await worker.recognize(processedCrop);
    nameRegionText = cropRes?.data?.text || '';
  } catch {
    nameRegionText = '';
  }

  const combinedText = [fullText, nameRegionText].filter(Boolean).join('\n');
  const nameEn = extractEnglishName(combinedText);
  const nameAr = extractNameFromOCR(combinedText) || '';

  return { nameEn, nameAr, ocrText: combinedText };
};

// ============================================================
// 🎯 الدالة الرئيسية: استخراج بيانات الهوية
// تُستخدم في كل مسارات النظام (تصوير/معرض/حضور/بصمة/صفحة الطالب)
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
  let ocrText = '';

  // المحاولة الأولى: خادم Flask (OpenCV + Tesseract server-side — الأدق)
  try {
    onProgress?.('جاري الاستعلام من خادم التعرف...', 50);
    const apiResult = await callNameExtractionAPI(imageFile);
    nameEn = apiResult.name_en || '';
    nameAr = apiResult.name_ar || '';
    extractedName = nameAr || nameEn;
    ocrText = [nameEn && `Name: ${nameEn}`, nameAr && `الاسم: ${nameAr}`].filter(Boolean).join('\n');
  } catch (e: any) {
    console.warn('⚠️ Flask API فشل، الانتقال لـ Tesseract.js المحلي:', e?.message);

    // المحاولة الثانية: Tesseract.js في المتصفح (بدون خادم)
    try {
      onProgress?.('الخادم غير متاح — جاري القراءة المحلية...', 55);
      const local = await runLocalOCR(imageFile);
      nameEn = local.nameEn;
      nameAr = local.nameAr;
      extractedName = nameAr || nameEn;
      ocrText = local.ocrText;
    } catch (e2: any) {
      console.warn('⚠️ OCR المحلي فشل أيضاً:', e2?.message);
    }
  }

  onProgress?.('تحليل البيانات...', 85);

  const qrUrl = qrText || undefined;
  const qrId = qrText ? (extractIdFromQRUrl(qrText) || qrText) : undefined;
  const nationalId = qrId || undefined;

  // مطابقة الاسم المعروف (اسم الطالب بالنظام) مع الاسم المستخرج — للتحقق فقط
  let nameFromCard = '';
  if (knownName && (extractedName || ocrText)) {
    const result = findNameInOCRText(knownName, extractedName || ocrText);
    if (result.matched) {
      nameFromCard = knownName;
    }
  }

  onProgress?.('اكتمل', 100);

  if (!qrText && !extractedName && !ocrText.trim()) {
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
    nameFromCard: nameFromCard || undefined,
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
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch {}
    tesseractWorker = null;
  }
};