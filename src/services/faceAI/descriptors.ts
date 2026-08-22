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

/** أدنى نسبة ثقة مقبولة للتعرف أثناء الحضور (62% → 55%) — يوسّع نطاق القبول من قريب/بعيد مع بقاء حارس الهامش يحمي الدقة */
export const MIN_RECOG_CONFIDENCE = 55;

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
  samples?: number;
  quality?: number;
}

// ══════════════════════════════════════════════════════════════
// 2) parseOneSample
// ══════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════
// 3) isGalleryDescriptor
// ══════════════════════════════════════════════════════════════

export function isGalleryDescriptor(fd: unknown): fd is FaceGalleryDescriptor {
  if (!fd || typeof fd !== 'object') return false;
  const o = fd as Record<string, unknown>;
  return o.version === DESC_VERSION_GALLERY
    && Array.isArray(o.enrollment)
    && (Array.isArray(o.clusters) || (typeof o.clusters === 'object' && o.clusters !== null));
}

/** Firebase يحوّل المصفوفات الفارغة [] إلى كائنات {} — نعوّض تلقائياً */
function normalizeClusters(clusters: unknown): PoseCluster[] {
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

/** جميع العينات القابلة للمقارنة */
export function parseAllSamples(input: unknown): Float32Array[] {
  if (!isGalleryDescriptor(input)) return [];
  return parseGallerySamples(input);
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

export function getCoveragePercent(fd: unknown): number {
  if (!isGalleryDescriptor(fd)) return 0;
  const len = normalizeClusters(fd.clusters).length;
  return Math.min(100, Math.round((len / MAX_CLUSTERS) * 100));
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
