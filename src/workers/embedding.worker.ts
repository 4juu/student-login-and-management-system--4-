/// <reference lib="webworker" />
// ─────────────────────────────────────────────────────────────
// عامل استخراج البصمات — GhostFaceNet ONNX عبر onnxruntime-web (wasm)
// يستقبل ImageBitmap + مربعات الوجوه القادمة من MediaPipe، يقصّها ويستخرج 512 قيمة
// كل الاستدلال الثقيل هنا → الخيط الرئيسي بلا تجمد
// ─────────────────────────────────────────────────────────────
import * as ort from 'onnxruntime-web/wasm';

const BASE = import.meta.env.BASE_URL || '/';
const MODEL_URL = BASE + 'models/ghostfacenet.onnx';
const WASM_PREFIX = BASE + 'ort/';
console.info('[face-embed] base =', BASE);

const EMB_INPUT = 112;
const EMB_DIM = 512;

let session: ort.InferenceSession | null = null;
let inputName = 'input';
let outputName = 'embedding';

type Msg =
  | { type: 'init' }
  | { type: 'embed'; id: number; bitmap: ImageBitmap; box: Box }
  | { type: 'embedBatch'; id: number; bitmap: ImageBitmap; boxes: Box[] };

export interface Box { x: number; y: number; width: number; height: number }

interface EmbedOut {
  descriptor: number[];
  quality: { brightness: number; sizeScore: number; centerScore: number; composite: number };
}

function post(m: unknown) { (self as DedicatedWorkerGlobalScope).postMessage(m); }

let workCanvas: OffscreenCanvas | null = null;
function getCtx(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!workCanvas) workCanvas = new OffscreenCanvas(w, h);
  const c = workCanvas as OffscreenCanvas;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  g.imageSmoothingEnabled = true;
  return g;
}

/** قص مربع حول الوجه مع هامش 25% ثم تصغيره إلى 112×112 */
function cropFace(g: OffscreenCanvasRenderingContext2D, bmp: ImageBitmap, box: Box): void {
  const pad = 0.25;
  const pw = box.width * pad, ph = box.height * pad;
  let sx = box.x - pw, sy = box.y - ph;
  let sw = box.width + pw * 2, sh = box.height + ph * 2;
  const side = Math.max(sw, sh);
  const bcx = sx + sw / 2, bcy = sy + sh / 2;
  sx = bcx - side / 2; sy = bcy - side / 2; sw = side; sh = side;
  const cx1 = Math.max(0, sx), cy1 = Math.max(0, sy);
  const cx2 = Math.min(bmp.width, sx + sw), cy2 = Math.min(bmp.height, sy + sh);
  if (cx2 - cx1 < 8 || cy2 - cy1 < 8) throw new Error('face too small');
  g.clearRect(0, 0, EMB_INPUT, EMB_INPUT);
  g.drawImage(bmp, cx1, cy1, cx2 - cx1, cy2 - cy1, 0, 0, EMB_INPUT, EMB_INPUT);
}

async function embed(bmp: ImageBitmap, box: Box): Promise<EmbedOut> {
  if (!session) throw new Error('engine not ready');
  const g = getCtx(EMB_INPUT, EMB_INPUT);
  cropFace(g, bmp, box);
  const data = g.getImageData(0, 0, EMB_INPUT, EMB_INPUT).data;

  // جودة سريعة من نفس البكسلات
  let sum = 0, n = 0;
  for (let j = 0; j < data.length; j += 64) {
    sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    n++;
  }
  const brightness = sum / n / 255;
  const relSize = box.width / bmp.width;
  const sizeScore = relSize < 0.12 ? relSize / 0.12 : relSize > 0.75 ? Math.max(0, 1 - (relSize - 0.75) / 0.25) : 1;
  const fcx = box.x + box.width / 2, fcy = box.y + box.height / 2;
  const off = Math.hypot(fcx - bmp.width / 2, fcy - bmp.height / 2) / (Math.min(bmp.width, bmp.height) / 2);
  const centerScore = Math.max(0, 1 - off * 0.8);
  const brightScore = brightness < 0.25 ? brightness / 0.25 : brightness > 0.92 ? Math.max(0, 1 - (brightness - 0.92) / 0.08) : 1;
  const composite = Math.max(0, Math.min(1, sizeScore * 0.35 + centerScore * 0.3 + brightScore * 0.35));

  const px = new Float32Array(EMB_INPUT * EMB_INPUT * 3);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) {
    px[i] = data[j] / 255; px[i + 1] = data[j + 1] / 255; px[i + 2] = data[j + 2] / 255;
  }
  const out = await session.run({ [inputName]: new ort.Tensor('float32', px, [1, EMB_INPUT, EMB_INPUT, 3]) });
  const emb = out[outputName].data as Float32Array;

  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm) || 1;
  const desc = new Array<number>(EMB_DIM);
  for (let i = 0; i < EMB_DIM && i < emb.length; i++) desc[i] = emb[i] / norm;
  return {
    descriptor: desc,
    quality: {
      brightness: Math.round(brightness * 100) / 100,
      sizeScore: Math.round(sizeScore * 100) / 100,
      centerScore: Math.round(centerScore * 100) / 100,
      composite: Math.round(composite * 100) / 100,
    },
  };
}

async function init() {
  ort.env.wasm.wasmPaths = WASM_PREFIX;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  post({ type: 'progress', stage: 'model', percent: 20, detail: 'تحميل موديل البصمة...' });
  session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  inputName = session.inputNames[0];
  outputName = session.outputNames[0];

  post({ type: 'progress', stage: 'warmup', percent: 70, detail: 'تسخين الموديل...' });
  const dummy = new ort.Tensor('float32', new Float32Array(EMB_INPUT * EMB_INPUT * 3), [1, EMB_INPUT, EMB_INPUT, 3]);
  await session.run({ [inputName]: dummy });

  post({ type: 'progress', stage: 'done', percent: 100, detail: 'المحرك جاهز' });
  post({ type: 'ready' });
}

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
        await init();
        break;
      case 'embed': {
        const r = await embed(msg.bitmap, msg.box);
        msg.bitmap.close();
        post({ type: 'result', id: msg.id, ok: true, data: r });
        break;
      }
      case 'embedBatch': {
        const results: Array<EmbedOut & { box: Box }> = [];
        for (const box of msg.boxes) {
          try {
            const r = await embed(msg.bitmap, box);
            results.push({ ...r, box });
          } catch { /* وجه صغير جداً — تجاهل */ }
        }
        msg.bitmap.close();
        post({ type: 'result', id: msg.id, ok: true, data: results });
        break;
      }
    }
  } catch (e) {
    try { if ('bitmap' in msg && msg.bitmap) msg.bitmap.close(); } catch {}
    post({ type: 'result', id: (msg as { id?: number }).id ?? 0, ok: false, error: String((e as Error)?.message || e) });
  }
};
