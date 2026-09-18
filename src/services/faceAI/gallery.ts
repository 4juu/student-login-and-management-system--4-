// ─────────────────────────────────────────────────────────────
// فهرس المعرض المُعرَّف مسبقاً — يُبنى مرة واحدة عند تغيّر الطلاب
// يُغني عن parseAllSamples كل فريم ويوسّع نطاق المطابقة ضد كل العينات
// ─────────────────────────────────────────────────────────────
import { descriptorDistance, MIN_MARGIN, MATCH_LOOSE, isGalleryDescriptor, normalizeClusters, parseOneSample, NEAR_MISS_THRESHOLD, NEAR_MISS_MIN_MARGIN } from './descriptors';

interface GalleryItem {
  id: string;
  allSamples: Float32Array[];
  centroid: Float32Array | null;
  primary: Float32Array | null;
}

/** ابنِ فهرس المعرض من قائمة الطلاب — يُبنى مرة واحدة فقط عند تغيّر الطلاب */
export function buildGallery<T extends { id: string; faceDescriptor?: unknown }>(
  items: T[],
): GalleryItem[] {
  const gallery: GalleryItem[] = [];
  for (const item of items) {
    const fd = item.faceDescriptor;
    if (!isGalleryDescriptor(fd)) continue;

    // ── #3: Weighted centroid — weight clusters by quality ──
    const enrollmentSamples: Float32Array[] = [];
    const clusterSamples: Array<{ vec: Float32Array; weight: number }> = [];

    for (const s of fd.enrollment) {
      const p = parseOneSample(s);
      if (p) enrollmentSamples.push(p);
    }

    for (const c of normalizeClusters(fd.clusters)) {
      const p = parseOneSample(c.vector);
      if (p) clusterSamples.push({ vec: p, weight: Math.max(0.5, c.quality) });
    }

    const allSamples = [
      ...enrollmentSamples,
      ...clusterSamples.map(c => c.vec),
    ];
    if (allSamples.length === 0) continue;

    // Weighted centroid: enrollment = weight 1.0, clusters = weight by quality
    const dim = allSamples[0].length;
    const avg = new Float32Array(dim);
    let totalWeight = 0;

    for (const s of enrollmentSamples) {
      for (let i = 0; i < dim; i++) avg[i] += s[i];
      totalWeight += 1;
    }
    for (const c of clusterSamples) {
      for (let i = 0; i < dim; i++) avg[i] += c.vec[i] * c.weight;
      totalWeight += c.weight;
    }

    if (totalWeight > 0) {
      for (let i = 0; i < dim; i++) avg[i] /= totalWeight;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) avg[i] /= norm;

    // primary: العينة الأقرب للـ centroid (أعلى جودة تمثيلاً)
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < allSamples.length; i++) {
      const d = descriptorDistance(avg, allSamples[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    gallery.push({
      id: item.id,
      allSamples,
      centroid: norm > 0 ? avg : null,
      primary: allSamples[bestIdx],
    });
  }
  return gallery;
}

/** مطابقة مُحسّنة ضد كل العينات — نفس منطق findBestMatch مع ميزة الفهرس المُعرَّف مسبقاً */
export function findBestMatchIndexed(
  query: Float32Array,
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
): { item: GalleryItem; distance: number; confidence: number; sampleCount: number; margin: number } | null {
  const perItem: Array<{ item: GalleryItem; distance: number; sampleCount: number; threshold: number }> = [];

  for (const entry of gallery) {
    if (entry.allSamples.length === 0) break;

    let bestForItem = Infinity;
    for (const ref of entry.allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < bestForItem) bestForItem = distance;
      if (bestForItem < 0.15) break;
    }

    let sampleBonus = 0;
    if (entry.allSamples.length >= 5) sampleBonus = 0.07;
    else if (entry.allSamples.length >= 3) sampleBonus = 0.04;
    else if (entry.allSamples.length >= 2) sampleBonus = 0.02;

    let qualityBonus = 0;
    if (queryQuality !== undefined) {
      if (queryQuality >= 0.72) qualityBonus = 0.03;
      else if (queryQuality < 0.40) qualityBonus = -0.02;
      else if (queryQuality < 0.55) qualityBonus = -0.01;
    }

    perItem.push({
      item: entry,
      distance: bestForItem,
      sampleCount: entry.allSamples.length,
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

// #3: Near-miss — أقرب طالب بمسافة قريبة من الحد لكن فوقه (0.42-0.55)
export interface NearMissResult {
  studentId: string;
  distance: number;
  margin: number;
}

export function findNearMissCandidate(
  embedding: Float32Array,
  galleryIndex: GalleryItem[],
): NearMissResult | null {
  const perItem: { id: string; bestDist: number }[] = [];

  for (const entry of galleryIndex) {
    let bestDist = Infinity;
    for (const sample of entry.allSamples) {
      const d = descriptorDistance(embedding, sample);
      if (d < bestDist) bestDist = d;
    }
    perItem.push({ id: entry.id, bestDist: bestDist });
  }

  if (perItem.length === 0) return null;

  perItem.sort((a, b) => a.bestDist - b.bestDist);
  const first = perItem[0];
  const second = perItem[1];
  const margin = second ? second.bestDist - first.bestDist : 1;

  // المسافة بين الحد العلوي للمطابقة (0.42) والحد الأقصى للتعلم (0.55)
  // والفارق عن ثاني أقرب طالب كبير بما يكفي
  if (first.bestDist <= MATCH_LOOSE || first.bestDist > NEAR_MISS_THRESHOLD) return null;
  if (margin < NEAR_MISS_MIN_MARGIN) return null;

  return { studentId: first.id, distance: first.bestDist, margin };
}
