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

export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = MODEL_URLS[attempt % MODEL_URLS.length];
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(url),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
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

/* ─── قدرة الجهاز ─── */
const getDeviceInputSize = (): 160 | 224 | 320 | 416 | 512 | 608 => {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  if (cores >= 8 && memory >= 6) return 608;
  if (cores >= 4 && memory >= 3) return 416;
  return 320;
};

/* ─── إعدادات ديناميكية حسب الجهاز ─── */
const getDetectorOptions = () => {
  const inputSize = getDeviceInputSize();
  return new faceapi.TinyFaceDetectorOptions({
    inputSize,
    scoreThreshold: 0.38,
  });
};

/* ─── SSD للأجهزة القوية ─── */
const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.35,
  maxResults: 10,
});

/* ─── Canvas Pool (إعادة استخدام بدل إنشاء جديد) ─── */
const canvasPool: HTMLCanvasElement[] = [];

const getPooledCanvas = (): HTMLCanvasElement => {
  if (canvasPool.length > 0) return canvasPool.pop()!;
  const c = document.createElement('canvas');
  c.getContext('2d', { willReadFrequently: true });
  return c;
};

const returnCanvas = (c: HTMLCanvasElement) => {
  if (canvasPool.length < 5) canvasPool.push(c);
};

/* ─── Canvas مشترك للمعالجة الأساسية ─── */
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
  sharedCtx.filter = 'contrast(1.15) brightness(1.05)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';

  return canvas;
};

/* ─── معالجة إطار بإعدادات مرنة (للبصمة) ─── */
const preprocessFrameVariant = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth: number,
  contrast: number,
  brightness: number
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = getPooledCanvas();
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { returnCanvas(canvas); return input as HTMLCanvasElement; }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = `contrast(${contrast}) brightness(${brightness})`;
  ctx.drawImage(input, 0, 0, w, h);
  ctx.filter = 'none';

  return canvas;
};

/* ─── متوسط البصمات (لدقة أعلى) ─── */
export const averageDescriptors = (descriptors: Float32Array[]): Float32Array => {
  if (descriptors.length === 0) throw new Error('لا توجد بصمات');
  if (descriptors.length === 1) return descriptors[0];

  const len = descriptors[0].length;
  const avg = new Float32Array(len);

  for (const desc of descriptors) {
    for (let i = 0; i < len; i++) avg[i] += desc[i];
  }
  for (let i = 0; i < len; i++) avg[i] /= descriptors.length;

  return avg;
};

/* ─── استخراج بصمة مع تعزيز (حجاب + نظارات) ─── */
export const extractFaceDescriptorRich = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const variants: [number, number, number][] = [
    [640, 1.0, 1.0],
    [640, 1.25, 1.08],
    [640, 1.1, 1.18],
  ];

  for (const [tw, c, b] of variants) {
    const canvas = preprocessFrameVariant(input, tw, c, b);
    try {
      let result = await faceapi
        .detectSingleFace(canvas, getDetectorOptions())
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (result?.descriptor) return result.descriptor;

      result = await faceapi
        .detectSingleFace(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.28 })
        )
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (result?.descriptor) return result.descriptor;
    } finally {
      if (canvas !== input) returnCanvas(canvas);
    }
  }

  return null;
};

/* ─── بصمة واحدة (أصلية) ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 640);

  let result = await faceapi
    .detectSingleFace(processed, getDetectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!result) {
    result = await faceapi
      .detectSingleFace(
        processed,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.32 })
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }

  return result?.descriptor || null;
};

/* ─── كل الوجوه (أساسي) ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 1280);

  return faceapi
    .detectAllFaces(processed, getDetectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* ─── كشف هجين (بالتسلسل) ─── */
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

  if (isHighEnd) {
    let tiny: any[] = [];
    try {
      tiny = await faceapi
        .detectAllFaces(processed, options)
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch {
      tiny = [];
    }

    const merged = [...tiny];
    const IOU_THRESHOLD = 0.4;

    let ssd: any[] = [];
    try {
      ssd = await faceapi
        .detectAllFaces(processed, detectorOptionsSSD)
        .withFaceLandmarks(true)
        .withFaceDescriptors();
    } catch {
      ssd = [];
    }

    ssd.forEach((face: any) => {
      const isDup = merged.some(
        (m) => calculateIoU(m.detection.box, face.detection.box) > IOU_THRESHOLD
      );
      if (!isDup) merged.push(face);
    });

    return merged;
  }

  try {
    return await faceapi
      .detectAllFaces(processed, options)
      .withFaceLandmarks(true)
      .withFaceDescriptors();
  } catch {
    return [];
  }
};

/* ─── IoU ─── */
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
    (Array.isArray(desc2) && desc2.every((v) => Number.isInteger(v)))
      ? ensureDecompressed(desc2)
      : Array.isArray(desc2)
      ? desc2
      : Array.from(desc2 as Float32Array);
  const b = new Float32Array(desc2Array);
  return faceapi.euclideanDistance(a, b);
};

/* ─── أفضل تطابق مع Cache ─── */
export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

// cache للبصمات المحولة
const descriptorCache = new WeakMap<object, Float32Array>();

const getOrConvertDescriptor = (item: { faceDescriptor?: number[] | string }): Float32Array | null => {
  if (!item.faceDescriptor) return null;

  const cached = descriptorCache.get(item);
  if (cached) return cached;

  const arr =
    typeof item.faceDescriptor === 'string' ||
    (Array.isArray(item.faceDescriptor) && item.faceDescriptor.every((v: any) => Number.isInteger(v)))
      ? ensureDecompressed(item.faceDescriptor)
      : item.faceDescriptor;

  const fa = new Float32Array(arr as number[]);
  descriptorCache.set(item, fa);
  return fa;
};

export const findBestMatch = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold = 0.5
): FaceMatchResult<T> | null => {
  let best: FaceMatchResult<T> | null = null;

  for (const item of items) {
    const stored = getOrConvertDescriptor(item);
    if (!stored) continue;

    const distance = faceapi.euclideanDistance(queryDescriptor, stored);
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
export const descriptorToArray = (descriptor: Float32Array): number[] =>
  compressFaceDescriptor(descriptor);

export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] =>
  Array.from(descriptor);