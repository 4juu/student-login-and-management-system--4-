// Students + face descriptor overrides

import { ref, set, get, update } from "firebase/database";
import { database } from "./config";
import { Student } from "../types/student";
import { getActiveAcademicYear } from "./academicYear";
import { getStagePath } from "./paths";
import { LS, saveLocal, loadLocal, isDangerousEmpty, stripUndefined } from "./localCache";
import { debouncedSave, registerOutboxFallback } from "./saveQueue";
import { queueOutbox } from "../lib/offlineOutbox";

export const saveStudents = async (
  adminUid: string,
  stageId: string,
  students: Student[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(students)) {
      console.warn('🛑 منع حفظ طلاب فارغين');
      return;
    }
  }

  saveLocal(LS.students(adminUid, stageId), students);

  const year = await getActiveAcademicYear();
  const saveKey = `students_${adminUid}_${stageId}`;

  // فصل faceDescriptor إلى عقدة منفصلة — students تبقى خفيفة (بلا بصمات ضخمة)
  const descriptors: Record<string, unknown> = {};
  const stripped = students.map(s => {
    if (s.faceDescriptor !== undefined && s.faceDescriptor !== null) {
      descriptors[s.id] = s.faceDescriptor;
    }
    const { faceDescriptor: _fd, ...rest } = s;
    return rest;
  });

  const studentsPath = getStagePath(year, adminUid, stageId, 'students');
  const descriptorsPath = getStagePath(year, adminUid, stageId, 'descriptors');

  // نسخة احتياطية تُرفع تلقائياً إذا فشل الحفظ (قطع نت متقطع / Firebase مقطوع)
  registerOutboxFallback(saveKey, saveKey, stripped, studentsPath);
  registerOutboxFallback(`${saveKey}_desc`, `${saveKey}_desc`, descriptors, descriptorsPath);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(saveKey, stripped, studentsPath);
    void queueOutbox(`${saveKey}_desc`, descriptors, descriptorsPath);
  }

  debouncedSave(saveKey, async () => {
    await set(ref(database, studentsPath), stripped.map(s => stripUndefined(s as any)));
    await set(ref(database, descriptorsPath), descriptors);
  });
};

/**
 * دمج faceDescriptor من العقدة المنفصلة descriptors/ (إن وُجدت) فوق قائمة الطلاب.
 * البصمة المدمجة في student نفسه تبقى للمتوافقة العكسية.
 */
export const mergeDescriptorsIntoStudents = (
  students: Student[],
  descriptors: Record<string, unknown> | null | undefined,
): Student[] => {
  if (!descriptors || typeof descriptors !== 'object') return students;
  return students.map(s => {
    const d = descriptors[s.id];
    return d !== undefined && d !== null ? { ...s, faceDescriptor: d } : s;
  });
};

export const loadStudents = async (adminUid: string, stageId: string): Promise<Student[]> => {
  const local = loadLocal<Student[]>(LS.students(adminUid, stageId), []);
  try {
    const year = await getActiveAcademicYear();
    const [snap, descSnap] = await Promise.all([
      get(ref(database, getStagePath(year, adminUid, stageId, 'students'))),
      get(ref(database, getStagePath(year, adminUid, stageId, 'descriptors'))),
    ]);
    if (snap.exists()) {
      const data = snap.val();
      const arr: Student[] = Array.isArray(data) ? data : Object.values(data);
      const descriptors = descSnap.exists() ? (descSnap.val() as Record<string, unknown>) : null;
      const merged = mergeDescriptorsIntoStudents(arr, descriptors);
      if (merged.length > 0 || local.length === 0) {
        // كاش localStorage الصغير (~5MB) ينفجر مع المراحل الكبيرة ويخنق البيانات الجديدة —
        // نتجاوز الكتابة عليه للقوائم الكبيرة ونعتمد على كاش IndexedDB الأساسي
        try {
          const size = JSON.stringify(merged).length;
          if (size < 1_500_000) saveLocal(LS.students(adminUid, stageId), merged);
        } catch {
          /* تجاهل — الكاش الرئيسي (IndexedDB) يتولى الحفظ */
        }
        return merged;
      }
      return local;
    }
    return local;
  } catch {
    return local;
  }
};

/**
 * حفظ تحسين بصمة لطالب معين (يكتب للمسار الفرعي descriptorOverrides)
 * هذه الدالة لا تتطلب تسجيل دخول — القاعدة تسمح لـ `.write: true`
 */
export const updateStudentDescriptorOverride = async (
  adminUid: string,
  stageId: string,
  studentId: string,
  faceDescriptor: any,
): Promise<void> => {
  try {
    const year = await getActiveAcademicYear();
    const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/descriptorOverrides/${studentId}`;
    const payload = {
      faceDescriptor: JSON.parse(JSON.stringify(faceDescriptor)),
      updatedAt: Date.now(),
    };
    await set(ref(database, path), payload);
  } catch (e) {
    console.error(`[dataService] ❌ فشل حفظ بصمة الطالب ${studentId}:`, e);
  }
};

/** جلب التحسينات المحفوظة لمرحلة معينة */
export const loadDescriptorOverrides = async (
  adminUid: string,
  stageId: string,
): Promise<Record<string, any>> => {
  try {
    const year = await getActiveAcademicYear();
    const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/descriptorOverrides`;
    const snap = await get(ref(database, path));
    if (!snap.exists()) return {};
    return snap.val() as Record<string, any>;
  } catch {
    return {};
  }
};

/** حذف التحسينات بعد دمجها في القائمة الرئيسية */
export const clearDescriptorOverrides = async (
  adminUid: string,
  stageId: string,
  studentIds: string[],
): Promise<void> => {
  try {
    const year = await getActiveAcademicYear();
    const updates: Record<string, null> = {};
    for (const id of studentIds) {
      updates[`academicYears/${year}/userData/${adminUid}/stageData/${stageId}/descriptorOverrides/${id}`] = null;
    }
    await update(ref(database), updates);
  } catch { /* تجاهل */ }
};
