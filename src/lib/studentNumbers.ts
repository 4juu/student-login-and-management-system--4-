// ─────────────────────────────────────────────────────────────
// فريدية الأرقام — أي رقم من أرقام الطالب (الرمز · الرقم الجامعي ·
// رمز QR · المعرّف الداخلي id) لا يجوز أن يتكرر بين طلاب المرحلة.
//
// السبب: البصمة محفوظة في خانة واحدة تحت الـid — سجلان بنفس الرقم
// = بصمة مشتركة لشخصين (حضور باسم الغير) أو منع دائم لأحدهما.
// نمنع التكرار عند كل باب إدخال، ونكشف الموجود منه للكاشف والحفظ.
// ─────────────────────────────────────────────────────────────
import type { Student } from '../types/student';

export type NumberField = 'id' | 'code' | 'universityId' | 'qrCodeId';

export const NUMBER_FIELDS: NumberField[] = ['id', 'code', 'universityId', 'qrCodeId'];

export const NUMBER_FIELD_LABEL: Record<NumberField, string> = {
  id: 'المعرّف الداخلي',
  code: 'الرمز',
  universityId: 'الرقم الجامعي',
  qrCodeId: 'رمز QR',
};

export type NumberSource = {
  id: string;
  name: string;
  code?: string | undefined;
  universityId?: string | undefined;
  qrCodeId?: string | undefined;
};

export interface NumberConflict {
  field: NumberField;
  value: string;
  /** السجل الذي يحمل الرقم مسبقاً */
  holderId: string;
  holderName: string;
}

const value_of = (s: Partial<NumberSource> | null | undefined, field: NumberField): string => {
  const v = s ? s[field] : undefined;
  return typeof v === 'string' ? v.trim() : '';
};

/**
 * يفحص أرقام المرشّح (id/code/universityId/qrCodeId) مقابل القائمة الحالية
 * ويرجع أول تعارض — يُستعمل عند الإضافة وعند تعديل الرقم الجامعي/QR.
 */
export function findNumberConflict(
  candidate: Partial<Pick<Student, 'id' | 'code' | 'universityId' | 'qrCodeId'>>,
  students: Array<NumberSource | undefined | null>,
  excludeId?: string,
): NumberConflict | null {
  for (const field of NUMBER_FIELDS) {
    const value = value_of(candidate as NumberSource, field);
    if (!value) continue;
    const holder = students.find(s => s && s.id !== excludeId && value_of(s, field) === value);
    if (holder) {
      return { field, value, holderId: holder.id, holderName: holder.name };
    }
  }
  return null;
}

export interface DuplicateNumberGroup {
  field: NumberField;
  value: string;
  records: NumberSource[];
}

/** كل الأرقام المكرّرة في القائمة — للكاشف (FaceAuditPanel) وللحارس عند الحفظ */
export function findDuplicateNumbers(
  students: Array<NumberSource | undefined | null>,
): DuplicateNumberGroup[] {
  const groups: DuplicateNumberGroup[] = [];
  for (const field of NUMBER_FIELDS) {
    const byValue = new Map<string, NumberSource[]>();
    for (const s of students) {
      if (!s) continue;
      const value = value_of(s, field);
      if (!value) continue;
      const list = byValue.get(value);
      if (list) list.push(s);
      else byValue.set(value, [s]);
    }
    for (const [value, records] of byValue) {
      if (records.length > 1) groups.push({ field, value, records });
    }
  }
  return groups;
}

/** قيم مكرّرة من نوع واحد (مثلاً كل id المكرّرة) — تُستعمل لحماية بصمات الحفظ */
export function duplicateValues(
  students: Array<NumberSource | undefined | null>,
  field: NumberField,
): Set<string> {
  const counts = new Map<string, number>();
  for (const s of students) {
    if (!s) continue;
    const value = value_of(s, field);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [value, count] of counts) {
    if (count > 1) dups.add(value);
  }
  return dups;
}
