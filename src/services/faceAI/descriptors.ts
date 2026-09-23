// ─────────────────────────────────────────────────────────────
// نظام بصمات الوجه — GhostFaceNet 512-bits L2-normalized
// الصيغة الوحيدة: v5 Pose Grid
//   { version: 5, enrollment: number[][], clusters: PoseCluster[], samples?, quality? }
// ─────────────────────────────────────────────────────────────
import { YAW_STEPS, PITCH_STEPS } from './pose';

// ══════════════════════════════════════════════════════════════
// 1) الثوابت والأنواع
// ══════════════════════════════════════════════════════════════

export const DESC_DIM = 512;
export const DESC_VERSION_GALLERY = 5;

export const MATCH_STRICT = 0.32;
export const MATCH_LOOSE = 0.42;
export const MIN_MARGIN = 0.06;
export const TAMPER_THRESHOLD = 0.30;
export const CONFIRM_FRAMES = 3;

// 🗄️ Cache for parsed samples (key: JSON string of descriptor, value: Float32Array[])
const parsedSamplesCache = new Map<string, Float32Array[]>();
const CACHE_MAX = 200;

function getCacheKey(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  try {
    return JSON.stringify(input);
  } catch { return null; }
}

/** جميع العينات القابلة للمقارنة — مع كاش بسيط */
export function parseAllSamples(input: unknown): Float32Array[] {
  if (!isGalleryDescriptor(input)) return [];
  
  const key = getCacheKey(input);
  if (key) {
    const cached = parsedSamplesCache.get(key);
    if (cached) return cached;
  }
  
  const result = parseGallerySamples(input);
  
  if (key) {
    if (parsedSamplesCache.size >= CACHE_MAX) {
      const firstKey = parsedSamplesCache.keys().next().value;
      if (firstKey) parsedSamplesCache.delete(firstKey);
    }
    parsedSamplesCache.set(key, result);
  }
  
  return result;
}

/** أدنى نسبة ثقة مقبولة للتعرف أثناء الحضور — حارس الدقة الرئيسي */
export const MIN_RECOG_CONFIDENCE = 75;

export interface MatchCandidate {
  id: string;
}

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
  samples?: number | undefined;
  quality?: number | undefined;
}

// ══════════════════════════════════════════════════════════════
// 2) parseOneSample
// ══════════════════════════════════════════════════════════════

export function parseOneSample(arr: unknown): Float32Array | null {
  if (!Array.isArray(arr) || arr.length !== DESC_DIM) return null;
  const f = new Float32Array(DESC_DIM);
  let norm = 0;
  for (let i = 0; i < DESC_DIM; i++) {
    const raw = arr[i];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    f[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm <= 0) return null;
  if (Math.abs(norm - 1) > 0.05) {
    for (let i = 0; i < DESC_DIM; i++) f[i] = (f[i] ?? 0) / norm;
  }
  return f;
}

// ══════════════════════════════════════════════════════════════
// 3) isGalleryDescriptor
// ══════════════════════════════════════════════════════════════

export function isGalleryDescriptor(fd: unknown): fd is FaceGalleryDescriptor {
  if (!fd || typeof fd !== 'object') return false;
  const o = fd as Record<string, unknown>;
  return o.version === DESC_VERSION_GALLERY
    && Array.isArray(o.enrollment)
    // Firebase يحذف تلقائياً أي clusters: [] فاضية عند الحفظ — غيابها يعني "لا عناقيد بعد" وليس بصمة تالفة
    && (o.clusters === undefined
        || o.clusters === null
        || Array.isArray(o.clusters)
        || typeof o.clusters === 'object');
}

/** Firebase يحوّل المصفوفات الفارغة [] إلى كائنات {} — نعوّض تلقائياً */
export function normalizeClusters(clusters: unknown): PoseCluster[] {
  if (Array.isArray(clusters)) return clusters;
  return [];
}

// ══════════════════════════════════════════════════════════════
// 4) hasValidDescriptor
// ══════════════════════════════════════════════════════════════

export function hasValidDescriptor(fd: unknown): boolean {
  if (!isGalleryDescriptor(fd)) return false;
  return Array.isArray(fd.enrollment) && fd.enrollment.some(s => parseOneSample(s) !== null);
}

/**
 * مدقق صارم v5 فقط - اي تنسيق قديم (مصفوفة مسطحة، مصفوفة عينات، enrollment ككائن،
 * او {descriptor/vector/embedding}) يرفض نهائيا ويعيد null.
 * العناقيد الحالية (clusters) تحفظ كما هي حتى لا يفقد الطالب تعلمه التدريجي.
 */
export function migrateToV5(input: unknown): FaceGalleryDescriptor | null {
  if (!input || typeof input !== 'object') return null;

  // 1) صيغة v5 الحالية
  if (isGalleryDescriptor(input)) {
    const fd = input as FaceGalleryDescriptor;
    const samples = fd.enrollment
      .map(s => parseOneSample(s))
      .filter((s): s is Float32Array => s !== null);
    if (samples.length === 0) return null;
    return {
      version: DESC_VERSION_GALLERY,
      enrollment: samples.map(s => Array.from(l2Normalize(s)).map(v => Math.round(v * 1e5) / 1e5)),
      clusters: normalizeClusters(fd.clusters),
      samples: samples.length,
      quality: typeof fd.quality === 'number' ? fd.quality : undefined,
    };
  }


  return null;
}

// ══════════════════════════════════════════════════════════════
// 5) parseStoredDescriptor + parseAllSamples + parseGallerySamples
// ══════════════════════════════════════════════════════════════

/** ترجّع "البصمة الرئيسية" كـ Float32Array */
export function parseStoredDescriptor(input: unknown): Float32Array | null {
  if (!isGalleryDescriptor(input)) return null;
  for (const s of input.enrollment) {
    const p = parseOneSample(s);
    if (p) return p;
  }
  return null;
}

/** كل عينات المعرض: عينات التسجيل + العناقيد المكتسبة */
export function parseGallerySamples(fd: unknown): Float32Array[] {
  if (!isGalleryDescriptor(fd)) return [];

  const result: Float32Array[] = [];
  for (const s of fd.enrollment) {
    const p = parseOneSample(s);
    if (p) result.push(p);
  }
  for (const c of normalizeClusters(fd.clusters)) {
    const p = parseOneSample(c.vector);
    if (p) result.push(p);
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// 6) الدوال المساعدة
// ══════════════════════════════════════════════════════════════

export function l2Normalize(d: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < d.length; i++) n += (d[i] ?? 0) * (d[i] ?? 0);
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = (d[i] ?? 0) / n;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
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
  margin: number;
}

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
      if (bestForItem < 0.15) break;
    }

    let sampleBonus = 0;
    if (allSamples.length >= 5) sampleBonus = 0.07;
    else if (allSamples.length >= 3) sampleBonus = 0.04;
    else if (allSamples.length >= 2) sampleBonus = 0.02;

    // جودة الإطار: وجه عالي الجودة (قريب/مضيء) → نسمح بمسافة أبعد قليلاً
    // وجه منخفض الجودة (بعيد/ضبابي) → نشدّد قليلاً لحماية الدقة ومنع القبول الخاطئ
    let qualityBonus = 0;
    if (queryQuality !== undefined) {
      if (queryQuality >= 0.72) qualityBonus = 0.03;
      else if (queryQuality < 0.40) qualityBonus = -0.02;
      else if (queryQuality < 0.55) qualityBonus = -0.01;
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
  if (!first) return null;
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

export function findSuspiciousPairs<T extends MatchCandidate & { name: string; faceDescriptor?: unknown }>(
  students: T[],
): Array<{ a: string; b: string; distance: number }> {
  const withFace = students.filter(s => parseAllSamples(s.faceDescriptor).length > 0);
  const suspicious: Array<{ a: string; b: string; distance: number }> = [];
  for (let i = 0; i < withFace.length; i++) {
    const studentA = withFace[i];
    if (!studentA) continue;
    const samplesA = parseAllSamples(studentA.faceDescriptor);
    for (let j = i + 1; j < withFace.length; j++) {
      const studentB = withFace[j];
      if (!studentB) continue;
      const samplesB = parseAllSamples(studentB.faceDescriptor);
      let minDist = Infinity;
      for (const a of samplesA) for (const b of samplesB) {
        const d = descriptorDistance(a, b);
        if (d < minDist) minDist = d;
      }
      if (minDist < TAMPER_THRESHOLD) {
        suspicious.push({ a: studentA.name, b: studentB.name, distance: Math.round(minDist * 100) / 100 });
      }
    }
  }
  return suspicious;
}

// ══════════════════════════════════════════════════════════════
// 7) شبكة الزوايا (Pose Grid) — نظام العناقيد v5
// ══════════════════════════════════════════════════════════════

export interface ClusterUpdateResult {
  gallery: FaceGalleryDescriptor;
  action: 'merged' | 'created' | 'rejected' | 'skipped_mature';
  bin?: string;
}

export function updateGallery(
  current: FaceGalleryDescriptor,
  newSample: Float32Array,
  quality: number,
  bin: string,
  allowMatureMerge = false,
): ClusterUpdateResult {
  if (quality < MIN_CLUSTER_QUALITY) {
    return { gallery: current, action: 'rejected' };
  }

  const sameBinIdx = normalizeClusters(current.clusters).findIndex(c => c.bin === bin);

  let nearestDistance = Infinity;
  const allRefs = parseGallerySamples(current);
  for (const ref of allRefs) {
    const d = descriptorDistance(newSample, ref);
    if (d < nearestDistance) nearestDistance = d;
  }
  if (allRefs.length > 0 && nearestDistance > MAX_NEW_CLUSTER_DISTANCE) {
    return { gallery: current, action: 'rejected' };
  }

  const clusters = [...normalizeClusters(current.clusters)];

  if (sameBinIdx >= 0) {
    const cluster = clusters[sameBinIdx];
    if (!cluster) return { gallery: current, action: 'skipped_mature', bin };
    const existingVec = parseOneSample(cluster.vector);
    if (existingVec) {
      if (cluster.mergeCount >= MAX_MERGES_PER_CLUSTER && !allowMatureMerge) {
        return { gallery: current, action: 'skipped_mature', bin };
      }
      const dist = descriptorDistance(newSample, existingVec);
      if (dist > MAX_CLUSTER_MERGE_DISTANCE) {
        return { gallery: current, action: 'rejected' };
      }
      const k = Math.min(cluster.mergeCount, MAX_MERGES_PER_CLUSTER - 1);
      const dim = existingVec.length;
      const merged = new Float32Array(dim);
      for (let i = 0; i < dim; i++) merged[i] = ((existingVec[i] ?? 0) * k + (newSample[i] ?? 0)) / (k + 1);
      let norm = 0; for (let i = 0; i < dim; i++) norm += (merged[i] ?? 0) * (merged[i] ?? 0);
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < dim; i++) merged[i] = (merged[i] ?? 0) / norm;

      clusters[sameBinIdx] = {
        ...cluster,
        vector: Array.from(merged).map(v => Math.round(v * 1e5) / 1e5),
        mergeCount: Math.min(k + 1, MAX_MERGES_PER_CLUSTER),
        quality: Math.max(cluster.quality, quality),
        updatedAt: Date.now(),
      };
      return { gallery: { ...current, clusters }, action: 'merged', bin };
    }
    return { gallery: current, action: 'skipped_mature', bin };
  }

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
    let weakestIdx = 0;
    for (let i = 1; i < clusters.length; i++) {
      const c = clusters[i];
      const w = clusters[weakestIdx];
      if (!c || !w) continue;
      if (c.mergeCount < w.mergeCount ||
          (c.mergeCount === w.mergeCount && c.updatedAt < w.updatedAt)) {
        weakestIdx = i;
      }
    }
    const weakest = clusters[weakestIdx];
    if (weakest && weakest.mergeCount <= 2) {
      clusters[weakestIdx] = newCluster;
    } else {
      return { gallery: current, action: 'rejected' };
    }
  }

  return { gallery: { ...current, clusters }, action: 'created', bin };
}

export function getCoveragePercent(fd: unknown): number {
  if (!isGalleryDescriptor(fd)) return 0;
  const len = normalizeClusters(fd.clusters).length;
  return Math.min(100, Math.round((len / MAX_CLUSTERS) * 100));
}

// ── Bootstrap Clusters من عينات التسجيل ──
// يأخذ 10 عينات تسجيل ويُنشئ حتى 5 عناقيد — كل طالب يبدأ بـ5 عناقيد من اليوم الأول

const BOOTSTRAP_MAX_CLUSTERS = 5;
const BOOTSTRAP_MERGE_DISTANCE = 0.30;

export function bootstrapClusters(
  enrollmentSamples: Float32Array[],
  quality: number,
): PoseCluster[] {
  if (enrollmentSamples.length === 0) return [];

  // كل عينة = عنقيد مؤقت نبدأ به
  type TempCluster = { vec: Float32Array; count: number; sum: Float32Array };
  const temps: TempCluster[] = [];

  for (const sample of enrollmentSamples) {
    // أقرب عنقيد موجود؟
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < temps.length; i++) {
      const temp = temps[i];
      if (!temp) continue;
      const avg = new Float32Array(sample.length);
      for (let j = 0; j < sample.length; j++) avg[j] = (temp.sum[j] ?? 0) / temp.count;
      const d = descriptorDistance(sample, avg);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (bestIdx >= 0 && bestDist < BOOTSTRAP_MERGE_DISTANCE && temps.length <= BOOTSTRAP_MAX_CLUSTERS) {
      // دمج — أضف للعنقيد الموجود
      const target = temps[bestIdx];
      if (target) {
        for (let j = 0; j < sample.length; j++) target.sum[j] = (target.sum[j] ?? 0) + (sample[j] ?? 0);
        target.count++;
      }
    } else if (temps.length < BOOTSTRAP_MAX_CLUSTERS) {
      // عنقيد جديد
      const sum = new Float32Array(sample.length);
      for (let j = 0; j < sample.length; j++) sum[j] = sample[j] ?? 0;
      temps.push({ vec: sample, count: 1, sum });
    }
  }

  // حوّل إلى PoseCluster[] مع bin افتراضي
  return temps.map((t, i) => {
    const avg = new Float32Array(t.vec.length);
    for (let j = 0; j < t.vec.length; j++) avg[j] = (t.sum[j] ?? 0) / t.count;
    let norm = 0;
    for (let j = 0; j < avg.length; j++) norm += (avg[j] ?? 0) * (avg[j] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < avg.length; j++) avg[j] = (avg[j] ?? 0) / norm;
    return {
      bin: `e${i}`,
      vector: Array.from(avg).map(v => Math.round(v * 1e5) / 1e5),
      mergeCount: t.count,
      quality,
      updatedAt: Date.now(),
    };
  });
}

// ── تنظيف العناقيد القديمة (Cluster Decay) ──

export const CLUSTER_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 120;

export function pruneStaleClusters(gallery: FaceGalleryDescriptor): FaceGalleryDescriptor {
  const clusters = normalizeClusters(gallery.clusters);
  const now = Date.now();
  const filtered = clusters.filter(c => {
    const age = now - c.updatedAt;
    if (age < CLUSTER_MAX_AGE_MS) return true;
    return c.mergeCount >= 6;
  });
  return filtered.length === clusters.length ? gallery : { ...gallery, clusters: filtered };
}

// ── الزوايا الناقصة ──

export function getMissingBins(gallery: FaceGalleryDescriptor): string[] {
  const covered = new Set(normalizeClusters(gallery.clusters).map(c => c.bin));
  const missing: string[] = [];
  for (const y of YAW_STEPS) for (const p of PITCH_STEPS) {
    const bin = `${y}_${p}`;
    if (!covered.has(bin)) missing.push(bin);
  }
  return missing;
}

// ── ملخص صحة النظام ──

export function getGalleryHealthSummary(students: Array<{ faceDescriptor?: unknown }>) {
  let v5Count = 0, matureCount = 0, noFaceCount = 0;
  for (const s of students) {
    if (!hasValidDescriptor(s.faceDescriptor)) { noFaceCount++; continue; }
    v5Count++;
    if (getCoveragePercent(s.faceDescriptor) >= 80) matureCount++;
  }
  return { v5Count, matureCount, noFaceCount, total: students.length };
}
