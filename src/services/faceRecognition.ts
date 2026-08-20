import { compressFaceDescriptor, ensureDecompressed } from './faceCompression';
import { getWorker, workerFindBestMatch, workerBatchMatchAll } from './faceWorker';
import { loadMobileFaceNet, isMobileFaceNetReady, extractEmbedding, cosineSimilarity } from './mobileFaceNet';

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
    if (arr.length === DESC_DIM) {
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

const loadModelsInternal = async (): Promise<void> => {
  startPerfTimer('modelDownload');

  _emitProgress({ stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل كاشف الوجه...' });
  await yieldToMain();
  _detectorReady = true;
  _emitProgress({ stage: 'detector', stageIndex: 0, percent: 50, detail: '✓ كاشف الوجه جاهز' });

  _emitProgress({ stage: 'recognition', stageIndex: 1, percent: 50, detail: 'جاري تحميل موديل التعرف...' });
  await loadMobileFaceNet();
  _emitProgress({ stage: 'recognition', stageIndex: 1, percent: 100, detail: '✓ موديل التعرف جاهز' });

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

export function startDetectorPreload(): void {
  if (_detectorReady || modelsLoaded) return;
  _detectorReady = true;
}

export function isPreloadStarted(): boolean { return preloadStarted; }
export const resetModels = () => { modelsLoaded = false; loadingPromise = null; _loadProgress = 0; _detectorReady = false; preloadStarted = false; _lastProgress = { stage: 'detector', stageIndex: 0, percent: 0, detail: 'جاري تحميل الموديلات...' }; };
export const areModelsLoaded = () => modelsLoaded;
export const getLastModelProgress = (): LoadProgressInfo => _lastProgress;

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
  try {
    if (input instanceof Float32Array) return input;
    if (input && typeof input === 'object' && !Array.isArray(input) && 'main' in input) {
      return toFloat32(input.main);
    }
    if (typeof input === 'string') {
      const arr = ensureDecompressed(input);
      return arr.length > 0 ? new Float32Array(arr) : new Float32Array(0);
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
          const arr = ensureDecompressed(input);
          return arr.length > 0 ? new Float32Array(arr) : new Float32Array(0);
        }
      }
      if (input.length > 0 && input.every(v => Number.isInteger(v))) {
        const arr = ensureDecompressed(input);
        return arr.length > 0 ? new Float32Array(arr) : new Float32Array(0);
      }
      return new Float32Array(input);
    }
    return new Float32Array(0);
  } catch {
    return new Float32Array(0);
  }
};

export const compareMultiDescriptor = (query: Float32Array, stored: MultiDescriptor): number => {
  const mainDesc = normalizeDescriptor(toFloat32(stored.main));
  if (mainDesc.length !== DESC_DIM) return 1;
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

// ── Simple face detection using skin color + center bias ──
const isSkinPixel = (r: number, g: number, b: number): boolean => {
  return r > 95 && g > 40 && b > 20 &&
    r > g && r > b &&
    (r - g) > 15 &&
    Math.max(r, g, b) - Math.min(r, g, b) > 15;
};

interface SimpleDetection { box: { x: number; y: number; width: number; height: number }; score: number }

const detectFacesSimple = (canvas: HTMLCanvasElement): SimpleDetection[] => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const gridW = Math.ceil(w / 8);
  const gridH = Math.ceil(h / 8);
  const skinGrid = new Uint8Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.floor((gx + 0.5) * (w / gridW));
      const py = Math.floor((gy + 0.5) * (h / gridH));
      let skin = 0;
      let total = 0;
      const step = 2;
      for (let dy = -4; dy <= 4; dy += step) {
        for (let dx = -4; dx <= 4; dx += step) {
          const sx = px + dx;
          const sy = py + dy;
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
          const i = (sy * w + sx) * 4;
          total++;
          if (isSkinPixel(data[i], data[i + 1], data[i + 2])) skin++;
        }
      }
      skinGrid[gy * gridW + gx] = total > 0 && skin / total > 0.4 ? 1 : 0;
    }
  }

  const visited = new Uint8Array(gridW * gridH);
  const clusters: Array<{ minX: number; minY: number; maxX: number; maxY: number; count: number }> = [];

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (visited[gy * gridW + gx] || !skinGrid[gy * gridW + gx]) continue;
      const stack = [gy * gridW + gx];
      let minX = gx, minY = gy, maxX = gx, maxY = gy, count = 0;
      while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx]) continue;
        visited[idx] = 1;
        const cx = idx % gridW;
        const cy = Math.floor(idx / gridW);
        count++;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        for (const [ndx, ndy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = cx + ndx, ny = cy + ndy;
          if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && !visited[ny * gridW + nx] && skinGrid[ny * gridW + nx]) {
            stack.push(ny * gridW + nx);
          }
        }
      }
      if (count >= 4) {
        clusters.push({ minX, minY, maxX, maxY, count });
      }
    }
  }

  if (clusters.length === 0) return [];

  clusters.sort((a, b) => b.count - a.count);
  const cellW = w / gridW;
  const cellH = h / gridH;

  return clusters.slice(0, 3).map(c => {
    const bx = c.minX * cellW;
    const by = c.minY * cellH;
    const bw = (c.maxX - c.minX + 1) * cellW;
    const bh = (c.maxY - c.minY + 1) * cellH;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const distFromCenter = Math.sqrt(Math.pow((cx - w / 2) / (w / 2), 2) + Math.pow((cy - h / 2) / (h / 2), 2));
    const score = c.count / (gridW * gridH) * (1 - distFromCenter * 0.5);
    const pad = 0.15;
    return {
      box: {
        x: Math.max(0, bx - bw * pad),
        y: Math.max(0, by - bh * pad),
        width: Math.min(w - Math.max(0, bx - bw * pad), bw * (1 + pad * 2)),
        height: Math.min(h - Math.max(0, by - bh * pad), bh * (1 + pad * 2)),
      },
      score,
    };
  });
};

// ── Face detection + recognition ──
export const detectFaces = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  inputSize = 320
) => {
  const processed = preprocessFrame(input, inputSize);
  return detectFacesSimple(processed);
};

export const extractFaceDescriptor = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();
  if (!isMobileFaceNetReady()) return null;

  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;

  const processed = preprocessFrame(input, 640);
  const detections = detectFacesSimple(processed);
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
  _inputSize = 320
) => {
  if (!modelsLoaded) await loadFaceModels();
  if (!isMobileFaceNetReady()) return [];

  const vw = 'videoWidth' in input ? input.videoWidth : input.width;
  const vh = 'videoHeight' in input ? input.videoHeight : input.height;

  const processed = preprocessFrame(input, targetWidth);
  const detections = detectFacesSimple(processed);

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
  _inputSize = 320
) => {
  const processed = preprocessFrame(input, targetWidth);
  return detectFacesSimple(processed);
};

export const detectSingleFace = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetWidth = 640,
  _inputSize = 320
) => {
  if (!modelsLoaded) await loadFaceModels();
  const processed = preprocessFrame(input, targetWidth);
  const faces = detectFacesSimple(processed);
  return faces.length > 0 ? faces[0] : null;
};

// ── Comparison (cosine similarity) ──
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string | MultiDescriptor
): number => {
  try {
    const a = desc1 instanceof Float32Array ? desc1 : toFloat32(desc1);
    if (a.length === 0 || a.length !== DESC_DIM) return 1;
    if (isMultiDescriptor(desc2)) return compareMultiDescriptor(a, desc2);

    let b: Float32Array;
    if (typeof desc2 === 'string') { b = toFloat32(desc2); }
    else if (Array.isArray(desc2)) { b = toFloat32(desc2); }
    else { b = toFloat32(desc2 as any); }

    if (b.length === 0 || b.length !== DESC_DIM) return 1;

    const aNorm = normalizeDescriptor(a);
    const bNorm = normalizeDescriptor(b);

    return 1 - cosineSimilarity(aNorm, bNorm);
  } catch {
    return 1;
  }
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
    if (currentArray.length !== DESC_DIM) {
      const normalized = normalizeDescriptor(new Float32Array(newDescriptor));
      return { main: Array.from(normalized), quality: newQuality, directions: newDirection, version: 2, descriptorVersion: 2 };
    }
    const normalized = normalizeDescriptor(currentArray);
    return { main: Array.from(normalized), quality: newQuality, directions: newDirection, version: 2, descriptorVersion: 2 };
  }

  if ((md.quality || 0) >= 0.85 && (md.directions || '').split(',').length >= 5) return null;
  if (newQuality < (md.quality || 0) * 0.9) return null;

  const currentMain = toFloat32(md.main);
  if (currentMain.length !== DESC_DIM) {
    const normalized = normalizeDescriptor(new Float32Array(newDescriptor));
    return { main: Array.from(normalized), quality: newQuality, directions: newDirection, version: 2, descriptorVersion: 2 };
  }
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
