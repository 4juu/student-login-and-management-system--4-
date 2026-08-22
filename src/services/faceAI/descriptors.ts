// ─────────────────────────────────────────────────────────────
// صيغة البصمة v4 — GhostFaceNet 512-bits L2-normalized
// { main: number[512], alt?: number[512][], samples?, quality?, version: 4 }
// alt يحتوي العينات الأصلية (أمام/يمين/يسار) — المقارنة تتم ضد كل عينة
// ─────────────────────────────────────────────────────────────

export const DESC_DIM = 512;
export const DESC_VERSION = 4;
export const DESC_VERSION_GALLERY = 5;

/** عتبة المسافة الكوسينية الأساسية — صار محسوب بعناية بدل القيمة القديمة الفضفاضة */
export const MATCH_STRICT = 0.32;
export const MATCH_LOOSE = 0.42;

/** أقل هامش مطلوب بين أفضل تطابق وثاني أفضل تطابق لقبول القرار */
export const MIN_MARGIN = 0.06;

/** إذا تطابق وجه طالب مع بصمة طالب آخر أقل من هذه العتبة → احتيال محتمل */
export const TAMPER_THRESHOLD = 0.30;

/** عدد إطارات التأكيد المطلوبة قبل قبول أي تطابق (يُستخدم بالواجهة) */
export const CONFIRM_FRAMES = 3;

export interface StoredFaceDescriptor {
  main: number[];
  alt?: number[][];
  samples?: number;
  quality?: number;
  version: number;
  /** عدد مرات التحسين التلقائي عبر الحضور — يتوقف عند MAX_ADAPTIVE_MERGES */
  mergeCount?: number;
}

export interface MatchCandidate {
  id: string;
}

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

export function parseAllSamples(input: unknown): Float32Array[] {
  if (!input || typeof input !== 'object') return [];
  // دعم v5 gallery أولاً
  if (isGalleryDescriptor(input)) return parseGallerySamples(input);
  // fallback لـ v4
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

export function hasLegacyDescriptor(fd: unknown): boolean {
  return fd != null && typeof fd === 'object' && !hasValidDescriptor(fd);
}

export function descriptorToStorage(
  main: Float32Array,
  opts?: { samples?: number; quality?: number; alt?: Float32Array[] },
): StoredFaceDescriptor {
  const out: number[] = new Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = Math.round(main[i] * 1e5) / 1e5;
  const result: StoredFaceDescriptor = { main: out, version: DESC_VERSION };
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
  confidence: number;
  sampleCount: number;
  /** الفرق بين هذا التطابق وثاني أفضل تطابق — كلما زاد كان القرار أوثق */
  margin: number;
}

/**
 * البحث عن أقرب بصمة مع حماية مزدوجة:
 * ١) عتبة تكيّفية فعلية لكل طالب (مو معطّلة كالسابق)
 * ٢) هامش أمان إجباري بين الأفضل والثاني — يمنع الخلط بين طالبين متشابهين
 */
export function findBestMatch<T extends MatchCandidate & { faceDescriptor?: unknown }>(
  query: Float32Array,
  items: T[],
  baseThreshold = MATCH_LOOSE,
  queryQuality?: number,
): BestMatch<T> | null {
  interface PerItem { item: T; distance: number; sampleCount: number; threshold: number }
  const perItem: PerItem[] = [];

  for (const item of items) {
    const allSamples = parseAllSamples(item.faceDescriptor);
    if (allSamples.length === 0) continue;

    let bestForItem = Infinity;
    for (const ref of allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < bestForItem) bestForItem = distance;
    }

    let sampleBonus = 0;
    if (allSamples.length >= 5) sampleBonus = 0.07;   // 5 عينات (تغطية كاملة) → مرونة أكبر بثقة
    else if (allSamples.length >= 3) sampleBonus = 0.04;
    else if (allSamples.length >= 2) sampleBonus = 0.02;

    let qualityBonus = 0;
    if (queryQuality !== undefined && queryQuality < 0.6) {
      qualityBonus = (0.6 - queryQuality) * 0.10;
    }

    perItem.push({
      item,
      distance: bestForItem,
      sampleCount: allSamples.length,
      threshold: baseThreshold + sampleBonus + qualityBonus,
    });
  }

  if (perItem.length === 0) return null;

  perItem.sort((a, b) => a.distance - b.distance);
  const first = perItem[0];
  const second = perItem[1];
  const margin = second ? second.distance - first.distance : 1;

  if (first.distance > first.threshold) return null;
  if (second && margin < MIN_MARGIN) return null;

  return {
    item: first.item,
    distance: first.distance,
    confidence: Math.round((1 - first.distance) * 100),
    sampleCount: first.sampleCount,
    margin: Math.round(margin * 100) / 100,
  };
}

/** فحص الاحتيال: هل بصمة هذا الطالب قريبة جداً من طالب آخر؟ */
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

/**
 * فحص دوري: مقارنة كل الطلاب ببعض — يكشف تشابه مريب بين بصمتين لطالبين مختلفين
 * يُستخدم بصفحة إدارة الطلاب للتنبيه المبكر عند أخطاء التسجيل
 */
export function findSuspiciousPairs<T extends MatchCandidate & { name: string; faceDescriptor?: unknown }>(
  students: T[],
): Array<{ a: string; b: string; distance: number }> {
  const withFace = students.filter(s => parseAllSamples(s.faceDescriptor).length > 0);
  const suspicious: Array<{ a: string; b: string; distance: number }> = [];
  for (let i = 0; i < withFace.length; i++) {
    const samplesA = parseAllSamples(withFace[i].faceDescriptor);
    for (let j = i + 1; j < withFace.length; j++) {
      const samplesB = parseAllSamples(withFace[j].faceDescriptor);
      let minDist = Infinity;
      for (const a of samplesA) for (const b of samplesB) {
        const d = descriptorDistance(a, b);
        if (d < minDist) minDist = d;
      }
      if (minDist < TAMPER_THRESHOLD) {
        suspicious.push({ a: withFace[i].name, b: withFace[j].name, distance: Math.round(minDist * 100) / 100 });
      }
    }
  }
  return suspicious;
}

// ── Face-ID Style: تحسين البصمة تلقائياً مع كل حضور ──

/** الحد الأقصى لعدد مرات التحسين التلقائي — بعدها تصبح البصمة "مثبّتة" */
export const MAX_ADAPTIVE_MERGES = 15;
/** أقل جودة مقبولة لعينة يُسمح بدمجها بالبصمة */
export const MIN_MERGE_QUALITY = 0.62;
/** أقصى مسافة مسموحة بين العينة الجديدة والبصمة الحالية حتى تُدمج */
export const MAX_MERGE_DISTANCE = MATCH_STRICT;

export interface MergeResult {
  descriptor: StoredFaceDescriptor;
  merged: boolean;
  reason?: string;
}

/**
 * دمج عيّنة جديدة (وقت الحضور) مع البصمة المخزّنة عبر متوسط متحرك مرجّح.
 * كل عيّنة جديدة تأثيرها يقل تدريجياً كلما زاد mergeCount — يشبه Face ID.
 * alt ما تتغيّر إطلاقاً (العينات الأصلية مرجع أمان).
 */
export function mergeDescriptor(
  current: StoredFaceDescriptor,
  newSample: Float32Array,
  quality: number,
): MergeResult {
  const mergeCount = current.mergeCount ?? 0;

  if (mergeCount >= MAX_ADAPTIVE_MERGES) {
    return { descriptor: current, merged: false, reason: 'البصمة مثبّتة بالفعل' };
  }
  if (quality < MIN_MERGE_QUALITY) {
    return { descriptor: current, merged: false, reason: 'جودة العيّنة ضعيفة' };
  }

  const mainParsed = parseOneSample(current.main);
  if (!mainParsed) {
    return { descriptor: current, merged: false, reason: 'بصمة حالية غير صالحة' };
  }

  const distance = descriptorDistance(newSample, mainParsed);
  if (distance > MAX_MERGE_DISTANCE) {
    return { descriptor: current, merged: false, reason: 'العيّنة مختلفة كثيراً — تجاهل احتياطاً' };
  }

  // متوسط متحرك مرجّح: كل عيّنة جديدة وزنها 1/(k+1)
  const k = mergeCount;
  const dim = mainParsed.length;
  const updated = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    updated[i] = (mainParsed[i] * k + newSample[i]) / (k + 1);
  }
  // إعادة تطبيع L2
  let norm = 0; for (let i = 0; i < dim; i++) norm += updated[i] * updated[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) updated[i] /= norm;

  const outMain: number[] = new Array(dim);
  for (let i = 0; i < dim; i++) outMain[i] = Math.round(updated[i] * 1e5) / 1e5;

  return {
    descriptor: {
      ...current,
      main: outMain,
      mergeCount: k + 1,
      quality: Math.max(current.quality ?? 0, Math.round(quality * 100) / 100),
    },
    merged: true,
  };
}

/** نسبة اكتمال "نضج" البصمة — لعرضها بالواجهة (0 → 100) */
export function getMaturityPercent(fd: unknown): number {
  const d = fd as Partial<StoredFaceDescriptor> | null;
  const mergeCount = d?.mergeCount ?? 0;
  return Math.min(100, Math.round((mergeCount / MAX_ADAPTIVE_MERGES) * 100));
}

// ── شبكة الزوايا (Pose Grid) — نظام العناقيد v5 ──

export const MAX_CLUSTERS = 18;
export const MAX_MERGES_PER_CLUSTER = 12;
export const MIN_CLUSTER_QUALITY = 0.60;
export const MAX_NEW_CLUSTER_DISTANCE = 0.40;
export const MAX_CLUSTER_MERGE_DISTANCE = MATCH_STRICT;

export interface PoseCluster {
  bin: string;
  vector: number[];
  mergeCount: number;
  quality: number;
  updatedAt: number;
}

export interface FaceGalleryDescriptor {
  version: typeof DESC_VERSION_GALLERY;
  enrollment: number[][];
  clusters: PoseCluster[];
  samples?: number;
  quality?: number;
}

export function isGalleryDescriptor(fd: unknown): fd is FaceGalleryDescriptor {
  return !!fd && typeof fd === 'object' && (fd as Record<string, unknown>).version === DESC_VERSION_GALLERY;
}

/** يحوّل بصمة v4 القديمة (main+alt) إلى معرض v5 — للترحيل التلقائي بدون فقدان بيانات */
export function migrateToGallery(old: StoredFaceDescriptor): FaceGalleryDescriptor {
  const enrollment: number[][] = [old.main, ...(old.alt ?? [])];
  return {
    version: DESC_VERSION_GALLERY,
    enrollment,
    clusters: [],
    samples: old.samples,
    quality: old.quality,
  };
}

/** كل العينات القابلة للمقارنة: عينات التسجيل + كل العناقيد المكتسبة */
export function parseGallerySamples(fd: unknown): Float32Array[] {
  let gallery: FaceGalleryDescriptor | null = null;

  if (isGalleryDescriptor(fd)) {
    gallery = fd;
  } else if (hasValidDescriptor(fd)) {
    gallery = migrateToGallery(fd as StoredFaceDescriptor);
  }
  if (!gallery) return [];

  const result: Float32Array[] = [];
  for (const s of gallery.enrollment) {
    const p = parseOneSample(s);
    if (p) result.push(p);
  }
  for (const c of gallery.clusters) {
    const p = parseOneSample(c.vector);
    if (p) result.push(p);
  }
  return result;
}

export interface ClusterUpdateResult {
  gallery: FaceGalleryDescriptor;
  action: 'merged' | 'created' | 'rejected' | 'skipped_mature';
  bin?: string;
}

/**
 * الدالة الأساسية: تستقبل عيّنة جديدة وتقرر:
 *  - زاوية معروفة → دمج بمتوسط متحرك
 *  - زاوية جديدة → إنشاء عنقود (حتى الحد الأقصى)
 *  - عنقود مستقر → تجاهل
 *  - عيّنة بعيدة → رفض (حماية من التلوّث)
 */
export function updateGallery(
  current: FaceGalleryDescriptor,
  newSample: Float32Array,
  quality: number,
  bin: string,
): ClusterUpdateResult {
  if (quality < MIN_CLUSTER_QUALITY) {
    return { gallery: current, action: 'rejected' };
  }

  const sameBinIdx = current.clusters.findIndex(c => c.bin === bin);

  // فحص الأمان: هل العيّنة قريبة من بصمة هذا الطالب أصلاً؟
  let nearestDistance = Infinity;
  const allRefs = parseGallerySamples(current);
  for (const ref of allRefs) {
    const d = descriptorDistance(newSample, ref);
    if (d < nearestDistance) nearestDistance = d;
  }
  if (allRefs.length > 0 && nearestDistance > MAX_NEW_CLUSTER_DISTANCE) {
    return { gallery: current, action: 'rejected' };
  }

  const clusters = [...current.clusters];

  if (sameBinIdx >= 0) {
    const cluster = clusters[sameBinIdx];
    const existingVec = parseOneSample(cluster.vector);
    if (existingVec && cluster.mergeCount < MAX_MERGES_PER_CLUSTER) {
      const dist = descriptorDistance(newSample, existingVec);
      if (dist > MAX_CLUSTER_MERGE_DISTANCE) {
        return { gallery: current, action: 'rejected' };
      }
      const k = cluster.mergeCount;
      const dim = existingVec.length;
      const merged = new Float32Array(dim);
      for (let i = 0; i < dim; i++) merged[i] = (existingVec[i] * k + newSample[i]) / (k + 1);
      let norm = 0; for (let i = 0; i < dim; i++) norm += merged[i] * merged[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < dim; i++) merged[i] /= norm;

      clusters[sameBinIdx] = {
        ...cluster,
        vector: Array.from(merged).map(v => Math.round(v * 1e5) / 1e5),
        mergeCount: k + 1,
        quality: Math.max(cluster.quality, quality),
        updatedAt: Date.now(),
      };
      return { gallery: { ...current, clusters }, action: 'merged', bin };
    }
    return { gallery: current, action: 'skipped_mature', bin };
  }

  // زاوية جديدة — أنشئ عنقود
  const newCluster: PoseCluster = {
    bin,
    vector: Array.from(newSample).map(v => Math.round(v * 1e5) / 1e5),
    mergeCount: 1,
    quality,
    updatedAt: Date.now(),
  };

  if (clusters.length < MAX_CLUSTERS) {
    clusters.push(newCluster);
  } else {
    // امتلأت السعة — أخلِ أضعف عنقود
    let weakestIdx = 0;
    for (let i = 1; i < clusters.length; i++) {
      if (clusters[i].mergeCount < clusters[weakestIdx].mergeCount ||
          (clusters[i].mergeCount === clusters[weakestIdx].mergeCount && clusters[i].updatedAt < clusters[weakestIdx].updatedAt)) {
        weakestIdx = i;
      }
    }
    if (clusters[weakestIdx].mergeCount <= 2) {
      clusters[weakestIdx] = newCluster;
    } else {
      return { gallery: current, action: 'rejected' };
    }
  }

  return { gallery: { ...current, clusters }, action: 'created', bin };
}

/** نسبة تغطية الزوايا الفعلية — لعرضها بالواجهة */
export function getCoveragePercent(fd: unknown): number {
  if (!isGalleryDescriptor(fd)) return 0;
  return Math.min(100, Math.round((fd.clusters.length / MAX_CLUSTERS) * 100));
}
