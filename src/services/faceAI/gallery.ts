// ─────────────────────────────────────────────────────────────
// فهرس المعرض المُعرَّف مسبقاً — يُبنى مرة واحدة عند تغيّر الطلاب
// يُغني عن parseAllSamples كل فريم ويوسّع نطاق المطابقة ضد كل العينات
// ─────────────────────────────────────────────────────────────
import { parseAllSamples, descriptorDistance, MIN_MARGIN } from './descriptors';

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
    const samples = parseAllSamples(item.faceDescriptor);
    if (samples.length === 0) continue;

    // centroid: متوسط L2-normalized لكل العينات
    const dim = samples[0].length;
    const avg = new Float32Array(dim);
    for (const s of samples) for (let i = 0; i < dim; i++) avg[i] += s[i];
    for (let i = 0; i < dim; i++) avg[i] /= samples.length;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += avg[i] * avg[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) avg[i] /= norm;

    // primary: العينة الأقرب للـ centroid (أعلى جودة تمثيلاً)
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < samples.length; i++) {
      const d = descriptorDistance(avg, samples[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    gallery.push({
      id: item.id,
      allSamples: samples,
      centroid: norm > 0 ? avg : null,
      primary: samples[bestIdx],
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
