import { describe, it, expect } from 'vitest';
import type { Student } from '../../../types/student';
import { enrollPhotoSample, PHOTO_TAMPER_MAX_DISTANCE, MAX_PHOTO_ENROLLMENT } from '../photoEnrollment';
import { DESC_DIM, DESC_VERSION_GALLERY, l2Normalize, type FaceGalleryDescriptor } from '../descriptors';

/** عينة بُعد DESC_DIM: متجه معياري محور axis (بقيدها وبقية الصفر) */
function axisSample(axis: number, extraAxis?: number): Float32Array {
  const v = new Float32Array(DESC_DIM);
  v[axis] = 1;
  if (extraAxis !== undefined) v[extraAxis] = 1;
  return l2Normalize(v);
}

function galleryOf(...samples: Float32Array[]): FaceGalleryDescriptor {
  return {
    version: DESC_VERSION_GALLERY,
    enrollment: samples.map(s => Array.from(s).map(x => Math.round(x * 1e5) / 1e5)),
    clusters: [],
    samples: samples.length,
    quality: 0.8,
  };
}

function student(id: string, name: string, faceDescriptor?: unknown): Student {
  return { id, name, faceDescriptor } as Student;
}

const selfStudent = (existing?: unknown) => student('self', 'طالبتي', existing);

describe('enrollPhotoSample', () => {
  it('يرفض عينة بطول خاطئ', () => {
    const r = enrollPhotoSample({
      query: new Float32Array(100),
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent()],
    });
    expect(r).toEqual({ ok: false, reason: 'invalid' });
  });

  it('يرفض الصورة المشابهة لطالب آخر (حارس 0.40)', () => {
    const other = student('other', 'طالبة أخرى', galleryOf(axisSample(3)));
    const r = enrollPhotoSample({
      query: axisSample(3), // مطابقة تقريباً لطالب آخر
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent(), other],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('tamper');
      expect(r.matchedWith).toBe('طالبة أخرى');
    }
  });

  it('يتجاهل الصورة المكررة لمراجع الطالب نفسه (≤0.02)', () => {
    const existing = galleryOf(axisSample(0));
    const r = enrollPhotoSample({
      query: axisSample(0), // مسافة 0 عن مرجعها
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent(existing)],
      existing,
    });
    expect(r).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('يلحق صورة جديدة بمعرض موجود دون مساس بالعينات القائمة', () => {
    const existing = galleryOf(axisSample(0));
    const r = enrollPhotoSample({
      query: axisSample(5), // زاوية مختلفة — مسافة 1 عن المرجع
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent(existing)],
      existing,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.merged).toBe(true);
      expect(r.gallery.enrollment).toHaveLength(2);
      expect(r.gallery.version).toBe(DESC_VERSION_GALLERY);
      expect(r.gallery.quality).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('ينشئ معرضاً جديداً من الصورة عندما لا يوجد معرض', () => {
    const r = enrollPhotoSample({
      query: axisSample(7),
      quality: 0.85,
      studentId: 'self',
      students: [selfStudent()],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.merged).toBe(false);
      expect(r.gallery.enrollment).toHaveLength(1);
      expect(r.gallery.samples).toBe(1);
      expect(r.gallery.version).toBe(DESC_VERSION_GALLERY);
      expect(r.gallery.quality).toBe(0.85);
    }
  });

  it('يقيّد عدد عينات المعرض بالحد الأقصى', () => {
    const many = Array.from({ length: MAX_PHOTO_ENROLLMENT }, (_, i) => axisSample(i));
    const existing = galleryOf(...many);
    const r = enrollPhotoSample({
      query: axisSample(400),
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent(existing)],
      existing,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.gallery.enrollment).toHaveLength(MAX_PHOTO_ENROLLMENT);
  });

  it('الحارس يمنع الاقتراب من مرجع طالب آخر دون مطابقة تامة', () => {
    // مرجع الطالب الآخر محور 0 — نبني صورة بميل نحوه: مسافة ≈0.30 < 0.40
    const otherRef = axisSample(0);
    const tilted = axisSample(0, 1); // cosine مع المحور0 = 1/√2 ≈ 0.707 → مسافة ≈0.293
    expect(1 - (1 / Math.SQRT2)).toBeLessThan(PHOTO_TAMPER_MAX_DISTANCE);

    const other = student('other', 'طالبة أخرى', galleryOf(otherRef));
    const r = enrollPhotoSample({
      query: tilted,
      quality: 0.9,
      studentId: 'self',
      students: [selfStudent(), other],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('tamper');
  });
});
