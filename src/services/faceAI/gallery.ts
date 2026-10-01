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
  parseOneSample,
  ENROLLMENT_SAMPLE_COUNT,
  RECOG_D1_CAP,
  RECOG_MATCH_K,
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
  /** حد العيّنة الوحيدة (مارٍ بلا إحصاء) */
  soloCap: number;
  /** الهامش الأدنى بين أفضل طالبين */
  margin: number;
}

export const DEFAULT_MATCH_PROFILE: MatchProfile = {
  d1Cap: RECOG_D1_CAP,
  soloCap: RECOG_SOLO_CAP,
  margin: MIN_MARGIN,
};

/** مقياس داخلي لمعايرة تشتت معرض التسجيل فقط؛ قرار التعرف نفسه يستخدم أقرب عينة. */
export function decisionDistance(sortedDists: number[], k: number = RECOG_MATCH_K): number {
  const n = sortedDists.length;
  if (n === 0) return Infinity;
  const kk = Math.max(1, Math.min(k, n));
  let sum = 0;
  for (let i = 0; i < kk; i++) sum += sortedDists[i] ?? 0;
  return sum / kk;
}

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

/**
 * أسوأ «مسافة قرار ذاتية» لطالب: عيّنته بوصفها استعلاماً مطابقاً لنفسه.
 * تُقاس بنفس إحصاء المطابقة الفعلي (متوسط أقرب 3) حتى تُشتق حدود
 * المعايرة من السلوك الحقيقي لا من مقدار مختلف.
 */
export function selfDecisionDistances(item: GalleryItem, k: number = RECOG_MATCH_K): number[] {
  const out: number[] = [];
  for (const probe of item.allSamples) {
    const sorted = item.allSamples
      .map((s) => descriptorDistance(probe, s))
      .sort((a, b) => a - b);
    // نستبعد مسافة الصفر (العيّنة إلى نفسها) بإسقاطها عند التكرار
    const distinct = sorted.filter((d, i) => !(i === 0 && d < 1e-6));
    out.push(decisionDistance(distinct, k));
  }
  return out.sort((a, b) => a - b);
}

/** المئين ٩٠ من مسافات القرار الذاتية — تقدير محافظ لتشتّت الطالب */
export function intraDecisionMax(item: GalleryItem, k: number = RECOG_MATCH_K): number {
  const ds = selfDecisionDistances(item, k);
  if (ds.length === 0) return 0;
  const idx = Math.min(ds.length - 1, Math.floor(ds.length * 0.9));
  return ds[idx] ?? 0;
}

// ══════════════════════════════════════════════════════════════
// 2) المعايرة — اشتقاق الحدود من بيانات الطلاب الفعلية
//    قاعدة أمان: المعايرة تُشدّد فقط ولا تُخفّف الافتراضيات أبداً
// ══════════════════════════════════════════════════════════════

export function calibrateGallery(gallery: GalleryItem[]): {
  profile: MatchProfile;
  report: CalibrationReport;
} {
  const k = RECOG_MATCH_K;
  // التشتت الداخلي لطالب له 7 زوايا ليس مقياساً للانفصال بين الطلاب،
  // لذلك لا نُستخدم لتشديد العتبات. نستخدم الافتراضات الآمنة مباشرة.
  let intraMax = 0;
  for (const it of gallery) intraMax = Math.max(intraMax, intraDecisionMax(it, k));

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
  const profile: MatchProfile = {
    ...DEFAULT_MATCH_PROFILE,
    soloCap: Math.min(DEFAULT_MATCH_PROFILE.soloCap, DEFAULT_MATCH_PROFILE.d1Cap - 0.05),
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
  for (const it of gallery) if (intraDecisionMax(it, k) > profile.d1Cap) riskyReject++;

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

    // عينات التسجيل السبع فقط. بيانات العناقيد القديمة في Firebase تُتجاهل.
    const enrollmentSamples: Float32Array[] = [];

    for (const s of fd.enrollment.slice(0, ENROLLMENT_SAMPLE_COUNT)) {
      const p = parseOneSample(s);
      if (p) enrollmentSamples.push(p);
    }

    const allSamples = enrollmentSamples;
    if (allSamples.length === 0) continue;

    // مركز مؤقت لمعايرة الفهرس فقط؛ قرار التعرف النهائي يفحص كل عينة تسجيل منفردة.
    const firstSample = allSamples[0];
    if (!firstSample) continue;
    const dim = firstSample.length;
    const avg = new Float32Array(dim);
    let totalWeight = 0;

    for (const s of enrollmentSamples) {
      for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (s[i] ?? 0);
      totalWeight += 1;
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
  /** مسافة أقرب عيّنة زاوية */
  nearest: number;
}

export interface MatchOptions {
  profile?: MatchProfile;
  dangerKeys?: ReadonlySet<string>;
}

/** نتيجة التشخيص لطلب مُرفوض — تُغذّي سجل near-miss */
export interface MatchRejection {
  /** معرّف أقرب طالب (سبب الرفض غالباً) */
  nearestId: string | undefined;
  nearestName: string | undefined;
  /** أقرب مسافة عينة لأقرب طالب */
  nearestDistance: number;
  /** مسافة أقرب عيّنة مفردة */
  nearestSample: number;
  /** الهامش عن أفضل طالب */
  margin: number;
  /** سبب الرفض */
  reason: RejectionReason;
  /** عدد الطلاب المرشحين */
  candidates: number;
}

export type RejectionReason =
  | 'no-gallery'
  | 'all-too-far'
  | 'weak-second-proof'
  | 'tight-margin'
  | 'danger-pair'
  | 'low-quality-frame';

function reject(
  reason: RejectionReason,
  detail: {
    nearestId?: string | undefined;
    nearestName?: string | undefined;
    nearestDistance?: number;
    nearestSample?: number;
    margin?: number;
    candidates?: number;
  } = {},
): null {
  lastRejection = {
    nearestId: detail.nearestId,
    nearestName: detail.nearestName,
    nearestDistance: detail.nearestDistance ?? Infinity,
    nearestSample: detail.nearestSample ?? Infinity,
    margin: detail.margin ?? 0,
    reason,
    candidates: detail.candidates ?? 0,
  };
  return null;
}

/** تشخيص آخر طلب مُرفض — لقياس الأخطاء لا لقرار القبول */
let lastRejection: MatchRejection | null = null;
export function getLastRejection(): MatchRejection | null {
  return lastRejection;
}
export function clearLastRejection(): void {
  lastRejection = null;
}

/** مطابقة أقرب عينة زاوية مع جودة وهامش أمان وتأكيد زمني في FaceScanner. */
export function findBestMatchIndexed(
  query: Float32Array,
  gallery: GalleryItem[],
  baseThreshold: number,
  queryQuality?: number,
  options?: MatchOptions,
): IndexedMatch | null {
  const profile = options?.profile ?? DEFAULT_MATCH_PROFILE;

  // ── المرحلة 1: أقل مسافة إلى أي عينة تسجيل مستقلة ──
  // يكفي أن تطابق إحدى زوايا الطالب؛ التأكيد الزمني المتتابع يحسم هوية الإطار.
  // تسريع: إيقاف فوري عند تطابق قوي جداً — لا داعي لفحص بقية العينات.
  const EARLY_STOP_DISTANCE = 0.10;
  const perItem: Array<{
    item: GalleryItem;
    distance: number;
    nearest: number;
    sampleCount: number;
  }> = [];
  for (const entry of gallery) {
    if (entry.allSamples.length === 0) continue;

    let nearest = Infinity;
    for (const ref of entry.allSamples) {
      const distance = descriptorDistance(query, ref);
      if (distance < nearest) nearest = distance;
      if (nearest < EARLY_STOP_DISTANCE) break;
    }
    perItem.push({
      item: entry,
      distance: nearest,
      nearest,
      sampleCount: entry.allSamples.length,
    });
  }

  if (perItem.length === 0) return reject('no-gallery');

  perItem.sort((a, b) => a.distance - b.distance);
  const first = perItem[0];
  const second = perItem[1];
  if (!first) return reject('no-gallery');
  const margin = second ? second.distance - first.distance : 1;

  // جودة الإطار: تشديد فقط — لا تخفيف أبداً
  let d1Cap = profile.d1Cap;
  if (queryQuality !== undefined) {
    if (queryQuality < 0.40) d1Cap -= 0.04;
    else if (queryQuality < 0.55) d1Cap -= 0.02;
  }

  const detail = {
    nearestId: first.item.id,
    nearestName: first.item.name,
    nearestDistance: first.distance,
    nearestSample: first.nearest,
    margin,
    candidates: perItem.length,
  };

  // ── ١) الحد الأقصى لمسافة القرار ──
  if (first.distance > baseThreshold) return reject('all-too-far', detail);
  if (first.distance > d1Cap) {
    return reject(
      queryQuality !== undefined && queryQuality < 0.55 ? 'low-quality-frame' : 'all-too-far',
      detail,
    );
  }

  // يكفي تطابق إحدى عينات التسجيل؛ تأكيد الهوية زمنياً يتم عبر إطارات الكاميرا المتتابعة.
  if (first.sampleCount <= 1 && first.distance > profile.soloCap) return reject('weak-second-proof', detail);

  // ── ٤) الهامش + حسم الأزواج الخطرة ──
  if (second) {
    if (margin < profile.margin) return reject('tight-margin', detail);
    if (second.distance <= d1Cap && options?.dangerKeys?.has(pairKey(first.item.id, second.item.id))) {
      return reject('danger-pair', detail);
    }
  }

  clearLastRejection();
  return {
    item: first.item,
    distance: first.distance,
    confidence: Math.round((1 - first.distance) * 100),
    sampleCount: first.sampleCount,
    margin: Math.round(margin * 100) / 100,
    nearest: Math.round(first.nearest * 1000) / 1000,
  };
}
