import * as faceapi from 'face-api.js';
import {
  compressFaceDescriptor,
  ensureDecompressed,
} from './faceCompression';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

const MODEL_URLS = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
];

/* ═══════════════════════════════════════════
   تحميل الموديلات
═══════════════════════════════════════════ */
export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = MODEL_URLS[attempt % MODEL_URLS.length];
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(url),
          faceapi.nets.faceLandmark68Net.loadFromUri(url),
          faceapi.nets.faceRecognitionNet.loadFromUri(url),
          faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        ]);
        modelsLoaded = true;
        loadingPromise = null;
        console.log('✅ موديلات الوجه من:', url);
        return;
      } catch (e) {
        console.warn(`⚠️ محاولة ${attempt + 1} فشلت:`, e);
        loadingPromise = null;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    loadingPromise = null;
    throw new Error('فشل تحميل الموديلات');
  })();

  return loadingPromise;
};

export const resetModels = () => {
  modelsLoaded = false;
  loadingPromise = null;
};

export const areModelsLoaded = () => modelsLoaded;

/* ═══════════════════════════════════════════
   قدرة الجهاز
═══════════════════════════════════════════ */
const getDeviceInputSize = (): 320 | 416 | 512 | 608 => {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  if (cores >= 8 && memory >= 6) return 608;
  if (cores >= 4 && memory >= 3) return 416;
  return 320;
};

const getDetectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({
    inputSize: getDeviceInputSize(),
    scoreThreshold: 0.38,
  });

const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.35,
  maxResults: 10,
});

/* ═══════════════════════════════════════════
   قص الوجه الداخلي (بدون شعر/حجاب)
═══════════════════════════════════════════ */
const cropInnerFace = (
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  landmarks: faceapi.FaceLandmarks68,
  _detection: faceapi.FaceDetection
): HTMLCanvasElement | null => {
  try {
    const jawOutline = landmarks.getJawOutline();
    const leftEyebrow = landmarks.getLeftEyeBrow();
    const rightEyebrow = landmarks.getRightEyeBrow();

    const browTop = Math.min(
      ...leftEyebrow.map(p => p.y),
      ...rightEyebrow.map(p => p.y)
    );
    const jawBottom = Math.max(...jawOutline.map(p => p.y));
    const jawLeft = Math.min(...jawOutline.map(p => p.x));
    const jawRight = Math.max(...jawOutline.map(p => p.x));

    const padY = (jawBottom - browTop) * 0.08;
    const padX = (jawRight - jawLeft) * 0.05;

    const cropX = Math.max(0, jawLeft - padX);
    const cropY = Math.max(0, browTop - padY);
    const cropW = (jawRight - jawLeft) + padX * 2;
    const cropH = (jawBottom - browTop) + padY * 2;

    if (cropW < 30 || cropH < 30) return null;

    const SIZE = 200;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(SIZE / 2, SIZE / 2, SIZE * 0.48, SIZE * 0.48, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'contrast(1.15) brightness(1.05) saturate(0.9)';

    ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, SIZE, SIZE);
    ctx.filter = 'none';
    ctx.restore();

    return canvas;
  } catch {
    return null;
  }
};

/* ═══════════════════════════════════════════
   Canvas مشترك
═══════════════════════════════════════════ */
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

const getSharedCanvas = (w: number, h: number): HTMLCanvasElement => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  sharedCanvas.width = w;
  sharedCanvas.height = h;
  return sharedCanvas;
};

const preprocessFrame = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 1280
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = getSharedCanvas(w, h);
  if (!sharedCtx) return input as HTMLCanvasElement;

  sharedCtx.imageSmoothingEnabled = true;
  sharedCtx.imageSmoothingQuality = 'high';
  sharedCtx.filter = 'contrast(1.12) brightness(1.03)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';

  return canvas;
};

/* ═══════════════════════════════════════════
   دمج بصمتين وتطبيع
═══════════════════════════════════════════ */
const mergeDescriptors = (
  full: Float32Array,
  inner: Float32Array,
  fullWeight = 0.35,
  innerWeight = 0.65
): Float32Array => {
  const merged = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    merged[i] = full[i] * fullWeight + inner[i] * innerWeight;
  }
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += merged[i] * merged[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 128; i++) merged[i] /= norm;
  return merged;
};

/* ═══════════════════════════════════════════
   استخراج بصمة واحدة (داخلي)
═══════════════════════════════════════════ */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const processed = preprocessFrame(input, 640);

  let result = await faceapi
    .detectSingleFace(processed, getDetectorOptions())
    .withFaceLandmarks(false)
    .withFaceDescriptor();

  if (!result) {
    result = await faceapi
      .detectSingleFace(
        processed,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.30 })
      )
      .withFaceLandmarks(false)
      .withFaceDescriptor();
  }

  if (!result) return null;

  const innerFace = cropInnerFace(input, result.landmarks, result.detection);
  if (innerFace) {
    const innerResult = await faceapi
      .detectSingleFace(
        innerFace,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.25 })
      )
      .withFaceLandmarks(false)
      .withFaceDescriptor();

    if (innerResult) {
      return mergeDescriptors(result.descriptor, innerResult.descriptor);
    }
  }

  return result.descriptor;
};

/* ═══════════════════════════════════════════
   استخراج بصمة محسّنة (عدة عيّنات)
═══════════════════════════════════════════ */
export const extractFaceDescriptorEnhanced = async (
  video: HTMLVideoElement,
  numSamples = 3,
  delayMs = 400
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const descriptors: Float32Array[] = [];

  for (let i = 0; i < numSamples; i++) {
    if (video.readyState < 2) break;
    const desc = await extractFaceDescriptor(video);
    if (desc) descriptors.push(desc);
    if (i < numSamples - 1) await new Promise(r => setTimeout(r, delayMs));
  }

  if (descriptors.length === 0) return null;
  if (descriptors.length === 1) return descriptors[0];

  const avg = new Float32Array(128);
  for (const d of descriptors) {
    for (let i = 0; i < 128; i++) avg[i] += d[i];
  }
  for (let i = 0; i < 128; i++) avg[i] /= descriptors.length;

  let norm = 0;
  for (let i = 0; i < 128; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 128; i++) avg[i] /= norm;

  return avg;
};

/* ═══════════════════════════════════════════
   كل الوجوه (متوازن)
═══════════════════════════════════════════ */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 1280);

  return faceapi
    .detectAllFaces(processed, getDetectorOptions())
    .withFaceLandmarks(false)
    .withFaceDescriptors();
};

/* ═══════════════════════════════════════════
   كشف هجين مع قص الوجه الداخلي
═══════════════════════════════════════════ */
export const extractAllFaceDescriptorsHybrid = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  const isHighEnd = cores >= 8 && memory >= 6;

  const targetWidth = isHighEnd ? 1280 : 960;
  const processed = preprocessFrame(input, targetWidth);
  const options = getDetectorOptions();

  let allDetections: faceapi.WithFaceDescriptor<
    faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>
  >[] = [];

  try {
    const tiny = await faceapi
      .detectAllFaces(processed, options)
      .withFaceLandmarks(false)
      .withFaceDescriptors();
    allDetections = [...tiny];
  } catch {
    /* */
  }

  if (isHighEnd) {
    try {
      const ssd = await faceapi
        .detectAllFaces(processed, detectorOptionsSSD)
        .withFaceLandmarks(false)
        .withFaceDescriptors();

      const IOU_T = 0.4;
      ssd.forEach((face: any) => {
        const isDup = allDetections.some(
          m => calculateIoU(m.detection.box, face.detection.box) > IOU_T
        );
        if (!isDup) allDetections.push(face);
      });
    } catch {
      /* */
    }
  }

  const enhanced: typeof allDetections = [];

  for (const det of allDetections) {
    const innerCanvas = cropInnerFace(input, det.landmarks, det.detection);

    if (innerCanvas) {
      try {
        const innerResult = await faceapi
          .detectSingleFace(
            innerCanvas,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 })
          )
          .withFaceLandmarks(false)
          .withFaceDescriptor();

        if (innerResult) {
          const merged = mergeDescriptors(det.descriptor, innerResult.descriptor, 0.4, 0.6);
          enhanced.push({ ...det, descriptor: merged } as any);
          continue;
        }
      } catch {
        /* */
      }
    }

    enhanced.push(det);
  }

  return enhanced;
};

/* ═══════════════════════════════════════════
   IoU
═══════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════
   مقارنة بصمتين
═══════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════
   أفضل تطابق
═══════════════════════════════════════════ */
export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold = 0.5
): FaceMatchResult<T> | null => {
  let best: FaceMatchResult<T> | null = null;
  for (const item of items) {
    if (!item.faceDescriptor) continue;
    const distance = compareFaces(queryDescriptor, item.faceDescriptor as any);
    if (distance < threshold && (!best || distance < best.distance)) {
      best = { item, distance, confidence: Math.round((1 - distance / threshold) * 100) };
    }
  }
  return best;
};

/* ═══════════════════════════════════════════
   تحويل البصمة
═══════════════════════════════════════════ */
export const descriptorToArray = (descriptor: Float32Array): number[] =>
  compressFaceDescriptor(descriptor);

export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] =>
  Array.from(descriptor);