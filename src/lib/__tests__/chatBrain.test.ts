import { describe, it, expect } from 'vitest';
import {
  pickBestStudentMatch,
  scoreStudentMatch,
  buildLocalReply,
  type ChatScope,
} from '../chatBrain';
import type { Student, AttendanceRecord, AttendanceSession } from '../../types/student';

const stu = (id: string, name: string, code: string, group = 'A1'): Student => ({
  id, name, code, group, createdAt: '2026-01-01',
});

const students: Student[] = [
  stu('s1', 'ايات علي جبار حسن', '5038', 'A2'),
  stu('s2', 'أسماء عباس علي حمود', '5006', 'A1'),
  stu('s3', 'زينب سلام خميس صبيح', '2026', 'A1'),
  stu('s4', 'محمد رحيم عذيب محمد', '2257', 'A7'),
];

const today = new Date().toISOString().slice(0, 10);

const sess = (id: string, name: string, date: string): AttendanceSession => ({
  id, name, date, createdAt: date, isActive: date === today,
});

const rec = (id: string, student: Student, sessionId: string, status: 'present' | 'absent'): AttendanceRecord => ({
  id, studentId: student.id, studentName: student.name, studentCode: student.code,
  timestamp: `${today}T08:00:00`, date: today, time: '08:00', sessionId, status,
});

const scope = (over: Partial<ChatScope> = {}): ChatScope => ({
  students, records: [], sessions: [], ...over,
});

describe('pickBestStudentMatch — منع المطابقات الخاطئة', () => {
  it('لا يطابق "إحصائيات اليوم" باسم طالب (ايات ⊂ احصائيات)', () => {
    expect(pickBestStudentMatch('إحصائيات اليوم', students)).toBeNull();
  });

  it('لا يطابق "أسماء السجلات" باسم طالب (أسماء)', () => {
    expect(pickBestStudentMatch('ما هي أسماء السجلات؟', students)).toBeNull();
  });

  it('لا يطابق تاريخاً ككود طالب (2026 في "...24 أغسطس 2026")', () => {
    expect(pickBestStudentMatch('من حضّر يوم 24 أغسطس 2026؟', students)).toBeNull();
    expect(pickBestStudentMatch('من حضر 24/8/2026', students)).toBeNull();
  });

  it('اسم كامل مع تاريخ → مطابقة قوية تعمل رغم سياق التاريخ', () => {
    expect(pickBestStudentMatch('زينب سلام خميس صبيح في 24 أغسطس 2026', students)?.id).toBe('s3');
  });

  it('اسم جزئي داخل سياق تاريخي بلا فعل بحث → لا يُختطف (يرجع null)', () => {
    expect(pickBestStudentMatch('زينب في 24 أغسطس 2026', students)).toBeNull();
  });
});

describe('pickBestStudentMatch — الحفاظ على السلوك الحالي', () => {
  it('"ابحث عن محمد" → محمد رحيم', () => {
    expect(pickBestStudentMatch('ابحث عن محمد', students)?.id).toBe('s4');
  });

  it('اسم كامل/جزء قوي → مطابقة', () => {
    expect(pickBestStudentMatch('محمد', students)?.id).toBe('s4');
    expect(pickBestStudentMatch('زينب سلام خميس صبيح', students)?.id).toBe('s3');
  });

  it('كود طالب مفرداً → مطابقة', () => {
    expect(pickBestStudentMatch('2257', students)?.id).toBe('s4');
  });

  it('فعل بحث صريح يسمح بمطابقة الاسم الجزئي ("اسأل عن ايات")', () => {
    expect(pickBestStudentMatch('اسأل عن ايات', students)?.id).toBe('s1');
  });

  it('إرجاع null للنطاق الفارغ أو السؤال الفارغ', () => {
    expect(pickBestStudentMatch('', students)).toBeNull();
    expect(pickBestStudentMatch('محمد', [])).toBeNull();
  });
});

describe('scoreStudentMatch — كود الطالب داخل تاريخ', () => {
  it('الكود لا يُحتسب داخل سياق تاريخي', () => {
    expect(scoreStudentMatch('24 أغسطس 2026', students[2]!)).toBeLessThan(50);
    expect(scoreStudentMatch('2026', students[2]!)).toBeGreaterThanOrEqual(50);
  });
});

describe('buildLocalReply — إحصائيات اليوم لا تُختطف', () => {
  it('عند وجود محاضرة اليوم → رد الإحصائيات الصحيح', () => {
    const r = buildLocalReply('إحصائيات اليوم', scope({
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'present')],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('إحصائيات اليوم');
    expect(r.text).toContain('الحاضرون');
    expect(r.text).not.toContain('الطالب');
  });

  it('بلا محاضرة اليوم → "لا توجد محاضرات اليوم"', () => {
    const r = buildLocalReply('إحصائيات اليوم', scope());
    expect(r.handled).toBe(true);
    expect(r.text).toContain('لا توجد محاضرات اليوم');
  });
});

describe('buildLocalReply — أسماء السجلات', () => {
  it('يعرض قائمة السجلات بدل بطاقة طالب', () => {
    const r = buildLocalReply('ما هي أسماء السجلات؟', scope({
      sessions: [
        sess('a', 'حضور 24 أغسطس', '2026-08-24'),
        sess('b', 'حضور اليوم', today),
      ],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('أسماء السجلات');
    expect(r.text).toContain('حضور 24 أغسطس');
    expect(r.text).toContain('حضور اليوم');
    expect(r.text).not.toContain('الطالب');
  });

  it('نطاق بلا سجلات → رسالة واضحة', () => {
    const r = buildLocalReply('شنو أسماء السجلات؟', scope());
    expect(r.handled).toBe(true);
    expect(r.text).toContain('لا توجد سجلات');
  });
});

describe('buildLocalReply — سؤال يوم قديم لا يعطي بطاقة طالب', () => {
  it('يرد بدليل الاستخدام (بدون بطاقة زينب)', () => {
    const r = buildLocalReply('من حضّر يوم 24 أغسطس 2026؟', scope({
      sessions: [sess('a', 'حضور 24 أغسطس', '2026-08-24')],
    }));
    expect(r.text).not.toContain('زينب');
    expect(r.text).not.toContain('الطالب:');
    expect(r.text).toContain('أعمل حالياً بدون مفاتيح AI');
  });
});

describe('buildLocalReply — حفاظ على الردود الحالية', () => {
  it('منو حضر اليوم → قائمة الحاضرين', () => {
    const r = buildLocalReply('منو حضر اليوم؟', scope({
      students: [students[0]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'present')],
    }));
    expect(r.text).toContain('حضور اليوم');
    expect(r.text).toContain('ايات علي جبار حسن');
  });

  it('منو حضر اليوم بلا محاضرة → لا توجد بيانات', () => {
    const r = buildLocalReply('منو حضر اليوم؟', scope());
    expect(r.text).toContain('لا توجد بيانات حضور لليوم');
  });

  it('منو غاب اليوم → سجلات الغياب', () => {
    const r = buildLocalReply('منو غاب اليوم؟', scope({
      students: [students[1]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[1]!, 't', 'absent')],
    }));
    expect(r.text).toContain('غياب اليوم');
    expect(r.text).toContain('أسماء عباس');
  });

  it('بحث بالاسم داخل المرحلة → بطاقة الطالب', () => {
    const r = buildLocalReply('محمد', scope({
      sessions: [sess('t', 'حضور اليوم', today)],
    }));
    expect(r.text).toContain('الطالب:');
    expect(r.text).toContain('محمد رحيم عذيب محمد');
  });

  it('سؤال خارج النطاق → دليل الاستخدام يتضمن سجلات', () => {
    const r = buildLocalReply('كيف حالك', scope());
    expect(r.handled).toBe(false);
    expect(r.text).toContain('أسماء السجلات');
  });
});
