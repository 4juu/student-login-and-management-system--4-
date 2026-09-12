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
  private initTimer: number | null = null;
  private watchdog: number | null = null;

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
          const cvGlobal = (window as any).cv as any;

          const finish = (mod: any) => {
            this.clearInitTimers();
            this._cv = mod as OpenCV;
            this.report({ percent: 100, detail: 'محرك كشف البطاقة جاهز' });
            resolve(mod as OpenCV);
          };

          const fail = (e: Error) => {
            this.clearInitTimers();
            reject(e);
          };

          if (cvGlobal && cvGlobal.Mat && cvGlobal.imread) {
            // جاهز مباشرة (حالة نادرة — مُفعل قبل الوصول)
            finish(cvGlobal);
            return;
          }

          if (cvGlobal && typeof cvGlobal.then === 'function') {
            // نسخة 5.x تُخرج window.cv كـ Promise — الانتظار لحلّه هو الطريقة الصحيحة
            this.startInitAnimation();
            this.armWatchdog(fail);
            cvGlobal
              .then((mod: any) => {
                if (!mod || !mod.Mat) {
                  fail(new Error('تعذر إكمال تفعيل محرك كشف البطاقة'));
                  return;
                }
                finish(mod);
              })
              .catch((e: unknown) =>
                fail(e instanceof Error ? e : new Error('فشل تفعيل محرك كشف البطاقة'))
              );
            return;
          }

          if (cvGlobal && cvGlobal.onRuntimeInitialized !== undefined) {
            // نسخ قديمة — عبر onRuntimeInitialized
            this.startInitAnimation();
            this.armWatchdog(fail);
            cvGlobal.onRuntimeInitialized = () => finish(cvGlobal);
            return;
          }

          fail(new Error('فشل تفعيل محرك كشف البطاقة'));
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

  private startInitAnimation() {
    this.stopInitAnimation();
    let elapsed = 0;
    const phase = (ms: number, pct: number) =>
      ms < 9000 ? 'فك ترميز وحدة الحساب...'
      : ms < 22000 ? 'تهيئة محرك البطاقة...'
      : pct >= 99 ? 'المحرك جاهز تقريباً...'
      : 'تحسين أداء المحرك — يستغرق قليلاً في أول تشغيل...';

    // يتدرّج 92→99 ببطء حتى يكتمل التفعيل فعلياً (لا يبدو معلّقاً)
    this.initTimer = window.setInterval(() => {
      elapsed += 250;
      const pct = Math.min(99, 92 + (elapsed / 45000) * 7);
      this.report({ percent: pct, detail: phase(elapsed, pct) });
    }, 250);
  }

  private armWatchdog(fail: (e: Error) => void) {
    this.clearWatchdog();
    this.watchdog = window.setTimeout(() => {
      fail(new Error('استغرق تفعيل محرك كشف البطاقة وقتاً طويلاً — حاول مرة أخرى'));
    }, 90000);
  }

  private stopInitAnimation() {
    if (this.initTimer !== null) {
      window.clearInterval(this.initTimer);
      this.initTimer = null;
    }
  }

  private clearWatchdog() {
    if (this.watchdog !== null) {
      window.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearInitTimers() {
    this.stopInitAnimation();
    this.clearWatchdog();
  }

  reset() {
    this.clearInitTimers();
    this._cv = null;
    this.loading = null;
    this.report({ percent: 0, detail: 'تهيئة محرك كشف البطاقة...' });
  }
}

export const opencvLoader = new OpenCVLoader();