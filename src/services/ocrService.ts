// src/services/ocrService.ts
import Tesseract from 'tesseract.js';
import { extractQRFromImageFile, analyzeQR } from './qrExtractor';
import { IDExtractionResult } from '../types/registration';

// ============================================================
// 📷 استخراج البيانات من صورة الهوية
// ============================================================

let ocrWorker: Tesseract.Worker | null = null;
let workerLoading: Promise<Tesseract.Worker> | null = null;

/**
 * 🔧 تهيئة Tesseract Worker (مرة واحدة)
 */
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

/**
 * 🧹 إنهاء الـ Worker (لتحرير الذاكرة)
 */
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
 * - تكبير الصورة
 * - زيادة التباين
 * - تحويل لرمادي
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
        
        // تكبير الصورة إذا كانت صغيرة (يحسن OCR)
        const minWidth = 1500;
        let scale = 1;
        if (img.width < minWidth) {
          scale = minWidth / img.width;
        }
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        // رسم الصورة
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // زيادة التباين والوضوح
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
          // تحويل لرمادي مع تباين
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          // زيادة التباين
          const contrast = 1.3;
          const adjusted = ((gray - 128) * contrast) + 128;
          const final = Math.max(0, Math.min(255, adjusted));
          
          data[i] = final;
          data[i + 1] = final;
          data[i + 2] = final;
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('فشل تحويل الصورة'));
        }, 'image/jpeg', 0.95);
      };
      
      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.readAsDataURL(file);
  });
};

/**
 * 🔤 تنظيف النص المستخرج من OCR
 */
const cleanOCRText = (text: string): string => {
  return text
    .replace(/[^\u0600-\u06FF\u0750-\u077Fa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * 🔍 استخراج الاسم العربي من نص OCR
 */
export const extractArabicName = (rawText: string): string | null => {
  if (!rawText) return null;
  
  const cleaned = cleanOCRText(rawText);
  const lines = cleaned.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  
  // كلمات يجب تجاهلها (موجودة في الهوية لكن مو الاسم)
  const ignoreWords = [
    'الاسم', 'اسم', 'الطالب', 'الكلية', 'القسم', 'المرحلة', 'الفرع',
    'الجامعة', 'وزارة', 'التعليم', 'العالي', 'البحث', 'العلمي',
    'الجمهورية', 'العراقية', 'هوية', 'الهوية', 'بطاقة', 'البطاقة',
    'تاريخ', 'الميلاد', 'صادرة', 'الرقم', 'الامتحاني', 'الجامعي',
    'العام', 'الدراسي', 'الفصل', 'سنة', 'مديرية', 'دائرة',
    'بغداد', 'البصرة', 'الموصل', 'النجف', 'كربلاء', 'اربيل',
    'هندسة', 'طب', 'صيدلة', 'علوم', 'آداب', 'لغات', 'تربية',
    'حاسوب', 'معلومات', 'كهرباء', 'ميكانيك', 'مدنية',
    'صباحي', 'مسائي', 'دراسات', 'ذكر', 'انثى', 'انثي',
    'ايقاف', 'ايقافه', 'تخرج', 'مستمر',
  ];
  
  const isArabicWord = (word: string): boolean => {
    return /^[\u0600-\u06FF]+$/.test(word) && word.length >= 2;
  };
  
  const isLikelyName = (word: string): boolean => {
    if (!isArabicWord(word)) return false;
    return !ignoreWords.some(ig => word === ig || word.includes(ig));
  };
  
  // 🎯 استراتيجية: نبحث عن أطول تتابع لكلمات عربية مرشحة لتكون اسم
  const candidates: string[] = [];
  
  for (const line of lines) {
    const words = line.split(/\s+/);
    let currentName: string[] = [];
    
    for (const word of words) {
      if (isLikelyName(word)) {
        currentName.push(word);
      } else {
        if (currentName.length >= 2) {
          candidates.push(currentName.join(' '));
        }
        currentName = [];
      }
    }
    
    if (currentName.length >= 2) {
      candidates.push(currentName.join(' '));
    }
  }
  
  if (candidates.length === 0) return null;
  
  // نختار أطول مرشح (غالباً الاسم الكامل ثلاثي/رباعي)
  candidates.sort((a, b) => {
    const wordsA = a.split(/\s+/).length;
    const wordsB = b.split(/\s+/).length;
    if (wordsA !== wordsB) return wordsB - wordsA;
    return b.length - a.length;
  });
  
  return candidates[0];
};

/**
 * 🎯 الدالة الرئيسية: استخراج كل البيانات من صورة الهوية
 */
export const extractIDData = async (
  imageFile: File,
  onProgress?: (status: string, percent: number) => void
): Promise<IDExtractionResult> => {
  try {
    onProgress?.('🔍 جاري تحليل الصورة...', 5);
    
    // 1️⃣ استخراج QR من الصورة (متوازي مع OCR)
    onProgress?.('📷 جاري قراءة رمز QR...', 15);
    const qrPromise = extractQRFromImageFile(imageFile).catch(() => null);
    
    // 2️⃣ تحسين الصورة للـ OCR
    onProgress?.('✨ جاري تحسين جودة الصورة...', 25);
    const enhanced = await preprocessImage(imageFile);
    
    // 3️⃣ تشغيل OCR
    onProgress?.('📖 جاري قراءة النص العربي...', 40);
    const worker = await getWorker();
    
    const ocrResult = await worker.recognize(enhanced);
    const rawText = ocrResult.data.text;
    
    onProgress?.('🔤 جاري استخراج الاسم...', 75);
    const extractedName = extractArabicName(rawText);
    
    // 4️⃣ انتظار نتيجة QR
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

/**
 * 🧹 حذف الصورة من الذاكرة (للخصوصية)
 */
export const clearImageData = (imageUrl?: string): void => {
  if (imageUrl && imageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(imageUrl);
  }
};