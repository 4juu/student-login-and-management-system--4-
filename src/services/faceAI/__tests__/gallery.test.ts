import { describe, it, expect } from 'vitest';
import { buildGallery, findBestMatchIndexed, findBestMatchConsensus } from '../gallery';
import { DESC_DIM, MATCH_LOOSE, MATCH_STRICT, descriptorDistance, l2Normalize } from '../descriptors';

/** متجهات شبه عشوائية مستقلة تماماً لكل seed (mulberry32) */
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

/** متجه عمودي على v (Gram–Schmidt) */
function orthogonalTo(v: Float32Array, seed: number): Float32Array {
  const u = makeVec(seed);
  let dot = 0;
  for (let i = 0; i < DESC_DIM; i++) dot += (u[i] ?? 0) * (v[i] ?? 0);
  const out = new Float32Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = (u[i] ?? 0) - dot * (v[i] ?? 0);
  return l2Normalize(out);
}

/** normalize(a + beta * b) مع a ⊥ b → المسافة = 1 - 1/sqrt(1+beta²) */
function blend(a: Float32Array, b: Float32Array, beta: number): Float32Array {
  const out = new Float32Array(DESC_DIM);
  for (let i = 0; i < DESC_DIM; i++) out[i] = (a[i] ?? 0) + beta * (b[i] ?? 0);
  return l2Normalize(out);
}

/** 7 زوايا مختلفة لمتطابق واحد */
function sevenAngles(seed: number): number[][] {
  return Array.from({ length: 7 }, (_, i) => arr(makeVec(seed + i)));
}

describe('buildGallery', () => {
  it('indexes enrollment samples only (no cluster blending)', () => {
    const far = makeVec(400);
    const g = buildGallery([
      { id: 's1', faceDescriptor: { version: 5, enrollment: sevenAngles(1), clusters: [
        { bin: '0_0', vector: arr(far), mergeCount: 5, quality: 0.9, updatedAt: Date.now() },
      ] } },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.allSamples).toHaveLength(7);
    expect(g[0]!.allSamples.some(s => descriptorDistance(s, far) < 0.5)).toBe(false);
  });

  it('skips students without a valid descriptor', () => {
    const g = buildGallery([
      { id: 'a' },
      { id: 'b', faceDescriptor: null },
      { id: 'c', faceDescriptor: { version: 5, enrollment: [] } },
      { id: 'd', faceDescriptor: { version: 4, enrollment: [] } },
    ]);
    expect(g).toHaveLength(0);
  });

  it('ignores malformed samples inside enrollment', () => {
    const g = buildGallery([
      { id: 's1', faceDescriptor: { version: 5, enrollment: [null, [1, 2, 3], arr(makeVec(7))] } },
    ]);
    expect(g[0]!.allSamples).toHaveLength(1);
  });
});

describe('findBestMatchIndexed', () => {
  const student = (id: string, seeds: number[]) => ({
    id,
    faceDescriptor: { version: 5 as const, enrollment: seeds.map(s => arr(makeVec(s))) },
  });

  it('returns null for empty gallery', () => {
    expect(findBestMatchIndexed(makeVec(1), [], MATCH_LOOSE)).toBeNull();
  });

  it('matches the 7th angle sample (any of the seven is enough)', () => {
    const gallery = buildGallery([student('s1', [10, 11, 12, 13, 14, 15, 16])]);
    const query = makeVec(16); // الزاوية السابعة بالضبط
    const match = findBestMatchIndexed(query, gallery, MATCH_STRICT);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('s1');
    expect(match!.sampleCount).toBe(7);
    expect(match!.distance).toBeLessThan(0.05);
    expect(match!.confidence).toBeGreaterThan(90);
  });

  it('matches even when only one angle is seen', () => {
    const gallery = buildGallery([student('s1', [10, 11, 12, 13, 14, 15, 16])]);
    const match = findBestMatchIndexed(makeVec(11), gallery, MATCH_STRICT);
    expect(match).not.toBeNull();
  });

  it('rejects a face that matches no angle (over threshold)', () => {
    const gallery = buildGallery([student('s1', [10, 11, 12, 13, 14, 15, 16])]);
    const match = findBestMatchIndexed(makeVec(999), gallery, MATCH_LOOSE);
    expect(match).toBeNull();
  });

  it('rejects ambiguous results when margin between top-2 is too small', () => {
    const a = makeVec(40);
    const near = new Float32Array(a);
    near[0] = near[0]! + 0.0005;
    let n = 0;
    for (let i = 0; i < DESC_DIM; i++) n += near[i]! * near[i]!;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < DESC_DIM; i++) near[i] = near[i]! / n;

    const both = buildGallery([
      { id: 'a', faceDescriptor: { version: 5, enrollment: [arr(a)] } },
      { id: 'b', faceDescriptor: { version: 5, enrollment: [arr(near)] } },
    ]);
    expect(findBestMatchIndexed(a, both, MATCH_LOOSE)).toBeNull();

    const onlyA = buildGallery([student('a', [40])]);
    expect(findBestMatchIndexed(a, onlyA, MATCH_LOOSE)).not.toBeNull();
  });

  it('7 samples accept a harder query than 1 sample (sample bonus)', () => {
    // distance = 1 - 1/sqrt(1+1.35²) ≈ 0.405 → أعلى من عتبة العينة الواحدة وأقل من عتبة السبع
    const base = makeVec(50);
    const q = blend(base, orthogonalTo(base, 51), 1.35);
    expect(descriptorDistance(q, base)).toBeCloseTo(0.405, 2);

    const seven = buildGallery([student('s1', [50, 51, 52, 53, 54, 55, 56])]);
    const one = buildGallery([student('s2', [50])]);

    expect(findBestMatchIndexed(q, one, MATCH_LOOSE, 0.50)).toBeNull();
    expect(findBestMatchIndexed(q, seven, MATCH_LOOSE, 0.50)).not.toBeNull();
  });

  it('matches best-of-queries: a good frame rescues a bad one (بلا خلط زوايا)', () => {
    const gallery = buildGallery([student('s1', [60, 61, 62, 63, 64, 65, 66])]);
    const good = makeVec(66);
    const bad = makeVec(999); // وضعية لا تطابق أي عيّنة

    expect(findBestMatchIndexed(bad, gallery, MATCH_LOOSE)).toBeNull();
    const match = findBestMatchIndexed([bad, good], gallery, MATCH_LOOSE);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('s1');
  });

  it('caps the threshold at MAX_MATCH_DISTANCE regardless of bonuses', () => {
    // 7 عينات + جودة عالية ⇒ عتبة محسوبة 0.48 لكنها مسقوفة بـ0.44
    const base = makeVec(70);
    const u = orthogonalTo(base, 999);
    const gallery = buildGallery([student('s1', [70, 300, 301, 302, 303, 304, 305])]);

    const overCap = blend(base, u, 1.5185);   // d ≈ 0.45
    const underCap = blend(base, u, 1.4052);  // d ≈ 0.42
    expect(descriptorDistance(overCap, base)).toBeCloseTo(0.45, 2);
    expect(descriptorDistance(underCap, base)).toBeCloseTo(0.42, 2);

    expect(findBestMatchIndexed(overCap, gallery, MATCH_LOOSE, 0.90)).toBeNull();
    expect(findBestMatchIndexed(underCap, gallery, MATCH_LOOSE, 0.90)).not.toBeNull();
  });

  it('adaptive margin: thin margin allowed only for a strong match (ضد الخلط)', () => {
    const x = makeVec(80);
    const u = orthogonalTo(x, 81);

    // مطابقة قوية (d1=0) وهامش 0.10 → تُقبل (كانت تُرفض بـMIN_MARGIN 0.12)
    const strongGallery = buildGallery([
      { id: 'a', faceDescriptor: { version: 5, enrollment: [arr(x)] } },
      { id: 'b', faceDescriptor: { version: 5, enrollment: [arr(blend(x, u, 0.4844))] } }, // d=0.10
    ]);
    expect(findBestMatchIndexed(x, strongGallery, MATCH_LOOSE)).not.toBeNull();

    // مطابقة ضعيفة (d1=0.34) وهامش 0.10 → تُرفض حمايةً من خلط طالبين
    const a2 = blend(x, u, 1.1383); // d=0.34
    const b2 = blend(x, u, 1.4795); // d=0.44
    const weakGallery = buildGallery([
      { id: 'a', faceDescriptor: { version: 5, enrollment: [arr(a2)] } },
      { id: 'b', faceDescriptor: { version: 5, enrollment: [arr(b2)] } },
    ]);
    expect(findBestMatchIndexed(x, weakGallery, MATCH_LOOSE)).toBeNull();
  });
});

describe('findBestMatchConsensus — إجماع إطارين مستقلين (ضد الخلط)', () => {
  // عيّنات متمركزة حول وجه واحد (كالتسجيل الحقيقي) بدل متجهات متناثرة
  function personEnrollment(seed: number): number[][] {
    const base = makeVec(seed);
    return Array.from({ length: 7 }, (_, i) => arr(blend(base, orthogonalTo(base, seed + 500 + i), 0.5 + i * 0.1)));
  }
  const enrollA = personEnrollment(80);
  const enrollB = personEnrollment(90);
  const roster = [
    { id: 'a', faceDescriptor: { version: 5, enrollment: enrollA } },
    { id: 'b', faceDescriptor: { version: 5, enrollment: enrollB } },
  ];
  const frameA1 = makeVec(80);
  const frameA2 = Float32Array.from(enrollA[3]!);
  const frameB1 = makeVec(90);
  const far = makeVec(12345); // وضعية لا تطابق أحداً

  it('rejects a single lucky frame (إطار واحد لا يكفي)', () => {
    const g = buildGallery(roster);
    expect(findBestMatchConsensus([far, frameA1], g, MATCH_LOOSE)).toBeNull();
  });

  it('accepts when two independent frames agree on the same student', () => {
    const g = buildGallery(roster);
    const m = findBestMatchConsensus([far, frameA1, frameA2], g, MATCH_LOOSE);
    expect(m).not.toBeNull();
    expect(m!.item.id).toBe('a');
    expect(m!.agreement).toBe(2);
    expect(m!.supportedSamples).toBeGreaterThanOrEqual(2);
  });

  it('rejects when two students each get only one frame (لا أغلبية)', () => {
    const g = buildGallery(roster);
    expect(findBestMatchConsensus([frameA1, frameB1], g, MATCH_LOOSE)).toBeNull();
  });

  it('picks the student backed by more frames', () => {
    const g = buildGallery(roster);
    const m = findBestMatchConsensus([frameB1, frameA1, frameA2], g, MATCH_LOOSE);
    expect(m!.item.id).toBe('a');
    expect(m!.agreement).toBe(2);
  });

  it('rejects a lone frame even at track start (إطار واحد لا يحسم الهوية أبداً)', () => {
    const g = buildGallery(roster);
    expect(findBestMatchConsensus([frameA1], g, MATCH_LOOSE)).toBeNull();
  });

  it('returns null for an empty query list', () => {
    expect(findBestMatchConsensus([], buildGallery(roster), MATCH_LOOSE)).toBeNull();
  });
});
