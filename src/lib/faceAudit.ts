// ─────────────────────────────────────────────────────────────
// تدقيق بصمات المرحلة (قراءة فقط — لا يكتب أي شيء)
// يكشف: معرّفات مكرّرة · بصمات ضعيفة (عيّنات قليلة) · وجهان متشابهان
// (فحص الانحراف بين العيّنات مُلغى — الانحراف 0.45–0.79 طبيعي لنفس الشخص)
// ─────────────────────────────────────────────────────────────
import { parseAllSamples, descriptorDistance, l2Normalize } from '../services/faceAI/descriptors';
import { NUMBER_FIELD_LABEL, findDuplicateNumbers, type NumberField } from './studentNumbers';

export interface AuditStudentInput {
  id: string;
  name: string;
  code?: string | undefined;
  universityId?: string | undefined;
  qrCodeId?: string | undefined;
  faceDescriptor?: unknown;
}

export type AuditIssueKind =
  | 'duplicate-id'
  | 'duplicate-code'
  | 'duplicate-university-id'
  | 'duplicate-qr'
  | 'weak-samples'
  | 'similar-face';

export interface AuditIssue {
  kind: AuditIssueKind;
  severity: 'high' | 'med';
  studentIds: string[];
  studentNames: string[];
  detail: string;
  /** المسافة (كلما صغرت كان التشابه/الانحراف أكبر) */
  score?: number;
}

export interface StageAudit {
  issues: AuditIssue[];
  /** معرّفات طلاب يحتاجون إعادة تسجيل (بقايا في حقل affectedIds) */
  affectedIds: string[];
  totalStudents: number;
  withFace: number;
  /** طلاب بصمتهم سليمة */
  clean: number;
}

/** أقل عدد عيّنات صالحة تُعدّ البصمة سليمة */
export const MIN_HEALTHY_SAMPLES = 5;
/** أقل مسافة بين بِصمتين считаهما «الوجه نفسه» */
export const SIMILAR_FACE_THRESHOLD = 0.15;
/** ترشيح سريع بالمتوسط قبل المقارنة الكاملة بين كل عيّنات طالبين */
export const CENTROID_PREFILTER = 0.30;

/** متوسط عيّنات البصمة (مُطبَّع) */
export const centroidOf = (samples: Float32Array[]): Float32Array | null => {
  const first = samples[0];
  if (!first) return null;
  const dim = first.length;
  const mean = new Float32Array(dim);
  for (const s of samples) for (let i = 0; i < dim; i++) mean[i] = mean[i]! + s[i]!;
  for (let i = 0; i < dim; i++) mean[i] = mean[i]! / samples.length;
  return l2Normalize(mean);
};

/** أدنى مسافة بين أي عينة من بصمة وأخرى */
export const minSampleDistance = (a: Float32Array[], b: Float32Array[]): number => {
  let min = Infinity;
  for (const x of a) for (const y of b) {
    const d = descriptorDistance(x, y);
    if (d < min) min = d;
  }
  return min;
};

/** أسماء الطلاب المكرّرة المعرّفات (سجلّان لنفس الرقم) */
export function findRosterDuplicateIds(students: AuditStudentInput[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of students) {
    if (!s.id) continue;
    if (seen.has(s.id)) dupes.add(s.id);
    else seen.add(s.id);
  }
  return [...dupes];
}

export function auditFaceDescriptors(students: AuditStudentInput[]): StageAudit {
  const issues: AuditIssue[] = [];
  const affected = new Set<string>();

  // ── 1) أي رقم مكرّر (الرمز/الجامعي/QR/المعرّف) — الرقم الفريد شرط
  const DUPLICATE_KIND: Record<NumberField, AuditIssueKind> = {
    id: 'duplicate-id',
    code: 'duplicate-code',
    universityId: 'duplicate-university-id',
    qrCodeId: 'duplicate-qr',
  };
  for (const g of findDuplicateNumbers(students)) {
    const names = g.records.map(r => r.name);
    issues.push({
      kind: DUPLICATE_KIND[g.field],
      severity: 'high',
      studentIds: g.records.map(r => r.id),
      studentNames: names,
      detail: `${NUMBER_FIELD_LABEL[g.field]} «${g.value}» مكرر في ${names.length} سجلات — بصمة واحدة ستعمل للاثنين أو يُمنع أحدهما من الحضور`,
      score: names.length,
    });
    for (const r of g.records) affected.add(r.id);
  }

  // ── 2) تحليل كل بصمة على حدة
  const parsed: { id: string; name: string; samples: Float32Array[]; centroid: Float32Array }[] = [];
  for (const s of students) {
    if (!s.id) continue;
    let samples: Float32Array[] = [];
    try { samples = parseAllSamples(s.faceDescriptor as never); } catch { samples = []; }
    if (samples.length === 0) continue;
    const centroid = centroidOf(samples);
    if (!centroid) continue;
    parsed.push({ id: s.id, name: s.name, samples, centroid });

    if (samples.length < MIN_HEALTHY_SAMPLES) {
      issues.push({
        kind: 'weak-samples',
        severity: 'med',
        studentIds: [s.id],
        studentNames: [s.name],
        detail: `بصمة ضعيفة: ${samples.length} عينة صالحة فقط (المفروض ${MIN_HEALTHY_SAMPLES}+)`,
        score: samples.length,
      });
      affected.add(s.id);
    }
  }

  // ── 3) وجهان متشابهان بين طلاب (ترشيح بالمتوسط ثم مقارنة كاملة)
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;
      if (descriptorDistance(a.centroid, b.centroid) >= CENTROID_PREFILTER) continue;
      const d = minSampleDistance(a.samples, b.samples);
      if (d < SIMILAR_FACE_THRESHOLD) {
        issues.push({
          kind: 'similar-face',
          severity: 'high',
          studentIds: [a.id, b.id],
          studentNames: [a.name, b.name],
          detail: `وجهان متشابهان (${d.toFixed(2)}) — البصمة نفسها مسجّلة لطالبين`,
          score: d,
        });
        affected.add(a.id);
        affected.add(b.id);
      }
    }
  }

  const withFace = parsed.length;
  return {
    issues,
    affectedIds: [...affected],
    totalStudents: students.length,
    withFace,
    clean: withFace - [...affected].filter(id => parsed.some(p => p.id === id)).length,
  };
}

const KIND_LABEL: Record<AuditIssueKind, string> = {
  'duplicate-id': 'معرّف مكرر',
  'duplicate-code': 'رمز مكرر',
  'duplicate-university-id': 'رقم جامعي مكرر',
  'duplicate-qr': 'QR مكرر',
  'weak-samples': 'بصمة ضعيفة',
  'similar-face': 'وجهان متشابهان',
};

/** تصدير النتائج CSV (للأرشفة والمشاركة مع الإدارة) */
export function auditIssuesToCsv(audit: StageAudit): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ['النوع', 'الخطورة', 'الطلاب', 'المعرّفات', 'التفاصيل', 'المسافة'].map(esc).join(','),
    ...audit.issues.map(i =>
      [
        KIND_LABEL[i.kind],
        i.severity === 'high' ? 'عالية' : 'متوسطة',
        i.studentNames.join(' + '),
        i.studentIds.join(' + '),
        i.detail,
        i.score !== undefined ? String(i.score) : '',
      ].map(esc).join(','),
    ),
  ];
  // BOM حتى تفتح Excel العربية بترميز صحيح
  return `\uFEFF${rows.join('\r\n')}`;
}
