// ─────────────────────────────────────────────────────────────
// نظام بصمات الوجه — GhostFaceNet 512-bits L2-normalized
// الصيغة الوحيدة: v5 — سبع عينات تسجيل مستقلة، عينة لكل زاوية.
// أي clusters من بيانات قديمة تُتجاهل ولا تدخل في المطابقة.
// ─────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════
// 1) الثوابت والأنواع
// ══════════════════════════════════════════════════════════════

export const DESC_DIM = 512;
export const DESC_VERSION_GALLERY = 5;
export const ENROLLMENT_SAMPLE_COUNT = 7;

export const MATCH_STRICT = 0.32;
export const MATCH_LOOSE = 0.42;
// الهامش بين أفضل طالبين — كان 0.06 وكان يسمح بتعادل خطر بين وجهين
export const MIN_MARGIN = 0.10;
export const TAMPER_THRESHOLD = 0.30;
// التأكيد على 5 فريمات متتالية (كان 3) + ثبات المسافة عبر tracker — استقرار زمني أقوى
export const CONFIRM_FRAMES = 5;

// ══════════════════════════════════════════════════════════════
// حدود المطابقة على أقرب عينة؛ ثبات الإطارات المتتابعة يثبت التعرف.
// ══════════════════════════════════════════════════════════════
/** أقصى مسافة لأول عيّنة (≈ ثقة 75%) — الحد الفعلي القابل للمعايرة */
export const RECOG_D1_CAP = 0.25;
/** عدد العينات لأغراض معايرة حدود الأمان فقط، لا لدمج عينات التعرف */
export const RECOG_MATCH_K = 3;
/** حد مشدد للتوافق مع سجلات قديمة لا تحتوي إلا على عينة واحدة */
export const RECOG_SOLO_CAP = 0.18;
/** أقصى تشتت بين مسافات إطارات الكاميرا المتتابعة */
export const RECOG_SPREAD_MAX = 0.10;
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

/** legacy-only shape; old cluster data is intentionally ignored by the recognizer. */
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
  clusters?: PoseCluster[] | undefined;
  samples?: number | undefined;
  quality?: number | undefined;
  studentNameEn?: string | undefined;
  enrollmentAngles?: string[] | undefined;
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
  return o.version === DESC_VERSION_GALLERY
    && Array.isArray(o.enrollment)
    && Array.isArray(o.enrollment);
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
      .filter((s): s is Float32Array => s !== null)
      .slice(0, ENROLLMENT_SAMPLE_COUNT);
    if (samples.length === 0) return null;
    return {
      version: DESC_VERSION_GALLERY,
      enrollment: samples.map(s => Array.from(l2Normalize(s)).map(v => Math.round(v * 1e5) / 1e5)),
      samples: samples.length,
      ...(typeof fd.quality === 'number' ? { quality: fd.quality } : {}),
      ...(typeof fd.studentNameEn === 'string' && fd.studentNameEn.trim()
        ? { studentNameEn: fd.studentNameEn.trim() }
        : {}),
      ...(Array.isArray(fd.enrollmentAngles) && fd.enrollmentAngles.length === samples.length
        && fd.enrollmentAngles.every(angle => typeof angle === 'string')
        ? { enrollmentAngles: [...fd.enrollmentAngles] }
        : {}),
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

/** العينات المعتمدة الوحيدة للمطابقة: كل بصمات التسجيل المستقلة */
export function parseGallerySamples(fd: unknown): Float32Array[] {
  if (!isGalleryDescriptor(fd)) return [];

  const result: Float32Array[] = [];
  for (const s of fd.enrollment.slice(0, ENROLLMENT_SAMPLE_COUNT)) {
    const p = parseOneSample(s);
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

export function getGalleryHealthSummary(students: Array<{ faceDescriptor?: unknown }>) {
  let v5Count = 0, noFaceCount = 0;
  for (const s of students) {
    if (!hasValidDescriptor(s.faceDescriptor)) { noFaceCount++; continue; }
    v5Count++;
  }
  return { v5Count, noFaceCount, total: students.length };
}
