// ─────────────────────────────────────────────────────────────
// مُقايِس دقة المطابقة (leave-one-out) — قياس 99٪/1٪ بالأرقام
//
// الهدف: تحويل «الدقة 99٪» من دعوى إلى رقم مقيس. يعمل على بيانات
// موجودة فعلياً (عينات التسجيل) بلا حاجة تسجيل جديد.
//
// المنهجية — لكل طالب X:
//   ① FAR/TAR: كل عيّنة من عينات X تُطابَق على معرض مبني من *بقية* الطلاب.
//      قبول شخص آخر هنا = خطأ قاطع (false accept).
//   ② في المعرض الكامل يجب أن يفوز X هو بالضبط، وإلا خطأ هوية.
//   ③ FRR: رفض X نفسه despite أنه في المعرض.
//
// تحذير منهجي: عينات التسجيل هي نفسها عيّنات بناء المعرض، فالمقياس
// Train-on-test والأرقام *متفائلة*. يكشف انحياز عدد العينات وفشل
// التصويت النسبّي، لكنه لا يثبت نسبة 99٪ في العالم الحقيقي — لذلك
// يبقى سجل near-miss المرافق ضرورياً للقياس الميداني.
// ─────────────────────────────────────────────────────────────
import {
  buildGallery,
  decisionDistance,
  excludeSampleFromItem,
  findBestMatchIndexed,
  getLastRejection,
  type MatchOptions,
  type MatchProfile,
} from './gallery';
import { descriptorDistance, RECOG_MATCH_K } from './descriptors';

export interface AccuracyReport {
  students: number;
  probes: number;
  /** True Accept Rate — القبول الصحيح */
  tar: number;
  /** False Accept Rate — قبول شخص آخر */
  far: number;
  /** False Reject Rate — رفض الشخص الصحيح */
  frr: number;
  /** 1 − FAR — نقاء النظام */
  purity: number;
  /** هل يحقق الهدف (افتراضي 99٪) */
  meetsTarget: boolean;
  /** أسوأ الطلاب — يحتاجون إعادة تسجيل */
  worstStudents: Array<{
    id: string;
    name: string;
    rejectRate: number;
    /** متوسط مسافة القرار الذاتية (تشتّت الطالب مع نفسه) */
    avgDistance: number;
    /** مسافة أقرب توأم عند الرفض بسبب التداخل — التشخيص الحقيقي */
    twinDistance?: number | undefined;
  }>;
  /** توزيع أسباب الرفض */
  reasons: Record<string, number>;
  /** تحذير منهجي */
  caveat: string;
}

export interface AccuracyOptions {
  profile?: MatchProfile | undefined;
  dangerKeys?: ReadonlySet<string> | undefined;
  /** نسبة القبول المستهدفة */
  target?: number | undefined;
}
export const ACCURACY_CAVEAT =
  'يقيس عيّنات التسجيل الحقيقية بمنهج leave-one-out (كل عيّنة تُستبعد من معرضها قبل اختبارها). العناقيد مشتقة من هذه العيّنات فتبقى الأرقام تقديرية — القياس الميداني النهائي عبر سجل الأخطاء القريبة بعد الاستخدام.';

/** يطابق قيد buildGallery تماماً (exactOptionalPropertyTypes) */
type StudentLike = { id: string; name?: string; faceDescriptor?: unknown };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function measureAccuracy(
  students: StudentLike[],
  options?: AccuracyOptions,
): AccuracyReport {
  const target = options?.target ?? 0.99;
  const reasons: Record<string, number> = {};
  const bump = (k: string) => { reasons[k] = (reasons[k] ?? 0) + 1; };

  const gallery = buildGallery(students);
  if (gallery.length === 0) {
    return {
      students: 0, probes: 0, tar: 0, far: 0, frr: 0, purity: 1, meetsTarget: false,
      worstStudents: [], reasons, caveat: ACCURACY_CAVEAT,
    };
  }

  // exactOptionalPropertyTypes: نبني الخيارات تدريجياً
  const opts: MatchOptions = {};
  if (options?.profile) opts.profile = options.profile;
  if (options?.dangerKeys) opts.dangerKeys = options.dangerKeys;

  let correct = 0;
  let falseAccept = 0;
  let selfReject = 0;
  let probes = 0;
  const perStudent: Array<{ id: string; name: string; rejects: number; total: number; distSum: number; twinDist: number }> = [];

  for (const targetItem of gallery) {
    const withoutSelf = buildGallery(students.filter(s => s.id !== targetItem.id));
    // نختبر عيّنات التسجيل الحقيقية فقط — العناقيد مشتقة منها (متوسطات) فلا
    // تُحسب probes مستقلة؛ هذا أصدق قياس للزوايا التي التقطها الطالب فعلاً.
    const selfSamples: Float32Array[] =
      targetItem.enrollment && targetItem.enrollment.length > 0
        ? targetItem.enrollment
        : targetItem.allSamples;
    let rejects = 0;
    let distSum = 0;
    let twinDist = Infinity;

    for (const probe of selfSamples) {
      probes += 1;
      distSum += decisionDistance(
        selfSamples.map(s => descriptorDistance(probe, s)).sort((a, b) => a - b),
        RECOG_MATCH_K,
      );

      // ① FAR نظيف: لا يقبل أي طالب آخر من معرض بلا هو
      if (withoutSelf.length > 0) {
        const impostor = findBestMatchIndexed(probe, withoutSelf, 0.42, 0.7, opts);
        if (impostor) {
          falseAccept += 1;
          bump('false-accept');
          continue;
        }
      }

      // ② LOO حقيقي: العيّنة مستبعدة من معرض الهدف — لا تفاؤل train-on-test
      const targetWithout = excludeSampleFromItem(targetItem, probe);
      const looGallery = targetWithout.allSamples.length > 0
        ? [...withoutSelf, targetWithout]
        : withoutSelf;
      const genuine = findBestMatchIndexed(probe, looGallery, 0.42, 0.7, opts);
      if (genuine && genuine.item.id === targetItem.id) {
        correct += 1;
      } else {
        rejects += 1;
        selfReject += 1;
        const reason = getLastRejection()?.reason ?? 'rejected';
        if (reason === 'tight-margin' || reason === 'danger-pair') {
          bump('twin-reject');
          twinDist = Math.min(twinDist, genuine?.distance ?? Infinity);
        } else {
          bump('far-reject');
        }
      }
    }

    perStudent.push({
      id: targetItem.id,
      name: targetItem.name ?? targetItem.id,
      rejects,
      total: selfSamples.length,
      distSum: selfSamples.length > 0 ? distSum / selfSamples.length : 0,
      twinDist,
    });
  }

  const tar = probes > 0 ? correct / probes : 0;
  const far = probes > 0 ? falseAccept / probes : 0;
  const frr = probes > 0 ? selfReject / probes : 0;
  const purity = 1 - far;

  const worstStudents = perStudent
    .map(s => ({
      id: s.id,
      name: s.name,
      rejectRate: s.total > 0 ? round3(s.rejects / s.total) : 0,
      avgDistance: round3(s.distSum),
      twinDistance: Number.isFinite(s.twinDist) ? round3(s.twinDist) : undefined,
    }))
    .filter(s => s.rejectRate > 0)
    .sort((a, b) => b.rejectRate - a.rejectRate)
    .slice(0, 5);

  return {
    students: gallery.length,
    probes,
    tar: round3(tar),
    far: round3(far),
    frr: round3(frr),
    purity: round3(purity),
    meetsTarget: far <= round3(1 - target) && tar >= round3(target),
    worstStudents,
    reasons,
    caveat: ACCURACY_CAVEAT,
  };
}
