import { describe, it, expect } from 'vitest';
import {
  findNumberConflict,
  findDuplicateNumbers,
  duplicateValues,
  NUMBER_FIELD_LABEL,
} from '../studentNumbers';
import { auditFaceDescriptors, auditIssuesToCsv } from '../faceAudit';

const st = (
  id: string,
  name: string,
  rest: { code?: string; universityId?: string; qrCodeId?: string } = {},
) => ({ id, name, ...rest });

describe('findNumberConflict — أي رقم لا يتكرر', () => {
  const students = [
    st('u1', 'محمد', { code: '1234', universityId: '2024111', qrCodeId: 'QR-A' }),
    st('u2', 'أحمد', { code: '5678' }),
  ];

  it('يكتشف تكرار الرمز ويسمّي صاحبه', () => {
    const c = findNumberConflict({ code: '1234' }, students);
    expect(c).toEqual({ field: 'code', value: '1234', holderId: 'u1', holderName: 'محمد' });
    expect(NUMBER_FIELD_LABEL[c!.field]).toBe('الرمز');
  });

  it('يكتشف تكرار الرقم الجامعي ورمز QR والمعرّف', () => {
    expect(findNumberConflict({ universityId: '2024111' }, students)?.field).toBe('universityId');
    expect(findNumberConflict({ qrCodeId: 'QR-A' }, students)?.field).toBe('qrCodeId');
    expect(findNumberConflict({ id: 'u2' }, students)?.field).toBe('id');
  });

  it('يرجع null عند رقم جديد (وفارغ لا يُفحص)', () => {
    expect(findNumberConflict({ code: '9999' }, students)).toBeNull();
    expect(findNumberConflict({ code: '', universityId: '' }, students)).toBeNull();
    expect(findNumberConflict({}, students)).toBeNull();
  });

  it('excludeId يستثني السجل الجاري تعديله', () => {
    expect(findNumberConflict({ code: '1234' }, students, 'u1')).toBeNull();
    expect(findNumberConflict({ code: '1234' }, students, 'u2')?.holderId).toBe('u1');
  });

  it('يطابق بعد تنظيف المسافات', () => {
    expect(findNumberConflict({ code: ' 1234 ' }, students)?.value).toBe('1234');
  });

  it('يفحص الأرقام الأربعة معاً بأولوية id ثم الرمز ثم الجامعي ثم QR', () => {
    const c = findNumberConflict(
      { id: 'u1', code: '1234', universityId: '2024111', qrCodeId: 'QR-A' },
      students,
    );
    expect(c?.field).toBe('id');
  });
});

describe('findDuplicateNumbers — كشف الموجود في الجدول', () => {
  it('يرجع كل مجموعة تكرار من كل الأنواع', () => {
    const groups = findDuplicateNumbers([
      st('u1', 'محمد', { code: '1234', universityId: '77' }),
      st('u2', 'أحمد', { code: '1234' }),
      st('u3', 'علي', { universityId: '77', qrCodeId: 'QR-9' }),
      st('u4', 'رعد', { qrCodeId: 'QR-9' }),
      st('u4', 'رعد مكرر'),
    ]);
    const byField = new Map(groups.map(g => [g.field, g]));
    expect(byField.get('code')?.value).toBe('1234');
    expect(byField.get('code')?.records).toHaveLength(2);
    expect(byField.get('universityId')?.value).toBe('77');
    expect(byField.get('qrCodeId')?.value).toBe('QR-9');
    expect(byField.get('id')?.value).toBe('u4');
    expect(groups).toHaveLength(4);
  });

  it('الأرقام الفارغة والوحدة لا تُعدّ تكراراً', () => {
    expect(findDuplicateNumbers([
      st('u1', 'محمد', { code: '1234' }),
      st('u2', 'أحمد'),
      st('u3', 'علي', { universityId: '', qrCodeId: '' }),
    ])).toEqual([]);
    expect(findDuplicateNumbers([])).toEqual([]);
    expect(findDuplicateNumbers([undefined as never, null as never])).toEqual([]);
  });
});

describe('duplicateValues — حارس البصمات', () => {
  it('يعيد القيم المكرّرة فقط من نوع واحد', () => {
    const students = [
      st('u1', 'محمد', { code: '1234' }),
      st('u2', 'أحمد', { code: '1234' }),
      st('u3', 'علي', { code: '5678' }),
    ];
    expect([...duplicateValues(students, 'code')]).toEqual(['1234']);
    expect(duplicateValues(students, 'id').size).toBe(0);
    expect(duplicateValues(students, 'universityId').size).toBe(0);
  });

  it('تجاهل الفراغ', () => {
    expect(duplicateValues([st('u1', 'محمد'), st('u2', 'أحمد')], 'code').size).toBe(0);
  });
});

describe('auditFaceDescriptors — أرقام مكرّرة بالتقرير', () => {
  it('يكشف الرمز والجامعي QR والمعرّف المكرّرين بلا حاجة للبصمات', () => {
    const audit = auditFaceDescriptors([
      st('u1', 'محمد', { code: '1234' }),
      st('u2', 'أحمد', { code: '1234' }),
      st('u3', 'علي', { code: '5678', universityId: '99' }),
      st('u4', 'رعد', { code: '5679', universityId: '99', qrCodeId: 'Q1' }),
      st('u5', 'سعد', { code: '5680', qrCodeId: 'Q1' }),
      st('u5', 'سعد نسخة', { code: '5681' }),
    ]);
    const kinds = audit.issues.map(i => i.kind);
    expect(kinds).toContain('duplicate-code');
    expect(kinds).toContain('duplicate-university-id');
    expect(kinds).toContain('duplicate-qr');
    expect(kinds).toContain('duplicate-id');
    const codeIssue = audit.issues.find(i => i.kind === 'duplicate-code')!;
    expect(codeIssue.severity).toBe('high');
    expect(codeIssue.studentNames).toEqual(['محمد', 'أحمد']);
    expect(codeIssue.detail).toContain('الرمز');
    expect(audit.withFace).toBe(0);
  });

  it('جدول نظيف بلا تكرار لا ينتج مشاكل أرقام', () => {
    const audit = auditFaceDescriptors([
      st('u1', 'محمد', { code: '1234' }),
      st('u2', 'أحمد', { code: '5678' }),
    ]);
    expect(audit.issues).toEqual([]);
    expect(audit.affectedIds).toEqual([]);
  });

  it('CSV يضمّ تسميات الأنواع الجديدة', () => {
    const audit = auditFaceDescriptors([
      st('u1', 'محمد', { code: '1234' }),
      st('u2', 'أحمد', { code: '1234' }),
    ]);
    const csv = auditIssuesToCsv(audit);
    expect(csv).toContain('رمز مكرر');
    expect(csv).toContain('محمد + أحمد');
  });
});
