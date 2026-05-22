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

/* ─── إعدادات الكاشف - 3 مستويات ─── */

// عادي - للوضع الفردي (سريع)
const detectorOptionsNormal = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

// 🆕 جماعي - للمسافات المتوسطة
const detectorOptionsBulk = new faceapi.TinyFaceDetectorOptions({
  inputSize: 512,
  scoreThreshold: 0.4,
});

// 🆕 جماعي بعيد - للمسافات البعيدة جداً
const detectorOptionsBulkFar = new faceapi.TinyFaceDetectorOptions({
  inputSize: 608,
  scoreThreshold: 0.35,
});

/* ─── استخراج بصمة واحدة (للتسجيل الفردي) ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const result = await faceapi
    .detectSingleFace(input, detectorOptionsNormal)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  return result?.descriptor || null;
};

/* ─── استخراج كل الوجوه (الوضع العادي) ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  return await faceapi
    .detectAllFaces(input, detectorOptionsNormal)
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* 🆕 ─── استخراج للوضع الجماعي - مع كشف وجوه أصغر ─── */
export const extractAllFaceDescriptorsBulk = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  useFarDetection: boolean = false
) => {
  if (!modelsLoaded) await loadFaceModels();

  const options = useFarDetection ? detectorOptionsBulkFar : detectorOptionsBulk;

  return await faceapi
    .detectAllFaces(input, options)
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* 🆕 ─── استخراج هجين - يستخدم 3 مستويات معاً للحصول على أقصى دقة ─── */
export const extractAllFaceDescriptorsHybrid = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  // اكتشف الوجوه القريبة + البعيدة
  const [nearFaces, farFaces] = await Promise.all([
    faceapi.detectAllFaces(input, detectorOptionsBulk).withFaceLandmarks(true).withFaceDescriptors(),
    faceapi.detectAllFaces(input, detectorOptionsBulkFar).withFaceLandmarks(true).withFaceDescriptors(),
  ]);

  // دمج النتائج مع إزالة التكرار
  const allFaces = [...nearFaces];
  const IOU_THRESHOLD = 0.5;

  for (const farFace of farFaces) {
    const isDuplicate = nearFaces.some(nearFace => {
      const iou = calculateIoU(nearFace.detection.box, farFace.detection.box);
      return iou > IOU_THRESHOLD;
    });

    if (!isDuplicate) {
      allFaces.push(farFace);
    }
  }

  return allFaces;
};

/* ─── حساب التداخل بين مربعين (IoU) ─── */
function calculateIoU(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return intersection / union;
}

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

/* ─── تحويل Float32Array → مضغوطة (الافتراضي) ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  return compressFaceDescriptor(descriptor);
};

export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};