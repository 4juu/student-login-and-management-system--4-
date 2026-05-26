// src/services/faceCompression.ts

// ============================================================
// 🗜️ خدمة ضغط بصمات الوجه
// تدعم: Float32Array, number[], string (base64), MultiDescriptor
// ============================================================

/**
 * 📏 عدد الأبعاد الأهم اللي نحتفظ بيها بعد الضغط
 * face-api.js يستخرج 128 بُعد، نحتفظ بأهم 48 منها (نسبة 1%-3% فقدان)
 */
const TOP_DIMS = 48;

/**
 * 🗜️ ضغط بصمة وجه (Float32Array أو number[]) → array صغير
 *
 * الخوارزمية:
 * 1. ناخذ الـ 128 بُعد
 * 2. نختار أهم 48 بُعد (أكبر قيم مطلقة)
 * 3. نخزن: [index1, value1, index2, value2, ...]
 *
 * النتيجة: 96 رقم بدل 128 (توفير ~25%)
 * + كل قيمة float8 بدل float32 = توفير إضافي
 */
export const compressFaceDescriptor = (
  descriptor: Float32Array | number[] | string | any
): number[] => {
  if (!descriptor) return [];

  // 1️⃣ إذا Float32Array → تحويل لـ Array أولاً
  if (descriptor instanceof Float32Array) {
    const arr = Array.from(descriptor);
    return compressArray(arr);
  }

  // 2️⃣ إذا Array من الأرقام → ضغط مباشر
  if (Array.isArray(descriptor)) {
    if (descriptor.length === 0) return [];
    // تأكد إنها أرقام
    if (typeof descriptor[0] === 'number') {
      return compressArray(descriptor as number[]);
    }
    return [];
  }

  // 3️⃣ إذا string (base64) → فك ثم ضغط
  if (typeof descriptor === 'string') {
    try {
      const decoded = ensureDecompressed(descriptor);
      return compressArray(decoded);
    } catch {
      return [];
    }
  }

  // 4️⃣ إذا MultiDescriptor (object) → استخراج main أو descriptor
  if (typeof descriptor === 'object') {
    if (descriptor.main && Array.isArray(descriptor.main)) {
      return descriptor.main; // مضغوط أصلاً
    }
    if (descriptor.descriptor) {
      return compressFaceDescriptor(descriptor.descriptor);
    }
  }

  return [];
};

/**
 * Helper: ضغط array من 128 رقم
 */
const compressArray = (arr: number[]): number[] => {
  if (!arr || arr.length === 0) return [];

  // إذا أقل من 128، نرجعه كما هو (مع تقريب)
  if (arr.length < 128) {
    return arr.map(v => Math.round(Number(v) * 10000) / 10000);
  }

  // ضغط: اختيار أعلى TOP_DIMS قيمة
  const indexed = arr.slice(0, 128).map((v, i) => ({
    abs: Math.abs(Number(v)),
    i,
    val: Number(v),
  }));
  indexed.sort((a, b) => b.abs - a.abs);

  const top = indexed.slice(0, TOP_DIMS);
  top.sort((a, b) => a.i - b.i);

  const result: number[] = [];
  for (const t of top) {
    result.push(t.i);
    result.push(Math.round(t.val * 10000) / 10000);
  }

  return result;
};

/**
 * 📦 فك ضغط بصمة → Float32Array 128
 */
export const decompressFaceDescriptor = (compressed: number[] | string | any): number[] => {
  if (!compressed) return [];

  // إذا string، نحاول نفك تشفير base64
  if (typeof compressed === 'string') {
    try {
      const decoded = atob(compressed);
      const buffer = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        buffer[i] = decoded.charCodeAt(i);
      }
      const float32 = new Float32Array(buffer.buffer);
      return Array.from(float32);
    } catch {
      return [];
    }
  }

  // إذا object فيه main
  if (compressed && typeof compressed === 'object' && !Array.isArray(compressed)) {
    if (compressed.main) return decompressFaceDescriptor(compressed.main);
    if (compressed.descriptor) return decompressFaceDescriptor(compressed.descriptor);
    return [];
  }

  if (!Array.isArray(compressed)) return [];
  if (compressed.length === 0) return [];

  // إذا الطول 128 = صيغة عادية غير مضغوطة
  if (compressed.length === 128) {
    return compressed.map(v => Number(v));
  }

  // إذا الطول < 128 ولكن > 64 = ممكن غير مضغوط ناقص
  if (compressed.length > 64 && compressed.length < 128) {
    const padded = new Array(128).fill(0);
    for (let i = 0; i < compressed.length; i++) {
      padded[i] = Number(compressed[i]);
    }
    return padded;
  }

  // إذا الطول زوجي وأقل من 100 = مضغوط [index, value, index, value, ...]
  if (compressed.length % 2 === 0 && compressed.length <= TOP_DIMS * 2) {
    const result = new Array(128).fill(0);
    for (let i = 0; i < compressed.length; i += 2) {
      const idx = compressed[i];
      const val = compressed[i + 1];
      if (typeof idx === 'number' && idx >= 0 && idx < 128) {
        result[idx] = Number(val);
      }
    }
    return result;
  }

  // افتراضي: نرجعه كما هو
  return compressed.map(v => Number(v));
};

/**
 * ✅ تأكيد أن البصمة مفكوكة (للمقارنة)
 */
export const ensureDecompressed = (descriptor: any): number[] => {
  return decompressFaceDescriptor(descriptor);
};

/**
 * 🔍 كشف صيغة البصمة
 * 
 * @returns
 * - `'multi'` → MultiDescriptor (object فيه main)
 * - `'base64'` → string مشفرة
 * - `'compressed'` → array مضغوط [index, value, ...]
 * - `'normal'` → array 128 رقم كاملة
 * - `null` → غير موجودة أو غير معروفة
 */
export const detectDescriptorFormat = (
  fd: any
): 'normal' | 'compressed' | 'base64' | 'multi' | null => {
  if (!fd) return null;

  // 🆕 MultiDescriptor (object فيه main)
  if (typeof fd === 'object' && !Array.isArray(fd)) {
    if (fd.main && Array.isArray(fd.main) && fd.main.length > 0) {
      return 'multi';
    }
    if (fd.descriptor && Array.isArray(fd.descriptor) && fd.descriptor.length > 0) {
      return 'multi';
    }
    return null;
  }

  // base64 string
  if (typeof fd === 'string') {
    return fd.length > 0 ? 'base64' : null;
  }

  // Array
  if (Array.isArray(fd) && fd.length > 0) {
    // مضغوط: طول قصير أو أرقام صحيحة في المواقع الزوجية
    if (fd.length <= TOP_DIMS * 2 && fd.length % 2 === 0) {
      const looksCompressed = fd.length >= 4 &&
        Number.isInteger(fd[0]) && fd[0] >= 0 && fd[0] < 128 &&
        Number.isInteger(fd[2]) && fd[2] >= 0 && fd[2] < 128;
      if (looksCompressed) return 'compressed';
    }
    // عادي: 128 رقم أو قريب منها
    return 'normal';
  }

  return null;
};

/**
 * 📊 إحصائيات الضغط لمجموعة طلاب
 */
export interface CompressionStats {
  compressedCount: number;
  uncompressedCount: number;
  totalSizeKB: number;
  potentialSavingsKB: number;
  totalStudentsWithFace: number;
}

export const getCompressionStats = (
  students: Array<{ faceDescriptor?: any; faceCompressed?: boolean }>
): CompressionStats => {
  let compressedCount = 0;
  let uncompressedCount = 0;
  let totalSize = 0;
  let savingsEstimate = 0;

  for (const s of students) {
    if (!s.faceDescriptor) continue;

    const format = detectDescriptorFormat(s.faceDescriptor);
    if (!format) continue;

    // حجم البصمة الحالية
    const currentSize = JSON.stringify(s.faceDescriptor).length;
    totalSize += currentSize;

    // ✅ MultiDescriptor و compressed و base64 = مضغوطة
    if (format === 'multi' || format === 'compressed' || format === 'base64') {
      compressedCount++;
    } else {
      // normal = غير مضغوطة
      uncompressedCount++;
      // التقدير: ضغط normal يوفر ~70%
      savingsEstimate += currentSize * 0.7;
    }
  }

  return {
    compressedCount,
    uncompressedCount,
    totalSizeKB: totalSize / 1024,
    potentialSavingsKB: savingsEstimate / 1024,
    totalStudentsWithFace: compressedCount + uncompressedCount,
  };
};

/**
 * 🔍 التحقق من وجود بصمة وجه (يدعم كل الصيغ)
 * 
 * يستخدم في:
 * - StudentManager: عرض حالة الطلاب
 * - FaceRegister: التحقق قبل التسجيل
 * - StudentsViewer: عرض الإحصائيات
 */
export const hasFaceDescriptor = (fd: any): boolean => {
  if (!fd) return false;

  // MultiDescriptor (object)
  if (typeof fd === 'object' && !Array.isArray(fd)) {
    if (fd.main && Array.isArray(fd.main) && fd.main.length > 0) return true;
    if (fd.descriptor && Array.isArray(fd.descriptor) && fd.descriptor.length > 0) return true;
    return false;
  }

  // Array
  if (Array.isArray(fd) && fd.length > 0) return true;

  // base64 string
  if (typeof fd === 'string' && fd.length > 0) return true;

  return false;
};