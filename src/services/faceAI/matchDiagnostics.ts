// ─────────────────────────────────────────────────────────────
// سجل تشخيص المطابقة (Match Diagnostics) — **للأدمن فقط**.
//
// الهدف: إذا ظهر اسم طالب غير صحيح لاحقاً، نعرف بالضبط في أي مرحلة صار الخطأ:
// هل المطابقة نفسها (Face Matching) أم ربط الـID بالاسم (ID → Name mapping)
// أم عدد الإطارات (Frame Agreement) أم الهامش (Margin).
//
// قواعد التصميم:
// - بالذاكرة فقط (لا كتابة على Firebase ولا localStorage) — يختفي عند إغلاق الجلسة.
// - بحدّ أقصى 200 محاولة (ring buffer) لا تزيد تكلفة الذاكرة.
// - لا شيء من هذا يدخل قرار المطابقة — القرارات تبقى كما هي في gallery/descriptors.
// ─────────────────────────────────────────────────────────────
import type { IdentityRejectReason } from './identity';

export type MatchSource = 'test' | 'attendance' | 'report';
export type MatchDecision = 'accept' | 'reject' | 'unknown';

/** كود السبب — موحّد بين جميع المسارات لتسهيل البحث لاحقاً */
export type MatchReason =
  | 'HIGH_CONFIDENCE'      // قبول: ثقة عالية وهامش واضح
  | 'LOW_CONFIDENCE'       // أفضل نتيجة تحت العتبة
  | 'LOW_MARGIN'           // الفرق عن الثاني أدنى من الحد الآمن
  | 'FRAME_DISAGREEMENT'   // الإطارات لم تتفق على نفس الطالب
  | 'UNKNOWN_FACE'         // لا مرشّح أصلاً (وجه غير مسجّل)
  | 'DUPLICATE_ID'         // رقم مكرّر ولم يحسم الاسم الكامل
  | 'ID_NAME_MISMATCH'     // رقم مكرّر واسم متطابق بأكثر من سجل
  | 'INVALID_STUDENT_ID'   // السجل غير موجود في النظام
  | 'NO_DESCRIPTOR'        // البصمة رُفعت/حُذفت
  | 'NETWORK_ERROR';       // تعذّر القراءة من السيرفر

export interface MatchAttempt {
  attemptId: string;
  at: string;
  source: MatchSource;
  /** الطالب المُقتنَع به (يملأ عند القبول/الرفض) */
  studentId: string | null;
  studentName: string | null;
  bestId: string | null;
  bestScore: number | null;
  secondId: string | null;
  secondScore: number | null;
  /** الفرق عن الثاني — نقاط مئوية */
  margin: number | null;
  agreement: number;
  totalFrames: number;
  supportedSamples: number | null;
  decision: MatchDecision;
  reason: MatchReason;
}

const MAX_ATTEMPTS = 200;
/** لا نملأ المخزن بمسجّلات «غير معروف» متتالية — إيقاف موجز 3 ثوانٍ */
const UNKNOWN_THROTTLE_MS = 3_000;

/** بيانات المطابقة المُرفقة عند لحظة القرار (تعمل كافتراضيات آمنة) */
export interface MatchDiag {
  margin: number | null;
  secondId: string | null;
  secondScore: number | null;
  agreement: number;
  totalFrames: number;
  supportedSamples: number | null;
}

export const EMPTY_DIAG: MatchDiag = {
  margin: null,
  secondId: null,
  secondScore: null,
  agreement: 0,
  totalFrames: 0,
  supportedSamples: null,
};

let attempts: MatchAttempt[] = [];
let seq = 0;
let lastUnknownAt = 0;

export const recordAttempt = (
  entry: Omit<MatchAttempt, 'attemptId' | 'at'>,
): MatchAttempt | null => {
  if (entry.decision === 'unknown') {
    const now = Date.now();
    if (now - lastUnknownAt < UNKNOWN_THROTTLE_MS) return null;
    lastUnknownAt = now;
  }
  seq += 1;
  const attempt: MatchAttempt = {
    ...entry,
    attemptId: `M${seq.toString(36)}`,
    at: new Date().toISOString(),
  };
  attempts.push(attempt);
  if (attempts.length > MAX_ATTEMPTS) attempts.shift();
  return attempt;
};

/** الأحدث أولاً (نسخة — لا يُعدّل المخزن) */
export const getAttempts = (): MatchAttempt[] => [...attempts].reverse();

export const countAttempts = (): number => attempts.length;

export const clearAttempts = (): void => {
  attempts = [];
  lastUnknownAt = 0;
};

/** النسبة المئوية من المسافة: (1 − distance) × 100 */
export const toScore = (distance: number | null | undefined): number | null =>
  distance === null || distance === undefined || !Number.isFinite(distance)
    ? null
    : Math.round((1 - distance) * 100);

/** بناء بيانات التشخيص من نتيجة findBestMatchConsensus (بلا استيراد لتجنّب أي دورة) */
export const diagFromMatch = (m: {
  margin: number;
  secondId: string | null;
  secondDistance: number | null;
  agreement: number;
  totalQueries: number;
  supportedSamples: number;
}): MatchDiag => ({
  margin: Math.round(m.margin * 100),
  secondId: m.secondId,
  secondScore: toScore(m.secondDistance),
  agreement: m.agreement,
  totalFrames: m.totalQueries,
  supportedSamples: m.supportedSamples,
});

/** ربط أسباب بوابة الهوية الحالية (identity.ts) بكودات السبب الموحّدة */
export const identityReason = (reason: IdentityRejectReason | undefined): MatchReason => {
  switch (reason) {
    case 'not-found': return 'INVALID_STUDENT_ID';
    case 'ambiguous-name': return 'DUPLICATE_ID';
    case 'name-mismatch': return 'ID_NAME_MISMATCH';
    case 'no-descriptor': return 'NO_DESCRIPTOR';
    case 'read-error': return 'NETWORK_ERROR';
    default: return 'UNKNOWN_FACE';
  }
};

/** تفسير رفض الإطار القادم من scoreQuery (getLastMatchRejection) */
export const rejectionReason = (
  cause: 'threshold' | 'margin' | 'agreement' | null | undefined,
): MatchReason => {
  switch (cause) {
    case 'threshold': return 'LOW_CONFIDENCE';
    case 'margin': return 'LOW_MARGIN';
    case 'agreement': return 'FRAME_DISAGREEMENT';
    default: return 'UNKNOWN_FACE';
  }
};

const REASON_LABEL_AR: Record<MatchReason, string> = {
  HIGH_CONFIDENCE: 'ثقة عالية',
  LOW_CONFIDENCE: 'ثقة منخفضة',
  LOW_MARGIN: 'هامش ضيّق',
  FRAME_DISAGREEMENT: 'خلاف بين الإطارات',
  UNKNOWN_FACE: 'وجه غير معروف',
  DUPLICATE_ID: 'رقم مكرّر',
  ID_NAME_MISMATCH: 'رقم مكرّر بنفس الاسم',
  INVALID_STUDENT_ID: 'السجل غير موجود',
  NO_DESCRIPTOR: 'البصمة محذوفة',
  NETWORK_ERROR: 'تعذّر الاتصال',
};

export const reasonLabelAr = (reason: MatchReason): string => REASON_LABEL_AR[reason] ?? reason;

export const decisionLabelAr = (decision: MatchDecision): string =>
  decision === 'accept' ? 'قبول'
    : decision === 'reject' ? 'رفض'
      : 'غير معروف';

const SOURCE_LABEL_AR: Record<MatchSource, string> = {
  test: 'رابط الاختبار',
  attendance: 'الحضور',
  report: 'التقرير',
};

export const sourceLabelAr = (source: MatchSource): string => SOURCE_LABEL_AR[source] ?? source;

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const attemptsToCsv = (): string => {
  const header = [
    'معرّف المحاولة',
    'الوقت',
    'المصدر',
    'القرار',
    'سبب القرار',
    'Student ID',
    'الاسم',
    'أفضل نتيجة %',
    'المرشّح الثاني %',
    'الفرق %',
    'اتفاق الإطارات',
    'الزوايا الداعمة',
  ];
  const rows = attempts.map(a => [
    a.attemptId,
    a.at,
    sourceLabelAr(a.source),
    decisionLabelAr(a.decision),
    reasonLabelAr(a.reason),
    a.studentId ?? a.bestId ?? '',
    a.studentName ?? '',
    a.bestScore ?? '',
    a.secondScore ?? '',
    a.margin ?? '',
    `${a.agreement}/${a.totalFrames}`,
    a.supportedSamples ?? '',
  ].map(v => csvEscape(String(v))).join(','));
  return [header.join(','), ...rows].join('\n');
};
