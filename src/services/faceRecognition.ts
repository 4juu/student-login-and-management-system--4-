import * as faceapi from 'face-api.js';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

// ✅ تحميل الموديلات من CDN - بدون تحميل يدوي
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

/* ─── تحميل الموديلات (مرة وحدة فقط) ─── */
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

/* ─── إعدادات الكاشف (سريعة) ─── */
const detectorOptions = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
});

/* ─── استخراج بصمة من فيديو/صورة ─── */
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

/* ─── استخراج كل الوجوه (للوضع المتعدد) ─── */
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
  desc2: Float32Array | number[]
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  const b = desc2 instanceof Float32Array ? desc2 : new Float32Array(desc2);
  return faceapi.euclideanDistance(a, b);
};

/* ─── البحث عن أفضل تطابق من قائمة ─── */
export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <T extends { faceDescriptor?: number[] }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold: number = 0.5
): FaceMatchResult<T> | null => {
  let best: FaceMatchResult<T> | null = null;

  for (const item of items) {
    if (!item.faceDescriptor || item.faceDescriptor.length === 0) continue;

    const distance = compareFaces(queryDescriptor, item.faceDescriptor);

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

/* ─── تحويل Float32Array → Array عادي للحفظ ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] => {
  return Array.from(descriptor);
};