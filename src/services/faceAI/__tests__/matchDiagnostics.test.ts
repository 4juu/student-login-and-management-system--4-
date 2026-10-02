import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attemptsToCsv,
  clearAttempts,
  countAttempts,
  decisionLabelAr,
  diagFromMatch,
  getAttempts,
  identityReason,
  reasonLabelAr,
  recordAttempt,
  rejectionReason,
  sourceLabelAr,
  toScore,
} from '../matchDiagnostics';

const accept = (studentId: string) => ({
  source: 'attendance' as const,
  studentId,
  studentName: `طالب ${studentId}`,
  bestId: studentId,
  bestScore: 92,
  secondId: null,
  secondScore: null,
  margin: 30,
  agreement: 3,
  totalFrames: 5,
  supportedSamples: 7,
  decision: 'accept' as const,
  reason: 'HIGH_CONFIDENCE' as const,
});

beforeEach(() => clearAttempts());
afterEach(() => vi.restoreAllMocks());

describe('recordAttempt — المخزن بالذاكرة', () => {
  it('يضيف محاولة مع معرّف ووقت', () => {
    const a = recordAttempt(accept('s1'));
    expect(a).not.toBeNull();
    expect(a!.attemptId).toMatch(/^M/);
    expect(Number.isNaN(Date.parse(a!.at))).toBe(false);
    expect(countAttempts()).toBe(1);
  });

  it('يقصّ عند الحدّ الأقصى 200 ويبقي الأحدث', () => {
    for (let i = 0; i < 201; i++) recordAttempt(accept(`s${i}`));
    expect(countAttempts()).toBe(200);
    const ids = getAttempts().map(a => a.studentId);
    expect(ids[0]).toBe('s200');
    expect(ids).not.toContain('s0');
    expect(ids).toContain('s1');
  });

  it('getAttempts يعيد الأحدث أولاً دون تعديل المخزن', () => {
    recordAttempt(accept('first'));
    recordAttempt(accept('second'));
    const list = getAttempts();
    expect(list[0]!.studentId).toBe('second');
    expect(list).toHaveLength(2);
    expect(getAttempts()).toHaveLength(2);
  });

  it('clearAttempts يفرّغ المخزن', () => {
    recordAttempt(accept('s1'));
    clearAttempts();
    expect(countAttempts()).toBe(0);
    expect(getAttempts()).toEqual([]);
  });
});

describe('إيقاف مسجّلات «غير معروف»', () => {
  it('يسمح بواحدة ثم يمنع 3 ثوانٍ ثم يسمح بعد انقضائها', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const unknown = (id: string) => ({
      ...accept(id),
      studentId: null,
      studentName: null,
      decision: 'unknown' as const,
      reason: 'UNKNOWN_FACE' as const,
    });

    expect(recordAttempt(unknown('x'))).not.toBeNull();
    now += 1_000;
    expect(recordAttempt(unknown('x'))).toBeNull();
    now += 3_000;
    expect(recordAttempt(unknown('x'))).not.toBeNull();
    expect(countAttempts()).toBe(2);
  });

  it('clearAttempts يعيد ضبط الإيقاف', () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const u = {
      ...accept('x'),
      studentId: null,
      studentName: null,
      decision: 'unknown' as const,
      reason: 'UNKNOWN_FACE' as const,
    };
    expect(recordAttempt(u)).not.toBeNull();
    expect(recordAttempt(u)).toBeNull();
    clearAttempts();
    expect(recordAttempt(u)).not.toBeNull();
  });

  it('القبول/الرفض لا يخضعان للإيقاف', () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    expect(recordAttempt(accept('a'))).not.toBeNull();
    expect(recordAttempt(accept('b'))).not.toBeNull();
    expect(countAttempts()).toBe(2);
  });
});

describe('كوودات الأسباب والعناوين', () => {
  it('identityReason يربط أسباب الهوية', () => {
    expect(identityReason('not-found')).toBe('INVALID_STUDENT_ID');
    expect(identityReason('ambiguous-name')).toBe('DUPLICATE_ID');
    expect(identityReason('name-mismatch')).toBe('ID_NAME_MISMATCH');
    expect(identityReason('no-descriptor')).toBe('NO_DESCRIPTOR');
    expect(identityReason('read-error')).toBe('NETWORK_ERROR');
  });

  it('rejectionReason يفسّر رفض الإطار', () => {
    expect(rejectionReason('threshold')).toBe('LOW_CONFIDENCE');
    expect(rejectionReason('margin')).toBe('LOW_MARGIN');
    expect(rejectionReason('agreement')).toBe('FRAME_DISAGREEMENT');
    expect(rejectionReason(null)).toBe('UNKNOWN_FACE');
    expect(rejectionReason(undefined)).toBe('UNKNOWN_FACE');
  });

  it('عناوين عربية لكل السبوب والقرارات والمصادر', () => {
    expect(reasonLabelAr('HIGH_CONFIDENCE')).toBe('ثقة عالية');
    expect(reasonLabelAr('LOW_MARGIN')).toBe('هامش ضيّق');
    expect(decisionLabelAr('accept')).toBe('قبول');
    expect(decisionLabelAr('reject')).toBe('رفض');
    expect(decisionLabelAr('unknown')).toBe('غير معروف');
    expect(sourceLabelAr('test')).toBe('رابط الاختبار');
    expect(sourceLabelAr('attendance')).toBe('الحضور');
    expect(sourceLabelAr('report')).toBe('التقرير');
  });
});

describe('toScore و diagFromMatch', () => {
  it('toScore يحوّل المسافة إلى نسبة مئوية', () => {
    expect(toScore(0.3)).toBe(70);
    expect(toScore(0.305)).toBe(70);
    expect(toScore(null)).toBeNull();
    expect(toScore(undefined)).toBeNull();
    expect(toScore(NaN)).toBeNull();
  });

  it('diagFromMatch يبني البيانات من نتيجة إجماعية', () => {
    const d = diagFromMatch({
      margin: 0.094,
      secondId: 'b',
      secondDistance: 0.45,
      agreement: 3,
      totalQueries: 5,
      supportedSamples: 4,
    });
    expect(d).toEqual({
      margin: 9,
      secondId: 'b',
      secondScore: 55,
      agreement: 3,
      totalFrames: 5,
      supportedSamples: 4,
    });
  });
});

describe('attemptsToCsv', () => {
  it('يتضمن الترويسة وصفوف الترميز الصحيح', () => {
    recordAttempt(accept('s1'));
    recordAttempt({
      ...accept('x'),
      studentId: null,
      studentName: 'اسم, فيه فاصلة',
      decision: 'reject',
      reason: 'DUPLICATE_ID',
    });
    const csv = attemptsToCsv();
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('معرّف المحاولة');
    expect(lines[0]).toContain('سبب القرار');
    expect(csv).toContain('قبول');
    expect(csv).toContain('"اسم, فيه فاصلة"');
  });

  it('المخزن الفارغ يعطي الترويسة فقط', () => {
    expect(attemptsToCsv().split('\n')).toHaveLength(1);
  });
});
