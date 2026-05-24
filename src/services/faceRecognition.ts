// services/faceRecognition.ts
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
        console.warn(`⚠️ attempt ${attempt + 1} failed:`, e);
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
  const c = navigator.hardwareConcurrency || 2;
  const m = (navigator as any).deviceMemory || 2;
  if (c >= 8 && m >= 6) return 608;
  if (c >= 4 && m >= 3) return 416;
  return 320;
};

const getDetectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({ inputSize: getDeviceInputSize(), scoreThreshold: 0.38 });

const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 10 });

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;
const getSharedCanvas = (w: number, h: number) => {
  if (!sharedCanvas) { sharedCanvas = document.createElement('canvas'); sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true }); }
  sharedCanvas.width = w; sharedCanvas.height = h;
  return sharedCanvas;
};

const preprocessFrame = (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, targetWidth = 1280): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;
  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  const canvas = getSharedCanvas(w, h);
  if (!sharedCtx) return input as HTMLCanvasElement;
  sharedCtx.imageSmoothingEnabled = true;
  sharedCtx.imageSmoothingQuality = 'high';
  sharedCtx.filter = 'contrast(1.15) brightness(1.05)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';
  return canvas;
};

const preprocessForEnrollment = (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, targetWidth = 960): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) return input as HTMLCanvasElement;
  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return input as HTMLCanvasElement;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(input, 0, 0, w, h);
  return canvas;
};

const normalizeDescriptor = (d: Float32Array): Float32Array => {
  const out = new Float32Array(d);
  let norm = 0;
  for (let i = 0; i < 128; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 128; i++) out[i] /= norm;
  return out;
};

const meanDescriptor = (descs: Float32Array[]): Float32Array => {
  const merged = new Float32Array(128);
  for (const d of descs) for (let i = 0; i < 128; i++) merged[i] += d[i];
  for (let i = 0; i < 128; i++) merged[i] /= descs.length;
  return normalizeDescriptor(merged);
};

const filterOutliers = (descs: Float32Array[], maxDist = 0.30): Float32Array[] => {
  if (descs.length <= 2) return descs;
  const center = meanDescriptor(descs);
  const filtered = descs.filter(d => faceapi.euclideanDistance(d, center) <= maxDist);
  return filtered.length >= 2 ? filtered : descs.slice(0, Math.max(2, descs.length));
};

/* ─── كشف اتجاه الوجه من landmarks ─── */
export type FaceDirection = 'center' | 'left' | 'right' | 'up' | 'down';

export const detectFaceDirection = (landmarks: faceapi.FaceLandmarks68): FaceDirection => {
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();

  if (nose.length < 4 || jaw.length < 17) return 'center';

const noseTip = nose[3];

const jawLeft = jaw[0];
const jawRight = jaw[16];

  const faceWidth = Math.sqrt(
    (jawRight.x - jawLeft.x) ** 2 + (jawRight.y - jawLeft.y) ** 2
  );

  // نسبة المسافة من الأنف لكل طرف
  const distToLeft = Math.abs(noseTip.x - jawLeft.x);
  const distToRight = Math.abs(noseTip.x - jawRight.x);
  const horizontalRatio = distToLeft / (distToLeft + distToRight);

  // كشف الميلان العمودي
  const leftEyeCenter = {
    x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
    y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
  };
  const rightEyeCenter = {
    x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
    y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
  };
  const eyeMidY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
  const verticalDist = noseTip.y - eyeMidY;
  const verticalRatio = verticalDist / faceWidth;

  // فوق/تحت
  if (verticalRatio < 0.28) return 'up';
  if (verticalRatio > 0.52) return 'down';

  // يمين/يسار (بالنسبة للوجه الأصلي)
  if (horizontalRatio < 0.38) return 'right';
  if (horizontalRatio > 0.62) return 'left';

  return 'center';
};

/* ─── معلومات جودة الفريم ─── */
interface FrameQuality {
  score: number;
  areaRatio: number;
  centerDist: number;
  quality: number;
  direction: FaceDirection;
}

const evaluateFrameQuality = (
  detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>,
  imgW: number, imgH: number
): FrameQuality => {
  const box = detection.detection.box;
  const score = detection.detection.score;
  const areaRatio = (box.width * box.height) / (imgW * imgH);
  const cx = (box.x + box.width / 2) / imgW;
  const cy = (box.y + box.height / 2) / imgH;
  const centerDist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
  const direction = detectFaceDirection(detection.landmarks);
  const quality = score * 0.5 + Math.min(areaRatio / 0.25, 1) * 0.3 + (1 - centerDist * 2) * 0.2;
  return { score, areaRatio, centerDist, quality, direction };
};

/* ══════════════════════════════════════════════════════════
   extractFaceDescriptorMultiCapture — 10 ثواني مع دوران
══════════════════════════════════════════════════════════ */
export interface CaptureProgress {
  progress: number;
  phase: 'stabilize' | 'capture';
  direction: FaceDirection;
  directionLabel: string;
  capturedDirections: Set<FaceDirection>;
  totalGood: number;
  currentScore: number;
  faceDetected: boolean;
}

const DIRECTION_LABELS: Record<FaceDirection, string> = {
  center: '👤 انظر للأمام',
  right: '👉 أدر رأسك لليمين',
  left: '👈 أدر رأسك لليسار',
  up: '👆 ارفع رأسك للأعلى',
  down: '👇 انزل رأسك للأسفل',
};

const DIRECTION_SEQUENCE: FaceDirection[] = ['center', 'right', 'left', 'up', 'down', 'center'];

export const extractFaceDescriptorMultiCapture = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  onProgress?: (info: CaptureProgress) => void
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const TOTAL_MS = 10000;
  const STABILIZE_MS = 1000;
  const INTERVAL_MS = 250;
  const MIN_SCORE = 0.55;
  const MIN_AREA = 0.04;
  const MAX_CENTER = 0.42;
  const MIN_GOOD = 5;

  const capturedDirections = new Set<FaceDirection>();
  const allFrames: Array<{ descriptor: Float32Array; quality: number; direction: FaceDirection }> = [];

  const reportProgress = (p: number, phase: 'stabilize' | 'capture', dir: FaceDirection, detected: boolean, score = 0) => {
    onProgress?.({
      progress: p,
      phase,
      direction: dir,
      directionLabel: DIRECTION_LABELS[dir],
      capturedDirections: new Set(capturedDirections),
      totalGood: allFrames.length,
      currentScore: Math.round(score * 100),
      faceDetected: detected,
    });
  };

  /* ─── تثبيت ─── */
  const stabEnd = Date.now() + STABILIZE_MS;
  let stabilized = false;

  while (Date.now() < stabEnd) {
    const p = Math.round(((STABILIZE_MS - (stabEnd - Date.now())) / STABILIZE_MS) * 10);
    reportProgress(p, 'stabilize', 'center', false);
    try {
      const processed = preprocessForEnrollment(input, 640);
      const det = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (det.length === 1 && det[0].detection.score >= MIN_SCORE) {
        stabilized = true;
        reportProgress(p, 'stabilize', 'center', true, det[0].detection.score);
        break;
      }
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 150));
  }

  if (!stabilized) {
    try {
      const processed = preprocessForEnrollment(input, 640);
      const det = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (det.length !== 1) return null;
    } catch { return null; }
  }

  reportProgress(10, 'capture', 'center', true);

  /* ─── الالتقاط 10 ثواني ─── */
  const captureStart = Date.now();
  const captureEnd = captureStart + (TOTAL_MS - STABILIZE_MS);

  while (Date.now() < captureEnd) {
    const elapsed = Date.now() - captureStart;
    const totalCapture = TOTAL_MS - STABILIZE_MS;
    const ratio = elapsed / totalCapture;
    const progress = 10 + Math.min(85, Math.round(ratio * 85));

    // حدد الاتجاه المطلوب حسب الوقت
    const seqIdx = Math.min(
      DIRECTION_SEQUENCE.length - 1,
      Math.floor(ratio * DIRECTION_SEQUENCE.length)
    );
    const requiredDir = DIRECTION_SEQUENCE[seqIdx];

    try {
      const processed = preprocessForEnrollment(input, 960);
      const imgW = processed.width, imgH = processed.height;

      let detections = await faceapi
        .detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.50 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        detections = await faceapi
          .detectAllFaces(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.45 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      if (detections.length !== 1) {
        reportProgress(progress, 'capture', requiredDir, false);
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      const det = detections[0];
      const q = evaluateFrameQuality(det, imgW, imgH);

      reportProgress(progress, 'capture', requiredDir, true, q.score);

      if (q.score < MIN_SCORE || q.areaRatio < MIN_AREA || q.centerDist > MAX_CENTER) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      capturedDirections.add(q.direction);
      allFrames.push({
        descriptor: normalizeDescriptor(det.descriptor),
        quality: q.quality,
        direction: q.direction,
      });

    } catch (e) {
      console.warn('capture error:', e);
    }

    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }

  reportProgress(96, 'capture', 'center', true);

  if (allFrames.length < MIN_GOOD) {
    console.warn(`❌ لقطات: ${allFrames.length}/${MIN_GOOD}`);
    return null;
  }

  /* ─── اختيار أفضل لقطات من كل اتجاه ─── */
  const byDirection = new Map<FaceDirection, typeof allFrames>();
  for (const f of allFrames) {
    if (!byDirection.has(f.direction)) byDirection.set(f.direction, []);
    byDirection.get(f.direction)!.push(f);
  }

  const selected: typeof allFrames = [];
  const MAX_PER_DIR = 4;

  for (const [, frames] of byDirection) {
    frames.sort((a, b) => b.quality - a.quality);
    selected.push(...frames.slice(0, MAX_PER_DIR));
  }

  // أضف المتبقي من أفضل الكل إذا أقل من 12
  if (selected.length < 12) {
    const remaining = allFrames
      .filter(f => !selected.includes(f))
      .sort((a, b) => b.quality - a.quality);
    for (const f of remaining) {
      if (selected.length >= 12) break;
      selected.push(f);
    }
  }

  const descriptors = selected.map(f => f.descriptor);
  const filtered = filterOutliers(descriptors, 0.32);

  /* ─── دمج موزون ─── */
  const filteredWithQ = selected.filter(f => filtered.includes(f.descriptor));
  let totalWeight = 0;
  const merged = new Float32Array(128);

  for (const { descriptor, quality } of filteredWithQ) {
    const w = quality * quality;
    for (let i = 0; i < 128; i++) merged[i] += descriptor[i] * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return null;
  for (let i = 0; i < 128; i++) merged[i] /= totalWeight;

  const final = normalizeDescriptor(merged);

  reportProgress(100, 'capture', 'center', true);
  console.log(
    `✅ دمج ${filteredWithQ.length} من ${allFrames.length} لقطة | اتجاهات: ${[...capturedDirections].join(',')}`
  );

  return final;
};

/* ─── باقي الدوال بدون تغيير ─── */
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 640);
  let result = await faceapi.detectSingleFace(processed, getDetectorOptions()).withFaceLandmarks(true).withFaceDescriptor();
  if (!result) result = await faceapi.detectSingleFace(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.32 })).withFaceLandmarks(true).withFaceDescriptor();
  return result?.descriptor || null;
};

export const extractAllFaceDescriptors = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => {
  if (!modelsLoaded) await loadFaceModels();
  return faceapi.detectAllFaces(preprocessFrame(input, 1280), getDetectorOptions()).withFaceLandmarks(true).withFaceDescriptors();
};

export const extractAllFaceDescriptorsHybrid = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => {
  if (!modelsLoaded) await loadFaceModels();
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  const isHigh = cores >= 8 && memory >= 6;
  const processed = preprocessFrame(input, isHigh ? 1280 : 960);
  const options = getDetectorOptions();

  if (isHigh) {
    let tiny: any[] = []; try { tiny = await faceapi.detectAllFaces(processed, options).withFaceLandmarks(true).withFaceDescriptors(); } catch { tiny = []; }
    let ssd: any[] = []; try { ssd = await faceapi.detectAllFaces(processed, detectorOptionsSSD).withFaceLandmarks(true).withFaceDescriptors(); } catch { ssd = []; }
    const merged = [...tiny];
    ssd.forEach((f: any) => { if (!merged.some(m => calculateIoU(m.detection.box, f.detection.box) > 0.4)) merged.push(f); });
    return merged;
  }
  try { return await faceapi.detectAllFaces(processed, options).withFaceLandmarks(true).withFaceDescriptors(); } catch { return []; }
};

function calculateIoU(b1: { x: number; y: number; width: number; height: number }, b2: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(b1.x, b2.x), y1 = Math.max(b1.y, b2.y);
  const x2 = Math.min(b1.x + b1.width, b2.x + b2.width), y2 = Math.min(b1.y + b1.height, b2.y + b2.height);
  if (x2 < x1 || y2 < y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (b1.width * b1.height + b2.width * b2.height - inter);
}

export const compareFaces = (desc1: Float32Array | number[], desc2: Float32Array | number[] | string): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  const arr = typeof desc2 === 'string' || (Array.isArray(desc2) && desc2.every(v => Number.isInteger(v)))
    ? ensureDecompressed(desc2) : Array.isArray(desc2) ? desc2 : Array.from(desc2 as Float32Array);
  return faceapi.euclideanDistance(a, new Float32Array(arr));
};

export interface FaceMatchResult<T> { item: T; distance: number; confidence: number; }

export const findBestMatch = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array, items: T[], threshold = 0.60
): FaceMatchResult<T> | null => {
  let best: FaceMatchResult<T> | null = null;
  for (const item of items) {
    if (!item.faceDescriptor) continue;
    const distance = compareFaces(queryDescriptor, item.faceDescriptor as any);
    if (distance < threshold && (!best || distance < best.distance))
      best = { item, distance, confidence: Math.round((1 - distance / threshold) * 100) };
  }
  return best;
};

export const descriptorToArray = (d: Float32Array) => compressFaceDescriptor(d);
export const descriptorToArrayUncompressed = (d: Float32Array) => Array.from(d);