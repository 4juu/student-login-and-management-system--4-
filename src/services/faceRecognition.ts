import * as faceapi from '@vladmandic/face-api';
import { compressFaceDescriptor, ensureDecompressed } from './faceCompression';
import { getWorker, workerFindBestMatch, workerBatchMatchAll } from './faceWorker';
import { loadMobileFaceNet, isMobileFaceNetReady, extractEmbedding, cosineSimilarity, getEmbeddingDim } from './mobileFaceNet';

const DESC_DIM = 512;

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;
let preloadStarted = false;

export interface LoadProgressInfo {
  stage: 'detector' | 'recognition' | 'done' | 'error';
  stageIndex: number;
  percent: number;
  detail: string;
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

const yieldToMain = () => new Promise<void>(r => setTimeout(r, 0));

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
  modelDownloadMs: 0, modelInitMs: 0, cameraStartMs: 0,
  firstDetectionMs: 0, matchMs: 0, totalStartupMs: 0, preloadCompleted: false,
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

interface DescCacheEntry { id: string; desc: Float32Array }
let _descCache: DescCacheEntry[] | null = null;
let _cacheThreshold = 0.4;

export function buildDescriptorCache(
  students: Array<{ id: string; faceDescriptor?: any }>,
  threshold = 0.4
): void {
  _cacheThreshold = threshold;
  _descCache = [];
  for (const s of students) {
    if (!s.faceDescriptor) continue;
    const arr = toFloat32(s.faceDescriptor);
    if (arr.length >= DESC_DIM) {
      _descCache.push({ id: s.id, desc: normalizeDescriptor(arr) });
    }
  }
}
export function getDescriptorCache(): DescCacheEntry[] | null { return _descCache; }
export function clearDescriptorCache(): void { _descCache = null; }
export function getCacheThreshold(): number { return _cacheThreshold; }

let _loadProgress = 0;
let _detectorReady = false;
export function getLoadProgress(): number { return _loadProgress; }
export function isDetectorReady(): boolean { return _detectorReady; }
export function isLandmarksReady(): boolean { return false; }

const DETECTOR_MODEL_PATH = '/models/face-detect';

const loadModelsInternal = async (): Promise<void> => {
  startPerfTimer('modelDownload');

  _emitProgress({ stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل كاشف الوجوه...' });
  await faceapi.nets.tinyFaceDetector.loadFromUri(DETECTOR_MODEL_PATH);
  _detectorReady = true;
  _emitProgress({ stage: 'detector', stageIndex: 0, percent: 50, detail: '✓ كاشف الوجوه جاهز' });
  await yieldToMain();

  _emitProgress({ stage: 'recognition', stageIndex: 1, percent: 50, detail: 'جاري تحميل موديل التعرف...' });
  await loadMobileFaceNet();
  _emitProgress({ stage: 'recognition', stageIndex: 1, percent: 100, detail: '✓ موديل التعرف جاهز' });

  const dummyCanvas = document.createElement('canvas');
  dummyCanvas.width = 160;
  dummyCanvas.height = 120;
  try { faceapi.detectAllFaces(dummyCanvas, getDetectorOptions()); } catch {}

  endPerfTimer('modelDownload');
};

export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadModelsInternal().then(() => {
    modelsLoaded = true;
    _loadProgress = 100;
    _perf.preloadCompleted = true;
    _perf.totalStartupMs = performance.now() - (_perfTimers['totalStartup'] || performance.now());
    _emitProgress({ stage: 'done', stageIndex: 2, percent: 100, detail: 'الموديلات جاهزة!' });
    loadingPromise = null;
  }).catch((e) => {
    loadingPromise = null;
    _emitProgress({ stage: 'error', stageIndex: 0, percent: 0, detail: '', error: e.message || 'فشل التحميل' });
    throw e;
  });
  return loadingPromise;
};

export const loadModelsWithProgress = loadFaceModels;

export function startBackgroundPreload(): void {
  if (preloadStarted || modelsLoaded) return;
  preloadStarted = true;
  startPerfTimer('totalStartup');
  loadFaceModels().catch((err) => {
    console.warn('Background preload failed:', err);
    preloadStarted = false;
  });
}

let _detectorPreloadStarted = false;

export function startDetectorPreload(): void {
  if (_detectorPreloadStarted || _detectorReady || modelsLoaded) return;
  _detectorPreloadStarted = true;

  const doLoad = async () => {
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(DETECTOR_MODEL_PATH);
      _detectorReady = true;
      try {
        const c = document.createElement('canvas');
        c.width = 160; c.height = 120;
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
export const resetModels = () => { modelsLoaded = false; loadingPromise = null; _loadProgress = 0; _detectorReady = false; preloadStarted = false; _detectorPreloadStarted = false; _lastProgress = { stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل الموديلات...' }; };
export const areModelsLoaded = () => modelsLoaded;
export const getLastModelProgress = (): LoadProgressInfo => _lastProgress;

const getDetectorOptions = (inputSize = 320) =>
  new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.3 });

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

export const normalizeDescriptor = (d: Float32Array): Float32Array => {
  const out = new Float32Array(d);
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
};

const meanDescriptor = (descs: Float32Array[]): Float32Array => {
  const merged = new Float32Array(DESC_DIM);
  for (const d of descs) {
    for (let i = 0; i < DESC_DIM; i++) merged[i] += d[i];
  }
  for (let i = 0; i < DESC_DIM; i++) merged[i] /= descs.length;
  return normalizeDescriptor(merged);
};

export const getDetectionFrameDims = (
  videoWidth: number,
  videoHeight: number,
  targetWidth = 320
): { width: number; height: number } => {
  if (!videoWidth || !videoHeight) return { width: targetWidth, height: Math.round((targetWidth * 3) / 4) };
  const height = Math.max(1, Math.round((targetWidth * videoHeight) / videoWidth));
  return { width: targetWidth, height };
};

export const drawFaceLandmarks = () => {};

// ── MultiDescriptor ──
export interface MultiDescriptor {
  main: number[];
  angles?: number[];
  quality?: number;
  directions?: string;
  version?: number;
  descriptorVersion?: number;
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
  const desc = new Float32Array(DESC_DIM);
  for (let i = 0; i < compressed.length; i += 2) {
    const idx = compressed[i];
    const val = compressed[i + 1];
    if (idx >= 0 && idx < DESC_DIM) desc[idx] = val;
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
    descriptorVersion: 2,
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
    if (input.length === DESC_DIM) return new Float32Array(input);
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
  const mainSim = cosineSimilarity(qNorm, mainDesc);
  const mainDist = 1 - mainSim;
  if (!stored.angles || stored.angles.length === 0) return mainDist;

  const chunkSize = TOP_DIMS * 2;
  const angleCount = Math.floor(stored.angles.length / chunkSize);
  let bestAngleDist = Infinity;

  for (let i = 0; i < angleCount; i++) {
    const chunk = stored.angles.slice(i * chunkSize, (i + 1) * chunkSize);
    const angleDesc = decompressAngleDescriptor(chunk);
    const sim = cosineSimilarity(qNorm, angleDesc);
    const dist = 1 - sim;
    if (dist < bestAngleDist) bestAngleDist = dist;
  }

  return Math.min(mainDist, mainDist * 0.6 + bestAngleDist * 0.4);
};

const isMultiDescriptor = (d: any): d is MultiDescriptor => {
  return d !== null && typeof d === 'object' && !Array.isArray(d) && 'main' in d;
};

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
  threshold = 0.4
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

export const checkForTamperingAsync = checkForTampering;

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

// ── Face detection + recognition ──
export const detectFaces = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  inputSize = 320
) => {
  const processed = preprocessFrame(input, inputSize);
  return faceapi.detectAllFaces(processed, getDetectorOptions(inputSize));
};

export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  if (!isMobileFaceNetReady()) return null;

  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;

  const processed = preprocessFrame(input, 640);
  const detections = await faceapi.detectAllFaces(processed, getDetectorOptions(320));
  if (detections.length === 0) return null;

  const scale = vw / processed.width;
  const best = detections[0];
  const box = {
    x: best.box.x * scale,
    y: best.box.y * scale,
    width: best.box.width * scale,
    height: best.box.height * scale,
  };

  return extractEmbedding(input, box, vw, vh);
};

export const extractAllFaceDescriptors = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 480,
  inputSize = 320
) => {
  if (!modelsLoaded) await loadFaceModels();
  if (!isMobileFaceNetReady()) return [];

  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;

  const processed = preprocessFrame(input, targetWidth);
  const detections = await faceapi.detectAllFaces(processed, getDetectorOptions(inputSize));

  if (detections.length === 0) return [];

  const scale = vw / processed.width;
  const results: Array<{ detection: { box: { x: number; y: number; width: number; height: number }; score: number }; descriptor: Float32Array }> = [];

  for (const det of detections) {
    const box = {
      x: det.box.x * scale,
      y: det.box.y * scale,
      width: det.box.width * scale,
      height: det.box.height * scale,
    };
    const descriptor = await extractEmbedding(input, box, vw, vh);
    if (descriptor) {
      results.push({
        detection: { box: det.box, score: det.score },
        descriptor,
      });
    }
  }

  return results;
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
  return faceapi.detectSingleFace(processed, getDetectorOptions(inputSize));
};

// ── Comparison (cosine similarity) ──
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string | MultiDescriptor
): number => {
  const a = desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);
  if (isMultiDescriptor(desc2)) return compareMultiDescriptor(a, desc2);

  let b: Float32Array;
  if (typeof desc2 === 'string') { b = new Float32Array(ensureDecompressed(desc2)); }
  else if (Array.isArray(desc2)) {
    if (desc2.length < DESC_DIM) { b = new Float32Array(ensureDecompressed(desc2)); }
    else { b = new Float32Array(desc2); }
  } else { b = toFloat32(desc2 as any); }

  const aNorm = normalizeDescriptor(new Float32Array(a));
  const bNorm = normalizeDescriptor(new Float32Array(b));

  if (aNorm.length !== bNorm.length) {
    const maxLen = Math.max(aNorm.length, bNorm.length);
    const paddedA = new Float32Array(maxLen);
    const paddedB = new Float32Array(maxLen);
    paddedA.set(aNorm); paddedB.set(bNorm);
    return 1 - cosineSimilarity(paddedA, paddedB);
  }
  return 1 - cosineSimilarity(aNorm, bNorm);
};

export interface FaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
}

export const findBestMatch = <T extends { faceDescriptor?: number[] | string | MultiDescriptor }>(
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

export const findBestMatchFromCache = async (
  queryDescriptor: Float32Array,
  threshold = 0.5
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
  threshold = 0.5
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
    return { main: Array.from(normalized), quality: newQuality, directions: newDirection, version: 2, descriptorVersion: 2 };
  }

  if ((md.quality || 0) >= 0.85 && (md.directions || '').split(',').length >= 5) return null;
  if (newQuality < (md.quality || 0) * 0.9) return null;

  const currentMain = toFloat32(md.main);
  const blended = new Float32Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) blended[i] = currentMain[i] * 0.7 + newDescriptor[i] * 0.3;
  const normalized = normalizeDescriptor(blended);

  const existingDirs = new Set((md.directions || '').split(',').filter(Boolean));
  existingDirs.add(newDirection);

  return {
    main: Array.from(normalized),
    angles: md.angles,
    quality: Math.max(md.quality || 0, newQuality),
    directions: [...existingDirs].join(','),
    version: 2,
    descriptorVersion: 2,
  };
};

export const descriptorToArray = (d: Float32Array) => compressFaceDescriptor(d);
export const descriptorToArrayUncompressed = (d: Float32Array) => Array.from(d);
