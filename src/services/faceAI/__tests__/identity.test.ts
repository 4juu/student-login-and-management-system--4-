import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../firebase/config', () => ({ database: {} }));

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path?: string) => ({ path })),
  get: vi.fn(),
}));

vi.mock('../../../firebase/dataService', () => ({
  getActiveAcademicYear: vi.fn(async () => '2025-2026'),
}));

import { get } from 'firebase/database';
import { DESC_DIM } from '../descriptors';
import {
  verifyStudentIdentity,
  clearIdentityCache,
  isIdentityBlock,
  identityBlockMessage,
  resolveDataAdminUid,
  type IdentityRecord,
} from '../identity';

const getMock = vi.mocked(get);

/** متّجه 512 بعدّاد صحيح (لا مركزي) — نفس شكل عيّنات التسجيل */
const sample = (seed: number): number[] =>
  Array.from({ length: DESC_DIM }, (_, i) => Math.sin((seed + 1) * (i + 1) * 0.017 + seed) * 0.05);

const pathOf = (arg: unknown): string => (arg as { path?: string } | undefined)?.path ?? '';
const studentReadCount = (): number => getMock.mock.calls.filter(c => pathOf(c[0]).endsWith('/students')).length;

/** يردّ حسب المسار: students لقائمة السجلات، descriptors/{id} للبصمة */
function stubReads(students: unknown, descriptors: Record<string, unknown> = {}) {
  getMock.mockImplementation(async (r: unknown) => {
    const path = pathOf(r);
    if (path.endsWith('/students')) {
      const exists = students !== null && students !== undefined;
      return { exists: () => exists, val: () => students } as never;
    }
    const m = /\/descriptors\/(.+)$/.exec(path);
    if (m) {
      const key = m[1]!;
      const exists = Object.prototype.hasOwnProperty.call(descriptors, key);
      return { exists: () => exists, val: () => descriptors[key] } as never;
    }
    return { exists: () => false, val: () => null } as never;
  });
}

const validDescriptor = { version: 5, enrollment: [sample(1), sample(2), sample(3)] };

const A: IdentityRecord = { id: 's1', name: 'حسن كريم', code: '11' };
const B: IdentityRecord = { id: 's2', name: 'زينب أحمد' };

const base = { adminUid: 'adm1', stageId: 'st1' };

beforeEach(() => {
  getMock.mockReset();
  clearIdentityCache();
});

describe('verifyStudentIdentity — رقم فريد', () => {
  it('يعتمد السجل الحيّ ويعيد اسمه الرسمي (تعديل إداري بعد تحميل الكاميرا)', async () => {
    stubReads([{ id: 's1', name: 'حسن كريم محمد' }], { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(true);
    expect(res.record!.name).toBe('حسن كريم محمد');
  });

  it('يقرأ البصمة من العقدة المنفصلة descriptors/{id}', async () => {
    stubReads([A], { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(true);
    expect(res.record!.faceDescriptor).toEqual(validDescriptor);
  });

  it('يرفض إن حُذف الطالب من السيرفر', async () => {
    stubReads([B], { s2: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-found');
  });

  it('يرفض إن رُفعت/حُذفت البصمة (لا سجل على أساسها)', async () => {
    stubReads([A], {});
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-descriptor');
  });
});

describe('verifyStudentIdentity — رقم مكرّر', () => {
  const dupes = [
    { id: 's1', name: 'حسن كريم' },
    { id: 's1', name: 'حسن كريم نجم' },
  ];

  it('يقبل فقط حين يطابق الاسم الكامل سجلاً واحداً', async () => {
    stubReads(dupes, { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم نجم' });
    expect(res.ok).toBe(true);
    expect(res.record!.name).toBe('حسن كريم نجم');
  });

  it('يتجاهل فروق الهمزات/التشكيل/المسافات في الاسم', async () => {
    stubReads([{ id: 's1', name: 'زينب أحمد' }, { id: 's1', name: 'ليلى سعيد' }], { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: '  زينب   احمد ' });
    expect(res.ok).toBe(true);
    expect(res.record!.name).toBe('زينب أحمد');
  });

  it('اسمان يتطابقان بعد التطبيع (همزة/بدون) ⇒ استحالة تمييز ⇒ رفض', async () => {
    stubReads([{ id: 's1', name: 'زينب أحمد' }, { id: 's1', name: 'زينب احمد' }], { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'زينب احمد' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('name-mismatch');
  });

  it('يرفض ولا يخمّن إن لم يطابق الاسم أياً منهم', async () => {
    stubReads(dupes, { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'ليلى سعيد' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('ambiguous-name');
  });

  it('يرفض استحالة التمييز (نفس الاسم مرتين بنفس الرقم)', async () => {
    stubReads([{ id: 's1', name: 'حسن كريم' }, { id: 's1', name: 'حسن كريم' }], { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('name-mismatch');
  });

  it('يرفض بلا اسم عند الرقم المكرر (لا حاسم)', async () => {
    stubReads(dupes, { s1: validDescriptor });
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: '' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('ambiguous-name');
  });
});

describe('verifyStudentIdentity — الأعطال والكاش', () => {
  it('عطل الشبكة ⇒ read-error غير حاجب', async () => {
    getMock.mockRejectedValue(new Error('offline'));
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('read-error');
    expect(isIdentityBlock('read-error')).toBe(false);
  });

  it('يقرأ قائمة المرحلة مرة واحدة ضمن نافذة الكاش', async () => {
    stubReads([A], { s1: validDescriptor });
    await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(studentReadCount()).toBe(1);
  });

  it('بعد clearIdentityCache تُعاد القراءة', async () => {
    stubReads([A], { s1: validDescriptor });
    await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    clearIdentityCache('adm1', 'st1');
    await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم' });
    expect(studentReadCount()).toBe(2);
  });

  it('requireDescriptor=false يتخطى فحص البصمة', async () => {
    stubReads([A], {});
    const res = await verifyStudentIdentity({ ...base, id: 's1', name: 'حسن كريم', requireDescriptor: false });
    expect(res.ok).toBe(true);
  });

  it('يرفض فوراً بلا قراءة إن كان المعرّف فارغاً', async () => {
    const res = await verifyStudentIdentity({ ...base, id: '', name: 'حسن كريم' });
    expect(res.reason).toBe('not-found');
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('isIdentityBlock + الرسائل', () => {
  it('يسبّب الكتابة فقط الأسباب المرتبطة بهوية غير مؤكدة', () => {
    expect(isIdentityBlock('not-found')).toBe(true);
    expect(isIdentityBlock('ambiguous-name')).toBe(true);
    expect(isIdentityBlock('name-mismatch')).toBe(true);
    expect(isIdentityBlock('no-descriptor')).toBe(true);
    expect(isIdentityBlock('read-error')).toBe(false);
    expect(isIdentityBlock(undefined)).toBe(false);
  });

  it('رسائل عربية لكل سبب', () => {
    for (const reason of ['not-found', 'ambiguous-name', 'name-mismatch', 'no-descriptor'] as const) {
      expect(identityBlockMessage(reason).length).toBeGreaterThan(5);
    }
    expect(identityBlockMessage(undefined).length).toBeGreaterThan(5);
  });
});

describe('resolveDataAdminUid', () => {
  it('أدمن رئيسي ⇒ uid', () => {
    expect(resolveDataAdminUid({ role: 'admin', uid: 'u1' })).toBe('u1');
  });

  it('مشرف/معلّم ⇒ adminId ثم uid', () => {
    expect(resolveDataAdminUid({ role: 'college_admin', uid: 'u2', adminId: 'a2' })).toBe('a2');
    expect(resolveDataAdminUid({ role: 'teacher', uid: 'u3' })).toBe('u3');
  });

  it('بلا مستخدم ⇒ سلسلة فارغة', () => {
    expect(resolveDataAdminUid(null)).toBe('');
  });
});
