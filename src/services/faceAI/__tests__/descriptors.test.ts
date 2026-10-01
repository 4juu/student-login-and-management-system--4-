import { describe, it, expect } from 'vitest';
import {
  DESC_DIM,
  DESC_VERSION_GALLERY,
  MATCH_STRICT,
  MATCH_LOOSE,
  MIN_MARGIN,
  parseOneSample,
  isGalleryDescriptor,
  hasValidDescriptor,
  migrateToV5,
  parseAllSamples,
  parseStoredDescriptor,
  parseGallerySamples,
  l2Normalize,
  cosineSimilarity,
  descriptorDistance,
  findBestMatch,
  checkForTampering,
  checkPendingConflict,
  getGalleryHealthSummary,
  type FaceGalleryDescriptor,
  type PendingFaceRecord,
} from '../descriptors';

function makeVec(seed: number, dim = DESC_DIM): Float32Array {
  const f = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const val = Math.sin(seed * 1000 + i) + 0.1;
    f[i] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) f[i] = f[i]! / norm;
  return f;
}

function vecToArr(f: Float32Array): number[] {
  return Array.from(f);
}

function makeGallery(seeds: number[] = [1]): FaceGalleryDescriptor {
  return {
    version: DESC_VERSION_GALLERY,
    enrollment: seeds.map(s => vecToArr(makeVec(s))),
    clusters: [],
  };
}

describe('constants', () => {
  it('has expected values', () => {
    expect(DESC_DIM).toBe(512);
    expect(DESC_VERSION_GALLERY).toBe(5);
    expect(MATCH_STRICT).toBeLessThan(MATCH_LOOSE);
    expect(MIN_MARGIN).toBeGreaterThan(0);
  });
});

describe('parseOneSample', () => {
  it('parses a valid 512-dim array', () => {
    const arr = vecToArr(makeVec(1));
    const parsed = parseOneSample(arr);
    expect(parsed).toBeInstanceOf(Float32Array);
    expect(parsed!.length).toBe(DESC_DIM);
  });

  it('returns null for wrong length', () => {
    expect(parseOneSample([1, 2, 3])).toBeNull();
    expect(parseOneSample([])).toBeNull();
  });

  it('returns null for non-array', () => {
    expect(parseOneSample(null)).toBeNull();
    expect(parseOneSample('x')).toBeNull();
    expect(parseOneSample({})).toBeNull();
  });

  it('returns null for all-zero vector', () => {
    expect(parseOneSample(new Array(DESC_DIM).fill(0))).toBeNull();
  });

  it('normalizes vectors far from unit length', () => {
    const arr = new Array(DESC_DIM).fill(0);
    arr[0] = 100;
    const parsed = parseOneSample(arr)!;
    expect(Math.abs(Math.hypot(...parsed) - 1)).toBeLessThan(0.01);
  });
});

describe('isGalleryDescriptor', () => {
  it('accepts valid v5 descriptor', () => {
    expect(isGalleryDescriptor(makeGallery())).toBe(true);
  });

  it('accepts descriptor with undefined clusters (Firebase strips empty arrays)', () => {
    const fd = { version: 5, enrollment: [[]] };
    expect(isGalleryDescriptor(fd)).toBe(true);
  });

  it('rejects null/undefined/non-objects', () => {
    expect(isGalleryDescriptor(null)).toBe(false);
    expect(isGalleryDescriptor(undefined)).toBe(false);
    expect(isGalleryDescriptor('x')).toBe(false);
  });

  it('rejects wrong version', () => {
    expect(isGalleryDescriptor({ version: 4, enrollment: [] })).toBe(false);
  });

  it('rejects missing enrollment', () => {
    expect(isGalleryDescriptor({ version: 5 })).toBe(false);
  });
});

describe('hasValidDescriptor', () => {
  it('true when at least one valid enrollment sample exists', () => {
    expect(hasValidDescriptor(makeGallery([1]))).toBe(true);
  });

  it('false when enrollment is empty', () => {
    expect(hasValidDescriptor({ version: 5, enrollment: [], clusters: [] })).toBe(false);
  });

  it('false for invalid input', () => {
    expect(hasValidDescriptor(null)).toBe(false);
    expect(hasValidDescriptor({ version: 5, enrollment: [null] })).toBe(false);
  });
});

describe('migrateToV5', () => {
  it('passes through valid v5 descriptor (normalized)', () => {
    const result = migrateToV5(makeGallery([1]));
    expect(result).not.toBeNull();
    expect(result!.version).toBe(5);
    expect(result!.enrollment.length).toBe(1);
  });

  it('preserves all seven separate samples and English name through request/approval migration', () => {
    const seven = makeGallery([1, 2, 3, 4, 5, 6, 7]);
    seven.studentNameEn = 'Noor Al-Huda Salim';
    seven.enrollmentAngles = ['front', 'right', 'left', 'up', 'down', 'close', 'far'];

    const migrated = migrateToV5(seven);

    expect(migrated?.version).toBe(DESC_VERSION_GALLERY);
    expect(migrated?.enrollment).toHaveLength(7);
    expect(migrated?.enrollment.every(sample => sample.length === DESC_DIM)).toBe(true);
    expect(new Set(migrated?.enrollment.map(sample => JSON.stringify(sample))).size).toBe(7);
    expect(migrated?.studentNameEn).toBe('Noor Al-Huda Salim');
    expect(migrated?.enrollmentAngles).toEqual(seven.enrollmentAngles);
  });

  it('drops legacy clusters when normalizing a v5 descriptor', () => {
    const legacy = makeGallery([1, 2, 3, 4, 5, 6, 7]);
    legacy.clusters = [{
      bin: 'legacy',
      vector: vecToArr(makeVec(90)),
      mergeCount: 8,
      quality: 0.9,
      updatedAt: Date.now(),
    }];

    expect(migrateToV5(legacy)?.clusters).toBeUndefined();
  });

  it('returns null for legacy flat array format', () => {
    expect(migrateToV5(new Array(DESC_DIM).fill(0.1))).toBeNull();
  });

  it('returns null for legacy {descriptor} format', () => {
    expect(migrateToV5({ descriptor: [1, 2, 3] })).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(migrateToV5(null)).toBeNull();
    expect(migrateToV5(undefined)).toBeNull();
  });

  it('returns null when no valid enrollment samples', () => {
    expect(migrateToV5({ version: 5, enrollment: [], clusters: [] })).toBeNull();
  });
});

describe('parseAllSamples / parseStoredDescriptor / parseGallerySamples', () => {
  it('returns [] for non-gallery input', () => {
    expect(parseAllSamples(null)).toEqual([]);
    expect(parseStoredDescriptor(null)).toBeNull();
    expect(parseGallerySamples(null)).toEqual([]);
  });

  it('parses enrollment samples', () => {
    const samples = parseAllSamples(makeGallery([1, 2]));
    expect(samples.length).toBe(2);
  });

  it('ignores legacy cluster vectors and returns only the original enrollment samples', () => {
    const fd = makeGallery([1]);
    fd.clusters = [
      { bin: '0_0', vector: vecToArr(makeVec(50)), mergeCount: 1, quality: 0.9, updatedAt: Date.now() },
    ];
    expect(parseGallerySamples(fd).length).toBe(1);
    expect(parseAllSamples(fd).length).toBe(1);
  });

  it('parseStoredDescriptor returns first valid sample', () => {
    const stored = parseStoredDescriptor(makeGallery([7]));
    expect(stored).toBeInstanceOf(Float32Array);
    expect(stored!.length).toBe(DESC_DIM);
  });
});

describe('l2Normalize / cosineSimilarity / descriptorDistance', () => {
  it('l2Normalize produces unit vector', () => {
    const v = l2Normalize(new Float32Array([3, 4]));
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1, 5);
  });

  it('identical vectors have cosine 1 and distance 0', () => {
    const a = makeVec(1);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(descriptorDistance(a, a)).toBeCloseTo(0, 5);
  });

  it('orthogonal-ish vectors have positive distance', () => {
    const a = new Float32Array(DESC_DIM);
    const b = new Float32Array(DESC_DIM);
    a[0] = 1;
    b[1] = 1;
    expect(descriptorDistance(a, b)).toBeCloseTo(1, 5);
  });
});

describe('findBestMatch', () => {
  interface Cand { id: string; faceDescriptor?: unknown }

  it('returns null for empty candidate list', () => {
    expect(findBestMatch(makeVec(1), [])).toBeNull();
  });

  it('returns null when no candidate has valid descriptors', () => {
    expect(findBestMatch(makeVec(1), [{ id: 'a' }, { id: 'b' }])).toBeNull();
  });

  it('matches identical descriptor with high confidence', () => {
    const vec = makeVec(3);
    const items: Cand[] = [
      { id: 'a', faceDescriptor: { version: 5, enrollment: [vecToArr(vec)], clusters: [] } },
    ];
    const match = findBestMatch(vec, items);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('a');
    expect(match!.confidence).toBeGreaterThan(90);
    expect(match!.distance).toBeLessThan(0.1);
  });

  it('returns null when distance exceeds threshold', () => {
    const items: Cand[] = [
      { id: 'far', faceDescriptor: { version: 5, enrollment: [vecToArr(makeVec(100))], clusters: [] } },
    ];
    const match = findBestMatch(makeVec(1), items, 0.1);
    expect(match).toBeNull();
  });

  it('returns null when margin between top-2 is too small (ambiguous)', () => {
    const a = makeVec(4);
    const b = makeVec(4);
    b[0] = b[0]! + 0.001; // nearly identical
    let norm = 0;
    for (let i = 0; i < DESC_DIM; i++) norm += b[i]! * b[i]!;
    norm = Math.sqrt(norm);
    for (let i = 0; i < DESC_DIM; i++) b[i] = b[i]! / norm;

    const items: Cand[] = [
      { id: 'a', faceDescriptor: { version: 5, enrollment: [vecToArr(a)], clusters: [] } },
      { id: 'b', faceDescriptor: { version: 5, enrollment: [vecToArr(b)], clusters: [] } },
    ];
    expect(findBestMatch(a, items, MATCH_LOOSE)).toBeNull();
  });

  it('picks the closer of two distinct candidates', () => {
    const query = makeVec(10);
    const close = makeVec(10);
    close[0] = close[0]! + 0.01;
    let n = 0;
    for (let i = 0; i < DESC_DIM; i++) n += close[i]! * close[i]!;
    n = Math.sqrt(n);
    for (let i = 0; i < DESC_DIM; i++) close[i] = close[i]! / n;

    const items: Cand[] = [
      { id: 'far', faceDescriptor: { version: 5, enrollment: [vecToArr(makeVec(200))], clusters: [] } },
      { id: 'near', faceDescriptor: { version: 5, enrollment: [vecToArr(close)], clusters: [] } },
    ];
    const match = findBestMatch(query, items);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('near');
  });
});

describe('checkForTampering', () => {
  it('returns not tampered when no others', () => {
    const r = checkForTampering(makeVec(1), [], 'self');
    expect(r.tampered).toBe(false);
  });

  it('returns tampered when query matches another student', () => {
    const vec = makeVec(2);
    const others = [
      { id: 'other', name: 'طالب آخر', faceDescriptor: { version: 5, enrollment: [vecToArr(vec)], clusters: [] } },
    ];
    const r = checkForTampering(vec, others, 'self');
    expect(r.tampered).toBe(true);
    expect(r.matchedWith).toBe('طالب آخر');
  });

  it('ignores self (matched by id)', () => {
    const vec = makeVec(3);
    const others = [
      { id: 'self', name: 'أنا', faceDescriptor: { version: 5, enrollment: [vecToArr(vec)], clusters: [] } },
    ];
    expect(checkForTampering(vec, others, 'self').tampered).toBe(false);
  });
});

describe('getGalleryHealthSummary', () => {
  it('counts registered and missing descriptors without cluster maturity', () => {
    const valid = makeGallery([1]);
    const summary = getGalleryHealthSummary([
      { faceDescriptor: valid },
      { faceDescriptor: null },
      {},
    ]);
    expect(summary.total).toBe(3);
    expect(summary.v5Count).toBe(1);
    expect(summary.noFaceCount).toBe(2);
  });
});

describe('checkPendingConflict', () => {
  const stageId = 'stage-1';
  const sample = makeVec(10);

  const pendingOf = (over: Partial<PendingFaceRecord> = {}): Record<string, PendingFaceRecord> => ({
    r1: {
      requestId: 'r1',
      studentId: 'other-student',
      name: 'علي حسن',
      stageId,
      status: 'pending',
      faceDescriptor: { version: 5, enrollment: [vecToArr(makeVec(10))], clusters: [] },
      createdAt: new Date().toISOString(),
      ...over,
    },
  });

  it('no conflict when there are no pendings', () => {
    expect(checkPendingConflict([sample], null, { selfId: 'me', stageId }).conflict).toBe(false);
    expect(checkPendingConflict([sample], undefined, { selfId: 'me', stageId }).conflict).toBe(false);
    expect(checkPendingConflict([sample], {}, { selfId: 'me', stageId }).conflict).toBe(false);
  });

  it('conflicts when a pending for another student matches', () => {
    const r = checkPendingConflict([sample], pendingOf(), { selfId: 'me', stageId });
    expect(r.conflict).toBe(true);
    expect(r.matchedWith).toBe('علي حسن');
  });

  it('ignores own pending so retries stay possible', () => {
    const r = checkPendingConflict([sample], pendingOf({ studentId: 'me' }), { selfId: 'me', stageId });
    expect(r.conflict).toBe(false);
  });

  it('ignores pendings from another stage', () => {
    const r = checkPendingConflict([sample], pendingOf({ stageId: 'stage-2' }), { selfId: 'me', stageId });
    expect(r.conflict).toBe(false);
  });

  it('ignores requests that already got a decision', () => {
    expect(checkPendingConflict([sample], pendingOf({ status: 'approved' }), { selfId: 'me', stageId }).conflict).toBe(false);
    expect(checkPendingConflict([sample], pendingOf({ status: 'rejected' }), { selfId: 'me', stageId }).conflict).toBe(false);
  });

  it('no conflict for a different face', () => {
    const r = checkPendingConflict([makeVec(99)], pendingOf(), { selfId: 'me', stageId });
    expect(r.conflict).toBe(false);
  });

  it('skips malformed records (no studentId / empty descriptor)', () => {
    const pendings: Record<string, PendingFaceRecord> = {
      a: { status: 'pending', stageId },
      b: { studentId: 'x', status: 'pending', stageId, faceDescriptor: null },
    };
    expect(checkPendingConflict([sample], pendings, { selfId: 'me', stageId }).conflict).toBe(false);
  });

  it('checks records missing the status field (regression: index written without status)', () => {
    const rec = pendingOf();
    delete rec.r1?.status;
    const r = checkPendingConflict([sample], rec, { selfId: 'me', stageId });
    expect(r.conflict).toBe(true);
    expect(r.matchedWith).toBe('علي حسن');
  });
});
