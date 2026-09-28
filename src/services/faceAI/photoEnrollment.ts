// منطق دمج صورة الطالبة كمرجع بصمة إضافي — لا يغيّر منطق التطابق
// القواعد: حارس 0.40 ضد طلاب آخرين · تجاهل التكرار ≤0.02 ضد مراجع الطالب نفسه
import type { Student } from '../../types/student';
import {
  DESC_DIM,
  DESC_VERSION_GALLERY,
  bootstrapClusters,
  descriptorDistance,
  hasValidDescriptor,
  l2Normalize,
  migrateToV5,
  parseGallerySamples,
} from './descriptors';
import type { FaceGalleryDescriptor } from './descriptors';

export const PHOTO_TAMPER_MAX_DISTANCE = 0.4;
export const PHOTO_DEDUPE_DISTANCE = 0.02;
export const MAX_PHOTO_ENROLLMENT = 30;

export type PhotoEnrollFailure = 'invalid' | 'tamper' | 'duplicate';

export type PhotoEnrollResult =
  | { ok: true; gallery: FaceGalleryDescriptor; merged: boolean }
  | { ok: false; reason: PhotoEnrollFailure; matchedWith?: string };

function isFiniteVector(v: Float32Array): boolean {
  if (v.length !== DESC_DIM) return false;
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i]!)) return false;
  return true;
}

function roundSample(v: Float32Array): number[] {
  return Array.from(l2Normalize(v)).map(x => Math.round(x * 1e5) / 1e5);
}

/**
 * تقييم عينة صورة وإنشاء/دمج معرض الطالب:
 * - عينة غير صالحة → invalid
 * - قريبة من طالب آخر (< 0.40) → tamper مع الاسم
 * - قريبة جداً من مراجع الطالب نفسه (≤ 0.02) → duplicate
 * - معرض موجود → إلحاق العينة به (مع سقف عدد العينات)
 * - بلا معرض → إنشاء معرض جديد من العينة
 */
export function enrollPhotoSample(params: {
  query: Float32Array;
  quality: number;
  studentId: string;
  students: Student[];
  existing?: unknown;
}): PhotoEnrollResult {
  const { query, quality, studentId, students, existing } = params;

  if (!isFiniteVector(query)) return { ok: false, reason: 'invalid' };

  // ── حارس: لا تُقبل صورة تشبه طالباً آخر ──
  for (const other of students) {
    if (other.id === studentId || !hasValidDescriptor(other.faceDescriptor)) continue;
    for (const ref of parseGallerySamples(other.faceDescriptor)) {
      if (descriptorDistance(query, ref) < PHOTO_TAMPER_MAX_DISTANCE) {
        return { ok: false, reason: 'tamper', matchedWith: other.name };
      }
    }
  }

  const current = migrateToV5(existing);

  if (current) {
    // ── تجاهل الإضافة إذا كانت الصورة مكررة لمراجع الطالب ──
    for (const ref of parseGallerySamples(current)) {
      if (descriptorDistance(query, ref) <= PHOTO_DEDUPE_DISTANCE) {
        return { ok: false, reason: 'duplicate' };
      }
    }

    const rounded = roundSample(query);
    let enrollment = [...current.enrollment, rounded];
    if (enrollment.length > MAX_PHOTO_ENROLLMENT) {
      enrollment = enrollment.slice(enrollment.length - MAX_PHOTO_ENROLLMENT);
    }
    return {
      ok: true,
      merged: true,
      gallery: {
        ...current,
        enrollment,
        samples: enrollment.length,
        quality: Math.max(current.quality ?? 0, quality),
      },
    };
  }

  const rounded = roundSample(query);
  return {
    ok: true,
    merged: false,
    gallery: {
      version: DESC_VERSION_GALLERY,
      enrollment: [rounded],
      clusters: bootstrapClusters([query], quality),
      samples: 1,
      quality,
    },
  };
}
