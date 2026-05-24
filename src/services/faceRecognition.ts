import * as faceapi from 'face-api.js';
import {
  compressFaceDescriptor,
  ensureDecompressed,
} from './faceCompression';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

const MODEL_URLS = [
  '/models',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
];

export const loadFaceModels = async (): Promise<void> => {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    for (let attempt = 0; attempt < MODEL_URLS.length; attempt++) {
      const url = MODEL_URLS[attempt];

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
        console.log('✅ موديلات الوجه من:', url);
        return;
      } catch (e) {
        console.warn(`⚠️ محاولة تحميل الموديلات ${attempt + 1} فشلت:`, e);
        loadingPromise = null;
        if (attempt < MODEL_URLS.length - 1) {
          await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
        }
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

export interface RegistrationQualityResult {
  ok: boolean;
  level: 'good' | 'warning' | 'bad';
  message: string;
  facesCount: number;
  brightness: number;
  box?: { x: number; y: number; width: number; height: number };
}

const getDeviceInputSize = (): 160 | 224 | 320 | 416 | 512 | 608 => {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  if (cores >= 8 && memory >= 6) return 608;
  if (cores >= 4 && memory >= 3) return 416;
  return 320;
};

const getDetectorOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: getDeviceInputSize(),
    scoreThreshold: 0.38,
  });
};

const getRegisterDetectorOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.34,
  });
};

const getRegisterFallbackDetectorOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.28,
  });
};

const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.35,
  maxResults: 10,
});

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

  sharedCtx.clearRect(0, 0, w, h);
  sharedCtx.imageSmoothingEnabled = true;
  sharedCtx.imageSmoothingQuality = 'high';
  sharedCtx.filter = 'contrast(1.12) brightness(1.04)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';

  return canvas;
};

const estimateBrightness = (canvas: HTMLCanvasElement): number => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 128;

  const sampleW = Math.min(120, canvas.width);
  const sampleH = Math.min(90, canvas.height);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;
  }

  return count ? sum / count : 128;
};

export const analyzeRegistrationFrame = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<RegistrationQualityResult> => {
  if (!modelsLoaded) await loadFaceModels();

  const processed = preprocessFrame(input, 640);
  const brightness = estimateBrightness(processed);

  const faces = await faceapi
    .detectAllFaces(processed, getRegisterDetectorOptions())
    .withFaceLandmarks(false);

  if (!faces.length) {
    return { ok: false, level: 'bad', message: 'لا يوجد وجه واضح', facesCount: 0, brightness };
  }

  if (faces.length > 1) {
    return { ok: false, level: 'bad', message: 'يوجد أكثر من وجه، خلي طالب واحد فقط', facesCount: faces.length, brightness };
  }

  const box = faces[0].detection.box;
  const frameW = processed.width || 640;
  const frameH = processed.height || 480;
  const areaRatio = (box.width * box.height) / (frameW * frameH);
  const faceCx = box.x + box.width / 2;
  const faceCy = box.y + box.height / 2;
  const offCenterX = Math.abs(faceCx - frameW / 2) / frameW;
  const offCenterY = Math.abs(faceCy - frameH / 2) / frameH;

  if (brightness < 45) {
    return { ok: false, level: 'bad', message: 'الإضاءة ضعيفة، زيد الإضاءة', facesCount: 1, brightness, box };
  }

  if (areaRatio < 0.055) {
    return { ok: false, level: 'warning', message: 'اقترب قليلاً من الكاميرا', facesCount: 1, brightness, box };
  }

  if (areaRatio > 0.42) {
    return { ok: false, level: 'warning', message: 'ابتعد قليلاً عن الكاميرا', facesCount: 1, brightness, box };
  }

  if (offCenterX > 0.23 || offCenterY > 0.25) {
    return { ok: false, level: 'warning', message: 'خلي وجهك بوسط الدائرة', facesCount: 1, brightness, box };
  }

  return { ok: true, level: 'good', message: 'ممتاز، الوجه واضح', facesCount: 1, brightness, box };
};

const pickBestRegistrationFace = <T extends { detection: { box: any } }>(
  faces: T[],
  frameWidth: number,
  frameHeight: number
): T | null => {
  if (!faces.length) return null;
  if (faces.length === 1) return faces[0];

  const cx = frameWidth / 2;
  const cy = frameHeight / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;

  const scored = faces.map(face => {
    const box = face.detection.box;
    const area = box.width * box.height;
    const faceCx = box.x + box.width / 2;
    const faceCy = box.y + box.height / 2;
    const dist = Math.sqrt(Math.pow(faceCx - cx, 2) + Math.pow(faceCy - cy, 2));
    const centerScore = 1 - Math.min(1, dist / maxDist);
    return { face, area, score: area * (0.75 + centerScore * 0.25) };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored.length >= 2 && scored[1].area > scored[0].area * 0.75) {
    console.warn('⚠️ أكثر من وجه واضح أثناء التسجيل، تم تجاهل اللقطة');
    return null;
  }

  return scored[0].face;
};

const filterStableDescriptors = (descriptors: Float32Array[], minCount = 3): Float32Array[] => {
  if (descriptors.length < minCount) return [];

  const scored = descriptors.map((descriptor, index) => {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < descriptors.length; i++) {
      if (i === index) continue;
      sum += faceapi.euclideanDistance(descriptor, descriptors[i]);
      count++;
    }

    return { descriptor, avgDistance: count ? sum / count : 999 };
  });

  scored.sort((a, b) => a.avgDistance - b.avgDistance);
  const bestAvg = scored[0].avgDistance;

  let clean = scored
    .filter(x => x.avgDistance <= bestAvg + 0.08 && x.avgDistance < 0.42)
    .slice(0, 7)
    .map(x => x.descriptor);

  if (clean.length < minCount) {
    clean = scored
      .filter(x => x.avgDistance < 0.50)
      .slice(0, 5)
      .map(x => x.descriptor);
  }

  return clean.length >= minCount ? clean : [];
};

const mergeDescriptors = (descriptors: Float32Array[]): Float32Array => {
  const merged = new Float32Array(128);

  for (let i = 0; i < 128; i++) {
    let sum = 0;
    for (const d of descriptors) sum += d[i];
    merged[i] = sum / descriptors.length;
  }

  return merged;
};

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

export const extractFaceDescriptorMultiCapture = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<Float32Array | null> => {
  if (!modelsLoaded) await loadFaceModels();

  const CAPTURE_DURATION_MS = 3000;
  const CAPTURE_INTERVAL_MS = 250;
  const MIN_GOOD_DESCRIPTORS = 3;
  const startTime = Date.now();
  const descriptors: Float32Array[] = [];

  onProgress?.(0);

  while (Date.now() - startTime < CAPTURE_DURATION_MS) {
    const elapsed = Date.now() - startTime;
    onProgress?.(Math.min(90, Math.round((elapsed / CAPTURE_DURATION_MS) * 90)));

    try {
      if (input instanceof HTMLVideoElement && input.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
        continue;
      }

      const processed = preprocessFrame(input, 640);

      let results = await faceapi
        .detectAllFaces(processed, getRegisterDetectorOptions())
        .withFaceLandmarks(false)
        .withFaceDescriptors();

      if (!results.length) {
        results = await faceapi
          .detectAllFaces(processed, getRegisterFallbackDetectorOptions())
          .withFaceLandmarks(false)
          .withFaceDescriptors();
      }

      const bestFace = pickBestRegistrationFace(results, processed.width, processed.height);
      if (bestFace?.descriptor) descriptors.push(bestFace.descriptor);
    } catch (e) {
      console.warn('capture frame error:', e);
    }

    await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
  }

  onProgress?.(95);

  if (descriptors.length < MIN_GOOD_DESCRIPTORS) {
    console.warn(`❌ عدد البصمات قليل: ${descriptors.length}/${MIN_GOOD_DESCRIPTORS}`);
    return null;
  }

  const cleanDescriptors = filterStableDescriptors(descriptors, MIN_GOOD_DESCRIPTORS);
  if (cleanDescriptors.length < MIN_GOOD_DESCRIPTORS) {
    console.warn(`❌ البصمات غير ثابتة: ${cleanDescriptors.length}/${descriptors.length}`);
    return null;
  }

  const merged = mergeDescriptors(cleanDescriptors);
  onProgress?.(100);
  console.log(`✅ دُمجت ${cleanDescriptors.length} بصمة نظيفة من أصل ${descriptors.length} لقطة`);
  return merged;
};

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

export const extractAllFaceDescriptorsHybrid = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
) => {
  if (!modelsLoaded) await loadFaceModels();

  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  const isHighEnd = cores >= 8 && memory >= 6;
  const processed = preprocessFrame(input, isHighEnd ? 1280 : 960);
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
      const isDup = merged.some(m => calculateIoU(m.detection.box, face.detection.box) > 0.4);
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
  return union > 0 ? inter / union : 0;
}

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
      best = {
        item,
        distance,
        confidence: Math.max(0, Math.min(100, Math.round((1 - distance / threshold) * 100))),
      };
    }
  }

  return best;
};

export interface SmartFaceMatchResult<T> {
  item: T;
  distance: number;
  confidence: number;
  secondDistance: number | null;
  gap: number | null;
  status: 'accepted' | 'uncertain' | 'rejected';
  reason?: string;
}

export interface SmartFaceMatchOptions {
  threshold: number;
  minGap: number;
  uncertainMargin?: number;
}

export const findBestMatchSmart = <T extends { faceDescriptor?: number[] | string }>(
  queryDescriptor: Float32Array,
  items: T[],
  options: SmartFaceMatchOptions
): SmartFaceMatchResult<T> | null => {
  const { threshold, minGap, uncertainMargin = 0.04 } = options;

  const matches: Array<{ item: T; distance: number }> = [];

  for (const item of items) {
    if (!item.faceDescriptor) continue;
    const distance = compareFaces(queryDescriptor, item.faceDescriptor as any);
    if (Number.isFinite(distance)) matches.push({ item, distance });
  }

  if (!matches.length) return null;

  matches.sort((a, b) => a.distance - b.distance);
  const best = matches[0];
  const second = matches[1];
  const secondDistance = second ? second.distance : null;
  const gap = second ? second.distance - best.distance : null;
  const confidence = Math.max(0, Math.min(100, Math.round((1 - best.distance / threshold) * 100)));

  if (best.distance < threshold) {
    if (gap !== null && gap < minGap) {
      return {
        item: best.item,
        distance: best.distance,
        confidence,
        secondDistance,
        gap,
        status: 'uncertain',
        reason: 'أفضل تطابق قريب جداً من ثاني أفضل تطابق',
      };
    }

    return { item: best.item, distance: best.distance, confidence, secondDistance, gap, status: 'accepted' };
  }

  if (best.distance < threshold + uncertainMargin) {
    return {
      item: best.item,
      distance: best.distance,
      confidence,
      secondDistance,
      gap,
      status: 'uncertain',
      reason: 'المسافة قريبة من الحد لكنها غير كافية للتسجيل التلقائي',
    };
  }

  return {
    item: best.item,
    distance: best.distance,
    confidence,
    secondDistance,
    gap,
    status: 'rejected',
    reason: 'لا يوجد تطابق كافي',
  };
};

export const descriptorToArray = (descriptor: Float32Array): number[] =>
  compressFaceDescriptor(descriptor);

export const descriptorToArrayUncompressed = (descriptor: Float32Array): number[] =>
  Array.from(descriptor);
