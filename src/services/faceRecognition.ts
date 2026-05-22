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

const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

/* ─── استخراج بصمة من فيديو ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const result = await faceapi
    .detectSingleFace(input, detectorOptions)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  return result?.descriptor || null;
};

/* ─── استخراج كل الوجوه ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  return await faceapi
    .detectAllFaces(input, detectorOptions)
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* ─── مقارنة بصمتين ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  
  // 🆕 فك الضغط تلقائياً لو كانت مضغوطة
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
    
    // 🆕 يدعم المضغوطة والعادية تلقائياً
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

/* ─── 🆕 تحويل Float32Array → مضغوطة (الافتراضي الآن) ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  // 🗜️ ضغط تلقائي عند الحفظ!
  return compressFaceDescriptor(descriptor);
};

/* ─── تحويل بدون ضغط (للحالات الخاصة) ─── */
export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};