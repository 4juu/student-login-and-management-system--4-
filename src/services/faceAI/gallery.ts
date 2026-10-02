// ─────────────────────────────────────────────────────────────
// فهرس المعرض المُعرَّف مسبقاً — يُبنى مرة واحدة عند تغيّر الطلاب
// يقارن استعلام الفريم بأي عينة من عينات الطالب السبع فوراً (بلا تحسين)
// ─────────────────────────────────────────────────────────────
import {
  descriptorDistance, MIN_MARGIN, STRONG_MATCH_MARGIN, MAX_MATCH_DISTANCE,
  CONFIRM_MODERATE, isGalleryDescriptor, parseOneSample,
} from './descriptors';
import { ENROLLMENT_SAMPLE_COUNT } from './angles';

interface GalleryItem {
  id: string;
  /** الاسم الكامل كما في النظام — يُعرض مع المعرّف معاً، ويجوز التحقق منهما معاً عند التعريف */
  name: string;
  allSamples: Float32Array[];
  centroid: Float32Array | null;
  primary: Float32Array | null;
}

/** معرّفات الطلاب المكرّرة في القائمة (سجلّان لنفس الرقم) — تُسبب عرض اسم السجل الآخر */
export function findDuplicateIds<T extends { id?: unknown }>(items: T[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const it of items) {
    const id = typeof it.id === 'string' ? it.id : '';
    if (!id) continue;
    if (seen.has(id)) dupes.add(id);
    else seen.add(id);
  }
  return [...dupes];
}

/** ابنِ فهرس المعرض من قائمة الطلاب — يُبنى مرة واحدة فقط عند تغيّر الطلاب */
export function buildGallery<T extends { id: string; name?: string; faceDescriptor?: unknown }>(
  items: T[],
): GalleryItem[] {
  const gallery: GalleryItem[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    // ✅ سجلّان بنفس المعرّف ⇒ يبقى الأول فقط (وإلا عرضنا اسم السجل الآخر)
    if (seenIds.has(item.id)) {
      console.warn('[gallery] معرّف طالب مكرّر — تم تجاهل السجل المكرر:', item.id);
      continue;
    }
    seenIds.add(item.id);
    const fd = item.faceDescriptor;
    if (!isGalleryDescriptor(fd)) continue;

    // ── عينات التسجيل المستقلة فقط — بلا عناقيد ولا دمج ──
    const allSamples: Float32Array[] = [];
    for (const s of fd.enrollment) {
      const p = parseOneSample(s);
      if (p) allSamples.push(p);
    }
    if (allSamples.length === 0) continue;

    // centroid: متوسط العينات (للاستدلال فقط — المطابقة تقارن بكل عينة على حدة)
    const firstSample = allSamples[0];
    if (!firstSample) continue;
    const dim = firstSample.length;
    const avg = new Float32Array(dim);

    for (const s of allSamples) {
      for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (s[i] ?? 0);
    }
    for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) / allSamples.length;
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (avg[i] ?? 0) * (avg[i] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) / norm;

    // primary: العينة الأقرب للـ centroid (أعلى جودة تمثيلاً)
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < allSamples.length; i++) {
      const sample = allSamples[i];
      if (!sample) continue;
      const d = descriptorDistance(avg, sample);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    gallery.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : '',
      allSamples,
      centroid: norm > 0 ? avg : null,
      primary: allSamples[bestIdx] ?? null,
    });
  }
  return gallery;
}

/** نتيجة مطابقة إطار واحد مقابل المعرض */
interface QueryHit {
  entry: GalleryItem;
  distance: number;
  threshold: number;
  margin: number;
}

/** مرتخي طفيف: لحساب «الزوايا الداعمة» — زاوية على الحدّ ما زالت دليل تأييد */
const SUPPORTED_SAMPLE_SLACK = 0.08;

/** عتبة المطابقة لطالب: مكافأة العينات + مكافأة الجودة، مسقوفة بـMAX_MATCH_DISTANCE */
function itemThreshold(sampleCount: number, baseThreshold: number, queryQuality?: number): number {
  let sampleBonus = 0;
  if (sampleCount >= ENROLLMENT_SAMPLE_COUNT) sampleBonus = 0.05;
  else if (sampleCount >= 3) sampleBonus = 0.03;
  else if (sampleCount >= 2) sampleBonus = 0.01;

  let qualityBonus = 0;
  if (queryQuality !== undefined) {
    if (queryQuality >= 0.72) qualityBonus = 0.03;
    else if (queryQuality < 0.40) qualityBonus = -0.02;
    else if (queryQuality < 0.55) qualityBonus = -0.01;
  }
  return Math.min(baseThreshold + sampleBonus + qualityBonus, MAX_MATCH_DISTANCE);
}

/** مطابقة إطار واحد: أقرب عيّنة لكل طالب ثم عتبة + سقف + هامش متكيّف */
function scoreQuery(
  query: Float32Array,
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
): QueryHit | null {
  const perItem: Array<{ entry: GalleryItem; distance: number; threshold: number }> = [];

  for (const entry of gallery) {
    if (entry.allSamples.length === 0) continue;

    let bestForItem = Infinity;
    for (const ref of entry.allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < bestForItem) bestForItem = distance;
      if (bestForItem < 0.15) break;
    }

    perItem.push({
      entry,
      distance: bestForItem,
      threshold: itemThreshold(entry.allSamples.length, baseThreshold, queryQuality),
    });
  }

  if (perItem.length === 0) return null;

  perItem.sort((a, b) => a.distance - b.distance);
  const first = perItem[0];
  const second = perItem[1];
  if (!first) return null;
  const margin = second ? second.distance - first.distance : 1;

  if (first.distance > first.threshold) return null;
  // هامش متكيّف: قوة المطابقة تحدّد صرامة الفصل عن المرشّح الثاني (منع الخلط بين طالبين)
  const requiredMargin = first.distance <= CONFIRM_MODERATE ? STRONG_MATCH_MARGIN : MIN_MARGIN;
  if (second && margin < requiredMargin) return null;

  return { entry: first.entry, distance: first.distance, threshold: first.threshold, margin };
}

/** كم زاوية من عينات الطالب السبع يدعمها هذا الإطار؟ — دليل تأييد إضافي */
function countSupportedSamples(query: Float32Array, hit: QueryHit): number {
  const bound = Math.min(hit.threshold + SUPPORTED_SAMPLE_SLACK, MAX_MATCH_DISTANCE + SUPPORTED_SAMPLE_SLACK);
  let count = 0;
  for (const s of hit.entry.allSamples) {
    if (descriptorDistance(query, s) <= bound) count++;
  }
  return count;
}

function toQueries(query: Float32Array | Float32Array[]): Float32Array[] {
  const qs = Array.isArray(query) ? query : [query];
  return qs.filter(q => q && q.length > 0);
}

/**
 * مطابقة مُحسّنة — أفضل إطار من مصفوفة استعلامات (best-of).
 * تُقارن كل استعلام بكل عيّنة وتأخذ أدنى مسافة ⇒ «أي زاوية من الزوايا الأخيرة تكفي»
 * بدل متوسطها الذي يقع بين الزاويتين ويُبعِّد المسافة.
 */
export function findBestMatchIndexed(
  query: Float32Array | Float32Array[],
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
): { item: GalleryItem; distance: number; confidence: number; sampleCount: number; margin: number } | null {
  const queries = toQueries(query);
  if (queries.length === 0) return null;

  let best: QueryHit | null = null;
  for (const q of queries) {
    const hit = scoreQuery(q, gallery, baseThreshold, queryQuality);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  if (!best) return null;

  return {
    item: best.entry,
    distance: best.distance,
    confidence: Math.round((1 - best.distance) * 100),
    sampleCount: best.entry.allSamples.length,
    margin: Math.round(best.margin * 100) / 100,
  };
}

/**
 * يربط نتيجة المعرض بسجل الطالب — **بالمعرّف والاسم معاً**:
 * لا يكفي تطابق المعرّف وحده، فأي سجل يحمل المعرّف نفسه باسم مختلف يُرفض
 * (يمنع عرض اسم طالب آخر عند تكرار المعرّف في الروستر).
 * الاسم يُقارن بعد توحيد المسافات وتجاهل حالة الأحرف، وفيه «الاسم الأول» أو «الاسم الأخير» مقبول.
 */
export function resolveStudent<T extends { id?: unknown; name?: unknown }>(
  entry: { id: string; name: string },
  records: T[],
): T | null {
  const sameId = records.filter(r => r && r.id === entry.id);
  if (sameId.length === 0) return null;
  if (sameId.length === 1) return sameId[0] ?? null;
  const norm = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().toLowerCase() : '');
  const target = norm(entry.name);
  if (target) {
    const exact = sameId.find(r => norm(r.name) === target);
    if (exact) return exact;
  }
  return null;
}

export interface ConsensusMatch {
  item: GalleryItem;
  distance: number;
  confidence: number;
  sampleCount: number;
  margin: number;
  /** عدد الإطارات المستقلة المتفقة على نفس الطالب */
  agreement: number;
  /** عدد الزوايا (عينات التسجيل) التي يدعمها الإطار الفائز */
  supportedSamples: number;
}

/**
 * مطابقة **إجماعية** — الحارس الأقوى ضد الخلط:
 * يستقبل آخر الإيمبدنجات المستقلة (إطارات حقيقية) ويشترط أن **يتفق إطاران على نفس الطالب**،
 * فتحصل على دليل من مصدرين مستقلين بدل إطار واحد محظوظ قد يُطابق وجه طالب آخر.
 * - لو توفر إطار واحد فقط (بداية المسار) يُقبل مؤقتاً ثم يحسمه عدّاد التأكيد.
 * - `supportedSamples` = الزوايا الداعمة من عينات الطالب (خاصية السبع بصمات المميزة).
 */
export function findBestMatchConsensus(
  queries: Float32Array[],
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
  minAgree = 2,
): ConsensusMatch | null {
  const qs = toQueries(queries);
  if (qs.length === 0 || gallery.length === 0) return null;
  // ✅ إطاران مستقلان على الأقل دائماً — إطار واحد محظوظ لا يحسم الهوية
  //    (كان `Math.min(minAgree, qs.length)` ينزل بالشرط إلى 1 عند المسار الجديد)
  if (qs.length < minAgree) return null;
  const need = minAgree;

  const groups = new Map<string, Array<{ query: Float32Array; hit: QueryHit }>>();
  for (const q of qs) {
    const hit = scoreQuery(q, gallery, baseThreshold, queryQuality);
    if (!hit) continue;
    const id = hit.entry.id;
    const list = groups.get(id);
    if (list) list.push({ query: q, hit });
    else groups.set(id, [{ query: q, hit }]);
  }
  if (groups.size === 0) return null;

  let winnerId: string | null = null;
  let winnerList: Array<{ query: Float32Array; hit: QueryHit }> | null = null;
  for (const [id, list] of groups) {
    if (list.length < need) continue;
    if (!winnerList
      || list.length > winnerList.length
      || (list.length === winnerList.length && Math.min(...list.map(l => l.hit.distance)) < Math.min(...winnerList.map(l => l.hit.distance)))) {
      winnerId = id;
      winnerList = list;
    }
  }
  if (!winnerId || !winnerList || winnerList.length === 0) return null;

  const firstHit = winnerList[0];
  if (!firstHit) return null;
  let best = firstHit;
  for (const cand of winnerList) {
    if (cand.hit.distance < best.hit.distance) best = cand;
  }

  return {
    item: best.hit.entry,
    distance: best.hit.distance,
    confidence: Math.round((1 - best.hit.distance) * 100),
    sampleCount: best.hit.entry.allSamples.length,
    margin: Math.round(best.hit.margin * 100) / 100,
    agreement: winnerList.length,
    supportedSamples: countSupportedSamples(best.query, best.hit),
  };
}
