import * as faceapi from 'face-api.js';
import { compressFaceDescriptor, ensureDecompressed } from './faceCompression';
import { getWorker, workerFindBestMatch, workerBatchMatchAll } from './faceWorker';

// ── Shared loading state ──
let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;
let preloadStarted = false;

// ── Progress-aware loading ──
export interface LoadProgressInfo {
  stage: 'detector' | 'landmarks' | 'recognition' | 'done' | 'error';
  stageIndex: number; // 0,1,2,3
  percent: number;    // 0-100
  detail: string;     // Arabic label
  error?: string;
}
type ProgressListener = (info: LoadProgressInfo) => void;
const _progressListeners: Set<ProgressListener> = new Set();
let _lastProgress: LoadProgressInfo = { stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل الموديلات...' };

export function onModelProgress(cb: ProgressListener): () => void {
  _progressListeners.add(cb);
  cb(_lastProgress);
  return () => { _progressListeners.delete(cb); };
}
function _emitProgress(info: LoadProgressInfo) {
  _lastProgress = info;
  _progressListeners.forEach(cb => cb(info));
}

// ── Yield to main thread ──
const yieldToMain = () => new Promise<void>(r => setTimeout(r, 0));

// ── Performance metrics ──
export interface FacePerfMetrics {
  modelDownloadMs: number;
  modelInitMs: number;
  cameraStartMs: number;
  firstDetectionMs: number;
  matchMs: number;
  totalStartupMs: number;
  preloadCompleted: boolean;
}

let _perf: FacePerfMetrics = {
  modelDownloadMs: 0,
  modelInitMs: 0,
  cameraStartMs: 0,
  firstDetectionMs: 0,
  matchMs: 0,
  totalStartupMs: 0,
  preloadCompleted: false,
};
const _perfTimers: Record<string, number> = {};

export function startPerfTimer(label: string) { _perfTimers[label] = performance.now(); }
export function endPerfTimer(label: string) {
  if (_perfTimers[label]) {
    const ms = performance.now() - _perfTimers[label];
    if (label === 'modelDownload') _perf.modelDownloadMs = ms;
    else if (label === 'modelInit') _perf.modelInitMs = ms;
    else if (label === 'cameraStart') _perf.cameraStartMs = ms;
    else if (label === 'firstDetection') _perf.firstDetectionMs = ms;
    else if (label === 'match') _perf.matchMs = ms;
    delete _perfTimers[label];
  }
}
export function getPerfMetrics(): FacePerfMetrics { return { ..._perf }; }
export function resetPerfMetrics() {
  _perf = { modelDownloadMs: 0, modelInitMs: 0, cameraStartMs: 0, firstDetectionMs: 0, matchMs: 0, totalStartupMs: 0, preloadCompleted: false };
}

// ── Canvas pool ──
const _cvs: HTMLCanvasElement[] = [];
let _cvsIdx = 0;
function allocCanvas(w: number, h: number): HTMLCanvasElement {
  const c = _cvs[_cvsIdx];
  if (c) { c.width = w; c.height = h; _cvsIdx = (_cvsIdx + 1) % _cvs.length; return c; }
  const nc = document.createElement('canvas');
  nc.width = w; nc.height = h;
  _cvs.push(nc);
  _cvsIdx = (_cvsIdx + 1) % 3;
  return nc;
}

// ── Descriptor cache ──
interface DescCacheEntry { id: string; desc: Float32Array }
let _descCache: DescCacheEntry[] | null = null;
let _cacheThreshold = 0.6;

export function buildDescriptorCache(
  students: Array<{ id: string; faceDescriptor?: any }>,
  threshold = 0.6
): void {
  _cacheThreshold = threshold;
  _descCache = [];
  for (const s of students) {
    if (!s.faceDescriptor) continue;
    const arr = toFloat32(s.faceDescriptor);
    if (arr.length >= 128) {
      _descCache.push({ id: s.id, desc: normalizeDescriptor(arr) });
    }
  }
}
export function getDescriptorCache(): DescCacheEntry[] | null { return _descCache; }
export function clearDescriptorCache(): void { _descCache = null; }
export function getCacheThreshold(): number { return _cacheThreshold; }

// ── Model URLs ──
const MODEL_URLS = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
];

// ── Priority-based progressive loading ──
// Stage 1: TinyFaceDetector (lightest, fastest)
// Stage 2: FaceLandmark68TinyNet (medium)
// Stage 3: FaceRecognitionNet (heaviest)
// Stage 4: (future) Anti-spoofing

let _loadProgress = 0;
let _detectorReady = false;
let _landmarksReady = false;
export function getLoadProgress(): number { return _loadProgress; }
export function isDetectorReady(): boolean { return _detectorReady; }
export function isLandmarksReady(): boolean { return _landmarksReady; }

export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    startPerfTimer('modelDownload');
    for (let attempt = 0; attempt < 3; attempt++) {
      const baseUrl = MODEL_URLS[attempt % MODEL_URLS.length];
      try {
        // Stage 1: FaceDetector (highest priority)
        await faceapi.nets.tinyFaceDetector.loadFromUri(baseUrl);
        _detectorReady = true;
        _loadProgress = 33;
        // Stage 2: Landmarks
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(baseUrl);
        _landmarksReady = true;
        _loadProgress = 66;
        // Stage 3: Recognition (heaviest)
        await faceapi.nets.faceRecognitionNet.loadFromUri(baseUrl);
        _loadProgress = 100;
        endPerfTimer('modelDownload');
        modelsLoaded = true;
        _perf.preloadCompleted = true;
        _perf.totalStartupMs = performance.now() - (_perfTimers['totalStartup'] || performance.now());
        loadingPromise = null;
        return;
      } catch (e) {
        console.warn(`Model load attempt ${attempt + 1} from ${baseUrl} failed:`, e);
        _loadProgress = 0;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    loadingPromise = null;
    throw new Error('فشل تحميل موديلات التعرف على الوجه');
  })();

  return loadingPromise;
};

// ── Progress-aware model loading (using loadFromUri with yields between models) ──
interface ModelStageDef {
  net: 'tinyFaceDetector' | 'faceLandmark68TinyNet' | 'faceRecognitionNet';
  label: string;
  stage: LoadProgressInfo['stage'];
  stageIndex: number;
}
const MODEL_STAGES: ModelStageDef[] = [
  { net: 'tinyFaceDetector',     label: 'كشف الوجوه',        stage: 'detector',    stageIndex: 0 },
  { net: 'faceLandmark68TinyNet', label: 'نقاط الوجه',        stage: 'landmarks',   stageIndex: 1 },
  { net: 'faceRecognitionNet',    label: 'التعرف على الهوية', stage: 'recognition', stageIndex: 2 },
];

export const loadModelsWithProgress = async (onProgress?: ProgressListener): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    startPerfTimer('modelDownload');

    for (let attempt = 0; attempt < 3; attempt++) {
      const baseUrl = MODEL_URLS[attempt % MODEL_URLS.length];
      try {
        for (let i = 0; i < MODEL_STAGES.length; i++) {
          const { net, label, stage, stageIndex } = MODEL_STAGES[i];
          const basePercent = (i / MODEL_STAGES.length) * 100;
          const stageWeight = 100 / MODEL_STAGES.length;

          _emitProgress({ stage, stageIndex, percent: basePercent, detail: `جاري تحميل ${label}...` });
          if (onProgress) onProgress({ stage, stageIndex, percent: basePercent, detail: `جاري تحميل ${label}...` });

          // Use face-api.js loadFromUri (handles correct file names internally)
          await faceapi.nets[net].loadFromUri(baseUrl);

          const donePct = basePercent + stageWeight;
          _emitProgress({ stage, stageIndex, percent: donePct, detail: `✓ ${label} جاهز` });
          if (onProgress) onProgress({ stage, stageIndex, percent: donePct, detail: `✓ ${label} جاهز` });

          if (i === 0) { _detectorReady = true; }
          if (i === 1) { _landmarksReady = true; }

          // Yield to main thread between models to prevent freeze
          await yieldToMain();
        }

        _loadProgress = 100;
        endPerfTimer('modelDownload');
        modelsLoaded = true;
        _perf.preloadCompleted = true;
        _perf.totalStartupMs = performance.now() - (_perfTimers['totalStartup'] || performance.now());

        _emitProgress({ stage: 'done', stageIndex: 3, percent: 100, detail: 'الموديلات جاهزة!' });
        if (onProgress) onProgress({ stage: 'done', stageIndex: 3, percent: 100, detail: 'الموديلات جاهزة!' });

        loadingPromise = null;
        return;
      } catch (e: any) {
        console.warn(`Model load attempt ${attempt + 1} from ${baseUrl} failed:`, e);
        _loadProgress = 0;
        _emitProgress({ stage: 'error', stageIndex: 0, percent: 0, detail: '', error: e.message || 'فشل التحميل' });
        if (onProgress) onProgress({ stage: 'error', stageIndex: 0, percent: 0, detail: '', error: e.message || 'فشل التحميل' });
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    loadingPromise = null;
    throw new Error('فشل تحميل موديلات التعرف على الوجه');
  })();

  return loadingPromise;
};

// ── Preload in background using requestIdleCallback ──
export function startBackgroundPreload(): void {
  if (preloadStarted || modelsLoaded) return;
  preloadStarted = true;

  startPerfTimer('totalStartup');

  const doLoad = () => {
    loadModelsWithProgress().catch((err) => {
      console.warn('Background preload failed, will retry on demand:', err);
      preloadStarted = false;
    });
  };

  setTimeout(doLoad, 0);
}

let _detectorPreloadStarted = false;

export function startDetectorPreload(): void {
  if (_detectorPreloadStarted || _detectorReady || modelsLoaded) return;
  _detectorPreloadStarted = true;

  const doLoad = async () => {
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URLS[0]);
      _detectorReady = true;
      try {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 120;
        faceapi.detectAllFaces(c, getDetectorOptions());
      } catch {}
    } catch {
      _detectorPreloadStarted = false;
    }
  };

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(doLoad, { timeout: 2500 });
  } else {
    setTimeout(doLoad, 800);
  }
}

export function isPreloadStarted(): boolean { return preloadStarted; }
export const resetModels = () => { modelsLoaded = false; loadingPromise = null; _loadProgress = 0; _detectorReady = false; _landmarksReady = false; preloadStarted = false; _detectorPreloadStarted = false; _lastProgress = { stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل الموديلات...' }; };
export const areModelsLoaded = () => modelsLoaded;
export const getLastModelProgress = (): LoadProgressInfo => _lastProgress;

// ── Detector options ──
// inputSize قابل للتمرير: 160/224 للكشف المباشر الخفيف، و320 فقط للالتقاط النهائي
const getDetectorOptions = (inputSize = 320) =>
  new faceapi.TinyFaceDetectorOptions({
    inputSize,
    scoreThreshold: 0.3,
  });

// ── Frame preprocessing ──
export const preprocessFrame = (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 480
): HTMLCanvasElement => {
  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;
  if (!vw || !vh) { const c = allocCanvas(1, 1); return c; }

  const scale = Math.min(1, targetWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const canvas = allocCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(input, 0, 0, w, h);
  return canvas;
};

// ── Normalization ──
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
  for (const d of descs) {
    for (let i = 0; i < 128; i++) merged[i] += d[i];
  }
  for (let i = 0; i < 128; i++) merged[i] /= descs.length;
  return normalizeDescriptor(merged);
};

// ── Face landmarks drawing ──

// إحداثيات الوجوه تعود بأبعاد إطار المعالجة (بعد preprocessFrame) وليس بأبعاد الفيديو الأصلية.
// هذه الدالة تحسب أبعاد إطار الكشف الفعلي لضبط الرسم فوق الفيديو المعروض.
export const getDetectionFrameDims = (
  videoWidth: number,
  videoHeight: number,
  targetWidth = 320
): { width: number; height: number } => {
  if (!videoWidth || !videoHeight) return { width: targetWidth, height: Math.round((targetWidth * 3) / 4) };
  const height = Math.max(1, Math.round((targetWidth * videoHeight) / videoWidth));
  return { width: targetWidth, height };
};

export const drawFaceLandmarks = (
  ctx: CanvasRenderingContext2D,
  landmarks: faceapi.FaceLandmarks68,
  box: { x: number; y: number; width: number; height: number },
  displayWidth: number,
  displayHeight: number,
  frameWidth: number,
  frameHeight: number,
  mirrored: boolean
) => {
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const scaleX = displayWidth / frameWidth;
  const scaleY = displayHeight / frameHeight;
  const s = Math.max(scaleX, scaleY);
  const ox = (displayWidth - frameWidth * s) / 2;
  const oy = (displayHeight - frameHeight * s) / 2;

  const mapX = (x: number) => (mirrored ? displayWidth - (x * s + ox) : x * s + ox);
  const mapY = (y: number) => y * s + oy;
  const mapW = (w: number) => w * s;

  // Bounding box
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 2;
  ctx.strokeRect(mirrored ? mapX(box.x + box.width) : mapX(box.x), mapY(box.y), mapW(box.width), mapW(box.height));

  // Face features
  const pos = landmarks.positions;
  const features = {
    jaw: pos.slice(0, 17),
    eyebrowLeft: pos.slice(17, 22),
    eyebrowRight: pos.slice(22, 27),
    noseBridge: pos.slice(27, 31),
    nose: pos.slice(31, 36),
    eyeLeft: pos.slice(36, 42),
    eyeRight: pos.slice(42, 48),
    lipOuter: pos.slice(48, 60),
    lipInner: pos.slice(60),
  };

  const drawPoints = (pts: faceapi.Point[], color: string, close = true) => {
    if (pts.length === 0) return;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mapX(pts[0].x), mapY(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(mapX(pts[i].x), mapY(pts[i].y));
    if (close) ctx.closePath();
    ctx.stroke();
    for (const p of pts) { ctx.beginPath(); ctx.arc(mapX(p.x), mapY(p.y), 2, 0, Math.PI * 2); ctx.fill(); }
  };

  drawPoints(features.jaw, 'rgba(156,163,175,0.4)', false);
  drawPoints(features.eyebrowLeft, '#3b82f6');
  drawPoints(features.eyebrowRight, '#3b82f6');
  drawPoints(features.noseBridge, '#ef4444', false);
  drawPoints(features.nose, '#ef4444');
  drawPoints(features.eyeLeft, '#3b82f6');
  drawPoints(features.eyeRight, '#3b82f6');
  drawPoints(features.lipOuter, '#10b981');
  drawPoints(features.lipInner, '#10b981');
};

// ── MultiDescriptor ──
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
  for (const t of top) { result.push(t.i, Math.round(t.val * 10000) / 10000); }
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
  angleDescs: Map<string, Float32Array[]>,
  overallQuality: number,
  capturedDirs: Set<string>
): MultiDescriptor => {
  const angles: number[] = [];
  const dirOrder = ['center', 'right', 'left'];
  for (const dir of dirOrder) {
    const descs = angleDescs.get(dir);
    if (descs && descs.length > 0) {
      angles.push(...compressAngleDescriptor(meanDescriptor(descs)));
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

const toFloat32 = (input: any): Float32Array => {
  if (input instanceof Float32Array) return input;
  if (input && typeof input === 'object' && !Array.isArray(input) && 'main' in input) {
    return toFloat32(input.main);
  }
  if (typeof input === 'string') {
    return new Float32Array(ensureDecompressed(input));
  }
  if (Array.isArray(input)) {
    if (input.length === 128) return new Float32Array(input);
    if (input.length > 0 && input.length < 128) {
      const looksCompressed =
        input.length % 2 === 0 &&
        Number.isInteger(input[0]) && input[0] >= 0 && input[0] < 128 &&
        input.length >= 4 &&
        Number.isInteger(input[2]) && input[2] >= 0 && input[2] < 128;
      if (looksCompressed) {
        return new Float32Array(ensureDecompressed(input));
      }
    }
    if (input.length > 0 && input.every(v => Number.isInteger(v))) {
      return new Float32Array(ensureDecompressed(input));
    }
    return new Float32Array(input);
  }
  return new Float32Array(input);
};

export const compareMultiDescriptor = (query: Float32Array, stored: MultiDescriptor): number => {
  const mainDesc = normalizeDescriptor(toFloat32(stored.main));
  const qNorm = normalizeDescriptor(new Float32Array(query));
  const mainDist = faceapi.euclideanDistance(qNorm, mainDesc);
  if (!stored.angles || stored.angles.length === 0) return mainDist;

  const chunkSize = TOP_DIMS * 2;
  const angleCount = Math.floor(stored.angles.length / chunkSize);
  let bestAngleDist = Infinity;

  for (let i = 0; i < angleCount; i++) {
    const chunk = stored.angles.slice(i * chunkSize, (i + 1) * chunkSize);
    const angleDesc = decompressAngleDescriptor(chunk);
    const dist = faceapi.euclideanDistance(qNorm, angleDesc);
    if (dist < bestAngleDist) bestAngleDist = dist;
  }

  return Math.min(mainDist, mainDist * 0.6 + bestAngleDist * 0.4);
};

const isMultiDescriptor = (d: any): d is MultiDescriptor => {
  return d !== null && typeof d === 'object' && !Array.isArray(d) && 'main' in d;
};

// ── Tamper detection ──
export interface TamperResult {
  isTamper: boolean;
  matchedStudents: Array<{ id: string; name: string; distance: number }>;
}

export const checkForTampering = <
  T extends { id: string; name: string; faceDescriptor?: number[] | string | MultiDescriptor }
>(
  descriptor: Float32Array,
  allStudents: T[],
  excludeId: string,
  threshold = 0.35
): TamperResult => {
  const query = normalizeDescriptor(new Float32Array(descriptor));
  const matches: Array<{ id: string; name: string; distance: number }> = [];
  for (const s of allStudents) {
    if (s.id === excludeId || !s.faceDescriptor) continue;
    const dist = compareFaces(query, s.faceDescriptor as any);
    if (dist < threshold) {
      matches.push({ id: s.id, name: s.name, distance: dist });
    }
  }
  return { isTamper: matches.length > 0, matchedStudents: matches };
};

export const checkForTamperingAsync = async <
  T extends { id: string; name: string; faceDescriptor?: number[] | string | MultiDescriptor }
>(
  descriptor: Float32Array,
  allStudents: T[],
  excludeId: string,
  threshold = 0.35
): Promise<TamperResult> => {
  const query = normalizeDescriptor(new Float32Array(descriptor));
  const matches: Array<{ id: string; name: string; distance: number }> = [];
  const storedSimple: Array<{ id: string; name: string; desc: number[] }> = [];

  for (const s of allStudents) {
    if (s.id === excludeId || !s.faceDescriptor) continue;
    if (isMultiDescriptor(s.faceDescriptor)) {
      const dist = compareMultiDescriptor(query, s.faceDescriptor);
      if (dist < threshold) matches.push({ id: s.id, name: s.name, distance: dist });
    } else {
      const arr = toFloat32(s.faceDescriptor as any);
      const normArr = normalizeDescriptor(new Float32Array(arr));
      storedSimple.push({ id: s.id, name: s.name, desc: Array.from(normArr) });
    }
  }

  if (storedSimple.length === 0) {
    return { isTamper: matches.length > 0, matchedStudents: matches };
  }

  const w = getWorker();
  if (!w) {
    for (const s of storedSimple) {
      const d = faceapi.euclideanDistance(query, new Float32Array(s.desc));
      if (d < threshold) matches.push({ id: s.id, name: s.name, distance: d });
    }
    return { isTamper: matches.length > 0, matchedStudents: matches };
  }

  return new Promise(resolve => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'tamperResult') {
        w.removeEventListener('message', handler);
        const wMatches = (e.data.data || []) as Array<{ id: string; name: string; distance: number }>;
        resolve({
          isTamper: matches.length + wMatches.length > 0,
          matchedStudents: [...matches, ...wMatches],
        });
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'tamper', data: { query: Array.from(query), storedDescriptors: storedSimple, threshold } });
    setTimeout(() => { w.removeEventListener('message', handler); resolve({ isTamper: matches.length > 0, matchedStudents: matches }); }, 15000);
  });
};

// ── IOU Tracker ──
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
  private readonly iouThreshold = 0.3;
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
    for (let i = 0; i < this.tracks.length; i++) { if (!matched.has(i)) this.tracks[i].lost++; }
    this.tracks = this.tracks.filter(t => t.lost <= this.maxLost);
    return this.tracks;
  }

  getActiveFaces(): TrackedFace[] { return this.tracks.filter(t => t.lost === 0); }
  reset() { this.tracks = []; this.nextId = 1; }

  private calculateIoU(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 < x1 || y2 < y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / (a.width * a.height + b.width * b.height - inter);
  }
}

// ── Face detection ──
export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, 640);
  const result = await faceapi
    .detectSingleFace(processed, getDetectorOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  return result?.descriptor || null;
};

export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 480,
  inputSize = 320
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, targetWidth);
  return faceapi
    .detectAllFaces(processed, getDetectorOptions(inputSize))
    .withFaceLandmarks(true)
    .withFaceDescriptors();
};

export const detectAllFacesOnly = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 320,
  inputSize = 320
) => {
  const processed = preprocessFrame(input, targetWidth);
  return faceapi.detectAllFaces(processed, getDetectorOptions(inputSize));
};

export const detectSingleFace = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 640,
  inputSize = 320
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, targetWidth);
  return faceapi
    .detectSingleFace(processed, getDetectorOptions(inputSize))
    .withFaceLandmarks(true);
};

// ── Comparison ──
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string | MultiDescriptor
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  if (isMultiDescriptor(desc2)) return compareMultiDescriptor(a, desc2);

  let b: Float32Array;
  if (typeof desc2 === 'string') { b = new Float32Array(ensureDecompressed(desc2)); }
  else if (Array.isArray(desc2)) {
    if (desc2.length < 128) { b = new Float32Array(ensureDecompressed(desc2)); }
    else { b = new Float32Array(desc2); }
  } else { b = toFloat32(desc2 as any); }

  if (a.length !== b.length) {
    const maxLen = Math.max(a.length, b.length);
    const paddedA = new Float32Array(maxLen);
    const paddedB = new Float32Array(maxLen);
    paddedA.set(a); paddedB.set(b);
    return faceapi.euclideanDistance(paddedA, paddedB);
  }
  return faceapi.euclideanDistance(a, b);
};

export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <T extends { faceDescriptor?: number[] | string | MultiDescriptor }>(
  queryDescriptor: Float32Array,
  items: T[],
  threshold = 0.6
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

export const findBestMatchFromCache = async (
  queryDescriptor: Float32Array,
  threshold = 0.6
): Promise<{ id: string; distance: number } | null> => {
  const cache = getDescriptorCache();
  if (!cache || cache.length === 0) return null;
  const stored = cache.map((e, i) => ({ index: i, desc: Array.from(e.desc) }));
  const result = await workerFindBestMatch(queryDescriptor, stored, threshold);
  if (!result) return null;
  return { id: cache[result.index].id, distance: result.distance };
};

export const findBestMatchBatchFromCache = async (
  queryDescriptors: Float32Array[],
  threshold = 0.6
): Promise<Array<{ id: string; distance: number } | null>> => {
  const cache = getDescriptorCache();
  if (!cache || cache.length === 0) return queryDescriptors.map(() => null);
  const stored = cache.map((e, i) => ({ index: i, desc: Array.from(e.desc) }));
  const results = await workerBatchMatchAll(queryDescriptors, stored, threshold);
  return results.map(r => r ? { id: cache[r.index].id, distance: r.distance } : null);
};

// ── Auto-improve ──
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
  newDirection: string,
  newQuality: number
): MultiDescriptor | null => {
  let md: MultiDescriptor;
  if (isMultiDescriptor(currentStored)) { md = currentStored; }
  else {
    const currentArray = toFloat32(currentStored as any);
    const normalized = normalizeDescriptor(new Float32Array(currentArray));
    return { main: Array.from(normalized), quality: newQuality, directions: newDirection, version: 2 };
  }

  if ((md.quality || 0) >= 0.85 && (md.directions || '').split(',').length >= 5) return null;
  if (newQuality < (md.quality || 0) * 0.9) return null;

  const currentMain = toFloat32(md.main);
  const blended = new Float32Array(128);
  for (let i = 0; i < 128; i++) blended[i] = currentMain[i] * 0.7 + newDescriptor[i] * 0.3;
  const normalized = normalizeDescriptor(blended);

  const existingDirs = new Set((md.directions || '').split(',').filter(Boolean));
  existingDirs.add(newDirection);

  return {
    main: Array.from(normalized),
    angles: md.angles,
    quality: Math.max(md.quality || 0, newQuality),
    directions: [...existingDirs].join(','),
    version: 2,
  };
};

export const descriptorToArray = (d: Float32Array) => compressFaceDescriptor(d);
export const descriptorToArrayUncompressed = (d: Float32Array) => Array.from(d);
