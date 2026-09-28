import { describe, it, expect } from 'vitest';
import {
  buildGallery,
  buildGalleryIndex,
  DEFAULT_MATCH_PROFILE,
  findBestMatchIndexed,
  pairKey,
  type GalleryItem,
} from '../gallery';
import { DESC_VERSION_GALLERY, descriptorDistance } from '../descriptors';

// ── أدوات بناء متجهات بطول DESC_DIM بزوايا مضبوطة ──
// المسافة بين متجه وزاويته عن المحور الأول = 1 − cos(θ)
const DIM = 512;

function angleVec(deg: number): Float32Array {
  const t = (deg * Math.PI) / 180;
  const v = new Float32Array(DIM);
  v[0] = Math.cos(t);
  v[1] = Math.sin(t);
  return v;
}

/** متجه يبعد المسافة d عن المتجه المرجعي [1,0,…] */
function atDist(d: number): Float32Array {
  return angleVec((Math.acos(Math.min(1, Math.max(-1, 1 - d))) * 180) / Math.PI);
}

const QUERY = atDist(0);

function makeItem(id: string, sampleDists: number[], name?: string): GalleryItem {
  const allSamples = sampleDists.map(atDist);
  const centroid = new Float32Array(DIM);
  for (const s of allSamples) for (let i = 0; i < DIM; i++) centroid[i] = (centroid[i] ?? 0) + (s[i] ?? 0);
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += (centroid[i] ?? 0) * (centroid[i] ?? 0);
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) centroid[i] = (centroid[i] ?? 0) / norm;
  return { id, name, allSamples, centroid, primary: allSamples[0] ?? null };
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

describe('findBestMatchIndexed — مطابقة صارمة بإثبات مزدوج وتصويت', () => {
  it('يقبل مطابقة قوية متعددة الإثباتات', () => {
    const gallery = [makeItem('A', [0.05, 0.06, 0.07, 0.36, 0.37]), makeItem('B', [0.6, 0.62])];
    const match = findBestMatchIndexed(QUERY, gallery, 0.42, 0.7);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('A');
    expect(match!.votes).toBe(3);
    expect(match!.distance).toBeLessThan(0.1);
    expect(match!.confidence).toBeGreaterThanOrEqual(95);
  });

  it('يرفض المارٍ بعيّنة واحدة فوق soloCap ويقبل تحتها', () => {
    const gallery = [makeItem('S', [0.19])];
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.7)).toBeNull();

    const gallery2 = [makeItem('S', [0.15])];
    const match = findBestMatchIndexed(QUERY, gallery2, 0.42, 0.7);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('S');
  });

  it('يرفض عند ضعف الإثبات الثاني (d2Cap)', () => {
    const gallery = [makeItem('A', [0.10, 0.33, 0.34])];
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.7)).toBeNull();
  });

  it('يرفض عند تصويت غيركافٍ', () => {
    const gallery = [makeItem('A', [0.05, 0.06, 0.40, 0.41, 0.42])];
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.7)).toBeNull();
  });

  it('يرفض عند هامش غيركافٍ بين أفضل طالبين', () => {
    const gallery = [makeItem('A', [0.05, 0.06, 0.07]), makeItem('B', [0.14])];
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.7)).toBeNull();
  });

  it('يقبل عند هامش كافٍ بين أفضل طالبين', () => {
    const gallery = [makeItem('A', [0.05, 0.06, 0.07]), makeItem('B', [0.20])];
    const match = findBestMatchIndexed(QUERY, gallery, 0.42, 0.7);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('A');
  });

  it('الزوج الخطر يحسم الرفض حتى مع هامش كافٍ', () => {
    const a = makeItem('A', [0.05, 0.06, 0.07]);
    const b = makeItem('B', [0.25]);
    const gallery = [a, b];

    // بدون مفتاح الخطر: يُقبل (B بعيد بما يكفي)
    const ok = findBestMatchIndexed(QUERY, gallery, 0.42, 0.7);
    expect(ok).not.toBeNull();

    // مع مفتاح الخطر: يُرفض
    const dangerKeys = new Set([pairKey('A', 'B')]);
    const rejected = findBestMatchIndexed(QUERY, gallery, 0.42, 0.7, { dangerKeys });
    expect(rejected).toBeNull();
  });

  it('الجودة المنخفضة تشدد ولا تُخفّف أبداً', () => {
    const gallery = [makeItem('A', [0.24, 0.25, 0.26])];

    // جودة عالية — الحد الافتراضي 0.25 يقبل 0.24
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.6)).not.toBeNull();

    // جودة منخفضة جداً — d1Cap ينزل إلى 0.21 فيُرفض 0.24
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.30)).toBeNull();

    // جودة متوسطة — d1Cap ينزل إلى 0.23 فيُرفض 0.24 أيضاً
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.50)).toBeNull();
  });

  it('يتجاوز العناصر بلا عينات بدل إيقاف المسح', () => {
    const empty: GalleryItem = { id: 'EMPTY', allSamples: [], centroid: null, primary: null };
    const gallery = [empty, makeItem('A', [0.05, 0.06, 0.07])];
    const match = findBestMatchIndexed(QUERY, gallery, 0.42, 0.7);
    expect(match).not.toBeNull();
    expect(match!.item.id).toBe('A');
  });

  it('تعادل تام بين طالبين متطابقين → يُرفض لا يُخمّن', () => {
    // طالبان متشابكان تماماً — الهامش 0 → يُرفضان معاً
    const gallery = [makeItem('A', [0.10, 0.11]), makeItem('B', [0.10, 0.11])];
    expect(findBestMatchIndexed(QUERY, gallery, 0.42, 0.7)).toBeNull();
  });
});

describe('calibrateGallery / buildGalleryIndex — معايرة تشدد فقط', () => {
  it('بيانات نظيفة: فصل واضح وعدم تجاوز الافتراضيات', () => {
    // A عند 0° ±، B عند 60° — مسافة ~0.5 بينهما
    const students = [
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
    ];
    const index = buildGalleryIndex(students);

    expect(index.report.students).toBe(2);
    expect(index.report.separation).toBe(true);
    expect(index.report.dangerPairs).toHaveLength(0);

    // تشديد فقط
    expect(index.profile.d1Cap).toBeLessThanOrEqual(DEFAULT_MATCH_PROFILE.d1Cap);
    expect(index.profile.d2Cap).toBeLessThanOrEqual(DEFAULT_MATCH_PROFILE.d2Cap);
    expect(index.profile.margin).toBeGreaterThanOrEqual(DEFAULT_MATCH_PROFILE.margin);
    expect(index.profile.soloCap).toBeLessThanOrEqual(DEFAULT_MATCH_PROFILE.soloCap);
  });

  it('بيانات متشابكة: فشل الفصل → أشد صرامة', () => {
    // A عند 0° ±15، B عند 12° ±15 — تداخل شبه كامل
    const students = [
      makeStudent('a', 'طالب أ', [-15, -7, 0, 7, 15]),
      makeStudent('b', 'طالب ب', [-3, 5, 12, 19, 27]),
    ];
    const index = buildGalleryIndex(students);

    expect(index.report.separation).toBe(false);
    expect(index.profile.d1Cap).toBeLessThanOrEqual(0.15);
    expect(index.profile.d1Cap).toBeLessThanOrEqual(DEFAULT_MATCH_PROFILE.d1Cap);
    expect(index.profile.margin).toBeGreaterThanOrEqual(DEFAULT_MATCH_PROFILE.margin);
    expect(index.report.dangerPairs.length).toBeGreaterThan(0);
    expect(index.dangerKeys.size).toBe(index.report.dangerPairs.length);
  });

  it('يكتشف الأزواج الخطرة الحقيقية ولا يُشير لأزواج سليمة', () => {
    const far = buildGalleryIndex([
      makeStudent('a', 'طالب أ', [-4, -2, 0, 2, 4]),
      makeStudent('b', 'طالب ب', [56, 58, 60, 62, 64]),
    ]);
    expect(far.report.dangerPairs).toHaveLength(0);

    const near = buildGalleryIndex([
      makeStudent('a', 'طالب أ', [-10, -5, 0, 5, 10]),
      makeStudent('b', 'طالب ب', [0, 5, 10, 15, 20]),
    ]);
    expect(near.report.dangerPairs.length).toBe(1);
    expect(near.report.dangerPairs[0]!.distance).toBeLessThan(0.30);
    expect(near.report.dangerPairs[0]!.a).toBe('a');
    expect(near.report.dangerPairs[0]!.b).toBe('b');
    expect(near.report.dangerPairs[0]!.aName).toBe('طالب أ');
  });

  it('يبني عناصر المعرض مع مركز ثقيل وعيّنة أساسية', () => {
    const students = [makeStudent('a', 'طالب أ', [0, 2, 4])];
    const gallery = buildGallery(students);
    expect(gallery).toHaveLength(1);
    const item = gallery[0]!;
    expect(item.id).toBe('a');
    expect(item.name).toBe('طالب أ');
    expect(item.allSamples).toHaveLength(3);
    expect(item.centroid).not.toBeNull();
    expect(item.primary).not.toBeNull();
    // العيّنة الأساسية قريبة من المركز
    expect(descriptorDistance(item.centroid!, item.primary!)).toBeLessThan(0.01);
  });
});
