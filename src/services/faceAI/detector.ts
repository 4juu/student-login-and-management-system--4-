// ─────────────────────────────────────────────────────────────
// كاشف الوجوه — MediaPipe FaceDetector من جوجل
// blaze_face_short_range.tflite بوضع VIDEO، GPU أولاً ثم CPU كبديل
// ─────────────────────────────────────────────────────────────
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL || '/';
const WASM_PATH = BASE + 'mediapipe/wasm';
const MODEL_PATH = BASE + 'models/blaze_face_short_range.tflite';

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  score: number;
  /** النقاط المرجعية الست لـ MediaPipe (إحداثيات الفيديو الحقيقية) */
  keypoints?: { x: number; y: number }[];
}

export type DetectorProgress = {
  stage: 'wasm' | 'model' | 'done';
  percent: number;
  detail: string;
};

type ProgressCb = (p: DetectorProgress) => void;

class FaceDetectionService {
  private detector: FaceDetector | null = null;
  private loading: Promise<void> | null = null;
  private listeners = new Set<ProgressCb>();
  private lastProgress: DetectorProgress = { stage: 'wasm', percent: 0, detail: 'تهيئة محرك الكشف...' };
  private _ready = false;

  get ready(): boolean { return this._ready; }

  onProgress(cb: ProgressCb): () => void {
    this.listeners.add(cb);
    cb(this.lastProgress);
    return () => { this.listeners.delete(cb); };
  }

  private report(p: DetectorProgress) {
    this.lastProgress = p;
    this.listeners.forEach(cb => cb(p));
  }

  /** تهيئة idempotent — GPU إن توفر وإلا CPU */
  ensureReady(): Promise<void> {
    if (this._ready) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        this.report({ stage: 'wasm', percent: 15, detail: 'تحميل ملفات التشغيل...' });
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

        this.report({ stage: 'model', percent: 45, detail: 'تحميل كاشف الوجوه...' });
        try {
          this.detector = await FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5,
          });
        } catch (gpuErr) {
          console.warn('[face-detector] GPU غير متاح، التحويل إلى CPU:', gpuErr);
          this.detector = await FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5,
          });
        }

        this._ready = true;
        this.report({ stage: 'done', percent: 100, detail: 'كاشف الوجوه جاهز' });
      } catch (e) {
        console.error('[face-detector] فشل التهيئة:', e);
        this.loading = null;
        throw new Error('تعذر تحميل كاشف الوجوه — تحقق من الاتصال وأعد المحاولة');
      }
    })();

    return this.loading;
  }

  /**
   * كشف الوجوه في إطار فيديو — يعيد مربعات بإحداثيات الفيديو الحقيقية
   * يجب استدعاؤها بعد جاهزية ensureReady وبتوقيت متزايد monotonic
   */
  detect(video: HTMLVideoElement, timestampMs: number): DetectedFace[] {
    if (!this.detector || video.readyState < 2 || !video.videoWidth) return [];
    try {
      const result = this.detector.detectForVideo(video, timestampMs);
      const out: DetectedFace[] = [];
      for (const det of result.detections ?? []) {
        const bb = det.boundingBox;
        const score = det.categories?.[0]?.score ?? 0;
        if (!bb || score < 0.5) continue;
        const x = Math.max(0, bb.originX);
        const y = Math.max(0, bb.originY);
        const width = Math.min(video.videoWidth - x, bb.width);
        const height = Math.min(video.videoHeight - y, bb.height);
        if (width < 24 || height < 24) continue;

        // ✅ النقاط المرجعية (نسبية 0..1) → نحوّلها لإحداثيات الفيديو الحقيقية
        const keypoints = det.keypoints?.map(kp => ({
          x: kp.x * video.videoWidth,
          y: kp.y * video.videoHeight,
        }));

        out.push({ box: { x, y, width, height }, score, keypoints });
      }
      out.sort((a, b) => b.box.width * b.score - a.box.width * a.score);
      return out;
    } catch (e) {
      console.error('[face-detector] فشل الكشف — إعادة تهيئة المحرك:', e);
      this._ready = false;
      this.detector = null;
      this.loading = null;
      this.report({ stage: 'wasm', percent: 0, detail: 'أُعيد تهيئة محرك الكشف...' });
      return [];
    }
  }

  /** إعادة تهيئة كاملة من الصفر — تستدعى عند تعطل المحرك */
  reset() {
    this._ready = false;
    this.detector = null;
    this.loading = null;
    this.report({ stage: 'wasm', percent: 0, detail: 'تهيئة محرك الوجه...' });
  }
}

export const faceDetectorService = new FaceDetectionService();

/** التقاط إطار من الفيديو كـ ImageBitmap قابل للنقل للعامل */
let grabCanvas: HTMLCanvasElement | null = null;

export async function grabVideoFrame(video: HTMLVideoElement, maxWidth = 480): Promise<ImageBitmap | null> {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || video.readyState < 2) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(2, Math.round(vw * scale));
  const h = Math.max(2, Math.round(vh * scale));
  if (!grabCanvas) grabCanvas = document.createElement('canvas');
  grabCanvas.width = w; grabCanvas.height = h;
  const g = grabCanvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(video, 0, 0, w, h);
  try {
    return await createImageBitmap(grabCanvas);
  } catch (e) {
    console.error('[face-detector] فشل createImageBitmap:', e);
    return null;
  }
}
