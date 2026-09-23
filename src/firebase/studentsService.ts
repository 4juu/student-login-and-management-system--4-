// Students + face descriptor overrides

import { ref, set, get, update } from "firebase/database";
import { database } from "./config";
import { Student } from "../types/student";
import { getActiveAcademicYear } from "./academicYear";
import { getStagePath } from "./paths";
import { LS, saveLocal, loadLocal, isDangerousEmpty, stripUndefined } from "./localCache";
import { debouncedSave } from "./saveQueue";
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

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(`students_${adminUid}_${stageId}`, students);
  }

  const year = await getActiveAcademicYear();
  const saveKey = `students_${adminUid}_${stageId}`;

  debouncedSave(saveKey, async () => {
    await set(ref(database, getStagePath(year, adminUid, stageId, 'students')), students.map(s => stripUndefined(s as any)));
  });
};

export const loadStudents = async (adminUid: string, stageId: string): Promise<Student[]> => {
  const local = loadLocal<Student[]>(LS.students(adminUid, stageId), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getStagePath(year, adminUid, stageId, 'students')));
    if (snap.exists()) {
      const data = snap.val();
      const arr: Student[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        // كاش localStorage الصغير (~5MB) ينفجر مع المراحل الكبيرة ويخنق البيانات الجديدة —
        // نتجاوز الكتابة عليه للقوائم الكبيرة ونعتمد على كاش IndexedDB الأساسي
        try {
          const size = JSON.stringify(arr).length;
          if (size < 1_500_000) saveLocal(LS.students(adminUid, stageId), arr);
        } catch {
          /* تجاهل — الكاش الرئيسي (IndexedDB) يتولى الحفظ */
        }
        return arr;
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
    console.log(`[dataService] جاري حفظ البصمة للمسار: ${path}`);
    await set(ref(database, path), payload);
    console.log(`[dataService] ✅ حُفظت بصمة الطالب بنجاح: ${studentId}`);
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
