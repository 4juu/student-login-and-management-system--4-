import { describe, it, expect } from 'vitest';
import {
  DESC_DIM,
  DESC_VERSION_GALLERY,
  MATCH_STRICT,
  MATCH_LOOSE,
  MIN_MARGIN,
  MAX_CLUSTERS,
  MAX_MERGES_PER_CLUSTER,
  MIN_CLUSTER_QUALITY,
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
  updateGallery,
  getCoveragePercent,
  getMissingBins,
  getGalleryHealthSummary,
  pruneStaleClusters,
  type FaceGalleryDescriptor,
} from '../descriptors';

function makeVec(seed: number, dim = DESC_DIM): Float32Array {
  const f = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    f[i] = Math.sin(seed * 1000 + i) + 0.1;
    norm += f[i] * f[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) f[i] /= norm;
  return f;
}

/** same base vector with a tiny perturbation → distance well under MAX_NEW_CLUSTER_DISTANCE */
function perturb(v: Float32Array, amount = 0.02): Float32Array {
  const out = new Float32Array(v);
  out[0] += amount;
  let norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
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
    expect(MAX_CLUSTERS).toBe(18);
    expect(MAX_MERGES_PER_CLUSTER).toBe(12);
    expect(MATCH_STRICT).toBeLessThan(MATCH_LOOSE);
    expect(MIN_MARGIN).toBeGreaterThan(0);
    expect(MIN_CLUSTER_QUALITY).toBeGreaterThan(0);
    expect(MIN_CLUSTER_QUALITY).toBeLessThan(1);
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

  it('includes cluster vectors in gallery samples', () => {
    const fd = makeGallery([1]);
    fd.clusters = [
      { bin: '0_0', vector: vecToArr(makeVec(50)), mergeCount: 1, quality: 0.9, updatedAt: Date.now() },
    ];
    expect(parseGallerySamples(fd).length).toBe(2);
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
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 5);
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
    b[0] += 0.001; // nearly identical
    let norm = 0;
    for (let i = 0; i < DESC_DIM; i++) norm += b[i] * b[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < DESC_DIM; i++) b[i] /= norm;

    const items: Cand[] = [
      { id: 'a', faceDescriptor: { version: 5, enrollment: [vecToArr(a)], clusters: [] } },
      { id: 'b', faceDescriptor: { version: 5, enrollment: [vecToArr(b)], clusters: [] } },
    ];
    expect(findBestMatch(a, items, MATCH_LOOSE)).toBeNull();
  });

  it('picks the closer of two distinct candidates', () => {
    const query = makeVec(10);
    const close = makeVec(10);
    close[0] += 0.01;
    let n = 0;
    for (let i = 0; i < DESC_DIM; i++) n += close[i] * close[i];
    n = Math.sqrt(n);
    for (let i = 0; i < DESC_DIM; i++) close[i] /= n;

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

describe('updateGallery', () => {
  it('rejects low-quality sample', () => {
    const g = makeGallery([1]);
    const r = updateGallery(g, makeVec(2), MIN_CLUSTER_QUALITY - 0.1, '0_0');
    expect(r.action).toBe('rejected');
    expect(r.gallery).toBe(g);
  });

  it('creates a new cluster for empty gallery', () => {
    const g = makeGallery([1]);
    const r = updateGallery(g, perturb(makeVec(1)), 0.9, '0_0');
    expect(r.action).toBe('created');
    expect(r.gallery.clusters.length).toBe(1);
    expect(r.bin).toBe('0_0');
  });

  it('merges into existing same-bin cluster', () => {
    const g = makeGallery([1]);
    const first = updateGallery(g, perturb(makeVec(1)), 0.9, '0_0');
    expect(first.action).toBe('created');
    const second = updateGallery(first.gallery, perturb(makeVec(1), 0.03), 0.9, '0_0');
    expect(second.action).toBe('merged');
    expect(second.gallery.clusters[0].mergeCount).toBe(2);
  });

  it('rejects sample too far from existing gallery (MAX_NEW_CLUSTER_DISTANCE)', () => {
    const g = makeGallery([1]);
    const r = updateGallery(g, makeVec(300), 0.9, '0_0');
    expect(r.action).toBe('rejected');
  });

  it('skips mature cluster when allowMatureMerge is false', () => {
    let g = makeGallery([1]);
    // build up mergeCount to max using close samples
    for (let i = 0; i < MAX_MERGES_PER_CLUSTER; i++) {
      const r = updateGallery(g, perturb(makeVec(1), 0.02 + i * 0.001), 0.9, '0_0');
      if (r.action === 'rejected' || r.action === 'skipped_mature') break;
      g = r.gallery;
    }
    expect(g.clusters[0].mergeCount).toBeGreaterThanOrEqual(MAX_MERGES_PER_CLUSTER);
    const r = updateGallery(g, perturb(makeVec(1), 0.05), 0.9, '0_0', false);
    expect(r.action).toBe('skipped_mature');
  });

  it('allows merge on mature cluster when allowMatureMerge=true', () => {
    let g = makeGallery([1]);
    for (let i = 0; i < MAX_MERGES_PER_CLUSTER; i++) {
      const r = updateGallery(g, perturb(makeVec(1), 0.02 + i * 0.001), 0.9, '0_0');
      if (r.action === 'rejected' || r.action === 'skipped_mature') break;
      g = r.gallery;
    }
    expect(g.clusters[0].mergeCount).toBeGreaterThanOrEqual(MAX_MERGES_PER_CLUSTER);
    const r = updateGallery(g, perturb(makeVec(1), 0.05), 0.9, '0_0', true);
    expect(r.action).toBe('merged');
    expect(r.gallery.clusters[0].mergeCount).toBeLessThanOrEqual(MAX_MERGES_PER_CLUSTER);
  });
});

describe('getCoveragePercent', () => {
  it('returns 0 for invalid descriptor', () => {
    expect(getCoveragePercent(null)).toBe(0);
  });

  it('returns percentage based on cluster count', () => {
    const g = makeGallery([1]);
    const empty = getCoveragePercent(g);
    expect(empty).toBe(0);

    g.clusters = Array.from({ length: 9 }, (_, i) => ({
      bin: `b${i}`,
      vector: vecToArr(makeVec(i + 10)),
      mergeCount: 1,
      quality: 0.8,
      updatedAt: Date.now(),
    }));
    const pct = getCoveragePercent(g);
    expect(pct).toBe(50); // 9/18
  });
});

describe('getMissingBins', () => {
  it('returns all bins when no clusters', () => {
    const missing = getMissingBins(makeGallery([1]));
    expect(missing.length).toBeGreaterThan(0);
  });

  it('removes covered bins', () => {
    const g = makeGallery([1]);
    g.clusters = [{ bin: '0_0', vector: vecToArr(makeVec(2)), mergeCount: 1, quality: 0.8, updatedAt: Date.now() }];
    const missing = getMissingBins(g);
    expect(missing).not.toContain('0_0');
  });
});

describe('getGalleryHealthSummary', () => {
  it('counts valid, mature, and missing descriptors', () => {
    const valid = makeGallery([1]);
    const summary = getGalleryHealthSummary([
      { faceDescriptor: valid },
      { faceDescriptor: null },
      {},
    ]);
    expect(summary.total).toBe(3);
    expect(summary.v5Count).toBe(1);
    expect(summary.noFaceCount).toBe(2);
    expect(summary.matureCount).toBe(0); // 0 clusters → 0% coverage
  });
});

describe('pruneStaleClusters', () => {
  it('keeps fresh clusters', () => {
    const g = makeGallery([1]);
    g.clusters = [{ bin: 'a', vector: vecToArr(makeVec(2)), mergeCount: 1, quality: 0.8, updatedAt: Date.now() }];
    const r = pruneStaleClusters(g);
    expect(r.clusters.length).toBe(1);
    expect(r).toBe(g); // same reference when nothing pruned
  });

  it('removes very old low-merge clusters', () => {
    const g = makeGallery([1]);
    g.clusters = [{
      bin: 'old',
      vector: vecToArr(makeVec(2)),
      mergeCount: 1,
      quality: 0.8,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 200, // 200 days > 120
    }];
    const r = pruneStaleClusters(g);
    expect(r.clusters.length).toBe(0);
  });

  it('keeps old clusters with high mergeCount (well-learned)', () => {
    const g = makeGallery([1]);
    g.clusters = [{
      bin: 'old-mature',
      vector: vecToArr(makeVec(2)),
      mergeCount: 6,
      quality: 0.9,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 200,
    }];
    const r = pruneStaleClusters(g);
    expect(r.clusters.length).toBe(1);
  });
});
