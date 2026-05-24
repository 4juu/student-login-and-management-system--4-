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

          // مهم: الشبكة الكاملة أدق للتسجيل
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

        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
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

/* ─── إعدادات أخف للتسجيل ─── */
const getRegisterDetectorOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.34,
  });
};

/* ─── fallback للتسجيل ─── */
const getRegisterFallbackDetectorOptions = () => {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.28,
  });
};

/* ─── SSD فقط للأجهزة القوية ─── */
const detectorOptionsSSD = new faceapi.SsdMobilenetv1Options({
  minConfidence: 0.35,
  maxResults: 10,
});

/* ─── Canvas مُشترك ─── */
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

  // تحسين بسيط للصورة
  sharedCtx.filter = 'contrast(1.12) brightness(1.04)';
  sharedCtx.drawImage(input, 0, 0, w, h);
  sharedCtx.filter = 'none';

  return canvas;
};

/* ─── اختيار الوجه الأفضل أثناء التسجيل ─── */
/*
  الفكرة:
  - لا نعتمد على detectSingleFace لأن ممكن يختار وجه شخص آخر.
  - نختار الوجه الأكبر والقريب من وسط الصورة.
*/
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

    const dist = Math.sqrt(
      Math.pow(faceCx - cx, 2) + Math.pow(faceCy - cy, 2)
    );

    const centerScore = 1 - Math.min(1, dist / maxDist);

    // الأكبر أهم، والقرب للوسط يساعد
    const score = area * (0.75 + centerScore * 0.25);

    return { face, area, score };
  });

  scored.sort((a, b) => b.score - a.score);

  /*
    إذا يوجد وجهين متقاربين بالحجم جداً، نتجاهل هذه اللقطة
    حتى لا تدخل بصمة شخص ثاني بالدمج.
  */
  if (scored.length >= 2) {
    const firstArea = scored[0].area;
    const secondArea = scored[1].area;

    if (secondArea > firstArea * 0.75) {
      console.warn('⚠️ أكثر من وجه واضح أثناء التسجيل، تم تجاهل هذه اللقطة');
      return null;
    }
  }

  return scored[0].face;
};

/* ─── فلترة البصمات قبل الدمج ─── */
const filterStableDescriptors = (
  descriptors: Float32Array[],
  minCount = 3
): Float32Array[] => {
  if (descriptors.length < minCount) return [];

  /*
    نحسب متوسط بُعد كل بصمة عن باقي البصمات.
    البصمة الجيدة تكون قريبة من المجموعة.
    البصمة الشاذة تكون بعيدة.
  */
  const scored = descriptors.map((descriptor, index) => {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < descriptors.length; i++) {
      if (i === index) continue;

      sum += faceapi.euclideanDistance(descriptor, descriptors[i]);
      count++;
    }

    return {
      descriptor,
      avgDistance: count > 0 ? sum / count : 999,
    };
  });

  scored.sort((a, b) => a.avgDistance - b.avgDistance);

  const bestAvg = scored[0].avgDistance;

  /*
    القيم المقترحة:
    - x.avgDistance < 0.42: يمنع اللقطات الضعيفة جداً.
    - bestAvg + 0.08: يسمح باختلاف بسيط لكن يرفض الشاذ.
  */
  let clean = scored
    .filter(x => x.avgDistance <= bestAvg + 0.08 && x.avgDistance < 0.42)
    .slice(0, 7)
    .map(x => x.descriptor);

  /*
    إذا كانت الكاميرا أو الإضاءة صعبة، ممكن تكون الفلترة صارمة.
    هنا fallback نأخذ أفضل 3 إذا كانت مقبولة نسبياً.
  */
  if (clean.length < minCount) {
    clean = scored
      .filter(x => x.avgDistance < 0.50)
      .slice(0, 5)
      .map(x => x.descriptor);
  }

  if (clean.length < minCount) return [];

  return clean;
};

/* ─── دمج البصمات بدون normalization ─── */
const mergeDescriptors = (descriptors: Float32Array[]): Float32Array => {
  const merged = new Float32Array(128);

  for (let i = 0; i < 128; i++) {
    let sum = 0;

    for (const d of descriptors) {
      sum += d[i];
    }

    merged[i] = sum / descriptors.length;
  }

  /*
    مهم:
    لا نسوي normalization هنا.
    لأن face-api يرجع descriptor بصيغة معينة،
    وإذا طبّعنا المخزون فقط راح تختلف المسافات أثناء المقارنة.
  */

  return merged;
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
      .detectSingleFace(
        processed,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 320,
          scoreThreshold: 0.32,
        })
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();
  }

  return result?.descriptor || null;
};

/* ─── التقاط متعدد ودمج البصمات ─── */
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
    const progress = Math.min(
      90,
      Math.round((elapsed / CAPTURE_DURATION_MS) * 90)
    );

    onProgress?.(progress);

    try {
      if (
        input instanceof HTMLVideoElement &&
        input.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
        continue;
      }

      const processed = preprocessFrame(input, 640);

      /*
        مهم:
        نستخدم detectAllFaces بدل detectSingleFace حتى نعرف إذا أكثر من وجه موجود.
        ونستخدم full landmarks false حتى تكون البصمة أدق.
      */
      let results = await faceapi
        .detectAllFaces(processed, getRegisterDetectorOptions())
        .withFaceLandmarks(false)
        .withFaceDescriptors();

      /*
        fallback إذا ما لقى وجه
      */
      if (!results.length) {
        results = await faceapi
          .detectAllFaces(processed, getRegisterFallbackDetectorOptions())
          .withFaceLandmarks(false)
          .withFaceDescriptors();
      }

      if (!results.length) {
        await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
        continue;
      }

      const bestFace = pickBestRegistrationFace(
        results,
        processed.width,
        processed.height
      );

      if (bestFace?.descriptor) {
        descriptors.push(bestFace.descriptor);
      }
    } catch (e) {
      console.warn('capture frame error:', e);
    }

    await new Promise(r => setTimeout(r, CAPTURE_INTERVAL_MS));
  }

  onProgress?.(95);

  if (descriptors.length < MIN_GOOD_DESCRIPTORS) {
    console.warn(
      `❌ عدد البصمات قليل: ${descriptors.length}/${MIN_GOOD_DESCRIPTORS}`
    );
    return null;
  }

  const cleanDescriptors = filterStableDescriptors(
    descriptors,
    MIN_GOOD_DESCRIPTORS
  );

  if (cleanDescriptors.length < MIN_GOOD_DESCRIPTORS) {
    console.warn(
      `❌ البصمات غير ثابتة: ${cleanDescriptors.length}/${descriptors.length}`
    );
    return null;
  }

  const merged = mergeDescriptors(cleanDescriptors);

  onProgress?.(100);

  console.log(
    `✅ دُمجت ${cleanDescriptors.length} بصمة نظيفة من أصل ${descriptors.length} لقطة`
  );

  return merged;
};

/* ─── كل الوجوه - الطريقة الأساسية ─── */
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

/* ─── كشف هجين - بالتسلسل مو بالتوازي ─── */
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
        m => calculateIoU(m.detection.box, face.detection.box) > IOU_THRESHOLD
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
  const union =
    box1.width * box1.height + box2.width * box2.height - inter;

  return union > 0 ? inter / union : 0;
}

/* ─── مقارنة بصمتين ─── */
export const compareFaces = (
  desc1: Float32Array | number[],
  desc2: Float32Array | number[] | string
): number => {
  const a =
    desc1 instanceof Float32Array ? desc1 : new Float32Array(desc1);

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

/* ─── أفضل تطابق ─── */
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

    if (distance < threshold) {
      if (!best || distance < best.distance) {
        best = {
          item,
          distance,
          confidence: Math.max(
            0,
            Math.min(100, Math.round((1 - distance / threshold) * 100))
          ),
        };
      }
    }
  }

  return best;
};

/* ─── تحويل البصمة ─── */
export const descriptorToArray = (descriptor: Float32Array): number[] =>
  compressFaceDescriptor(descriptor);

/*
  استخدم هذا مؤقتاً إذا تحب تختبر بدون ضغط:
  export const descriptorToArray = (descriptor: Float32Array): number[] =>
    Array.from(descriptor);
*/

export const descriptorToArrayUncompressed = (
  descriptor: Float32Array
): number[] => Array.from(descriptor);