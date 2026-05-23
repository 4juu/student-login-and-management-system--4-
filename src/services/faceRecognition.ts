// faceRecognition.ts - محسّن
import * as faceapi from 'face-api.js';
import {
  compressFaceDescriptor,
  ensureDecompressed,
} from './faceCompression';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

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
  scoreThreshold: 0.35,
});

const detectorOptionsRegister = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.4,
});

const detectorOptionsBulk = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.3,
});

// منع التشغيل المتزامن
let isProcessing = false;

const cropAndEnlargeFace = (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: faceapi.Box,
  padding = 0.35,
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const targetSize = 160;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  const srcW =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  const padX = box.width * padding;
  const padY = box.height * padding;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(srcW - x, box.width + padX * 2);
  const h = Math.min(srcH - y, box.height + padY * 2);

  ctx.drawImage(source, x, y, w, h, 0, 0, targetSize, targetSize);
  return canvas;
};

export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  // التحقق من جاهزية الـ video
  if (input instanceof HTMLVideoElement) {
    if (input.readyState < 2 || input.videoWidth === 0) return null;
  }

  try {
    const detection = await faceapi
      .detectSingleFace(input, detectorOptionsRegister)
      .withFaceLandmarks(true);

    if (!detection) {
      // محاولة مباشرة بدون تكبير
      const direct = await faceapi
        .detectSingleFace(input, detectorOptionsRegister)
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      return direct?.descriptor || null;
    }

    const faceCanvas = cropAndEnlargeFace(input, detection.detection.box);

    const result = await faceapi
      .detectSingleFace(faceCanvas, detectorOptionsRegister)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (result) return result.descriptor;

    // fallback
    const fallback = await faceapi
      .detectSingleFace(input, detectorOptionsRegister)
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return fallback?.descriptor || null;
  } catch {
    return null;
  }
};

export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  isBulk = false,
) => {
  if (!modelsLoaded) await loadFaceModels();
  if (isProcessing) return [];

  if (input instanceof HTMLVideoElement) {
    if (input.readyState < 2 || input.videoWidth === 0) return [];
  }

  isProcessing = true;
  try {
    const opts = isBulk ? detectorOptionsBulk : detectorOptions;

    const detections = await faceapi
      .detectAllFaces(input, opts)
      .withFaceLandmarks(true);

    if (detections.length === 0) return [];

    const results: faceapi.WithFaceDescriptor<
      faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>
    >[] = [];

    for (const detection of detections) {
      try {
        if (detection.detection.box.width < 25) continue;

        const faceCanvas = cropAndEnlargeFace(input, detection.detection.box);

        const result = await faceapi
          .detectSingleFace(faceCanvas, detectorOptionsRegister)
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (result) {
          results.push({
            detection: detection.detection,
            landmarks: detection.landmarks,
            unshiftedLandmarks: detection.unshiftedLandmarks,
            alignedRect: detection.alignedRect,
            descriptor: result.descriptor,
          } as any);
        }
      } catch {
        // تجاهل الوجه الفاشل
      }
    }

    if (results.length === 0) {
      return await faceapi
        .detectAllFaces(input, opts)
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    }

    return results;
  } finally {
    isProcessing = false;
  }
};

export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string,
): number => {
  const a =
    desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);

  const desc2Array =
    typeof desc2 === 'string' ||
    (Array.isArray(desc2) && desc2.every((v) => Number.isInteger(v)))
      ? ensureDecompressed(desc2)
      : Array.isArray(desc2)
        ? desc2
        : Array.from(desc2);

  const b = new Float32Array(desc2Array);
  return faceapi.euclideanDistance(a, b);
};

export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <
  T extends { faceDescriptor?: number[] | string },
>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold = 0.5,
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

export const descriptorToArray = (descriptor: Float32Array): number[] =>
  compressFaceDescriptor(descriptor);

export const descriptorToArrayUncompressed = (
  descriptor: Float32Array,
): number[] => Array.from(descriptor);