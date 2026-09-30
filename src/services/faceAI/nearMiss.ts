// ─────────────────────────────────────────────────────────────
// سجل الأخطاء القريبة (near-miss) — قياس عملي لخطأ المطابقة
//
// قبل هذا الملف كان الرفض صامتاً: `findBestMatchIndexed` يُرجع null
// دون أي أثر، فلا يمكن معرفة إن كان السبب «وجه غير معروف» أم «طالبان
// متقاربان» أم «جودة إطار ضعيفة». هذا الملف يحوّل الرفض إلى رقم.
//
// الهدف: قياس FAR/FRR تشغيلياً (هدف 99٪ قبول صحيح / 1٪ خطأ) بدل
// التخمين. يعتمد على getLastRejection() من gallery.ts.
// ─────────────────────────────────────────────────────────────
import { getLastRejection, type RejectionReason } from './gallery';

export interface NearMiss {
  /** معرّف أقرب طالب عند الرفض */
  id: string | undefined;
  name: string | undefined;
  /** مسافة القرار العادلة لأقرب طالب */
  distance: number;
  /** مسافة أقرب عيّنة مفردة (مفيدة لتفسير « seulement عيّنة قريبة») */
  nearestSample: number;
  margin: number;
  reason: RejectionReason;
  candidates: number;
  /** وقت الرفض */
  at: number;
  /** عدد مرات رفض هذا الطالب — تراكمي */
  count: number;
}

export interface NearMissSummary {
  total: number;
  byReason: Record<string, number>;
  /** أكثر الطلاب إلقاءً للخلط — أهم قائمة للإصلاح */
  topSuspects: Array<{ id: string; name: string; misses: number; avgDistance: number; minMargin: number }>;
}

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'face-near-miss-log-v1';

function loadPersisted(): NearMiss[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as NearMiss[]).slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persist(entries: NearMiss[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* التخزين غير متاح — نتجاهل */
  }
}

// دائم: يُحمَّل من localStorage عند البدء — يبقى بعد إعادة التحميل (قياس ميداني)
const entries: NearMiss[] = loadPersisted();
const perStudent = new Map<string, { misses: number; distSum: number; minMargin: number }>();

function keyOf(id: string | undefined): string {
  return id && id.length > 0 ? id : '__unknown__';
}

/** سجّل آخر رفض من المطابقة (يُستدعى بعد كل findBestMatchIndexed رافض) */
export function recordRejection(forcedReason?: RejectionReason): NearMiss | null {
  const rej = getLastRejection();
  if (!rej) return null;
  const reason = forcedReason ?? rej.reason;
  const key = keyOf(rej.nearestId);

  const stat = perStudent.get(key) ?? { misses: 0, distSum: 0, minMargin: Infinity };
  stat.misses += 1;
  stat.distSum += Number.isFinite(rej.nearestDistance) ? rej.nearestDistance : 0;
  stat.minMargin = Math.min(stat.minMargin, rej.margin);
  perStudent.set(key, stat);

  const entry: NearMiss = {
    id: rej.nearestId,
    name: rej.nearestName,
    distance: Number.isFinite(rej.nearestDistance) ? rej.nearestDistance : 1,
    nearestSample: Number.isFinite(rej.nearestSample) ? rej.nearestSample : 1,
    margin: rej.margin,
    reason,
    candidates: rej.candidates,
    at: Date.now(),
    count: stat.misses,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  persist(entries);
  return entry;
}

export function getNearMissLog(): readonly NearMiss[] {
  return entries;
}

export function getNearMissSummary(): NearMissSummary {
  const byReason: Record<string, number> = {};
  for (const e of entries) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;

  const nameOf = (id: string): string => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e && e.id === id && e.name) return e.name;
    }
    return id;
  };

  const topSuspects = [...perStudent.entries()]
    .filter(([k]) => k !== '__unknown__')
    .map(([id, s]) => ({
      id,
      name: nameOf(id),
      misses: s.misses,
      avgDistance: s.misses > 0 ? Math.round((s.distSum / s.misses) * 1000) / 1000 : 1,
      minMargin: Number.isFinite(s.minMargin) ? Math.round(s.minMargin * 1000) / 1000 : 1,
    }))
    .sort((a, b) => b.misses - a.misses)
    .slice(0, 5);

  return { total: entries.length, byReason, topSuspects };
}

export function clearNearMissLog(): void {
  entries.length = 0;
  perStudent.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* تجاهل */
  }
}
