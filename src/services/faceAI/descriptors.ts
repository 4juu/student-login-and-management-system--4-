// ─────────────────────────────────────────────────────────────
// صيغة البصمة الجديدة v4 — GhostFaceNet 512-bits L2-normalized
// { main: number[512], alt?: number[512][], samples?, quality?, version: 4 }
// alt يحتوي العينات الأصلية (أمام/يمين/يسار) — المقارنة تتم ضد كل عينة
// ─────────────────────────────────────────────────────────────

export const DESC_DIM = 512;
export const DESC_VERSION = 4;

/** عتبة المسافة الكوسينية — صارم للمطابقة المؤكدة */
export const MATCH_STRICT = 0.35;
/**
 * عتبة متساهلة — تُقبل تغيّرات في الزاوية والمسافة والاتجاه.
 * لأن البصمة تحتوي عينات متعددة الزوايا، نرفع العتبة لتقديم مرونة أكبر.
 */
export const MATCH_LOOSE = 0.70;
/** إذا تطابق وجه طالب مع بصمة طالب آخر أقل من هذه العتبة → احتيال محتمل */
export const TAMPER_THRESHOLD = 0.32;

export interface StoredFaceDescriptor {
  main: number[];
  /** عينات أصلية إضافية (أمام/يمين/يسار) — تُقارَن كل منها أثناء التعرّف */
  alt?: number[][];
  samples?: number;
  quality?: number;
  version: number;
}

export interface MatchCandidate {
  id: string;
}

/** تحليل عينة واحدة من المخزون إلى Float32Array */
function parseOneSample(arr: unknown): Float32Array | null {
  if (!Array.isArray(arr) || arr.length !== DESC_DIM) return null;
  const f = new Float32Array(DESC_DIM);
  let norm = 0;
  for (let i = 0; i < DESC_DIM; i++) {
    const v = typeof arr[i] === 'number' && Number.isFinite(arr[i]) ? arr[i] : 0;
    f[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm <= 0) return null;
  if (Math.abs(norm - 1) > 0.05) {
    for (let i = 0; i < DESC_DIM; i++) f[i] /= norm;
  }
  return f;
}

export function parseStoredDescriptor(input: unknown): Float32Array | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Partial<StoredFaceDescriptor>;
  if (d.version !== DESC_VERSION) return null;
  return parseOneSample(d.main);
}

/** يُعيد جميع العينات المخزنة (main + alt) */
export function parseAllSamples(input: unknown): Float32Array[] {
  if (!input || typeof input !== 'object') return [];
  const d = input as Partial<StoredFaceDescriptor>;
  if (d.version !== DESC_VERSION) return [];
  const result: Float32Array[] = [];
  const main = parseOneSample(d.main);
  if (main) result.push(main);
  if (Array.isArray(d.alt)) {
    for (const a of d.alt) {
      const parsed = parseOneSample(a);
      if (parsed) result.push(parsed);
    }
  }
  return result;
}

export function hasValidDescriptor(fd: unknown): boolean {
  return parseStoredDescriptor(fd) !== null;
}

/** بصمة من نظام قديم (face-api / مضغوطة / multi) — لا تعمل مع المحرك الجديد */
export function hasLegacyDescriptor(fd: unknown): boolean {
  return fd != null && typeof fd === 'object' && !hasValidDescriptor(fd);
}

export function descriptorToStorage(
  main: Float32Array,
  opts?: { samples?: number; quality?: number; alt?: Float32Array[] },
): StoredFaceDescriptor {
  const out: number[] = new Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = Math.round(main[i] * 1e5) / 1e5;
  const result: StoredFaceDescriptor = {
    main: out,
    version: DESC_VERSION,
  };
  if (opts?.samples !== undefined) result.samples = opts.samples;
  if (opts?.quality !== undefined) result.quality = Math.round(opts.quality * 100) / 100;
  if (opts?.alt && opts.alt.length > 0) {
    result.alt = opts.alt.map(a => {
      const arr: number[] = new Array(DESC_DIM);
      for (let i = 0; i < DESC_DIM; i++) arr[i] = Math.round(a[i] * 1e5) / 1e5;
      return arr;
    });
  }
  return result;
}

export function l2Normalize(d: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < d.length; i++) n += d[i] * d[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] / n;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function descriptorDistance(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSimilarity(a, b);
}

export interface BestMatch<T> {
  item: T;
  distance: number;
  /** ثقة معروضة 0..100 */
  confidence: number;
}

/**
 * يبحث في قائمة الطلاب عن أقرب بصمة — يُقارن ضد كل عينة مخزنة (main + alt)
 * ويأخذ أقل مسافة (أفضل تطابق). هذا يضمن التعرّف بأي زاوية.
 */
export function findBestMatch<T extends MatchCandidate & { faceDescriptor?: unknown }>(
  query: Float32Array,
  items: T[],
  maxDistance = MATCH_LOOSE,
): BestMatch<T> | null {
  let best: BestMatch<T> | null = null;
  for (const item of items) {
    const allSamples = parseAllSamples(item.faceDescriptor);
    for (const ref of allSamples) {
      const distance = descriptorDistance(query, ref);
      if (!best || distance < best.distance) {
        best = { item, distance, confidence: Math.round((1 - distance) * 100) };
      }
    }
  }
  if (best && best.distance > maxDistance) return null;
  return best;
}

/**
 * فحص الاحتيال: هل بصمة هذا الطالب قريبة جداً من طالب آخر؟
 * يُقارن ضد كل عينة مخزنة للطلاب الآخرين
 */
export function checkForTampering<T extends MatchCandidate & { name: string; faceDescriptor?: unknown }>(
  query: Float32Array,
  others: T[],
  selfId: string,
): { tampered: boolean; matchedWith?: string } {
  for (const other of others) {
    if (other.id === selfId) continue;
    const allSamples = parseAllSamples(other.faceDescriptor);
    for (const ref of allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < TAMPER_THRESHOLD) return { tampered: true, matchedWith: other.name };
    }
  }
  return { tampered: false };
}
