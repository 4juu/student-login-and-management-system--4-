import { describe, it, expect } from 'vitest';
import { FaceTracker, type TrackBox } from '../tracker';
import { buildGallery, findDuplicateIds, findBestMatchConsensus } from '../gallery';
import { DESC_DIM, MATCH_LOOSE, l2Normalize, minDistanceToAny } from '../descriptors';
import {
  auditFaceDescriptors,
  findRosterDuplicateIds,
  minSampleDistance,
  auditIssuesToCsv,
  MIN_HEALTHY_SAMPLES,
} from '../../../lib/faceAudit';

// ─────────────────────────── أدوات بناء المتجهات ───────────────────────────
function makeVec(seed: number, dim = DESC_DIM): Float32Array {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const f = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const v = rand() * 2 - 1;
    f[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) f[i] = f[i]! / norm;
  return f;
}

const arr = (f: Float32Array): number[] => Array.from(f);

function orthogonalTo(v: Float32Array, seed: number): Float32Array {
  const u = makeVec(seed);
  let dot = 0;
  for (let i = 0; i < DESC_DIM; i++) dot += (u[i] ?? 0) * (v[i] ?? 0);
  const out = new Float32Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = (u[i] ?? 0) - dot * (v[i] ?? 0);
  return l2Normalize(out);
}

function blend(a: Float32Array, b: Float32Array, beta: number): Float32Array {
  const out = new Float32Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = (a[i] ?? 0) + beta * (b[i] ?? 0);
  return l2Normalize(out);
}

/** 7 زوايا خفيفة التباين لمتطابق واحد (بصمة سليمة) */
function cleanEnrollment(seed: number): number[][] {
  const base = makeVec(seed);
  return Array.from({ length: 7 }, (_, i) => arr(blend(base, orthogonalTo(base, seed + 500 + i), 0.06 + i * 0.01)));
}

const box = (x = 100, y = 100, w = 120, h = 120): TrackBox => ({ x, y, width: w, height: h });

// ═══════════════ 1) عدّاد التأكيد = عدّاد ثبات لا عدّاد إطارات ═══════════════
describe('tracker.bumpConfirm — عدّاد ثبات حقيقي', () => {
  it('يزداد عدّاد التأكيد على نفس الطالب عبر الإطارات', () => {
    const t = new FaceTracker();
    const id = t.update([box()])[0]!.trackId;
    expect(t.bumpConfirm(id, 'A')).toBe(1);
    expect(t.bumpConfirm(id, 'A')).toBe(2);
    expect(t.bumpConfirm(id, 'A')).toBe(3);
  });

  it('يتجاهل الكاش: setCache بمعرّف آخر لا يجعل المقارنة تمرّ', () => {
    const t = new FaceTracker();
    const id = t.update([box()])[0]!.trackId;
    expect(t.bumpConfirm(id, 'A')).toBe(1);
    // هذه هي العلة القديمة: الكاش يُكتب قبل الفحص فينجح 항상
    t.setCache(id, 'B', 90, 0.1, 0.2, 3);
    expect(t.bumpConfirm(id, 'A')).toBe(2);
    // تبدّل الهوية ⇒ العدّاد يبدأ من 1 لا يكمل
    t.setCache(id, 'B', 90, 0.1, 0.2, 3);
    expect(t.bumpConfirm(id, 'B')).toBe(1);
  });

  it('يصفّر العدّاد بعد أكثر من 3 تبدّلات (حماية تبدّل الهوية تعمل)', () => {
    const t = new FaceTracker();
    const id = t.update([box()])[0]!.trackId;
    t.bumpConfirm(id, 'A');
    t.bumpConfirm(id, 'B');
    t.bumpConfirm(id, 'A');
    t.bumpConfirm(id, 'B');
    // التبدّل الرابع => تصفير
    expect(t.bumpConfirm(id, 'A')).toBe(0);
  });
});

// ═══════════════ 2) عدم وراثة الهوية بعد اختفاء المسار ═══════════════
describe('tracker — إعادة الالتقاط لا ترث هوية الوجه السابق', () => {
  it('يصفّر أدلة الهوية بعد اختفاء المسار إطارين', () => {
    const t = new FaceTracker();
    const created = t.update([box()])[0]!;
    const id = created.trackId;
    t.addEmbedding(id, makeVec(1), performance.now());
    t.addEmbedding(id, makeVec(2), performance.now());
    expect(t.bumpConfirm(id, 'A')).toBe(1);
    expect(t.bumpConfirm(id, 'A')).toBe(2);

    // وجه يختفي إطارين ثم يعود
    t.update([]);
    t.update([]);
    const again = t.update([box()])[0]!;
    expect(again.trackId).toBe(id);

    // الأدلة صُفّرت: لا إطارات قديمة ولا عدّاد
    expect(t.getQueries(id).length).toBe(0);
    expect(t.bumpConfirm(id, 'B')).toBe(1);
  });

  it('لا يرث مسارٌ جديدٌ مخزن إطارات الوجه القديم عند التداخل', () => {
    const t = new FaceTracker();
    const first = t.update([box(100, 100)])[0]!.trackId;
    t.addEmbedding(first, makeVec(7), performance.now());
    t.addEmbedding(first, makeVec(8), performance.now());

    // وجه آخر بعيد تماماً => مسار جديد بمعرّف جديد
    const second = t.update([box(600, 500)])[0]!;
    expect(second.trackId).not.toBe(first);
    expect(t.getQueries(second.trackId).length).toBe(0);
  });
});

// ═══════════════ 3) إطاران متفقان دائماً + تكرار المعرّفات ═══════════════
describe('المعرض — إجماع إطارين + تكرار المعرّفات', () => {
  const enrollA = cleanEnrollment(80);
  const roster = [
    { id: 'a', name: 'طالب أ', faceDescriptor: { version: 5, enrollment: enrollA } },
    { id: 'b', name: 'طالب ب', faceDescriptor: { version: 5, enrollment: cleanEnrollment(900) } },
  ];
  const frameA1 = makeVec(80);
  const frameA2 = Float32Array.from(enrollA[3]!);

  it('إطار واحد لا يحسم الهوية', () => {
    const g = buildGallery(roster);
    expect(findBestMatchConsensus([frameA1], g, MATCH_LOOSE)).toBeNull();
  });

  it('إطاران متفقان يحسمان الهوية', () => {
    const g = buildGallery(roster);
    const m = findBestMatchConsensus([frameA1, frameA2], g, MATCH_LOOSE);
    expect(m).not.toBeNull();
    expect(m!.item.id).toBe('a');
  });

  it('findDuplicateIds يكشف السجلّين بنفس المعرّف', () => {
    expect(findDuplicateIds([{ id: 'x' }, { id: 'x' }, { id: 'y' }])).toEqual(['x']);
    expect(findDuplicateIds([{ id: 'x' }, { id: 'y' }])).toEqual([]);
  });

  it('buildGallery يبني مدخلاً واحداً للمعرّف المكرّر (الأول فقط)', () => {
    const dup = [
      { id: 'x', name: 'سجل أول', faceDescriptor: { version: 5, enrollment: cleanEnrollment(11) } },
      { id: 'x', name: 'سجل ثانٍ', faceDescriptor: { version: 5, enrollment: cleanEnrollment(22) } },
    ];
    expect(buildGallery(dup).length).toBe(1);
  });
});

// ═══════════════ 4) بوابة اتساق الالتقاط (شخص ثانٍ vs زاوية أخرى) ═══════════════
describe('minDistanceToAny — أساس بوابة اتساق العينات', () => {
  it('زاوية أخرى لنفس الشخص = قريبة من أقرب عينة (تُقبل)', () => {
    const base = makeVec(41);
    const previous = [
      Float32Array.from(blend(base, orthogonalTo(base, 1), 0.05)),
      Float32Array.from(blend(base, orthogonalTo(base, 2), 0.07)),
    ];
    const nextAngle = blend(base, orthogonalTo(base, 3), 0.30);
    expect(minDistanceToAny(nextAngle, previous)).toBeLessThan(0.35);
  });

  it('شخص مختلف = بعيد عن كل العيّنات (يُرفض)', () => {
    const base = makeVec(42);
    const previous = [
      Float32Array.from(blend(base, orthogonalTo(base, 1), 0.05)),
      Float32Array.from(blend(base, orthogonalTo(base, 2), 0.07)),
    ];
    const other = makeVec(4321);
    expect(minDistanceToAny(other, previous)).toBeGreaterThan(0.9);
  });
});

// ═══════════════ 5) تدقيق البصمات (لوحة التدقيق) ═══════════════
describe('auditFaceDescriptors — تدقيق بصمات المرحلة', () => {
  it('قائمة نظيفة => بلا ملاحظات', () => {
    const a = auditFaceDescriptors([
      { id: '1', name: 'سالم', faceDescriptor: { version: 5, enrollment: cleanEnrollment(21) } },
      { id: '2', name: 'هند', faceDescriptor: { version: 5, enrollment: cleanEnrollment(77) } },
    ]);
    expect(a.issues).toHaveLength(0);
    expect(a.withFace).toBe(2);
  });

  it('يكشف المعرّف المكرّر', () => {
    const ids = findRosterDuplicateIds([
      { id: '1', name: 'أ' },
      { id: '1', name: 'ب' },
    ]);
    expect(ids).toEqual(['1']);
    const a = auditFaceDescriptors([
      { id: '1', name: 'أ', faceDescriptor: { version: 5, enrollment: cleanEnrollment(5) } },
      { id: '1', name: 'ب', faceDescriptor: { version: 5, enrollment: cleanEnrollment(6) } },
    ]);
    expect(a.issues.some(i => i.kind === 'duplicate-id')).toBe(true);
    expect(a.affectedIds).toContain('1');
  });

  it('لا يرفض عيّنة بُعدت عن سابقاتها (فحص الانحراف مُلغى — الانحراف طبيعي لنفس الشخص)', () => {
    const base = makeVec(31);
    const enrollment = [
      ...Array.from({ length: 6 }, (_, i) => arr(blend(base, orthogonalTo(base, 900 + i), 0.05))),
      arr(makeVec(999)), // عينة بعيدة جداً — لا تُمنع بعد الإلغاء
    ];
    const a = auditFaceDescriptors([{ id: '9', name: 'بعيدة', faceDescriptor: { version: 5, enrollment } }]);
    expect(a.issues).toHaveLength(0);
    expect(a.affectedIds).not.toContain('9');
  });

  it('يكشف البصمة الضعيفة (عيّنات قليلة)', () => {
    const enrollment = cleanEnrollment(44).slice(0, MIN_HEALTHY_SAMPLES - 1);
    const a = auditFaceDescriptors([{ id: '5', name: 'ضعيف', faceDescriptor: { version: 5, enrollment } }]);
    expect(a.issues.some(i => i.kind === 'weak-samples')).toBe(true);
  });

  it('يكشف الوجه المسجّل لطالبين (وجهان متشابهان)', () => {
    const enrollment = cleanEnrollment(66);
    const a = auditFaceDescriptors([
      { id: 'a', name: 'طالب أ', faceDescriptor: { version: 5, enrollment: enrollment.map(e => [...e]) } },
      { id: 'b', name: 'طالب ب', faceDescriptor: { version: 5, enrollment: enrollment.map(e => [...e]) } },
    ]);
    const pair = a.issues.find(i => i.kind === 'similar-face');
    expect(pair).toBeTruthy();
    expect(pair!.studentIds).toEqual(['a', 'b']);
    expect(minSampleDistance(
      enrollment.map(e => Float32Array.from(e)),
      enrollment.map(e => Float32Array.from(e)),
    )).toBeLessThan(0.15);
  });

  it('يتجاهل الطلاب بلا بصمة', () => {
    const a = auditFaceDescriptors([{ id: '1', name: 'بلا بصمة' }]);
    expect(a.issues).toHaveLength(0);
    expect(a.withFace).toBe(0);
  });

  it('يصدّر CSV يحتوي العناوين والنتائج', () => {
    const a = auditFaceDescriptors([
      { id: 'z', name: 'متطابقان', faceDescriptor: { version: 5, enrollment: cleanEnrollment(88) } },
      { id: 'z', name: 'متطابقان٢', faceDescriptor: { version: 5, enrollment: cleanEnrollment(89) } },
    ]);
    const csv = auditIssuesToCsv(a);
    expect(csv).toContain('النوع');
    expect(csv).toContain('معرّف مكرر');
  });
});
