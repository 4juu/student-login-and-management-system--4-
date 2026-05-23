import * as faceapi from 'face-api.js';
import {
  compressFaceDescriptor,
  ensureDecompressed,
} from './faceCompression';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;
let modelLoadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

const MODEL_URLS = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
];

/* ─── تحميل الموديلات مع إعادة المحاولة ─── */
export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
      const url = MODEL_URLS[attempt % MODEL_URLS.length];
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(url),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
          faceapi.nets.faceRecognitionNet.loadFromUri(url),
          // SSD للكشف الإضافي
          faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        ]);
        modelsLoaded = true;
        modelLoadAttempts = 0;
        console.log('✅ تم تحميل موديلات الوجه من:', url);
        return;
      } catch (e) {
        console.warn(`⚠️ محاولة ${attempt + 1} فشلت:`, e);
        if (attempt < MAX_LOAD_ATTEMPTS - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    loadingPromise = null;
    throw new Error('فشل تحميل الموديلات بعد عدة محاولات');
  })();

  return loadingPromise;
};

export const resetModels = () => {
  modelsLoaded = false;
  loadingPromise = null;
};

export const areModelsLoaded = () => modelsLoaded;

/* ─── إعدادات الكاشف المحسّنة ─── */

// سريع - للوضع الفردي
const detectorOptionsFast = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.45,
});

// متوازن - للوضع الجماعي
const detectorOptionsBulk = new faceapi.TinyFaceDetectorOptions({
  inputSize: 608,
  scoreThreshold: 0.38,
});

// بعيد جداً
const detectorOptionsFar = new faceapi.TinyFaceDetectorOptions({
  inputSize: 800,
  scoreThreshold: 0.30,
});

// SSD للكشف الدقيق
const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.35,
  maxResults: 20,
});

/* ─── Canvas مُشترك لتجنب تسرب الذاكرة ─── */
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

const getSharedCanvas = (width: number, height: number): HTMLCanvasElement => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  sharedCanvas.width = width;
  sharedCanvas.height = height;
  return sharedCanvas;
};

/* ─── تحسين الصورة قبل المعالجة ─── */
const preprocessFrame = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth: number = 1280
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;

  if (!vw || !vh) return input as HTMLCanvasElement;

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = getSharedCanvas(w, h);
  if (!sharedCtx) return input as HTMLCanvasElement;

  // تحسين جودة الرسم
  sharedCtx.imageSmoothingEnabled = true;
  sharedCtx.imageSmoothingQuality = 'high';

  // تحسين التباين والسطوع
  sharedCtx.filter = 'contrast(1.15) brightness(1.05) saturate(1.1)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';

  return canvas;
};

/* ─── استخراج بصمة واحدة (للتسجيل) ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const processed = preprocessFrame(input, 640);

  // جرب مرتين بإعدادات مختلفة
  let result = await faceapi
    .detectSingleFace(processed, detectorOptionsFast)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!result) {
    result = await faceapi
      .detectSingleFace(processed, new faceapi.TinyFaceDetectorOptions({
        inputSize: 512,
        scoreThreshold: 0.35,
      }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }

  return result?.descriptor || null;
};

/* ─── استخراج كل الوجوه (الوضع الجماعي) ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 1280);
  return faceapi
    .detectAllFaces(processed, detectorOptionsBulk)
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* ─── الكشف الهجين المحسّن ─── */
export const extractAllFaceDescriptorsHybrid = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  const processed = preprocessFrame(input, 1920);

  // ثلاثة مستويات متوازية
  const [bulkFaces, farFaces, ssdFaces] = await Promise.allSettled([
    faceapi.detectAllFaces(processed, detectorOptionsBulk)
      .withFaceLandmarks(true).withFaceDescriptors(),
    faceapi.detectAllFaces(processed, detectorOptionsFar)
      .withFaceLandmarks(true).withFaceDescriptors(),
    faceapi.detectAllFaces(processed, detectorOptionsSSD)
      .withFaceLandmarks(true).withFaceDescriptors(),
  ]);

  const bulk = bulkFaces.status === 'fulfilled' ? bulkFaces.value : [];
  const far = farFaces.status === 'fulfilled' ? farFaces.value : [];
  const ssd = ssdFaces.status === 'fulfilled' ? ssdFaces.value : [];

  // دمج مع إزالة التكرار
  const merged = [...bulk];
  const IOU_THRESHOLD = 0.4;

  const addIfUnique = (face: typeof bulk[0]) => {
    const isDup = merged.some(m => calculateIoU(m.detection.box, face.detection.box) > IOU_THRESHOLD);
    if (!isDup) merged.push(face);
  };

  far.forEach(addIfUnique);
  ssd.forEach(addIfUnique);

  return merged;
};

/* ─── حساب IoU ─── */
function calculateIoU(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
  if (x2 < x1 || y2 < y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const union = box1.width * box1.height + box2.width * box2.height - inter;
  return inter / union;
}

/* ─── مقارنة بصمتين ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  const desc2Array =
    typeof desc2 === 'string' ||
    (Array.isArray(desc2) && desc2.every(v => Number.isInteger(v)))
      ? ensureDecompressed(desc2)
      : Array.isArray(desc2)
      ? desc2
      : Array.from(desc2 as Float32Array);
  const b = new Float32Array(desc2Array);
  return faceapi.euclideanDistance(a, b);
};

/* ─── البحث عن أفضل تطابق مع threshold ديناميكي ─── */
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
          confidence: Math.round((1 - distance / threshold) * 100),
        };
      }
    }
  }

  return best;
};

/* ─── تحويل البصمة ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  return compressFaceDescriptor(descriptor);
};

export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};