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
// v6 = بصمة مُحاذاة (alignment بالعينين). v5 = legacy غير مُحاذاة.
// المحاذاة تغيّر فضاء الـembedding ⇒ v5 لا تُطابَق مع v6 وتُستبعد من التعرّف
// (تُعرض «قديمة — أعد التسجيل») حتى يعيد الطالب التسجيل على v6.
export const DESC_VERSION_GALLERY = 6;
export const LEGACY_DESC_VERSIONS = [5];
const SUPPORTED_DESC_VERSIONS = [DESC_VERSION_GALLERY, ...LEGACY_DESC_VERSIONS];

/** أقل مسافة قرار بين طالبين مختلفين — دونها تُمنع البصمة الجديدة (تداخل) */
export const ENROLL_SEPARATION_MIN = 0.30;
/** أقصى مسافة لعيّنة تعلّم عن مرساة التسجيل — قيد يمنع جرّ الهوية نحو طالب آخر */
export const AUTO_LEARN_TETHER_MAX = 0.25;
/** أقل مسافة فصل مطلق عن الطلاب الآخرين قبل أي تعلّم — يمنع دمج وجه طالب آخر */
export const AUTO_LEARN_SEPARATION_MIN = 0.30;

export const MATCH_STRICT = 0.32;
export const MATCH_LOOSE = 0.42;
// الهامش بين أفضل طالبين — كان 0.06 وكان يسمح بتعادل خطر بين وجهين
export const MIN_MARGIN = 0.10;
export const TAMPER_THRESHOLD = 0.30;
// التأكيد على 5 فريمات متتالية (كان 3) + ثبات المسافة عبر tracker — استقرار زمني أقوى
export const CONFIRM_FRAMES = 5;

// ══════════════════════════════════════════════════════════════
// حواجز المطابقة الصارمة — إثبات مزدوج + تصويت (لا تطابق بعيّنة واحدة)
// ══════════════════════════════════════════════════════════════
/** أقصى مسافة لأول عيّنة (≈ ثقة 75%) — الحد الفعلي القابل للمعايرة */
export const RECOG_D1_CAP = 0.25;
/** العيّنة الثانية لازم تثبت ضمن هذا الحد — إثبات مستقل ثانٍ */
export const RECOG_D2_CAP = 0.32;
/** حد التصويت: عيّنات الطالب تحت هذا الحد تُعدّ إثباتات */
export const RECOG_VOTE_CAP = 0.35;
/** عدد الإثباتات المطلوبة (يُخفَّض لعدد ما هو متاح للمارٍ قليل العيّنات) */
export const RECOG_VOTES = 3;
/**
 * أدنى نسبة من عيّنات الطالب يجب أن تصوّت.
 * كسر تحيّز «صاحب أكثر عيّنات»: 3 تصويتات من 28 عيّنة (10.7٪) لم تعد تكفي.
 */
export const RECOG_VOTE_RATIO = 0.34;
/**
 * عدد الأقرب المُتوسَّط في مسافة القرار.
 * `min` يجعل احتمال القبول الخاطئ يتضاعف أُسّياً بعدد عيّنات الطالب
 * (٣ عيّنات ≈ ٢.٨٪ خطأ مقابل ٢٨ عيّنة ≈ ٧٨.٥٪) — وهذا سبب خلط الأسماء.
 */
export const RECOG_MATCH_K = 3;
/** مارٍ بعيّنة واحدة فقط (بلا إحصاء) — يتطلب ثقة استثنائية */
export const RECOG_SOLO_CAP = 0.18;
/** أقصى تشتت بين مسافات الإثبات — يمنع الاستقرار على قرار متذبذب */
export const RECOG_SPREAD_MAX = 0.10;
/** التغذية الراجعة أثناء الحضور: يُدمَج في المعرض فقط عند ثقة قصوى — يوقف تضخّم الخطأ */
export const AUTO_LEARN_MAX_DISTANCE = 0.18;
export const AUTO_LEARN_MIN_MARGIN = 0.12;

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

/** حارس جودة الفريم المعمم — يرفض الضبابي/المظلم جداً في كل مسارات المطابقة */
export const MIN_FRAME_QUALITY = 0.40;

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
  /** خانة الزاوية لكل عيّنة تسجيل (موازية لـ enrollment) — تمنع العناقيد الوهمية e0..e4 */
  enrollmentBins?: string[] | undefined;
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
  // تطبيع إلزامي: cosine صار حقيقياً، لكن الطول غير المتطابق بين
  // عيّنات من مصادر مختلفة يظل يُفسد المقارنة داخل نافذة التسريب.
  if (Math.abs(norm - 1) > 1e-3) {
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
  return SUPPORTED_DESC_VERSIONS.includes(o.version as number)
    && Array.isArray(o.enrollment)
    // Firebase يحذف تلقائياً أي clusters: [] فاضية عند الحفظ — غيابها يعني "لا عناقيد بعد" وليس بصمة تالفة
    && (o.clusters === undefined
        || o.clusters === null
        || Array.isArray(o.clusters)
        || typeof o.clusters === 'object');
}

/** هل البصمة مُحاذاة (v6)؟ — فقط v6 تُطابَق في التعرّف */
export function isAlignedDescriptor(fd: unknown): fd is FaceGalleryDescriptor {
  if (!fd || typeof fd !== 'object') return false;
  return (fd as Record<string, unknown>).version === DESC_VERSION_GALLERY;
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
 * مدقق صارم v6 فقط — أي تنسيق قديم (مصفوفة مسطحة، مصفوفة عينات، enrollment ككائن،
 * او {descriptor/vector/embedding}) يرفض نهائيا ويعيد null.
 * v5 (غير مُحاذاة) لا تُترحَل إلى v6: المحاذاة تحتاج الصورة الأصلية غير المتاحة،
 * فمطابقة v5 مع استعلام v6 ستفشل — يُعاد الطالب للتسجيل على v6 بدل ترحيل مضلل.
 */
export function migrateToV6(input: unknown): FaceGalleryDescriptor | null {
  if (!input || typeof input !== 'object') return null;

  if (isGalleryDescriptor(input)) {
    const fd = input as FaceGalleryDescriptor;
    if (fd.version !== DESC_VERSION_GALLERY) return null;
    const samples = fd.enrollment
      .map(s => parseOneSample(s))
      .filter((s): s is Float32Array => s !== null);
    if (samples.length === 0) return null;
    return {
      version: DESC_VERSION_GALLERY,
      enrollment: samples.map(s => Array.from(l2Normalize(s)).map(v => Math.round(v * 1e5) / 1e5)),
      enrollmentBins: Array.isArray(fd.enrollmentBins)
        ? fd.enrollmentBins.slice(0, samples.length)
        : undefined,
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

/** مركز بصمة (متوسط كل العينات، مطبّع L2) — مرساة الهوية */
export function computeCentroid(fd: unknown): Float32Array | null {
  const samples = parseGallerySamples(fd);
  if (samples.length === 0) return null;
  const dim = samples[0]!.length;
  const avg = new Float32Array(dim);
  for (const s of samples) for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (s[i] ?? 0);
  for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) / samples.length;
  return l2Normalize(avg);
}

/**
 * أقرب مسافة قرار (متوسط أقرب k) من بصمة جديدة إلى كل الطلاب الموجودين.
 * تُستخدم عند التسجيل/الموافقة لمنع بصمة متداخلة من دخول النظام.
 */
export function minDistanceToOthers(
  descriptor: unknown,
  others: Array<{ id: string; name?: string; faceDescriptor?: unknown }>,
  selfId: string,
): { minDistance: number; closestId?: string | undefined; closestName?: string | undefined } {
  const selfSamples = parseGallerySamples(descriptor);
  if (selfSamples.length === 0) return { minDistance: Infinity };

  let minDistance = Infinity;
  let closestId: string | undefined;
  let closestName: string | undefined;

  for (const other of others) {
    if (other.id === selfId) continue;
    const otherSamples = parseGallerySamples(other.faceDescriptor);
    if (otherSamples.length === 0) continue;

    const dists: number[] = [];
    for (const s of selfSamples) {
      for (const o of otherSamples) dists.push(descriptorDistance(s, o));
    }
    dists.sort((a, b) => a - b);
    const k = Math.min(RECOG_MATCH_K, dists.length);
    let sum = 0;
    for (let i = 0; i < k; i++) sum += dists[i] ?? 0;
    const d = k > 0 ? sum / k : Infinity;
    if (d < minDistance) {
      minDistance = d;
      closestId = other.id;
      closestName = other.name;
    }
  }
  return { minDistance, closestId, closestName };
}

/**
 * فحص الفصل المطلق السريع: هل العيّنة بعيدة عن مراكز كل الطلاب الآخرين؟
 * يُستدعى قبل أي تعلّم تلقائي لضمان عدم دمج وجه طالب آخر (سبب تسميم محمد/مجتبى).
 */
export function isFarFromAllOthers(
  sample: Float32Array,
  others: Array<{ id: string; name?: string; faceDescriptor?: unknown }>,
  selfId: string,
  minDist: number,
): { ok: boolean; closestId?: string | undefined; closestName?: string | undefined; closestDist?: number | undefined } {
  for (const other of others) {
    if (other.id === selfId) continue;
    const centroid = computeCentroid(other.faceDescriptor);
    if (!centroid) continue;
    const d = descriptorDistance(sample, centroid);
    if (d < minDist) {
      return { ok: false, closestId: other.id, closestName: other.name, closestDist: d };
    }
  }
  return { ok: true };
}

export function l2Normalize(d: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < d.length; i++) n += (d[i] ?? 0) * (d[i] ?? 0);
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = (d[i] ?? 0) / n;
  return out;
}

/**
 * تشابه الجيب التمام (cosine) الحقيقي.
 *
 * ملاحظة أمنية: كان هذا dot product عادياً بافتراض أن كل المتجهات
 * مطبَّعة مسبقاً. لكن `parseOneSample` كان يطبّع **شرطياً** (فقط إذا
 * انحرف النورم أكثر من 0.05) والتخزين يُقرّب إلى 5 منازل عشرية، فكانت
 * المتجهات «شبه وحدة» بمسافة خطأ صغيرة تتسرّب في كل العتبات.
 * القسمة على ‖a‖·‖b‖ تُلغي هذا التبعية تماماً وتُصلح أي انزياح.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!(denom > 0)) return 0;
  const sim = dot / denom;
  // حماية من خطأ الفاصلة العائمة خارج [-1, 1]
  return sim > 1 ? 1 : sim < -1 ? -1 : sim;
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

/** الشكل الأدنى لقيد في فهرس البصمات المعلقة pendingFaceIndex */
export interface PendingFaceRecord {
  requestId?: string;
  studentId?: string;
  name?: string;
  stageId?: string;
  status?: string;
  createdAt?: string;
  faceDescriptor?: unknown;
}

export interface PendingConflictResult {
  conflict: boolean;
  matchedWith?: string | undefined;
}

/**
 * فحص بصمة جديدة ضد الطلبات المعلقة — يمنع رفع بصمة لطالب آخر قبل وصول الطلب للأدمن.
 * تُتجاهل: طلبات نفس الطالب (إعادة المحاولة)، وطلبات المرحلة الأخرى، وما لم يعد pending.
 */
export function checkPendingConflict(
  samples: Float32Array[],
  pendings: Record<string, PendingFaceRecord | null | undefined> | null | undefined,
  opts: { selfId: string; stageId: string },
): PendingConflictResult {
  if (!pendings || typeof pendings !== 'object') return { conflict: false };

  const candidates: Array<{ id: string; name: string; faceDescriptor?: unknown }> = [];
  for (const rec of Object.values(pendings)) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.status && rec.status !== 'pending') continue;
    if (rec.stageId !== opts.stageId) continue;
    if (!rec.studentId || rec.studentId === opts.selfId) continue;
    candidates.push({ id: rec.studentId, name: rec.name || rec.studentId, faceDescriptor: rec.faceDescriptor });
  }
  if (candidates.length === 0) return { conflict: false };

  for (const sample of samples) {
    const r = checkForTampering(sample, candidates, opts.selfId);
    if (r.tampered) return { conflict: true, matchedWith: r.matchedWith };
  }
  return { conflict: false };
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

  // قيد المرساة: العيّنة الجديدة يجب أن تبقى قريبة من مرساة التسجيل.
  // يمنع رياضياً جرّ الهوية نحو طالب آخر (سبب تسميم محمد/مجتبى).
  if (current.enrollment.length > 0) {
    const anchor = computeCentroid(current);
    if (anchor && descriptorDistance(newSample, anchor) > AUTO_LEARN_TETHER_MAX) {
      return { gallery: current, action: 'rejected' };
    }
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
// يجمّع العينات حسب خانة الزاوية الحقيقية (poseToBin) — كل طالب يبدأ بعناقيد
// حقيقية تغطي زوايا تسجيله، بدل العناقيد الوهمية e0..e4 التي لا معنى لها.

export function bootstrapClusters(
  enrollmentSamples: Float32Array[],
  bins: string[],
  quality: number,
): PoseCluster[] {
  if (enrollmentSamples.length === 0) return [];

  const byBin = new Map<string, { sum: Float32Array; count: number }>();
  for (let i = 0; i < enrollmentSamples.length; i++) {
    const sample = enrollmentSamples[i];
    if (!sample) continue;
    const bin = bins[i] ?? '0_0';
    let entry = byBin.get(bin);
    if (!entry) {
      entry = { sum: new Float32Array(sample.length), count: 0 };
      byBin.set(bin, entry);
    }
    for (let j = 0; j < sample.length; j++) {
      entry.sum[j] = (entry.sum[j] ?? 0) + (sample[j] ?? 0);
    }
    entry.count++;
  }

  const clusters: PoseCluster[] = [];
  for (const [bin, e] of byBin) {
    const avg = new Float32Array(e.sum.length);
    for (let j = 0; j < e.sum.length; j++) avg[j] = (e.sum[j] ?? 0) / e.count;
    let norm = 0;
    for (let j = 0; j < avg.length; j++) norm += (avg[j] ?? 0) * (avg[j] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < avg.length; j++) avg[j] = (avg[j] ?? 0) / norm;
    clusters.push({
      bin,
      vector: Array.from(avg).map(v => Math.round(v * 1e5) / 1e5),
      mergeCount: e.count,
      quality,
      updatedAt: Date.now(),
    });
  }
  return clusters;
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
  let v6Count = 0, legacyCount = 0, matureCount = 0, noFaceCount = 0;
  for (const s of students) {
    const fd = s.faceDescriptor;
    if (!hasValidDescriptor(fd)) { noFaceCount++; continue; }
    if (isAlignedDescriptor(fd)) {
      v6Count++;
      if (getCoveragePercent(fd) >= 80) matureCount++;
    } else {
      // v5 (غير مُحاذاة) — بصمة قديمة تحتاج إعادة تسجيل
      legacyCount++;
    }
  }
  return { v6Count, legacyCount, matureCount, noFaceCount, total: students.length };
}
