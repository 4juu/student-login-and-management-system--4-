// faceRecognition.ts
import * as faceapi from 'face-api.js';
import { compressFaceDescriptor, ensureDecompressed } from './faceCompression';

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
          faceapi.nets.faceLandmark68Net.loadFromUri(url),
          faceapi.nets.faceRecognitionNet.loadFromUri(url),
          faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        ]);
        modelsLoaded = true;
        loadingPromise = null;
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

export const resetModels = () => { modelsLoaded = false; loadingPromise = null; };
export const areModelsLoaded = () => modelsLoaded;

const getDeviceInputSize = (): 160 | 224 | 320 | 416 | 512 | 608 => {
  const cores  = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory  || 2;
  if (cores >= 8 && memory >= 6) return 608;
  if (cores >= 4 && memory >= 3) return 416;
  return 320;
};

const getDetectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({ inputSize: getDeviceInputSize(), scoreThreshold: 0.38 });

const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 10 });

/* ─── Canvas مشترك للكشف السريع فقط ─── */
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx:    CanvasRenderingContext2D | null = null;

const getSharedCanvas = (w: number, h: number) => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCtx    = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  sharedCanvas.width = w; sharedCanvas.height = h;
  return sharedCanvas;
};

/* ─── preprocess للكشف السريع (مع فلتر) ─── */
const preprocessFrame = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 1280
): HTMLCanvasElement => {
  const vw = 'videoWidth'  in input ? input.videoWidth  : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const canvas = getSharedCanvas(w, h);
  if (!sharedCtx) return input as HTMLCanvasElement;

  sharedCtx.imageSmoothingEnabled  = true;
  sharedCtx.imageSmoothingQuality  = 'high';
  sharedCtx.filter = 'contrast(1.15) brightness(1.05)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';
  return canvas;
};

/* ─── preprocess للتسجيل (بدون فلتر، canvas مستقل) ─── */
const preprocessForEnrollment = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 960
): HTMLCanvasElement => {
  const vw = 'videoWidth'  in input ? input.videoWidth  : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return input as HTMLCanvasElement;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(input, 0, 0, w, h);
  return canvas;
};

/* ─── تطبيع descriptor ─── */
const normalizeDescriptor = (d: Float32Array): Float32Array => {
  const out = new Float32Array(d);
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) out[i] /= norm;
  return out;
};

/* ─── متوسط descriptors ─── */
const meanDescriptor = (descs: Float32Array[]): Float32Array => {
  const merged = new Float32Array(128);
  for (const d of descs) for (let i = 0; i < 128; i++) merged[i] += d[i];
  for (let i = 0; i < 128; i++) merged[i] /= descs.length;
  return normalizeDescriptor(merged);
};

/* ─── استبعاد outliers ─── */
const filterOutliers = (descs: Float32Array[], maxDist = 0.30): Float32Array[] => {
  if (descs.length <= 2) return descs;
  const center = meanDescriptor(descs);
  const filtered = descs.filter(d => faceapi.euclideanDistance(d, center) <= maxDist);
  return filtered.length >= 2 ? filtered : descs.slice(0, 2);
};

/* ─── تقييم جودة اللقطة ─── */
interface FrameQuality {
  score:      number;   // detection score
  areaRatio:  number;   // نسبة مساحة الوجه
  centerDist: number;   // بُعده عن المنتصف (0 = مركز)
  quality:    number;   // وزن مجمّع
}

const evaluateFrameQuality = (
  detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>,
  imgW: number,
  imgH: number
): FrameQuality => {
  const box       = detection.detection.box;
  const score     = detection.detection.score;
  const areaRatio = (box.width * box.height) / (imgW * imgH);
  const cx        = (box.x + box.width  / 2) / imgW;
  const cy        = (box.y + box.height / 2) / imgH;
  const centerDist= Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
  const quality   = score * 0.5 + Math.min(areaRatio / 0.25, 1) * 0.3 + (1 - centerDist * 2) * 0.2;
  return { score, areaRatio, centerDist, quality };
};

/* ══════════════════════════════════════════════════════════
   extractFaceDescriptorMultiCapture — محسّن
══════════════════════════════════════════════════════════ */
export const extractFaceDescriptorMultiCapture = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const STABILIZE_MS   = 800;   // انتظار تثبيت الكاميرا
  const CAPTURE_MS     = 2500;  // وقت الالتقاط الفعلي
  const INTERVAL_MS    = 280;
  const MIN_SCORE      = 0.60;
  const MIN_AREA       = 0.05;
  const MAX_CENTER_DIST= 0.40;
  const MIN_GOOD       = 3;
  const MAX_CAPTURES   = 12;

  onProgress?.(0);

  /* ─── مرحلة التثبيت ─── */
  const stabilizeEnd = Date.now() + STABILIZE_MS;
  let stabilized = false;

  while (Date.now() < stabilizeEnd) {
    const prog = Math.round(((STABILIZE_MS - (stabilizeEnd - Date.now())) / STABILIZE_MS) * 15);
    onProgress?.(prog);

    try {
      const processed = preprocessForEnrollment(input, 640);
      const det = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.50 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (det.length === 1 && det[0].detection.score >= MIN_SCORE) {
        stabilized = true;
        break;
      }
    } catch { /* تجاهل */ }

    await new Promise(r => setTimeout(r, 150));
  }

  /* ─── إذا ما ثبت الوجه، جرب الـ fallback ─── */
  if (!stabilized) {
    try {
      const processed = preprocessForEnrollment(input, 640);
      const det = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.40 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (det.length !== 1) { onProgress?.(0); return null; }
    } catch { onProgress?.(0); return null; }
  }

  onProgress?.(15);

  /* ─── مرحلة الالتقاط ─── */
  const goodFrames:  Array<{ descriptor: Float32Array; quality: number }> = [];
  const captureEnd   = Date.now() + CAPTURE_MS;
  let   attempts     = 0;

  while (Date.now() < captureEnd && goodFrames.length < MAX_CAPTURES) {
    attempts++;
    const elapsed  = Date.now() - (captureEnd - CAPTURE_MS);
    const progress = 15 + Math.min(75, Math.round((elapsed / CAPTURE_MS) * 75));
    onProgress?.(progress);

    try {
      const processed = preprocessForEnrollment(input, 960);
      const imgW = processed.width;
      const imgH = processed.height;

      /* ─── SSD أولاً ─── */
      let detections = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      /* ─── fallback: Tiny بـ inputSize كبير ─── */
      if (detections.length === 0) {
        detections = await faceapi
          .detectAllFaces(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.50 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      /* ─── لازم وجه واحد فقط ─── */
      if (detections.length !== 1) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      const det = detections[0];
      const q   = evaluateFrameQuality(det, imgW, imgH);

      /* ─── شروط الجودة ─── */
      if (q.score      < MIN_SCORE)       { await new Promise(r => setTimeout(r, INTERVAL_MS)); continue; }
      if (q.areaRatio  < MIN_AREA)        { await new Promise(r => setTimeout(r, INTERVAL_MS)); continue; }
      if (q.centerDist > MAX_CENTER_DIST) { await new Promise(r => setTimeout(r, INTERVAL_MS)); continue; }

      goodFrames.push({ descriptor: normalizeDescriptor(det.descriptor), quality: q.quality });

    } catch (e) {
      console.warn('capture error:', e);
    }

    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }

  onProgress?.(92);

  if (goodFrames.length < MIN_GOOD) {
    console.warn(`❌ لقطات كافية: ${goodFrames.length}/${MIN_GOOD}`);
    onProgress?.(0);
    return null;
  }

  /* ─── رتّب حسب الجودة وخذ أفضل 8 ─── */
  goodFrames.sort((a, b) => b.quality - a.quality);
  const topFrames = goodFrames.slice(0, 8).map(f => f.descriptor);

  /* ─── استبعاد outliers ─── */
  const filtered = filterOutliers(topFrames, 0.30);

  /* ─── دمج موزون حسب الجودة ─── */
  const topWithQuality = goodFrames.slice(0, 8).filter(f =>
    filtered.some(fd => fd === f.descriptor)
  );

  let totalWeight = 0;
  const merged    = new Float32Array(128);

  for (const { descriptor, quality } of topWithQuality) {
    const w = quality * quality; // تربيع الجودة = وزن أكبر للأفضل
    for (let i = 0; i < 128; i++) merged[i] += descriptor[i] * w;
    totalWeight += w;
  }

  if (totalWeight === 0) {
    onProgress?.(0);
    return null;
  }

  for (let i = 0; i < 128; i++) merged[i] /= totalWeight;

  const final = normalizeDescriptor(merged);
  onProgress?.(100);

  console.log(`✅ دُمج ${topWithQuality.length} من ${goodFrames.length} لقطة جيدة (${attempts} محاولة)`);
  return final;
};

/* ─── بصمة واحدة ─── */
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
      .detectSingleFace(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.32 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }

  return result?.descriptor || null;
};

/* ─── كل الوجوه ─── */
export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();
  return faceapi
    .detectAllFaces(preprocessFrame(input, 1280), getDetectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

/* ─── هجين ─── */
export const extractAllFaceDescriptorsHybrid = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  const cores    = navigator.hardwareConcurrency || 2;
  const memory   = (navigator as any).deviceMemory || 2;
  const isHighEnd= cores >= 8 && memory >= 6;
  const processed= preprocessFrame(input, isHighEnd ? 1280 : 960);
  const options  = getDetectorOptions();

  if (isHighEnd) {
    let tiny: any[] = [];
    try { tiny = await faceapi.detectAllFaces(processed, options).withFaceLandmarks(true).withFaceDescriptors(); } catch { tiny = []; }

    let ssd: any[] = [];
    try { ssd  = await faceapi.detectAllFaces(processed, detectorOptionsSSD).withFaceLandmarks(true).withFaceDescriptors(); } catch { ssd = []; }

    const merged = [...tiny];
    ssd.forEach((face: any) => {
      const isDup = merged.some(m => calculateIoU(m.detection.box, face.detection.box) > 0.4);
      if (!isDup) merged.push(face);
    });
    return merged;
  }

  try {
    return await faceapi.detectAllFaces(processed, options).withFaceLandmarks(true).withFaceDescriptors();
  } catch { return []; }
};

/* ─── IoU ─── */
function calculateIoU(
  b1: { x: number; y: number; width: number; height: number },
  b2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(b1.x, b2.x), y1 = Math.max(b1.y, b2.y);
  const x2 = Math.min(b1.x + b1.width,  b2.x + b2.width);
  const y2 = Math.min(b1.y + b1.height, b2.y + b2.height);
  if (x2 < x1 || y2 < y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (b1.width * b1.height + b2.width * b2.height - inter);
}

/* ─── مقارنة ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  const desc2Array =
    typeof desc2 === 'string' || (Array.isArray(desc2) && desc2.every(v => Number.isInteger(v)))
      ? ensureDecompressed(desc2)
      : Array.isArray(desc2) ? desc2 : Array.from(desc2 as Float32Array);
  return faceapi.euclideanDistance(a, new Float32Array(desc2Array));
};

/* ─── أفضل تطابق ─── */
export interface FaceMatchResult<T> { item: T; distance: number; confidence: number; }

export const findBestMatch = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold = 0.50
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

/* ─── تحويل ─── */
export const descriptorToArray             = (d: Float32Array) => compressFaceDescriptor(d);
export const descriptorToArrayUncompressed = (d: Float32Array) => Array.from(d);