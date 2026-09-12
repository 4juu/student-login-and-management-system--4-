// ─────────────────────────────────────────────────────────────
// محمّل محرك OpenCV.js في المتصفح
// يحمّل الملفة الكبيرة (~12MB) مرة واحدة فقط، مع تتبع نسبة التحميل
// وتفجير الأحداث للمكونات — يُسترسل فقط عند فتح كاميرا البطاقة
// ─────────────────────────────────────────────────────────────

// Type مبسّط للمكتبة — يُستخدم فقط في التوقيع، لا قيمة له في الحزمة
import type { OCVMat, OCVCV } from './opencvTypes';

export type OpenCV = OCVCV;
export type Mat = OCVMat;

const BASE = import.meta.env.BASE_URL || '/';
const OPENCV_PATH = BASE + 'opencv/opencv.js';

export interface OpenCVProgress {
  percent: number;
  detail: string;
}

type ProgressCb = (p: OpenCVProgress) => void;

class OpenCVLoader {
  private _cv: OpenCV | null = null;
  private loading: Promise<OpenCV> | null = null;
  private listeners = new Set<ProgressCb>();
  private lastProgress: OpenCVProgress = { percent: 0, detail: 'تهيئة محرك كشف البطاقة...' };

  onProgress(cb: ProgressCb): () => void {
    this.listeners.add(cb);
    cb(this.lastProgress);
    return () => { this.listeners.delete(cb); };
  }

  get ready(): boolean {
    return !!this._cv;
  }

  getCV(): OpenCV {
    if (!this._cv) throw new Error('OpenCV.js غير منتهٍ من التحميل');
    return this._cv;
  }

  private report(p: OpenCVProgress) {
    this.lastProgress = p;
    this.listeners.forEach(cb => cb(p));
  }

  ensureReady(): Promise<OpenCV> {
    if (this._cv) return Promise.resolve(this._cv);
    if (this.loading) return this.loading;

    this.loading = this.loadOpenCV();
    return this.loading;
  }

  private loadOpenCV(): Promise<OpenCV> {
    return new Promise<OpenCV>((resolve, reject) => {
      // التحقق من وجود نسخة سابقة متوسطة (window) — عند فتح النافذة الثانية
      const existing = (window as any).cv;
      if (existing && existing.Mat) {
        this._cv = existing as OpenCV;
        this.report({ percent: 100, detail: 'محرك كشف البطاقة جاهز' });
        resolve(existing as OpenCV);
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('GET', OPENCV_PATH, true);
      xhr.responseType = 'arraybuffer';

      xhr.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.min(90, Math.round((e.loaded / e.total) * 100));
          this.report({
            percent: pct,
            detail: `تحميل محرك كشف البطاقة... ${pct}% (${(e.loaded / 1048576).toFixed(1)} MB)`,
          });
        } else {
          this.report({ percent: 30, detail: 'تحميل محرك كشف البطاقة...' });
        }
      };

      xhr.onload = () => {
        if (xhr.status !== 200 && xhr.status !== 0) {
          reject(new Error(`تعذر تحميل محرك الكشف (${xhr.status})`));
          return;
        }
        this.report({ percent: 92, detail: 'تفعيل محرك البطاقة...' });

        const bytes = new Uint8Array(xhr.response as ArrayBuffer);
        const blob = new Blob([bytes], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);

        const script = document.createElement('script');
        script.src = url;
        script.async = true;

        script.onload = () => {
          URL.revokeObjectURL(url);
          const cv = (window as any).cv;
          if (!cv) {
            reject(new Error('فشل تفعيل محرك كشف البطاقة'));
            return;
          }

          const onInit = () => {
            this._cv = cv as OpenCV;
            this.report({ percent: 100, detail: 'محرك كشف البطاقة جاهز' });
            resolve(cv as OpenCV);
          };

          if (cv.Mat && cv.imread) {
            onInit();
          } else {
            cv.onRuntimeInitialized = onInit;
          }
        };

        script.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('فشل تحميل محرك كشف البطاقة'));
        };

        document.body.appendChild(script);
      };

      xhr.onerror = () => reject(new Error('تعذر الاتصال لتحميل محرك كشف البطاقة'));
      xhr.send();
    }).catch((e) => {
      this.loading = null;
      throw e;
    });
  }

  reset() {
    this._cv = null;
    this.loading = null;
    this.report({ percent: 0, detail: 'تهيئة محرك كشف البطاقة...' });
  }
}

export const opencvLoader = new OpenCVLoader();