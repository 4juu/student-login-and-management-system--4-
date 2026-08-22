// ─────────────────────────────────────────────────────────────
// جسر الواجهة ↔ عامل البصمات: مهلة زمنية لكل طلب + استعادة تلقائية
// ─────────────────────────────────────────────────────────────
import type { Box } from '../../workers/embedding.worker';

export type { Box };

export interface EmbedQuality {
  brightness: number;
  sizeScore: number;
  centerScore: number;
  composite: number;
}

export interface EmbedResult {
  descriptor: number[];
  quality: EmbedQuality;
}

export interface EngineProgress {
  stage: 'model' | 'warmup' | 'done';
  percent: number;
  detail: string;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const INIT_TIMEOUT = 60_000;
const REQ_TIMEOUT = 15_000;

class EmbeddingClient {
  private worker: Worker | null = null;
  private seq = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void> | null = null;
  private progressListeners = new Set<(p: EngineProgress) => void>();
  private lastProgress: EngineProgress = { stage: 'model', percent: 0, detail: '...' };
  private restarts = 0;
  private _ready = false;
  private latencies: number[] = [];
  private readonly LATENCY_SAMPLE_SIZE = 5;

  get ready(): boolean { return this._ready; }

  get avgLatencyMs(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  /** يحدد أفضل دقة التقاط بناءً على أداء الجهاز الفعلي */
  get recommendedMaxWidth(): number {
    const avg = this.avgLatencyMs;
    if (avg === 0) return 480;
    if (avg > 220) return 320;
    if (avg > 130) return 400;
    return 480;
  }

  onProgress(cb: (p: EngineProgress) => void): () => void {
    this.progressListeners.add(cb);
    cb(this.lastProgress);
    return () => { this.progressListeners.delete(cb); };
  }

  ensureReady(): Promise<void> {
    if (this._ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolveInit, rejectInit) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../../workers/embedding.worker.ts', import.meta.url), { type: 'module' });
      } catch (e) {
        console.error('[face-embed] فشل إنشاء العامل:', e);
        rejectInit(new Error('فشل إنشاء محرك البصمات'));
        return;
      }
      this.worker = worker;

      const initTimer = setTimeout(() => {
        console.error('[face-embed] انتهت مهلة تحميل الموديل بعد 60 ثانية');
        rejectInit(new Error('انتهت مهلة تحميل محرك البصمات'));
      }, INIT_TIMEOUT);

      worker.onmessage = (ev: MessageEvent) => {
        const m = ev.data as Record<string, unknown> & { type: string };
        switch (m.type) {
          case 'progress':
            this.lastProgress = {
              stage: m.stage as EngineProgress['stage'],
              percent: m.percent as number,
              detail: m.detail as string,
            };
            this.progressListeners.forEach(cb => cb(this.lastProgress));
            break;
          case 'ready':
            clearTimeout(initTimer);
            this.restarts = 0;
            this._ready = true;
            resolveInit();
            break;
          case 'result': {
            const p = this.pending.get(m.id as number);
            if (!p) break;
            this.pending.delete(m.id as number);
            clearTimeout(p.timer);
            if (m.ok) p.resolve(m.data);
            else p.reject(new Error(String(m.error)));
            break;
          }
        }
      };

      worker.onerror = (ev: ErrorEvent) => {
        console.error('[face-embed] خطأ في العامل:', ev.message, ev.filename, `line ${ev.lineno}`);
        clearTimeout(initTimer);
        this.handleCrash();
        rejectInit(new Error('تعطل محرك البصمات'));
      };

      worker.postMessage({ type: 'init' });
    })
      .then(() => { this.readyPromise = null; })
      .catch(e => { this.readyPromise = null; throw e; });

    return this.readyPromise;
  }

  private handleCrash() {
    const wasReady = this._ready;
    this.worker?.terminate();
    this.worker = null;
    this._ready = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('انقطع محرك البصمات، جاري الاستعادة...'));
    }
    this.pending.clear();
    if (this.restarts < 1) {
      this.restarts++;
      console.warn('[face-embed] إعادة تشغيل تلقائية بعد الانهيار...');
      this.ensureReady().catch(e => { console.error('[face-embed] فشلت إعادة التشغيل:', e); });
    } else if (wasReady) {
      this.lastProgress = { stage: 'model', percent: 0, detail: 'تعذر تشغيل محرك البصمات' };
      this.progressListeners.forEach(cb => cb(this.lastProgress));
    }
  }

  private request<T>(msg: Record<string, unknown>, timeoutMs = REQ_TIMEOUT): Promise<T> {
    if (!this.worker || !this._ready) return Promise.reject(new Error('المحرك غير جاهز'));
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('انتهت مهلة المعالجة'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async embed(bitmap: ImageBitmap, box: Box): Promise<EmbedResult> {
    const start = performance.now();
    try {
      const res = await this.request<EmbedResult>({ type: 'embed', bitmap, box });
      this.recordLatency(performance.now() - start);
      return res;
    } catch (e) {
      if (String(e).includes('المحرك غير جاهز') || String(e).includes('انقطع')) {
        console.warn('[face-embed] المحرك معطّل، محاولة إعادة التشغيل...');
        this._ready = false;
        this.worker?.terminate();
        this.worker = null;
        this.readyPromise = null;
        this.restarts = 0;
        this.ensureReady().catch(() => {});
      }
      throw e;
    }
  }

  async embedBatch(bitmap: ImageBitmap, boxes: Box[]): Promise<Array<EmbedResult & { box: Box }>> {
    const start = performance.now();
    try {
      const res = await this.request<Array<EmbedResult & { box: Box }>>({ type: 'embedBatch', bitmap, boxes });
      this.recordLatency((performance.now() - start) / Math.max(1, boxes.length));
      return res;
    } catch (e) {
      if (String(e).includes('المحرك غير جاهز') || String(e).includes('انقطع')) {
        console.warn('[face-embed] المحرك معطّل، محاولة إعادة التشغيل...');
        this._ready = false;
        this.worker?.terminate();
        this.worker = null;
        this.readyPromise = null;
        this.restarts = 0;
        this.ensureReady().catch(() => {});
      }
      throw e;
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this._ready = false;
    this.readyPromise = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('تم إغلاق المحرك'));
    }
    this.pending.clear();
  }

  private recordLatency(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > this.LATENCY_SAMPLE_SIZE) this.latencies.shift();
  }
}

export const faceEmbedder = new EmbeddingClient();
