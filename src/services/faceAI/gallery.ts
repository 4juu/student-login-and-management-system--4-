// ─────────────────────────────────────────────────────────────
// فهرس المعرض المُعرَّف مسبقاً — يُبنى مرة واحدة عند تغيّر الطلاب
// يُغني عن parseAllSamples كل فريم ويوسّع نطاق المطابقة ضد كل العينات
//
// 🔒 مطابقة صارمة (2026): إثبات مزدوج + تصويت + هامش مُعايَر —
//    عيّنة واحدة لن تكفي أبداً لتسجيل حضور، والمعايرة تُشتق من
//    تشتت الطلاب الفعلي ولا تُخفّف الافتراضيات أبداً.
// ─────────────────────────────────────────────────────────────
import {
  descriptorDistance,
  MIN_MARGIN,
  isGalleryDescriptor,
  normalizeClusters,
  parseOneSample,
  RECOG_D1_CAP,
  RECOG_D2_CAP,
  RECOG_VOTE_CAP,
  RECOG_VOTES,
  RECOG_SOLO_CAP,
} from './descriptors';

export interface GalleryItem {
  id: string;
  name?: string | undefined;
  allSamples: Float32Array[];
  centroid: Float32Array | null;
  primary: Float32Array | null;
}

/** أقصى مسافة يُعدّ فيها زوج طالبين «خطرة» (فصل صامت مستحيل بينهما) */
export const DANGER_PAIR_DISTANCE = 0.30;

// ══════════════════════════════════════════════════════════════
// 1) ملف المطابقة — الحدود الفعلية للقرار (افتراضي + مُعايَر)
// ══════════════════════════════════════════════════════════════

export interface MatchProfile {
  /** أقصى مسافة لأول عيّنة */
  d1Cap: number;
  /** أقصى مسافة للعيّنة الثانية (إثبات مستقل) */
  d2Cap: number;
  /** حد التصويت — عيّنات تحته تُعدّ إثباتات */
  voteCap: number;
  /** عدد الإثباتات المطلوبة */
  votes: number;
  /** حد العيّنة الوحيدة (مارٍ بلا إحصاء) */
  soloCap: number;
  /** الهامش الأدنى بين أفضل طالبين */
  margin: number;
}

export const DEFAULT_MATCH_PROFILE: MatchProfile = {
  d1Cap: RECOG_D1_CAP,
  d2Cap: RECOG_D2_CAP,
  voteCap: RECOG_VOTE_CAP,
  votes: RECOG_VOTES,
  soloCap: RECOG_SOLO_CAP,
  margin: MIN_MARGIN,
};

export interface DangerPair {
  a: string;
  b: string;
  aName?: string | undefined;
  bName?: string | undefined;
  distance: number;
}

export interface CalibrationReport {
  students: number;
  /** أسوأ تشتت داخلي تقريبي (مسافة عيّنة إلى مركزها ×2) */
  intraMax: number;
  /** أقرب مسافة بين مركزي طالبين */
  interMin: number;
  /** هل تفصل البيانات الطالبين عند العتب الحالية؟ */
  separation: boolean;
  /** أزواج خطرة (مسافة عينات حقيقية < 0.30) */
  dangerPairs: DangerPair[];
  /** نسبة الأزواج التي قد تؤدي لقبول خاطئ (تقديري) */
  estFalseAccept: number;
  /** نسبة الطلاب الذين قد يُرفضون لتشتت داخلي عالٍ (تقديري) */
  estFalseReject: number;
}

export interface GalleryIndex {
  items: GalleryItem[];
  profile: MatchProfile;
  report: CalibrationReport;
  dangerKeys: ReadonlySet<string>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** مفتاح زوج غير مرتّب — للاستعلام السريع عن الأزواج الخطرة */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function centroidSpread(item: GalleryItem): number {
  if (!item.centroid) return 0;
  let max = 0;
  for (const s of item.allSamples) {
    const d = descriptorDistance(item.centroid, s);
    if (d > max) max = d;
  }
  return max;
}

function exactMinDistance(a: GalleryItem, b: GalleryItem): number {
  let min = Infinity;
  for (const x of a.allSamples) {
    for (const y of b.allSamples) {
      const d = descriptorDistance(x, y);
      if (d < min) min = d;
    }
  }
  return min;
}

// ══════════════════════════════════════════════════════════════
// 2) المعايرة — اشتقاق الحدود من بيانات الطلاب الفعلية
//    قاعدة أمان: المعايرة تُشدّد فقط ولا تُخفّف الافتراضيات أبداً
// ══════════════════════════════════════════════════════════════

export function calibrateGallery(gallery: GalleryItem[]): {
  profile: MatchProfile;
  report: CalibrationReport;
} {
  // ── التشتت الداخلي: أسوأ حالة لطالب شرعي ──
  let intraMax = 0;
  for (const it of gallery) intraMax = Math.max(intraMax, centroidSpread(it) * 2);

  // ── أقرب مركزين بين طالبين ──
  let interMin = Infinity;
  for (let i = 0; i < gallery.length; i++) {
    const a = gallery[i];
    if (!a?.centroid) continue;
    for (let j = i + 1; j < gallery.length; j++) {
      const b = gallery[j];
      if (!b?.centroid) continue;
      const d = descriptorDistance(a.centroid, b.centroid);
      if (d < interMin) interMin = d;
    }
  }
  if (!Number.isFinite(interMin)) interMin = 1;

  const gap = interMin - intraMax;
  let profile: MatchProfile;
  if (gap >= 0.08) {
    // بيانات نظيفة — وسط الفصل الآمن (لا يتجاوز الافتراضي أبداً)
    const midpoint = intraMax + gap / 2;
    profile = {
      ...DEFAULT_MATCH_PROFILE,
      d1Cap: clamp(Math.min(DEFAULT_MATCH_PROFILE.d1Cap, midpoint), 0.14, DEFAULT_MATCH_PROFILE.d1Cap),
      margin: clamp(Math.max(DEFAULT_MATCH_PROFILE.margin, Math.min(gap / 2, 0.14)), DEFAULT_MATCH_PROFILE.margin, 0.14),
    };
  } else {
    // فشل/ضعف الفصل بين الطلاب — أشد صرامة ممكنة
    profile = { ...DEFAULT_MATCH_PROFILE, d1Cap: 0.15, margin: 0.14 };
  }
  profile = {
    ...profile,
    d2Cap: Math.min(DEFAULT_MATCH_PROFILE.d2Cap, profile.d1Cap + 0.08),
    voteCap: Math.min(DEFAULT_MATCH_PROFILE.voteCap, profile.d1Cap + 0.10),
    soloCap: Math.min(DEFAULT_MATCH_PROFILE.soloCap, profile.d1Cap - 0.05),
  };

  // ── الأزواج الخطرة: مسافة عينات حقيقية (مع ترشيح مبدئي بالمركزين) ──
  const spreads = gallery.map(centroidSpread);
  const candidates: Array<{ i: number; j: number; cd: number }> = [];
  for (let i = 0; i < gallery.length; i++) {
    const a = gallery[i], b0 = spreads[i] ?? 0;
    if (!a?.centroid) continue;
    for (let j = i + 1; j < gallery.length; j++) {
      const b = gallery[j];
      if (!b?.centroid) continue;
      const cd = descriptorDistance(a.centroid, b.centroid);
      // ترشيح أولي: المسافة بين العيّنات الحقيقية لا تقل عن المركز − التشتتين
      if (cd - b0 - (spreads[j] ?? 0) < DANGER_PAIR_DISTANCE + 0.15) {
        candidates.push({ i, j, cd });
      }
    }
  }
  candidates.sort((x, y) => x.cd - y.cd);
  const dangerPairs: DangerPair[] = [];
  const scanned = Math.min(candidates.length, 400);
  for (let k = 0; k < scanned; k++) {
    const c = candidates[k];
    if (!c) continue;
    const A = gallery[c.i], B = gallery[c.j];
    if (!A || !B) continue;
    const minD = exactMinDistance(A, B);
    if (minD < DANGER_PAIR_DISTANCE) {
      dangerPairs.push({
        a: A.id, b: B.id, aName: A.name, bName: B.name, distance: round2(minD),
      });
    }
  }

  const pairCount = Math.max(1, (gallery.length * (gallery.length - 1)) / 2);
  let riskyReject = 0;
  for (const it of gallery) if (centroidSpread(it) * 2 > profile.d1Cap) riskyReject++;

  return {
    profile,
    report: {
      students: gallery.length,
      intraMax: round2(intraMax),
      interMin: round2(interMin),
      separation: gap >= 0.08,
      dangerPairs,
      estFalseAccept: round2(dangerPairs.length / pairCount),
      estFalseReject: round2(riskyReject / Math.max(1, gallery.length)),
    },
  };
}

/** ابنِ فهرس كامل (عناصر + ملف مُعايَر + أزواج خطرة) — يُبنى مرة واحدة عند تغيّر الطلاب */
export function buildGalleryIndex<T extends { id: string; name?: string; faceDescriptor?: unknown }>(
  items: T[],
): GalleryIndex {
  const gallery = buildGallery(items);
  const { profile, report } = calibrateGallery(gallery);
  const dangerKeys = new Set<string>(report.dangerPairs.map(p => pairKey(p.a, p.b)));
  return { items: gallery, profile, report, dangerKeys };
}

// ══════════════════════════════════════════════════════════════
// 3) بناء الفهرس
// ══════════════════════════════════════════════════════════════

/** ابنِ فهرس المعرض من قائمة الطلاب — يُبنى مرة واحدة فقط عند تغيّر الطلاب */
export function buildGallery<T extends { id: string; name?: string; faceDescriptor?: unknown }>(
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
    const firstSample = allSamples[0];
    if (!firstSample) continue;
    const dim = firstSample.length;
    const avg = new Float32Array(dim);
    let totalWeight = 0;

    for (const s of enrollmentSamples) {
      for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (s[i] ?? 0);
      totalWeight += 1;
    }
    for (const c of clusterSamples) {
      for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (c.vec[i] ?? 0) * c.weight;
      totalWeight += c.weight;
    }

    if (totalWeight > 0) {
      for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) / totalWeight;
    }
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
      name: item.name,
      allSamples,
      centroid: norm > 0 ? avg : null,
      primary: allSamples[bestIdx] ?? null,
    });
  }
  return gallery;
}

// ══════════════════════════════════════════════════════════════
// 4) المطابقة الصارمة
// ══════════════════════════════════════════════════════════════

export interface IndexedMatch {
  item: GalleryItem;
  distance: number;
  confidence: number;
  sampleCount: number;
  margin: number;
  /** عدد عيّنات الطالب تحت حد التصويت — الإثباتات المستقلة */
  votes: number;
}

export interface MatchOptions {
  profile?: MatchProfile;
  dangerKeys?: ReadonlySet<string>;
}

/**
 * مطابقة مُحسّنة ضد كل العينات — قرار صارم:
 *  ١) أول عيّنة ضمن d1Cap (مع تشديد عند جودة منخفضة — لا تخفيف أبداً)
 *  ٢) إثبات ثانٍ: عيّنة ثانية ضمن d2Cap
 *  ٣) تصويت: ≥3 عيّنات تحت voteCap (أو كل ما هو متاح للمارٍ قليل العيّنات)
 *  ٤) هامش ≥ margin بين أفضل طالبين — والأزواج الخطرة تُرفض حتى لو كفى الهامش
 *  ٥) مارٍ بعيّنة واحدة فقط (v4 قديم) — soloCap صارم جداً
 */
export function findBestMatchIndexed(
  query: Float32Array,
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
  options?: MatchOptions,
): IndexedMatch | null {
  const profile = options?.profile ?? DEFAULT_MATCH_PROFILE;

  // ── المرحلة 1: أقل مسافة لكل طالب (مع كسر مبكر) ──
  const perItem: Array<{ item: GalleryItem; distance: number; sampleCount: number }> = [];
  for (const entry of gallery) {
    if (entry.allSamples.length === 0) continue;

    let bestForItem = Infinity;
    for (const ref of entry.allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < bestForItem) bestForItem = distance;
      if (bestForItem < 0.15) break;
    }
    perItem.push({ item: entry, distance: bestForItem, sampleCount: entry.allSamples.length });
  }

  if (perItem.length === 0) return null;

  perItem.sort((a, b) => a.distance - b.distance);
  const first = perItem[0];
  const second = perItem[1];
  if (!first) return null;
  const margin = second ? second.distance - first.distance : 1;

  // جودة الإطار: تشديد فقط — لا تخفيف أبداً
  let d1Cap = profile.d1Cap;
  if (queryQuality !== undefined) {
    if (queryQuality < 0.40) d1Cap -= 0.04;
    else if (queryQuality < 0.55) d1Cap -= 0.02;
  }

  // ── ١) الحد الأقصى للمسافة الأولى ──
  if (first.distance > d1Cap) return null;
  if (first.distance > baseThreshold) return null;

  // ── ٢-٣) الإثبات المزدوج والتصويت على كل عيّنات الطالب ──
  const dists: number[] = [];
  for (const ref of first.item.allSamples) dists.push(descriptorDistance(query, ref));
  dists.sort((a, b) => a - b);
  const votes = dists.filter(d => d <= profile.voteCap).length;

  if (first.sampleCount <= 1) {
    if (first.distance > profile.soloCap) return null;
  } else {
    const d2 = dists[1] ?? Infinity;
    if (d2 > profile.d2Cap) return null;
    if (votes < Math.min(profile.votes, first.sampleCount)) return null;
  }

  // ── ٤) الهامش + حسم الأزواج الخطرة ──
  if (second) {
    if (margin < profile.margin) return null;
    if (
      second.distance <= profile.voteCap &&
      options?.dangerKeys?.has(pairKey(first.item.id, second.item.id))
    ) {
      return null;
    }
  }

  return {
    item: first.item,
    distance: first.distance,
    confidence: Math.round((1 - first.distance) * 100),
    sampleCount: first.sampleCount,
    margin: Math.round(margin * 100) / 100,
    votes,
  };
}
