import { describe, it, expect } from 'vitest';
import {
  pickBestStudentMatch,
  scoreStudentMatch,
  buildLocalReply,
  extractDateQuery,
  extractGroupToken,
  extractAcademicCode,
  REFUSAL_REPLY,
  type ChatScope,
} from '../chatBrain';
import type { Student, AttendanceRecord, AttendanceSession, College } from '../../types/student';

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
  it('لا يطابق "إحصايات اليوم" باسم طالب (ايات ⊂ احصائيات)', () => {
    expect(pickBestStudentMatch('إحصايات اليوم', students)).toBeNull();
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

describe('buildLocalReply — خارج القائمة (إحصايات/سجلات) → رسالة الرفض', () => {
  it('إحصايات اليوم → رسالة الرفض (لا أرقام)', () => {
    const r = buildLocalReply('إحصايات اليوم', scope({
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'present')],
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('الحاضرون');
    expect(r.text).not.toContain('الطالب');
  });

  it('إحصايات اليوم بنطاق فارغ → رسالة الرفض أيضاً', () => {
    const r = buildLocalReply('إحصايات اليوم', scope());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
  });
});

describe('buildLocalReply — أسماء السجلات → رسالة الرفض', () => {
  it('ما هي أسماء السجلات؟ → رسالة الرفض (لا قائمة سجلات)', () => {
    const r = buildLocalReply('ما هي أسماء السجلات؟', scope({
      sessions: [
        sess('a', 'حضور 24 أغسطس', '2026-08-24'),
        sess('b', 'حضور اليوم', today),
      ],
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('حضور 24 أغسطس');
    expect(r.text).not.toContain('الطالب');
  });

  it('شنو أسماء السجلات؟ بنطاق فارغ → رسالة الرفض', () => {
    const r = buildLocalReply('شنو أسماء السجلات؟', scope());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
  });
});

describe('buildLocalReply — سؤال يوم قديم لا يعطي بطاقة طالب', () => {
  it('يرد بقائمة حضور ذلك اليوم (بدون بطاقة زينب وبدون رسالة مفاتيح AI)', () => {
    const r = buildLocalReply('من حضّر يوم 24 أغسطس 2026؟', scope({
      sessions: [sess('a', 'حضور 24 أغسطس', '2026-08-24')],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).not.toContain('زينب');
    expect(r.text).not.toContain('الطالب:');
    expect(r.text).toContain('لا يوجد حاضرين');
    expect(r.text).not.toContain('مفاتيح AI');
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

  it('سؤال خارج القائمة → رسالة الرفض الموحدة', () => {
    const r = buildLocalReply('كيف حالك', scope());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
  });
});

// ─────────────────────────────────────────────────────────────
// الترقية الكبرى — لغة طبيعية + كل بيانات النظام
// ─────────────────────────────────────────────────────────────

const college = (id: string, name: string): College => ({
  id, name, createdAt: '2026-01-01', createdBy: 'admin',
});

const pharmCollege = college('c1', 'كلية الصيدلة');
const engCollege = college('c2', 'كلية الهندسة');

describe('extractDateQuery — استخراج التاريخ من اللغة الطبيعية', () => {
  it('يعترف صيغ YMD وDMY وأرقام عربية', () => {
    expect(extractDateQuery('إحصايات 2026/09/25')).toBe('2026-09-25');
    expect(extractDateQuery('06/11/2029')).toBe('2029-11-06');
    expect(extractDateQuery('تاريخ ٢٥/٠٩/٢٠٢٦')).toBe('2026-09-25');
    expect(extractDateQuery('24/8/2026')).toBe('2026-08-24');
  });

  it('يعترف الأشهر العربية (24 أغسطس 2026 ← 2026-08-24)', () => {
    expect(extractDateQuery('من حضّر يوم 24 أغسطس 2026؟')).toBe('2026-08-24');
    expect(extractDateQuery('إحصايات 5 سبتمبر')).toBe(new Date().getFullYear() + '-09-05');
  });

  it('يرجع null بلا تاريخ', () => {
    expect(extractDateQuery('كيف حالك')).toBeNull();
    expect(extractDateQuery('ابحث عن محمد')).toBeNull();
    expect(extractDateQuery('منو حضر اليوم؟')).toBeNull();
    expect(extractDateQuery('99/99/9999')).toBeNull();
  });
});

describe('extractGroupToken — استخراج رمز المجموعة', () => {
  it('يقرأ غروب A1 ومنو غاب من a2', () => {
    expect(extractGroupToken('غروب A1')).toBe('A1');
    expect(extractGroupToken('منو غاب من a2 اليوم؟')).toBe('A2');
    expect(extractGroupToken('غروب A1 بتاريخ 2026/09/25')).toBe('A1');
  });

  it('يرجع null بلا رمز مجموعة', () => {
    expect(extractGroupToken('محمد رحيم')).toBeNull();
    expect(extractGroupToken('إحصايات 2026/09/25')).toBeNull();
    expect(extractGroupToken('منو حضر اليوم؟')).toBeNull();
  });
});

describe('buildLocalReply — بوابة ⚡ قبل تحميل البيانات', () => {
  const gated = { colleges: [pharmCollege, engCollege], students: [], records: [], sessions: [] };

  it('اسم طالب قبل ⚡ → رسالة تحميل بدل "بدون مفاتيح"', () => {
    const r = buildLocalReply('محمد ميثم', scope(gated));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('⚡ تحميل بيانات الجامعة');
    expect(r.text).not.toContain('مفاتيح AI');
  });

  it('منو حضر اليوم قبل ⚡ → بوابة التحميل', () => {
    const r = buildLocalReply('منو حضر اليوم؟', scope(gated));
    expect(r.text).toContain('⚡ تحميل بيانات الجامعة');
  });

  it('سؤال كليات قبل ⚡ → بوابة التحميل', () => {
    const r = buildLocalReply('كم كلية عندنا؟', scope(gated));
    expect(r.text).toContain('⚡ تحميل بيانات الجامعة');
    expect(r.text).not.toContain('مفاتيح');
  });

  it('سؤال مراحل قبل ⚡ → بوابة التحميل', () => {
    const r = buildLocalReply('شنو المراحل؟', scope({
      ...gated,
      stages: [{ id: 's1', name: 'المرحلة الأولى', collegeId: 'c1', createdAt: '2026-01-01' }],
    }));
    expect(r.text).toContain('⚡ تحميل بيانات الجامعة');
  });
});

describe('buildLocalReply — إحصايات تاريخ محدد → رسالة الرفض', () => {
  it('إحصايات 06/11/2029 → رسالة الرفض (لا تفصيل ولا مجاميع)', () => {
    const r = buildLocalReply('إحصايات 06/11/2029', scope({
      students: [students[0]!, students[1]!],
      sessions: [sess('d', 'حضور الأربعاء', '2029-11-06')],
      records: [
        rec('r1', students[0]!, 'd', 'present'),
        rec('r2', students[1]!, 'd', 'absent'),
      ],
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('المتوقع');
    expect(r.text).not.toContain('مفاتيح AI');
  });

  it('تاريخ بلا سجلات → رسالة الرفض نفسها', () => {
    const r = buildLocalReply('إحصايات 06/11/2029', scope());
    expect(r.text).toBe(REFUSAL_REPLY);
  });
});

describe('buildLocalReply — المجموعات (غروب A1)', () => {
  it('إحصايات المجموعة العامة (غروب A1) → رسالة الرفض', () => {
    const r = buildLocalReply('غروب A1', scope({
      students: [students[1]!, students[2]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[1]!, 't', 'present')],
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('الطلاب:');
  });

  it('غياب مجموعة اليوم فقط (منو غاب من A2 اليوم) → كشف الغياب', () => {
    const r = buildLocalReply('منو غاب من A2 اليوم؟', scope({
      students: [students[0]!, students[1]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [
        rec('r1', students[0]!, 't', 'absent'),
        rec('r2', students[1]!, 't', 'absent'),
      ],
    }));
    expect(r.text).toContain('غياب');
    expect(r.text).toContain('A2');
    expect(r.text).toContain('ايات علي جبار حسن');
    expect(r.text).not.toContain('أسماء عباس');
  });

  it('غروب بلا نية حضور/غياب → رسالة الرفض', () => {
    const r = buildLocalReply('غروب Z9', scope());
    expect(r.text).toBe(REFUSAL_REPLY);
  });
});

describe('buildLocalReply — أمس', () => {
  it('منو حضر امس؟ → قائم ليوم أمس', () => {
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
    const r = buildLocalReply('منو حضر امس؟', scope({
      students: [students[0]!],
      sessions: [sess('y', 'حضور الأمس', yesterday)],
      records: [rec('r1', students[0]!, 'y', 'present')],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('ايات علي جبار حسن');
    expect(r.text).not.toContain('لا توجد بيانات');
  });
});

describe('buildLocalReply — تجميعات الكليات/المراحل', () => {
  const withStages = () => scope({
    colleges: [pharmCollege, engCollege],
    stagesMap: {
      s5: {
        students: [students[0]!],
        records: [rec('r1', students[0]!, 't', 'present'), rec('r2', students[0]!, 't2', 'absent')],
        sessions: [],
        stageName: 'المرحلة الخامسة',
        collegeName: 'كلية الصيدلة',
      },
      s1: {
        students: [students[1]!],
        records: [rec('r3', students[1]!, 't', 'present')],
        sessions: [],
        stageName: 'المرحلة الأولى',
        collegeName: 'كلية الهندسة',
      },
    },
    stages: [
      { id: 's5', name: 'المرحلة الخامسة', collegeId: 'c1', createdAt: '2026-01-01' },
      { id: 's1', name: 'المرحلة الأولى', collegeId: 'c2', createdAt: '2026-01-01' },
    ],
  });

  it('إحصايات كلية الصيدلة → رسالة الرفض', () => {
    const r = buildLocalReply('إحصايات كلية الصيدلة', withStages());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
  });

  it('أكثر الكليات حضوراً → رسالة الرفض', () => {
    const r = buildLocalReply('منو أكثر الكليات حضوراً؟', withStages());
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('الصيادلة');
  });

  it('إحصايات عامه → رسالة الرفض', () => {
    const r = buildLocalReply('إحصايات عامه', withStages());
    expect(r.text).toBe(REFUSAL_REPLY);
  });

  it('إحصايات مرحلة محددة → رسالة الرفض', () => {
    const r = buildLocalReply('إحصايات المرحلة الخامسة', withStages());
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('✅ 1');
  });
});

describe('buildLocalReply — بطاقة الطالب الجديدة', () => {
  it('كود الطالب "صاحب الكود 123456" → بطاقة', () => {
    const rich: Student = { id: 'r1', name: 'مجتبى هيثم محمد', code: '123456', group: 'B1', createdAt: '2026-01-01' };
    const r = buildLocalReply('صاحب الكود 123456', scope({ students: [rich] }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('مجتبى هيثم محمد');
    expect(r.text).toContain('الطالب:');
  });

  it('اسم جزئي "مجتبى هيثم" → بطاقة كاملة مع سطر المرحلة', () => {
    const rich: Student = { id: 'r1', name: 'مجتبى هيثم محمد', code: '123456', group: 'B1', createdAt: '2026-01-01' };
    const r = buildLocalReply('مجتبى هيثم', scope({
      students: [rich],
      stagesMap: {
        s5: {
          students: [rich],
          records: [rec('r', rich, 't', 'present')],
          sessions: [sess('t', 'حضور اليوم', today)],
          stageName: 'المرحلة الخامسة',
          collegeName: 'كلية الصيدلة',
        },
      },
    }));
    expect(r.text).toContain('الطالب:');
    expect(r.text).toContain('مجتبى هيثم محمد');
    expect(r.text).toContain('كل السجلات');
    expect(r.text).toContain('المرحلة الخامسة');
    expect(r.text).toContain('كلية الصيدلة');
  });

  it('اسمه/منو تُعتبر أفعال بحث', () => {
    expect(pickBestStudentMatch('اسمه محمد', students)?.id).toBe('s4');
    expect(pickBestStudentMatch('منو محمد', students)?.id).toBe('s4');
  });
});

describe('buildLocalReply — عدّاد الطلاب → رسالة الرفض', () => {
  it('كم طلابنا؟ → رسالة الرفض (لا عدّ)', () => {
    const r = buildLocalReply('كم طلابنا؟', scope({ students }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('عدد الطلاب');
  });

  it('عدد الطلاب في كل مرحلة → رسالة الرفض', () => {
    const r = buildLocalReply('عدد الطلاب في كل مرحلة', scope({
      students,
      stagesMap: {
        s5: { students: [students[0]!], records: [], sessions: [], stageName: 'المرحلة الخامسة', collegeName: 'كلية الصيدلة' },
        s1: { students: [students[1]!], records: [], sessions: [], stageName: 'المرحلة الأولى', collegeName: 'كلية الهندسة' },
      },
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('👨‍🎓 1');
  });
});

describe('buildLocalReply — لا تظهر رسالة مفاتيح AI أبداً', () => {
  const battery = [
    'كيف حالك',
    'xyzzy بلا إجابة',
    'ابحث عن غير موجود',
    'منو غاب امس؟',
    'ميتا جي بي تي',
    'عسك',
  ];
  it('لا رد من المحرك يحتوي "بدون مفاتيح AI"', () => {
    battery.forEach(q => {
      const r = buildLocalReply(q, scope({ colleges: [pharmCollege] }));
      expect(r.text).not.toContain('مفاتيح AI');
      expect(r.text).not.toContain('بدون مفاتيح');
    });
  });

  it('نطاق عادي فارغ → رسالة الرفض بلا ذكر AI', () => {
    const r = buildLocalReply('xyzzy بلا إجابة', scope());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('AI');
    expect(r.text).not.toContain('غروب A1');
  });
});

describe('buildLocalReply — إصلاحات الأسئلة الحية', () => {
  it('"كم طالب في هذه المرحلة؟" داخل مرحلة → رسالة الرفض', () => {
    const r = buildLocalReply('كم طالب في هذه المرحلة؟', scope({
      students,
      stageName: 'المرحلة الثانية',
      collegeName: 'الصيدلة',
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('📚 المراحل');
    expect(r.text).not.toContain('عدد الطلاب');
  });

  it('إحصايات باسم كلية مباشرة بدون كلمة "كلية" → رسالة الرفض', () => {
    const r = buildLocalReply('إحصايات الصيدلة', scope({
      colleges: [college('c1', 'الصيدلة')],
      students,
      stagesMap: {
        s5: { students: [students[0]!], records: [], sessions: [], stageName: 'المرحلة الخامسة', collegeName: 'الصيدلة' },
      },
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('المرحلة الخامسة');
  });

  it('صاحب كود غير موجود → رد محدد لا دليل عام', () => {
    const r = buildLocalReply('صاحب الكود 999999', scope({ students }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('ما لقيت طالب بالكود 999999');
    expect(r.text).not.toContain('ما لقيت جواب مباشر');
  });

  it('بحث عن اسم غير موجود → رد محدد لا دليل عام', () => {
    const r = buildLocalReply('ابحث عن غير موجود', scope({ students }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('ما لقيت طالب');
    expect(r.text).not.toContain('ما لقيت جواب مباشر');
  });

  it('سؤال مركب: يجيب بقائمة الغياب فقط (بدون عدد الطلاب)', () => {
    const r = buildLocalReply('شكد طالب بالمرحلة الخامسة وشكد غاب اليوم؟', scope({
      students,
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'absent')],
      stagesMap: {
        s5: {
          students: [students[0]!, students[1]!],
          records: [rec('r1', students[0]!, 't', 'absent')],
          sessions: [sess('t', 'حضور اليوم', today)],
          stageName: 'المرحلة الخامسة',
          collegeName: 'كلية الصيدلة',
        },
      },
    }));
    expect(r.handled).toBe(true);
    expect(r.text).not.toContain('عدد الطلاب');
    expect(r.text).toContain('غياب');
    expect(r.text).toContain('ايات علي جبار حسن');
  });

  it('داخل مرحلة مع stagesMap كامل → "كم طالب" رسالة الرفض', () => {
    const inStage = () => scope({
      students: [students[0]!, students[1]!],
      stageName: 'المرحلة الخامسة',
      collegeName: 'كلية الصيدلة',
      stagesMap: {
        s5: { students: [students[0]!, students[1]!], records: [], sessions: [], stageName: 'المرحلة الخامسة', collegeName: 'كلية الصيدلة' },
        s1: { students: [students[2]!], records: [], sessions: [], stageName: 'المرحلة الأولى', collegeName: 'كلية الهندسة' },
      },
    });
    const r = buildLocalReply('كم طالب في هذه المرحلة؟', inStage());
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('**2**');
    expect(r.text).not.toContain('المرحلة الأولى');
  });

  it('"عدد الطلاب في كل مرحلة" داخل مرحلة → رسالة الرفض', () => {
    const r = buildLocalReply('عدد الطلاب في كل مرحلة', scope({
      students: [students[0]!, students[1]!],
      stageName: 'المرحلة الخامسة',
      collegeName: 'كلية الصيدلة',
      stagesMap: {
        s5: { students: [students[0]!, students[1]!], records: [], sessions: [], stageName: 'المرحلة الخامسة', collegeName: 'كلية الصيدلة' },
        s1: { students: [students[2]!], records: [], sessions: [], stageName: 'المرحلة الأولى', collegeName: 'كلية الهندسة' },
      },
    }));
    expect(r.handled).toBe(false);
    expect(r.text).toBe(REFUSAL_REPLY);
    expect(r.text).not.toContain('المرحلة الأولى');
  });

  it('بادئة كود لا يطابق طالباً آخر (123456 vs 1234)', () => {
    const other: Student = { id: 'p1', name: 'حوراء ماجد', code: '1234', group: 'A1', createdAt: '2026-01-01' };
    const r = buildLocalReply('صاحب الكود 123456', scope({ students: [other] }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('ما لقيت طالب بالكود 123456');
    expect(r.text).not.toContain('حوراء');
  });
});

describe('extractAcademicCode — الكود الأكاديمي (4 أرقام)', () => {
  it('مفرد 4 أرقام خارج سياق التاريخ', () => {
    expect(extractAcademicCode('5038')).toBe('5038');
    expect(extractAcademicCode('ما كود 5038؟')).toBe('5038');
    expect(extractAcademicCode('صاحب الكود 123456')).toBe('123456');
  });

  it('لا يستخرج رقم من سياق التاريخ', () => {
    expect(extractAcademicCode('من حضّر يوم 24 أغسطس 2026؟')).toBeUndefined();
    expect(extractAcademicCode('إحصايات 06/11/2029')).toBeUndefined();
    expect(extractAcademicCode('2026/09/25')).toBeUndefined();
  });

  it('بلا أرقام → undefined', () => {
    expect(extractAcademicCode('منو حضر اليوم؟')).toBeUndefined();
  });
});

describe('buildLocalReply — الوضع الصارم: تقرير طالب + كشف اليوم فقط', () => {
  it('كود أكاديمي مفرد (4 أرقام) بدون كلمة "كود" → تقرير الطالب باسم السجل', () => {
    const r = buildLocalReply('5038', scope({
      students,
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'present')],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('الطالب:');
    expect(r.text).toContain('ايات علي جبار حسن');
    expect(r.text).toContain('✅');   // حضور — يُعرض بالأخضر
    expect(r.text).toContain('حضور اليوم'); // ذكر اسم السجل
  });

  it('غياب الطالب يظهر بعلامة ❌ باسم السجل (يُعرض بالأحمر)', () => {
    const r = buildLocalReply('ايات', scope({
      students: [students[0]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [rec('r1', students[0]!, 't', 'absent')],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('❌');
    expect(r.text).toContain('حضور اليوم');
  });

  it('كود مفرد غير موجود → رد الكود غير الموجود لا رسالة الرفض', () => {
    const r = buildLocalReply('9999', scope({ students }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('ما لقيت طالب بالكود 9999');
    expect(r.text).not.toBe(REFUSAL_REPLY);
  });

  it('"منو حضر اليوم ومنو غاب اليوم" → القائمتان معاً', () => {
    const r = buildLocalReply('منو حضر اليوم ومنو غاب اليوم؟', scope({
      students: [students[0]!, students[1]!],
      sessions: [sess('t', 'حضور اليوم', today)],
      records: [
        rec('r1', students[0]!, 't', 'present'),
        rec('r2', students[1]!, 't', 'absent'),
      ],
    }));
    expect(r.handled).toBe(true);
    expect(r.text).toContain('حضور اليوم');
    expect(r.text).toContain('غياب اليوم');
    expect(r.text).toContain('ايات علي جبار حسن');
    expect(r.text).toContain('أسماء عباس');
  });

  it('كل ما عدا الأسئلة الثلاثة → رسالة الرفض الموحدة', () => {
    const scopeWith = scope({ students, colleges: [pharmCollege] });
    const others = [
      'كم طلابنا؟',
      'إحصايات اليوم',
      'كم كلية عندنا؟',
      'إحصايات كلية الصيدلة',
      'منو أكثر الكليات حضوراً؟',
      'شنو أسماء السجلات؟',
      'من صمم الموقع؟',
      'شو الطقس اليوم',
      'غروب A1',
      'إحصايات 2026/09/25',
    ];
    others.forEach(q => {
      const r = buildLocalReply(q, scopeWith);
      expect(r.text, q).toBe(REFUSAL_REPLY);
    });
  });

  it('رسالة الرفض لا تحتوي أي ذكر لمفاتيح AI', () => {
    const r = buildLocalReply('شو الطقس اليوم', scope({ students }));
    expect(r.text).not.toContain('مفاتيح');
    expect(r.text).not.toContain('AI');
  });
});
