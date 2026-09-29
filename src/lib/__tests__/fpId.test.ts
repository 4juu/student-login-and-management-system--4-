import { describe, it, expect } from 'vitest';
import { computeFpId, computeFpIds } from '../fpId';
import { DESC_VERSION_GALLERY } from '../../services/faceAI/descriptors';

function makeDescriptor(seed: number, clusters?: unknown) {
  const enrollment: number[][] = [];
  for (let s = 0; s < 5; s++) {
    const v: number[] = [];
    for (let i = 0; i < 64; i++) v.push(Math.sin(seed * 100 + s * 7 + i * 0.3));
    enrollment.push(v);
  }
  return { version: DESC_VERSION_GALLERY, enrollment, clusters: clusters ?? [], samples: 5, quality: 0.8 };
}

describe('computeFpId — رقم البصمة الفريد', () => {
  it('يعيد رقماً رقمياً من 10 خانات', () => {
    const id = computeFpId(makeDescriptor(1));
    expect(id).not.toBeNull();
    expect(id!).toMatch(/^\d{10}$/);
  });

  it('ثابت حتمياً لنفس المدخلات', () => {
    const a = computeFpId(makeDescriptor(2));
    const b = computeFpId(makeDescriptor(2));
    expect(a).toBe(b);
  });

  it('لا يتأثر بتغيّر العناقيد أو الجودة (يُشتق من التسجيل فقط)', () => {
    const base = makeDescriptor(3);
    const updated = makeDescriptor(3, [{ vector: [1, 2, 3], quality: 0.4, count: 1 }]);
    expect(computeFpId(updated)).toBe(computeFpId(base));
  });

  it('يبطلع null عند غياب عيّنات التسجيل', () => {
    expect(computeFpId(null)).toBeNull();
    expect(computeFpId({ version: DESC_VERSION_GALLERY, enrollment: [], clusters: [] })).toBeNull();
    expect(computeFpId({})).toBeNull();
  });

  it('بصمتان مختلفتان تختلفان', () => {
    expect(computeFpId(makeDescriptor(4))).not.toBe(computeFpId(makeDescriptor(5)));
  });
});

describe('computeFpIds — خريطة لكل الطلاب', () => {
  it('تغطي كل الطلاب ذوي البصمات بأرقام 10 خانات غير مكررة', () => {
    const students = [1, 2, 3, 4, 5].map(n => ({
      id: `s${n}`,
      faceDescriptor: makeDescriptor(n),
    }));
    const map = computeFpIds(students);
    expect(map.size).toBe(students.length);
    const ids = students.map(s => map.get(s.id)!);
    expect(ids.every(id => /^\d{10}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('تتجاهل الطلاب بلا بصمة', () => {
    const students = [
      { id: 'a', faceDescriptor: makeDescriptor(1) },
      { id: 'b', faceDescriptor: null },
      { id: 'c', faceDescriptor: makeDescriptor(2) },
    ];
    const map = computeFpIds(students);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
    expect(map.has('c')).toBe(true);
  });

  it('نفس الطالب يعطي نفس الرقم عبر الاستدعاءات', () => {
    const students = [{ id: 'x', faceDescriptor: makeDescriptor(9) }];
    const m1 = computeFpIds(students);
    const m2 = computeFpIds(students);
    expect(m1.get('x')).toBe(m2.get('x'));
  });
});
