// ─────────────────────────────────────────────────────────────
// صيغة البصمة الجديدة v4 — GhostFaceNet 512-bits L2-normalized
// { main: number[512], samples?: number, quality?: number, version: 4 }
// أي صيغة أخرى (128-d قديمة، مضغوطة، multi) تُعتبر legacy وتحتاج إعادة تسجيل
// ─────────────────────────────────────────────────────────────

export const DESC_DIM = 512;
export const DESC_VERSION = 4;

/** عتبة المسافة الكوسينية — صارم للمطابقة المؤكدة */
export const MATCH_STRICT = 0.35;
/** عتبة متساهلة — تُقبل مع ثقة معروضة أقل */
export const MATCH_LOOSE = 0.45;
/** إذا تطابق وجه طالب مع بصمة طالب آخر أقل من هذه العتبة → احتيال محتمل */
export const TAMPER_THRESHOLD = 0.32;

export interface StoredFaceDescriptor {
  main: number[];
  samples?: number;
  quality?: number;
  version: number;
}

export interface MatchCandidate {
  id: string;
}

export function parseStoredDescriptor(input: unknown): Float32Array | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Partial<StoredFaceDescriptor>;
  if (d.version !== DESC_VERSION) return null;
  if (!Array.isArray(d.main) || d.main.length !== DESC_DIM) return null;
  const f = new Float32Array(DESC_DIM);
  let norm = 0;
  for (let i = 0; i < DESC_DIM; i++) {
    const v = typeof d.main[i] === 'number' && Number.isFinite(d.main[i]) ? d.main[i] : 0;
    f[i] = v;
    norm += v * v;
  }
  // البصمات الصالحة L2-normalized ≈ 1 — إن لم تكن كذلك أعِد التطبيع دفاعياً
  norm = Math.sqrt(norm);
  if (norm <= 0) return null;
  if (Math.abs(norm - 1) > 0.05) {
    for (let i = 0; i < DESC_DIM; i++) f[i] /= norm;
  }
  return f;
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
  opts?: { samples?: number; quality?: number },
): StoredFaceDescriptor {
  const out: number[] = new Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = Math.round(main[i] * 1e5) / 1e5;
  return {
    main: out,
    ...(opts?.samples !== undefined ? { samples: opts.samples } : {}),
    ...(opts?.quality !== undefined ? { quality: Math.round(opts.quality * 100) / 100 } : {}),
    version: DESC_VERSION,
  };
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

/** يبحث في قائمة الطلاب عن أقرب بصمة للوجه المُستخرج */
export function findBestMatch<T extends MatchCandidate & { faceDescriptor?: unknown }>(
  query: Float32Array,
  items: T[],
  maxDistance = MATCH_LOOSE,
): BestMatch<T> | null {
  let best: BestMatch<T> | null = null;
  for (const item of items) {
    const ref = parseStoredDescriptor(item.faceDescriptor);
    if (!ref) continue;
    const distance = descriptorDistance(query, ref);
    if (!best || distance < best.distance) {
      best = { item, distance, confidence: Math.round((1 - distance) * 100) };
    }
  }
  if (best && best.distance > maxDistance) return null;
  return best;
}

/**
 * فحص الاحتيال: هل بصمة هذا الطالب قريبة جداً من طالب آخر؟
 * يمنع تسجيل نفس الوجه لأكثر من طالب
 */
export function checkForTampering<T extends MatchCandidate & { name: string; faceDescriptor?: unknown }>(
  query: Float32Array,
  others: T[],
  selfId: string,
): { tampered: boolean; matchedWith?: string } {
  for (const other of others) {
    if (other.id === selfId) continue;
    const ref = parseStoredDescriptor(other.faceDescriptor);
    if (!ref) continue;
    const distance = descriptorDistance(query, ref);
    if (distance < TAMPER_THRESHOLD) return { tampered: true, matchedWith: other.name };
  }
  return { tampered: false };
}
