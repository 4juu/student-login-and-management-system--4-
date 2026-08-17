// src/services/qrExtractor.ts
import { Html5Qrcode } from 'html5-qrcode';
import { preprocessForQR } from './ocrService';

// ============================================================
// 🔳 استخراج QR من صورة الهوية - نسخة محسّنة
// ============================================================

/**
 * مسح QR من Blob باستخدام Html5Qrcode
 */
const scanQRFromBlob = async (blob: Blob): Promise<string | null> => {
  const tempId = `temp-qr-scanner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDiv = document.createElement('div');
  tempDiv.id = tempId;
  tempDiv.style.display = 'none';
  document.body.appendChild(tempDiv);

  let scanner: Html5Qrcode | null = null;

  try {
    scanner = new Html5Qrcode(tempId, { verbose: false } as any);
    // scanFile يتطلب File وليس Blob — نحول Blob إلى File
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
 * 📸 استخراج QR من ملف صورة - نسخة محسّنة
 * يحاول الصورة الأصلية أولاً، ثم الصورة المحسّنة
 */
export const extractQRFromImageFile = async (file: File): Promise<string | null> => {
  // المحاولة 1: الصورة الأصلية
  console.log('🔳 محاولة QR: الصورة الأصلية...');
  const result1 = await scanQRFromBlob(file);
  if (result1) {
    console.log('✅ QR وجد من الصورة الأصلية:', result1);
    return result1;
  }

  // المحاولة 2: الصورة المحسّنة (تباين عالي + تكبير)
  console.log('🔳 محاولة QR: الصورة المحسّنة...');
  try {
    const enhanced = await preprocessForQR(file);
    const result2 = await scanQRFromBlob(enhanced);
    if (result2) {
      console.log('✅ QR وجد من الصورة المحسّنة:', result2);
      return result2;
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
