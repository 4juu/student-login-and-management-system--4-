// src/services/qrExtractor.ts
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { preprocessForQR } from './ocrService';

// ============================================================
// 🔳 استخراج QR من صورة الهوية - نسخة محسّنة
// ============================================================

/**
 * مسح QR من Blob باستخدام Html5Qrcode (QR_CODE فقط)
 */
const scanQRFromBlob = async (blob: Blob): Promise<string | null> => {
  const tempId = `temp-qr-scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDiv = document.createElement('div');
  tempDiv.id = tempId;
  tempDiv.style.display = 'none';
  document.body.appendChild(tempDiv);

  let scanner: Html5Qrcode | null = null;

  try {
    scanner = new Html5Qrcode(tempId, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    } as any);
    const file = new File([blob], 'qr-image.png', { type: blob.type || 'image/png' });
    const result = await scanner.scanFile(file, false);
    return result;
  } catch {
    return null;
  } finally {
    if (scanner) {
      try { await scanner.clear(); } catch {}
    }
    if (tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
  }
};

/**
 * تحويل صورة إلى رمادي (grayscale) لتحسين قراءة QR
 */
const toGrayscale = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = d[i + 1] = d[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('فشل التحويل'));
      }, 'image/jpeg', 0.95);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('فشل تحميل الصورة'));
    };
    img.src = url;
  });

/**
 * 📸 استخراج QR من ملف صورة - نسخة محسّنة
 * يحاول الصورة الأصلية أولاً، ثم الرمادي، ثم المحسّن
 */
export const extractQRFromImageFile = async (file: File): Promise<string | null> => {
  // المحاولة 1: الصورة الأصلية
  console.log('🔳 محاولة QR: الصورة الأصلية...');
  const result1 = await scanQRFromBlob(file);
  if (result1) {
    console.log('✅ QR وجد من الصورة الأصلية:', result1);
    return result1;
  }

  // المحاولة 2: الصورة الرمادية (grayscale)
  console.log('🔳 محاولة QR: الصورة الرمادية...');
  try {
    const gray = await toGrayscale(file);
    const result2 = await scanQRFromBlob(gray);
    if (result2) {
      console.log('✅ QR وجد من الصورة الرمادية:', result2);
      return result2;
    }
  } catch (e) {
    console.warn('⚠️ فشل التحويل الرمادي:', e);
  }

  // المحاولة 3: الصورة المحسّنة (تباين عالي + تكبير)
  console.log('🔳 محاولة QR: الصورة المحسّنة...');
  try {
    const enhanced = await preprocessForQR(file);
    const result3 = await scanQRFromBlob(enhanced);
    if (result3) {
      console.log('✅ QR وجد من الصورة المحسّنة:', result3);
      return result3;
    }
  } catch (e) {
    console.warn('⚠️ فشل تحسين الصورة لـ QR:', e);
  }

  console.warn('⚠️ لم يتم العثور على QR في أي محاولة');
  return null;
};

/**
 * 🔍 استخراج الـ ID من رابط QR
 * مثال: https://sis.mohesr.gov.iq/verify?id=bNgvmV11yKrV0jMB&signature=xxx
 * → bNgvmV11yKrV0jMB
 */
export const extractIdFromQRUrl = (url: string): string | null => {
  if (!url) return null;

  const trimmed = url.trim();

  // محاولة 1: رابط URL صحيح
  try {
    const parsed = new URL(trimmed);
    const id = parsed.searchParams.get('id');
    if (id) return id.trim();
  } catch {
    // ليس رابط
  }

  // محاولة 2: JSON
  try {
    const obj = JSON.parse(trimmed);
    const id = obj.id || obj.qrCodeId || obj.studentId || obj.universityId;
    if (id) return String(id).trim();
  } catch {
    // ليس JSON
  }

  // محاولة 3: نص مباشر يصلح كـ ID
  if (/^[A-Za-z0-9_-]{6,100}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
};

/**
 * 🌐 التحقق من أن الرابط من وزارة التعليم العراقية
 */
export const isMohesrUrl = (url: string): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('mohesr.gov.iq') ||
           parsed.hostname.includes('sis.mohesr');
  } catch {
    return false;
  }
};

/**
 * 📊 معلومات شاملة عن QR المستخرج
 */
export interface QRInfo {
  fullUrl: string;
  id: string | null;
  isMohesr: boolean;
  isValid: boolean;
}

/**
 * 🎯 تحليل شامل لنص QR
 */
export const analyzeQR = (qrText: string): QRInfo => {
  const id = extractIdFromQRUrl(qrText);
  const isMohesr = isMohesrUrl(qrText);

  return {
    fullUrl: qrText,
    id,
    isMohesr,
    isValid: !!id,
  };
};
