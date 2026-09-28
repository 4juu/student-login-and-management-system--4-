// ضغط صور البصمة/الصورة الشخصية — JPEG مضغوط ≤640px لتخزينها داخل RTDB (بلا Storage)
export const PHOTO_MAX_WIDTH = 640;
export const PHOTO_JPEG_QUALITY = 0.9;
export const MAX_PHOTO_URI_LENGTH = 120000;

export function fitWithin(width: number, height: number, maxWidth = PHOTO_MAX_WIDTH): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isValidPhotoDataUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/') &&
    value.length <= MAX_PHOTO_URI_LENGTH
  );
}

/** رسم المصدر على لوحة بالحجم المضغوط ثم ترميزه JPEG */
async function drawToDataUri(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxWidth = PHOTO_MAX_WIDTH,
  quality = PHOTO_JPEG_QUALITY,
): Promise<string> {
  const { width, height } = fitWithin(srcWidth, srcHeight, maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('تعذر تجهيز لوحة الرسم');
  g.drawImage(source, 0, 0, width, height);
  const uri = canvas.toDataURL('image/jpeg', quality);
  if (!isValidPhotoDataUri(uri)) {
    throw new Error('الصورة الناتجة أكبر من الحد المسموح — التقط صورة أصغر');
  }
  return uri;
}

/** ضغط صورة من ملف إلى data URI صالح للتخزين */
export async function compressImageFile(
  file: File,
  maxWidth = PHOTO_MAX_WIDTH,
  quality = PHOTO_JPEG_QUALITY,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return await drawToDataUri(bitmap, bitmap.width, bitmap.height, maxWidth, quality);
  } finally {
    bitmap.close();
  }
}

/** ضغط ImageBitmap (مثلاً إطار كاميرا) إلى data URI */
export async function compressBitmap(
  bitmap: ImageBitmap,
  maxWidth = PHOTO_MAX_WIDTH,
  quality = PHOTO_JPEG_QUALITY,
): Promise<string> {
  return drawToDataUri(bitmap, bitmap.width, bitmap.height, maxWidth, quality);
}

/** فك data URI إلى ImageBitmap للمعالجة (كشف/استخراج بصمة من الصورة المخزنة) */
export async function decodeDataUri(dataUri: string): Promise<ImageBitmap> {
  if (!isValidPhotoDataUri(dataUri)) throw new Error('بيانات الصورة غير صالحة');
  const blob = await (await fetch(dataUri)).blob();
  return createImageBitmap(blob);
}
