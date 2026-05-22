import * as faceapi from 'face-api.js';
import {
  compressFaceDescriptor,
  ensureDecompressed,
} from './faceCompression';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

/* ─── تحميل الموديلات ─── */
export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      modelsLoaded = true;
      console.log('✅ تم تحميل موديلات الوجه');
    } catch (e) {
      loadingPromise = null;
      console.error('❌ فشل تحميل الموديلات:', e);
      throw e;
    }
  })();

  return loadingPromise;
};

export const areModelsLoaded = () => modelsLoaded;

/* ─── خيارات الكشف - حساسية عالية للمسافات البعيدة ─── */
const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,       // ⬆️ أكبر = يكتشف وجوه أصغر (أبعد)
  scoreThreshold: 0.3,  // ⬇️ أقل = يكتشف حتى الوجوه غير الواضحة
});

/* ─── خيارات للتسجيل (دقة عالية) ─── */
const detectorOptionsRegister = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.5,
});

/* ─── تكبير الوجه من الفيديو على Canvas مؤقت ─── */
const cropAndEnlargeFace = (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: faceapi.Box,
  padding: number = 0.4
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const targetSize = 224;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  // حساب أبعاد المصدر
  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  // إضافة هامش حول الوجه
  const padX = box.width * padding;
  const padY = box.height * padding;

  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(srcW - x, box.width + padX * 2);
  const h = Math.min(srcH - y, box.height + padY * 2);

  // تكبير قطعة الوجه على الـ canvas
  ctx.drawImage(source, x, y, w, h, 0, 0, targetSize, targetSize);

  return canvas;
};

/* ─── استخراج بصمة من فيديو (مع تكبير الوجه) ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  // المرحلة 1: اكتشف الوجه في الصورة الكاملة
  const detection = await faceapi
    .detectSingleFace(input, detectorOptionsRegister)
    .withFaceLandmarks(true);

  if (!detection) return null;

  // المرحلة 2: اقطع وكبّر منطقة الوجه
  const faceCanvas = cropAndEnlargeFace(input, detection.detection.box);

  // المرحلة 3: استخرج البصمة من الوجه المكبّر
  const result = await faceapi
    .detectSingleFace(faceCanvas, detectorOptionsRegister)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  // إذا فشل التحليل على المكبّر، جرب الأصلي
  if (!result) {
    const fallback = await faceapi
      .detectSingleFace(input, detectorOptionsRegister)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return fallback?.descriptor || null;
  }

  return result.descriptor;
};

/* ─── استخراج كل الوجوه (مع تكبير كل وجه) ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  // المرحلة 1: اكتشف كل الوجوه في الصورة الكاملة
  const detections = await faceapi
    .detectAllFaces(input, detectorOptions)
    .withFaceLandmarks(true);

  if (detections.length === 0) return [];

  // المرحلة 2: لكل وجه، كبّره واستخرج البصمة
  const results: faceapi.WithFaceDescriptor<
    faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>
  >[] = [];

  for (const detection of detections) {
    try {
      // تجاهل الوجوه الصغيرة جداً (أبعد من اللازم)
      const minSize = 20; // بكسل
      if (detection.detection.box.width < minSize) continue;

      // قطع وتكبير الوجه
      const faceCanvas = cropAndEnlargeFace(input, detection.detection.box);

      // استخراج البصمة من الوجه المكبّر
      const result = await faceapi
        .detectSingleFace(faceCanvas, detectorOptionsRegister)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (result) {
        // أعد الإحداثيات الأصلية (مهم للرسم على Canvas)
        results.push({
          detection: detection.detection,
          landmarks: detection.landmarks,
          unshiftedLandmarks: detection.unshiftedLandmarks,
          alignedRect: detection.alignedRect,
          descriptor: result.descriptor,
        } as any);
      }
    } catch {
      // تجاهل الوجوه التي فشل تحليلها
    }
  }

  // إذا فشل الكل، ارجع للطريقة العادية
  if (results.length === 0) {
    return await faceapi
      .detectAllFaces(input, detectorOptions)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
  }

  return results;
};

/* ─── مقارنة بصمتين ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);

  const desc2Array = typeof desc2 === 'string' || (Array.isArray(desc2) && desc2.every(v => Number.isInteger(v)))
    ? ensureDecompressed(desc2)
    : (Array.isArray(desc2) ? desc2 : Array.from(desc2));

  const b = new Float32Array(desc2Array);
  return faceapi.euclideanDistance(a, b);
};

/* ─── البحث عن أفضل تطابق ─── */
export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold: number = 0.5
): FaceMatchResult<T> | null => {
  let best: FaceMatchResult<T> | null = null;

  for (const item of items) {
    if (!item.faceDescriptor) continue;

    const distance = compareFaces(queryDescriptor, item.faceDescriptor as any);

    if (distance < threshold) {
      if (!best || distance < best.distance) {
        best = {
          item,
          distance,
          confidence: Math.round((1 - distance) * 100),
        };
      }
    }
  }

  return best;
};

/* ─── تحويل Float32Array → مضغوطة ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  return compressFaceDescriptor(descriptor);
};

/* ─── تحويل بدون ضغط ─── */
export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};