// src/services/faceRecognition.ts
import * as faceapi from 'face-api.js';
import { compressFaceDescriptor, ensureDecompressed } from './faceCompression';
import { getWorker } from './faceWorker';

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

/* ─── Device ─── */
const getDeviceInputSize = (): 160 | 224 | 320 | 416 | 512 | 608 => {
  const c = navigator.hardwareConcurrency || 2, m = (navigator as any).deviceMemory || 2;
  if (c >= 8 && m >= 6) return 608;
  if (c >= 4 && m >= 3) return 416;
  return 320;
};

const getDetectorOptions = () =>
  new faceapi.TinyFaceDetectorOptions({ inputSize: getDeviceInputSize(), scoreThreshold: 0.38 });

const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 10 });

/* ─── Canvas: كل دالة تنشئ canvas خاص بها ─── */

/* ─── كشف مستوى الإضاءة ─── */
export const detectBrightness = (input: HTMLVideoElement | HTMLCanvasElement): number => {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 128;
  try {
    ctx.drawImage(input, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 16) {
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return sum / (data.length / 16);
  } catch {
    return 128;
  }
};

export type LightLevel = 'dark' | 'dim' | 'good' | 'bright';
export const classifyLight = (brightness: number): LightLevel => {
  if (brightness < 50) return 'dark';
  if (brightness < 90) return 'dim';
  if (brightness > 210) return 'bright';
  return 'good';
};

/* ─── preprocess ─── */
const preprocessFrame = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 1280,
  adaptiveLight = false
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  const canvas = document.createElement('canvas');
  if (!vw || !vh) { canvas.width = 1; canvas.height = 1; return canvas; }
  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { canvas.width = 1; canvas.height = 1; return canvas; }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';

  if (adaptiveLight && input instanceof HTMLVideoElement) {
    const brightness = detectBrightness(input);
    const light = classifyLight(brightness);
    if (light === 'dark') ctx.filter = 'brightness(1.8) contrast(1.3)';
    else if (light === 'dim') ctx.filter = 'brightness(1.3) contrast(1.15)';
    else if (light === 'bright') ctx.filter = 'brightness(0.85) contrast(1.1)';
    else ctx.filter = 'contrast(1.1) brightness(1.05)';
  } else {
    ctx.filter = 'contrast(1.1) brightness(1.05)';
  }

  ctx.drawImage(input, 0, 0, w, h);
  ctx.filter = 'none';
  return canvas;
};

const preprocessForEnrollment = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 960,
  adaptiveLight = true
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  const canvas = document.createElement('canvas');
  if (!vw || !vh) { canvas.width = 1; canvas.height = 1; return canvas; }
  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale), h = Math.round(vh * scale);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { canvas.width = 1; canvas.height = 1; return canvas; }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (adaptiveLight && input instanceof HTMLVideoElement) {
    const brightness = detectBrightness(input);
    const light = classifyLight(brightness);
    if (light === 'dark') ctx.filter = 'brightness(1.6) contrast(1.25)';
    else if (light === 'dim') ctx.filter = 'brightness(1.25) contrast(1.1)';
    else if (light === 'bright') ctx.filter = 'brightness(0.9) contrast(1.05)';
    else ctx.filter = 'none';
  }

  ctx.drawImage(input, 0, 0, w, h);
  ctx.filter = 'none';
  return canvas;
};

/* ─── منطقة الكشف ─── */
const cropCenterRegion = (
  input: HTMLVideoElement | HTMLCanvasElement,
  regionRatio = 0.75
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  const rw = Math.round(vw * regionRatio);
  const rh = Math.round(vh * regionRatio);
  const ox = Math.round((vw - rw) / 2);
  const oy = Math.round((vh - rh) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = rw; canvas.height = rh;
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.width = 1; canvas.height = 1; return canvas; }
  ctx.drawImage(input, ox, oy, rw, rh, 0, 0, rw, rh);
  return canvas;
};

/* ─── تطبيع ─── */
export const normalizeDescriptor = (d: Float32Array): Float32Array => {
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

/* ─── كشف اتجاه الوجه ─── */
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

  const faceWidth = Math.sqrt((jawRight.x - jawLeft.x) ** 2 + (jawRight.y - jawLeft.y) ** 2);
  const distToLeft = Math.abs(noseTip.x - jawLeft.x);
  const distToRight = Math.abs(noseTip.x - jawRight.x);
  const horizontalRatio = distToLeft / (distToLeft + distToRight);

  const leC = { x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length, y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length };
  const reC = { x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length, y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length };
  const eyeMidY = (leC.y + reC.y) / 2;
  const verticalRatio = (noseTip.y - eyeMidY) / faceWidth;

  if (verticalRatio < 0.28) return 'up';
  if (verticalRatio > 0.52) return 'down';
  if (horizontalRatio < 0.38) return 'left';
  if (horizontalRatio > 0.62) return 'right';
  return 'center';
};

/* ─── زاوية الدوران ─── */
export const detectRotationAngle = (landmarks: faceapi.FaceLandmarks68): number => {
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  if (nose.length < 4 || jaw.length < 17) return 0;

  const noseTip = nose[3];
  const jawLeft = jaw[0];
  const jawRight = jaw[16];

  const distToLeft = Math.abs(noseTip.x - jawLeft.x);
  const distToRight = Math.abs(noseTip.x - jawRight.x);
  const hRatio = distToLeft / (distToLeft + distToRight);

  const faceWidth = Math.sqrt((jawRight.x - jawLeft.x) ** 2 + (jawRight.y - jawLeft.y) ** 2);
  const leC = { y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length };
  const reC = { y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length };
  const eyeMidY = (leC.y + reC.y) / 2;
  const vRatio = (noseTip.y - eyeMidY) / faceWidth;

  const hAngle = (hRatio - 0.5) * 2;
  const vAngle = (vRatio - 0.4) * 2;

  let angle = Math.atan2(vAngle, hAngle) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
};

/* ─── جودة الفريم ─── */
export interface FrameQuality {
  score: number;
  areaRatio: number;
  centerDist: number;
  quality: number;
  direction: FaceDirection;
  rotationAngle: number;
  brightness: number;
  lightLevel: LightLevel;
}

export type QualityLevel = 'excellent' | 'good' | 'fair' | 'poor';
export const getQualityLevel = (quality: number): QualityLevel => {
  if (quality >= 0.8) return 'excellent';
  if (quality >= 0.6) return 'good';
  if (quality >= 0.4) return 'fair';
  return 'poor';
};

const evaluateFrameQuality = (
  detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }, faceapi.FaceLandmarks68>>,
  imgW: number, imgH: number,
  videoInput?: HTMLVideoElement
): FrameQuality => {
  const box = detection.detection.box;
  const score = detection.detection.score;
  const areaRatio = (box.width * box.height) / (imgW * imgH);
  const cx = (box.x + box.width / 2) / imgW;
  const cy = (box.y + box.height / 2) / imgH;
  const centerDist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
  const direction = detectFaceDirection(detection.landmarks);
  const rotationAngle = detectRotationAngle(detection.landmarks);
  const brightness = videoInput ? detectBrightness(videoInput) : 128;
  const lightLevel = classifyLight(brightness);
  const lightPenalty = lightLevel === 'dark' ? 0.6 : lightLevel === 'dim' ? 0.85 : lightLevel === 'bright' ? 0.9 : 1;
  const quality = (score * 0.4 + Math.min(areaRatio / 0.20, 1) * 0.3 + (1 - centerDist * 2) * 0.2 + 0.1) * lightPenalty;
  return { score, areaRatio, centerDist, quality, direction, rotationAngle, brightness, lightLevel };
};

/* ══════════════════════════════════════════════════════════
   MultiDescriptor — مقارنة متعددة مضغوطة
══════════════════════════════════════════════════════════ */
export interface MultiDescriptor {
  main: number[];
  angles?: number[];
  quality?: number;
  directions?: string;
  version?: number;
}

const TOP_DIMS = 32;

const compressAngleDescriptor = (desc: Float32Array): number[] => {
  const indexed = Array.from(desc).map((v, i) => ({ v: Math.abs(v), i, val: v }));
  indexed.sort((a, b) => b.v - a.v);
  const top = indexed.slice(0, TOP_DIMS);
  const result: number[] = [];
  for (const t of top) {
    result.push(t.i, Math.round(t.val * 10000) / 10000);
  }
  return result;
};

const decompressAngleDescriptor = (compressed: number[]): Float32Array => {
  const desc = new Float32Array(128);
  for (let i = 0; i < compressed.length; i += 2) {
    const idx = compressed[i];
    const val = compressed[i + 1];
    if (idx >= 0 && idx < 128) desc[idx] = val;
  }
  return normalizeDescriptor(desc);
};

export const buildMultiDescriptor = (
  mainDesc: Float32Array,
  angleDescs: Map<FaceDirection, Float32Array[]>,
  overallQuality: number,
  capturedDirs: Set<FaceDirection>
): MultiDescriptor => {
  const angles: number[] = [];
  const dirOrder: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

  for (const dir of dirOrder) {
    const descs = angleDescs.get(dir);
    if (descs && descs.length > 0) {
      const best = meanDescriptor(descs);
      angles.push(...compressAngleDescriptor(best));
    }
  }

  return {
    main: Array.from(mainDesc),
    angles: angles.length > 0 ? angles : undefined,
    quality: Math.round(overallQuality * 100) / 100,
    directions: [...capturedDirs].join(','),
    version: 2,
  };
};

/* ─── helper: تحويل أي بصمة لـ Float32Array ─── */
const toFloat32 = (input: number[] | string | Float32Array): Float32Array => {
  if (input instanceof Float32Array) return input;
  if (typeof input === 'string') return new Float32Array(ensureDecompressed(input));
  if (Array.isArray(input)) {
    if (input.length === 128) return new Float32Array(input);
    if (input.length > 0 && input.length < 128) {
      const looksCompressed = input.length % 2 === 0 &&
        Number.isInteger(input[0]) && input[0] >= 0 && input[0] < 128 &&
        Number.isInteger(input[2]) && input[2] >= 0 && input[2] < 128;
      if (looksCompressed) return new Float32Array(ensureDecompressed(input));
    }
    if (input.length > 0 && input.every(v => Number.isInteger(v))) {
      return new Float32Array(ensureDecompressed(input));
    }
    return new Float32Array(input);
  }
  return new Float32Array(input);
};

/* ─── مقارنة multi-angle ─── */
export const compareMultiDescriptor = (
  query: Float32Array,
  stored: MultiDescriptor
): number => {
  const mainDesc = toFloat32(stored.main);
  const mainDist = faceapi.euclideanDistance(query, mainDesc);

  if (!stored.angles || stored.angles.length === 0) return mainDist;

  const chunkSize = TOP_DIMS * 2;
  const angleCount = Math.floor(stored.angles.length / chunkSize);
  let bestAngleDist = Infinity;

  for (let i = 0; i < angleCount; i++) {
    const chunk = stored.angles.slice(i * chunkSize, (i + 1) * chunkSize);
    const angleDesc = decompressAngleDescriptor(chunk);
    const dist = faceapi.euclideanDistance(query, angleDesc);
    if (dist < bestAngleDist) bestAngleDist = dist;
  }

  return Math.min(mainDist, mainDist * 0.6 + bestAngleDist * 0.4);
};

/* ─── كشف نوع البصمة ─── */
const isMultiDescriptor = (d: any): d is MultiDescriptor => {
  return d !== null && typeof d === 'object' && !Array.isArray(d) && 'main' in d;
};

/* ─── كشف التلاعب ─── */
export interface TamperResult {
  isTamper: boolean;
  matchedStudents: Array<{ id: string; name: string; distance: number }>;
}

export const checkForTampering = <T extends { id: string; name: string; faceDescriptor?: number[] | string | MultiDescriptor }>(
  descriptor: Float32Array,
  allStudents: T[],
  excludeId: string,
  threshold = 0.35
): TamperResult => {
  const matches: Array<{ id: string; name: string; distance: number }> = [];

  for (const s of allStudents) {
    if (s.id === excludeId || !s.faceDescriptor) continue;
    const dist = compareFaces(descriptor, s.faceDescriptor as any);
    if (dist < threshold) matches.push({ id: s.id, name: s.name, distance: dist });
  }

  return { isTamper: matches.length > 0, matchedStudents: matches };
};

export const checkForTamperingAsync = async <T extends { id: string; name: string; faceDescriptor?: number[] | string | MultiDescriptor }>(
  descriptor: Float32Array,
  allStudents: T[],
  excludeId: string,
  threshold = 0.35
): Promise<TamperResult> => {
  const matches: Array<{ id: string; name: string; distance: number }> = [];
  const storedSimple: Array<{ id: string; name: string; desc: number[] }> = [];

  for (const s of allStudents) {
    if (s.id === excludeId || !s.faceDescriptor) continue;
    if (isMultiDescriptor(s.faceDescriptor)) {
      const dist = compareMultiDescriptor(descriptor, s.faceDescriptor);
      if (dist < threshold) matches.push({ id: s.id, name: s.name, distance: dist });
    } else {
      const arr = toFloat32(s.faceDescriptor as any);
      storedSimple.push({ id: s.id, name: s.name, desc: Array.from(arr) });
    }
  }

  if (storedSimple.length === 0) return { isTamper: matches.length > 0, matchedStudents: matches };

  const w = getWorker();
  if (!w) {
    for (const s of storedSimple) {
      const d = faceapi.euclideanDistance(descriptor, new Float32Array(s.desc));
      if (d < threshold) matches.push({ id: s.id, name: s.name, distance: d });
    }
    return { isTamper: matches.length > 0, matchedStudents: matches };
  }

  return new Promise(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'tamperResult') {
        w.removeEventListener('message', handler);
        const wMatches = (e.data.data || []) as Array<{ id: string; name: string; distance: number }>;
        resolve({ isTamper: (matches.length + wMatches.length) > 0, matchedStudents: [...matches, ...wMatches] });
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({
      type: 'tamper',
      data: {
        query: Array.from(descriptor),
        storedDescriptors: storedSimple,
        threshold,
      },
    });
    setTimeout(() => {
      w.removeEventListener('message', handler);
      resolve({ isTamper: matches.length > 0, matchedStudents: matches });
    }, 15000);
  });
};

/* ══════════════════════════════════════════════════════════ */
export interface CaptureProgress {
  progress: number;
  phase: 'stabilize' | 'capture';
  direction: FaceDirection;
  directionLabel: string;
  capturedDirections: Set<FaceDirection>;
  totalGood: number;
  currentScore: number;
  faceDetected: boolean;
  qualityLevel: QualityLevel;
  lightLevel: LightLevel;
  rotationAngle: number;
  rotationCoverage: number;
}

const DIRECTION_LABELS: Record<FaceDirection, string> = {
  center: '👤 انظر للأمام',
  right: '👉 أدر لليمين',
  left: '👈 أدر لليسار',
  up: '👆 ارفع للأعلى',
  down: '👇 انزل للأسفل',
};

/* ══════════════════════════════════════════════════════════
   extractFaceDescriptorMultiCapture
══════════════════════════════════════════════════════════ */
export const extractFaceDescriptorMultiCapture = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  onProgress?: (info: CaptureProgress) => void
): Promise<{ descriptor: Float32Array; angleDescs: Map<FaceDirection, Float32Array[]>; quality: number; directions: Set<FaceDirection> } | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const TOTAL_MS = 10000;
  const STABILIZE_MS = 1000;
  const INTERVAL_MS = 220;
  const MIN_SCORE = 0.50;
  const MIN_AREA = 0.03;
  const MAX_CENTER = 0.45;
  const MIN_GOOD = 5;

  const capturedDirections = new Set<FaceDirection>();
  const angleDescs = new Map<FaceDirection, Float32Array[]>();
  const allFrames: Array<{ descriptor: Float32Array; quality: number; direction: FaceDirection }> = [];
  const coveredAngles = new Set<number>();

  const reportProgress = (p: number, phase: 'stabilize' | 'capture', dir: FaceDirection, detected: boolean, qInfo?: Partial<FrameQuality>) => {
    onProgress?.({
      progress: p, phase, direction: dir,
      directionLabel: DIRECTION_LABELS[dir],
      capturedDirections: new Set(capturedDirections),
      totalGood: allFrames.length,
      currentScore: Math.round((qInfo?.score || 0) * 100),
      faceDetected: detected,
      qualityLevel: getQualityLevel(qInfo?.quality || 0),
      lightLevel: (qInfo?.lightLevel as LightLevel) || 'good',
      rotationAngle: qInfo?.rotationAngle || 0,
      rotationCoverage: Math.min(100, Math.round((coveredAngles.size / 12) * 100)),
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
      const det = await faceapi.detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 }))
        .withFaceLandmarks().withFaceDescriptors();
      if (det.length === 1 && det[0].detection.score >= MIN_SCORE) {
        stabilized = true;
        const q = evaluateFrameQuality(det[0], processed.width, processed.height, input instanceof HTMLVideoElement ? input : undefined);
        reportProgress(p, 'stabilize', 'center', true, q);
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }

  if (!stabilized) {
    try {
      const processed = preprocessForEnrollment(input, 640);
      const det = await faceapi.detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
        .withFaceLandmarks().withFaceDescriptors();
      if (det.length !== 1) return null;
    } catch { return null; }
  }

  reportProgress(10, 'capture', 'center', true);

  /* ─── الالتقاط ─── */
  const captureStart = Date.now();
  const captureEnd = captureStart + (TOTAL_MS - STABILIZE_MS);
  const DIRECTION_SEQUENCE: FaceDirection[] = ['center', 'right', 'left', 'up', 'down', 'center'];

  while (Date.now() < captureEnd) {
    const elapsed = Date.now() - captureStart;
    const totalCapture = TOTAL_MS - STABILIZE_MS;
    const ratio = elapsed / totalCapture;
    const progress = 10 + Math.min(85, Math.round(ratio * 85));
    const seqIdx = Math.min(DIRECTION_SEQUENCE.length - 1, Math.floor(ratio * DIRECTION_SEQUENCE.length));
    const requiredDir = DIRECTION_SEQUENCE[seqIdx];

    try {
      const processed = preprocessForEnrollment(input, 960, true);
      const imgW = processed.width, imgH = processed.height;

      let detections = await faceapi.detectAllFaces(processed, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.48 }))
        .withFaceLandmarks().withFaceDescriptors();

      if (detections.length === 0) {
        detections = await faceapi.detectAllFaces(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.42 }))
          .withFaceLandmarks().withFaceDescriptors();
      }

      if (detections.length !== 1) {
        reportProgress(progress, 'capture', requiredDir, false);
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      const det = detections[0];
      const q = evaluateFrameQuality(det, imgW, imgH, input instanceof HTMLVideoElement ? input : undefined);
      reportProgress(progress, 'capture', requiredDir, true, q);

      if (q.score < MIN_SCORE || q.areaRatio < MIN_AREA || q.centerDist > MAX_CENTER) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        continue;
      }

      const desc = normalizeDescriptor(det.descriptor);
      capturedDirections.add(q.direction);
      allFrames.push({ descriptor: desc, quality: q.quality, direction: q.direction });

      if (!angleDescs.has(q.direction)) angleDescs.set(q.direction, []);
      angleDescs.get(q.direction)!.push(desc);

      const angleBucket = Math.round(q.rotationAngle / 30) % 12;
      coveredAngles.add(angleBucket);

    } catch (e) { console.warn('capture err:', e); }
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }

  reportProgress(96, 'capture', 'center', true);

  if (allFrames.length < MIN_GOOD) return null;

  const byDir = new Map<FaceDirection, typeof allFrames>();
  for (const f of allFrames) {
    if (!byDir.has(f.direction)) byDir.set(f.direction, []);
    byDir.get(f.direction)!.push(f);
  }

  const selected: typeof allFrames = [];
  for (const [, frames] of byDir) {
    frames.sort((a, b) => b.quality - a.quality);
    selected.push(...frames.slice(0, 4));
  }
  if (selected.length < 12) {
    const remaining = allFrames.filter(f => !selected.includes(f)).sort((a, b) => b.quality - a.quality);
    for (const f of remaining) { if (selected.length >= 14) break; selected.push(f); }
  }

  const descriptors = selected.map(f => f.descriptor);
  const filtered = filterOutliers(descriptors, 0.32);
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
  const avgQuality = filteredWithQ.reduce((s, f) => s + f.quality, 0) / filteredWithQ.length;

  reportProgress(100, 'capture', 'center', true, { quality: avgQuality });

  return { descriptor: final, angleDescs, quality: avgQuality, directions: capturedDirections };
};

/* ─── IOU Tracker لتتبع الوجوه بين الفريمات ─── */
export interface TrackedFace {
  id: number;
  box: { x: number; y: number; width: number; height: number };
  descriptor?: Float32Array;
  age: number;
  lost: number;
}

export class IOUTracker {
  private tracks: TrackedFace[] = [];
  private nextId = 1;
  private readonly iouThreshold = 0.30;
  private readonly maxLost = 8;

  update(detections: Array<{ box: { x: number; y: number; width: number; height: number }; descriptor?: Float32Array }>): TrackedFace[] {
    const matched = new Set<number>();

    for (const det of detections) {
      let bestIdx = -1;
      let bestIoU = this.iouThreshold;
      for (let i = 0; i < this.tracks.length; i++) {
        if (matched.has(i)) continue;
        const iou = this.calculateIoU(det.box, this.tracks[i].box);
        if (iou > bestIoU) { bestIoU = iou; bestIdx = i; }
      }

      if (bestIdx >= 0) {
        matched.add(bestIdx);
        this.tracks[bestIdx].box = det.box;
        this.tracks[bestIdx].age++;
        this.tracks[bestIdx].lost = 0;
        if (det.descriptor) this.tracks[bestIdx].descriptor = det.descriptor;
      } else {
        this.tracks.push({ id: this.nextId++, box: det.box, descriptor: det.descriptor, age: 1, lost: 0 });
      }
    }

    for (let i = 0; i < this.tracks.length; i++) {
      if (!matched.has(i)) this.tracks[i].lost++;
    }

    this.tracks = this.tracks.filter(t => t.lost <= this.maxLost);
    return this.tracks;
  }

  getActiveFaces(): TrackedFace[] {
    return this.tracks.filter(t => t.lost === 0);
  }

  reset() { this.tracks = []; this.nextId = 1; }

  private calculateIoU(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 < x1 || y2 < y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / (a.width * a.height + b.width * b.height - inter);
  }
}

/* ─── بصمة واحدة ─── */
export const extractFaceDescriptor = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 640, true);
  let result = await faceapi.detectSingleFace(processed, getDetectorOptions()).withFaceLandmarks(true).withFaceDescriptor();
  if (!result) result = await faceapi.detectSingleFace(processed, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.32 })).withFaceLandmarks(true).withFaceDescriptor();
  return result?.descriptor || null;
};

export const extractAllFaceDescriptors = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, useRegion = false) => {
  if (!modelsLoaded) await loadFaceModels();
  const src = useRegion ? cropCenterRegion(input as any, 0.8) : input;
  return faceapi.detectAllFaces(preprocessFrame(src, 1280, true), getDetectorOptions()).withFaceLandmarks(true).withFaceDescriptors();
};

export const extractAllFaceDescriptorsHybrid = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, useRegion = false) => {
  if (!modelsLoaded) await loadFaceModels();
  const cores = navigator.hardwareConcurrency || 2, memory = (navigator as any).deviceMemory || 2;
  const isHigh = cores >= 8 && memory >= 6;
  const src = useRegion ? cropCenterRegion(input as any, 0.85) : input;
  const processed = preprocessFrame(src, isHigh ? 1280 : 960, true);
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

function calculateIoU(b1: any, b2: any): number {
  const x1 = Math.max(b1.x, b2.x), y1 = Math.max(b1.y, b2.y);
  const x2 = Math.min(b1.x + b1.width, b2.x + b2.width), y2 = Math.min(b1.y + b1.height, b2.y + b2.height);
  if (x2 < x1 || y2 < y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (b1.width * b1.height + b2.width * b2.height - inter);
}

/* ─── مقارنة عامة ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string | MultiDescriptor
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);

  if (isMultiDescriptor(desc2)) {
    return compareMultiDescriptor(a, desc2);
  }

  const arr = toFloat32(desc2 as any);
  return faceapi.euclideanDistance(a, arr);
};

export interface FaceMatchResult<T> { item: T; distance: number; confidence: number; }

export const findBestMatch = <T extends { faceDescriptor?: number[] | string | MultiDescriptor }>(
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

/* ─── تحسين تلقائي ─── */
export const shouldAutoImprove = (stored: MultiDescriptor | number[] | string): boolean => {
  if (isMultiDescriptor(stored)) {
    const md = stored;
    return !md.angles || md.angles.length < 64 || (md.quality || 0) < 0.5 || (md.directions || '').split(',').length < 3;
  }
  return true;
};

export const autoImproveDescriptor = (
  currentStored: MultiDescriptor | number[] | string,
  newDescriptor: Float32Array,
  newDirection: FaceDirection,
  newQuality: number
): MultiDescriptor | null => {
  let md: MultiDescriptor;
  if (isMultiDescriptor(currentStored)) {
    md = currentStored;
  } else {
    const currentArray = toFloat32(currentStored as any);
    const newMain = compressFaceDescriptor(newDescriptor);
    const normalized = normalizeDescriptor(new Float32Array(currentArray));
    return {
      main: compressFaceDescriptor(normalized),
      quality: newQuality,
      directions: newDirection,
      version: 2,
    };
  }
  if ((md.quality || 0) >= 0.85 && (md.directions || '').split(',').length >= 5) return null;
  if (newQuality < (md.quality || 0) * 0.9) return null;

  const currentMain = toFloat32(md.main);
  const blended = new Float32Array(128);
  const oldW = 0.7, newW = 0.3;
  for (let i = 0; i < 128; i++) blended[i] = currentMain[i] * oldW + newDescriptor[i] * newW;
  const normalized = normalizeDescriptor(blended);

  const existingDirs = new Set((md.directions || '').split(',').filter(Boolean));
  existingDirs.add(newDirection);

  return {
    main: compressFaceDescriptor(normalized),
    angles: md.angles,
    quality: Math.max(md.quality || 0, newQuality),
    directions: [...existingDirs].join(','),
    version: 2,
  };
};

export const descriptorToArray = (d: Float32Array) => compressFaceDescriptor(d);
export const descriptorToArrayUncompressed = (d: Float32Array) => Array.from(d);