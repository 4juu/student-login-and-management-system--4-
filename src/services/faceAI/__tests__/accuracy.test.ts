import { describe, it, expect, beforeEach } from 'vitest';
import { measureAccuracy } from '../accuracy';
import { buildGalleryIndex } from '../gallery';
import { DESC_VERSION_GALLERY } from '../descriptors';
import { clearNearMissLog, getNearMissSummary, recordRejection } from '../nearMiss';
import { findBestMatchIndexed } from '../gallery';

const DIM = 512;

/** متجه على دائرة الوحدة بزاوية محدّدة (المسافة = 1 − cos) */
function angleVec(deg: number): Float32Array {
  const t = (deg * Math.PI) / 180;
  const v = new Float32Array(DIM);
  v[0] = Math.cos(t);
  v[1] = Math.sin(t);
  return v;
}

function makeStudent(id: string, name: string, angles: number[]) {
  return {
    id,
    name,
    faceDescriptor: {
      version: DESC_VERSION_GALLERY,
      enrollment: angles.map(a => Array.from(angleVec(a))),
      clusters: [],
      samples: angles.length,
      quality: 0.8,
    },
  };
}

describe('م7 — مُقايِس الدقة (leave-one-out)', () => {
  it('بيانات منفصلة تماماً: القبول الصحيح 100٪ بلا قبول خاطئ', () => {
    const students = [
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
      makeStudent('c', 'طالب ج', [116, 118, 120, 122, 124]),
    ];
    const report = measureAccuracy(students);
    expect(report.students).toBe(3);
    expect(report.probes).toBe(15);
    expect(report.far).toBe(0);
    expect(report.purity).toBe(1);
  });

  it('طالبان متقاربان جداً: يكشف التداخل (قبول خاطئ أو رفض توأم) لا يتجاهله', () => {
    const students = [
      makeStudent('a', 'طالب أ', [-2, -1, 0, 1, 2]),
      makeStudent('b', 'طالب ب', [-1, 0, 1, 2, 3]),
    ];
    const report = measureAccuracy(students);
    expect(report.probes).toBe(10);
    // التداخل يجب أن ينكشف: إما قبول خاطئ أو رفض بسبب توأم
    expect(report.far + report.frr).toBeGreaterThan(0);
    expect(report.caveat).toContain('Train-on-test');
  });

  it('leave-one-out حقيقي: العيّنة مستبعدة من معرض الهدف', () => {
    // طالب واحد بعينتين متباعدتين — بدون LOO ستُقبل العيّنة الثانية تفائلاً،
    // وبـ LOO تُستبعد فيصبح المعرض من عيّنة واحدة فقط
    const students = [makeStudent('a', 'طالب أ', [0, 40])];
    const report = measureAccuracy(students);
    expect(report.students).toBe(1);
    expect(report.probes).toBe(2);
    // العيّنة الثانية (40°) بعيدة عن الأولى (0°) — مع LOO تُرفض لأنها بعيدة عن المعرض
    expect(report.frr).toBeGreaterThan(0);
  });

  it('طالب واحد فقط: يُقاس فقط ولا ينسب خطأ لنفسه', () => {
    const report = measureAccuracy([makeStudent('a', 'طالب أ', [-3, 0, 3, 6])]);
    expect(report.students).toBe(1);
    expect(report.far).toBe(0);
    expect(report.probes).toBe(4);
  });

  it('قائمة الطلاب: تقرير فارغ آمن', () => {
    const report = measureAccuracy([]);
    expect(report.students).toBe(0);
    expect(report.purity).toBe(1);
    expect(report.meetsTarget).toBe(false);
  });

  it('يستخدم الملف المُعايَر من بيانات الطلاب نفسها', () => {
    const students = [
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
    ];
    const index = buildGalleryIndex(students);
    const report = measureAccuracy(students, { profile: index.profile, dangerKeys: index.dangerKeys });
    expect(report.far).toBe(0);
  });
});

describe('م6 — سجل الأخطاء القريبة', () => {
  beforeEach(() => clearNearMissLog());

  it('يبدأ فارغاً', () => {
    const s = getNearMissSummary();
    expect(s.total).toBe(0);
    expect(s.topSuspects).toHaveLength(0);
  });

  it('يسجّل الرفض مع أقرب طالب وسببه', () => {
    const gallery = buildGalleryIndex([
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
    ]);
    // استعلام لا يطابق أحداً
    const probe = angleVec(180);
    const result = findBestMatchIndexed(probe, gallery.items, 0.42, 0.7, {
      profile: gallery.profile,
      dangerKeys: gallery.dangerKeys,
    });
    expect(result).toBeNull();
    const entry = recordRejection();
    expect(entry).not.toBeNull();
    expect(entry!.reason).toBe('all-too-far');
    expect(entry!.candidates).toBe(2);
    expect(getNearMissSummary().total).toBe(1);
  });

  it('يرتّب أكثر الطلاب إلقاءً للخلط', () => {
    const gallery = buildGalleryIndex([
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
    ]);
    const probe = angleVec(180);
    for (let i = 0; i < 3; i++) {
      findBestMatchIndexed(probe, gallery.items, 0.42, 0.7, { profile: gallery.profile });
      recordRejection();
    }
    const s = getNearMissSummary();
    expect(s.topSuspects.length).toBeGreaterThan(0);
    expect(s.topSuspects[0]!.misses).toBeGreaterThanOrEqual(3);
  });
});
