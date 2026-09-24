// New academic year reset + database statistics

import { ref, set, get, remove, update, query, orderByChild, equalTo } from "firebase/database";
import { database } from "./config";
import {
  getActiveAcademicYear,
  setActiveAcademicYear,
  getNextAcademicYear,
  isValidAcademicYearFormat,
} from "./academicYear";
import { getYearBasePath, getCollegesPath, getStagesPath } from "./paths";
import { flushAllPendingSaves } from "./saveQueue";
import { clearLocalDatabases } from "../lib/offlineOutbox";

/**
 * بدء سنة أكاديمية جديدة
 * - يحذف جميع الطلاب وسجلات الحضور والجلسات فقط
 * - يُبقي الكليات والمراحل وحسابات التدريسيين
 * - يعطّل صلاحيات جميع التدريسيين (الحسابات تبقى)
 * - ينتقل إلى سنة أكاديمية جديدة (قابلة للتعديل يدوياً عبر newYear)
 *
 * ⚠️ تحذير: حذف الطلاب والسجلات لا يمكن التراجع عنه!
 */
export const resetAcademicYear = async (
  adminUid: string,
  options: { newYear?: string } = {}
): Promise<{ oldYear: string; newYear: string }> => {
  try {

    // 1️⃣ احفظ كل التعديلات المعلقة
    await flushAllPendingSaves();

    // 2️⃣ السنة الحالية والقادمة
    const oldYear = await getActiveAcademicYear();
    const newYear = options.newYear && isValidAcademicYearFormat(options.newYear)
      ? options.newYear.trim()
      : getNextAcademicYear(oldYear);

    if (newYear === oldYear) {
      throw new Error('يجب أن تختلف السنة الجديدة عن السنة الحالية');
    }


    // 3️⃣ انقل الكليات والمراحل وإعدادات التلغرام إلى السنة الجديدة
    // (قراءات صغيرة فقط حتى لا يتم تحميل بيانات الطلاب الضخمة وتجميد الواجهة)
    const preserved: { [key: string]: unknown } = {};

    const collegesSnap = await get(ref(database, getCollegesPath(oldYear, adminUid)));
    if (collegesSnap.exists()) preserved.colleges = collegesSnap.val();

    const stagesSnap = await get(ref(database, getStagesPath(oldYear, adminUid)));
    if (stagesSnap.exists()) preserved.stages = stagesSnap.val();

    const telegramSnap = await get(ref(database, `${getYearBasePath(oldYear, adminUid)}/telegramConfig`));
    if (telegramSnap.exists()) preserved.telegramConfig = telegramSnap.val();

    if (Object.keys(preserved).length > 0) {
      await update(ref(database, getYearBasePath(newYear, adminUid)), preserved);
    }

    // 4️⃣ احذف الطلاب وسجلات الحضور والجلسات وفهرس studentAttendance فقط من السنة القديمة
    await remove(ref(database, `${getYearBasePath(oldYear, adminUid)}/stageData`));
    await remove(ref(database, `${getYearBasePath(oldYear, adminUid)}/studentAttendance`));

    // 5️⃣ تعطيل صلاحيات كل التدريسيين (الحسابات تبقى)
    await deactivateAllTeachers(adminUid);

    // 6️⃣ امسح LocalStorage + IndexedDB بالكامل (إلا الإعدادات الشخصية)
    clearAllLocalData(adminUid);
    void clearLocalDatabases();

    // 7️⃣ حدّث السنة الأكاديمية الحالية
    await setActiveAcademicYear(newYear);

    // 8️⃣ سجّل عملية التصفير
    await set(ref(database, `system/metadata/lastReset`), {
      from: oldYear,
      to: newYear,
      resetAt: new Date().toISOString(),
      resetBy: adminUid
    });


    return { oldYear, newYear };
  } catch (e) {
    console.error('❌ فشل بدء السنة الجديدة:', e);
    throw new Error('فشل بدء السنة الجديدة. تأكد من اتصالك بالإنترنت.');
  }
};

/** تعطيل كل التدريسيين (يبقون مسجّلين لكن بدون صلاحيات) */
const deactivateAllTeachers = async (adminUid: string): Promise<void> => {
  try {
    // ✅ استعلام مفهرس (adminId) بدل سرد users كاملة
    const snap = await get(query(ref(database, 'users'), orderByChild('adminId'), equalTo(adminUid)));
    if (!snap.exists()) return;

    const updates: { [key: string]: any } = {};
    const now = new Date().toISOString();

    Object.entries(snap.val()).forEach(([uid, user]: [string, any]) => {
      // عطّل التدريسيين فقط (مو الأدمن)
      if (user.role === 'teacher') {
        updates[`users/${uid}/active`] = false;
        updates[`users/${uid}/deactivatedAt`] = now;
        updates[`users/${uid}/permissions`] = {
          allowedStages: {},
          canViewRecords: false,
          canTakeAttendance: false
        };
      }
    });

    if (Object.keys(updates).length > 0) {
      await update(ref(database), updates);
    }
  } catch (e) {
    console.warn('⚠️ فشل تعطيل التدريسيين:', e);
  }
};

/** مسح كل البيانات المحلية (LocalStorage) */
const clearAllLocalData = (adminUid: string): void => {
  const keysToRemove: string[] = [];

  Object.keys(localStorage).forEach((key) => {
    if (
      key.startsWith(`colleges_${adminUid}`) ||
      key.startsWith(`stages_${adminUid}`) ||
      key.startsWith(`students_${adminUid}_`) ||
      key.startsWith(`records_${adminUid}_`) ||
      key.startsWith(`sessions_${adminUid}_`) ||
      key.startsWith(`activeSession_${adminUid}_`)
    ) {
      keysToRemove.push(key);
    }
  });

  keysToRemove.forEach(k => localStorage.removeItem(k));
};

/** إحصائيات حجم البيانات للفاتورة والمراقبة */
export const getDatabaseStats = async (adminUid: string): Promise<{
  academicYear: string;
  totalSizeKB: number;
  collegesCount: number;
  stagesCount: number;
  totalStudents: number;
  totalRecords: number;
  totalSessions: number;
  totalTeachers: number;
  totalFaceDescriptors: number;
}> => {
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getYearBasePath(year, adminUid)));

    if (!snap.exists()) {
      return {
        academicYear: year,
        totalSizeKB: 0,
        collegesCount: 0,
        stagesCount: 0,
        totalStudents: 0,
        totalRecords: 0,
        totalSessions: 0,
        totalTeachers: 0,
        totalFaceDescriptors: 0,
      };
    }

    const data = snap.val();
    const jsonStr = JSON.stringify(data);
    const sizeKB = Math.round(jsonStr.length / 1024);

    const colleges = data.colleges ? (Array.isArray(data.colleges) ? data.colleges.length : Object.keys(data.colleges).length) : 0;
    const stages = data.stages ? (Array.isArray(data.stages) ? data.stages.length : Object.keys(data.stages).length) : 0;

    let totalStudents = 0;
    let totalRecords = 0;
    let totalSessions = 0;
    let totalTeachers = 0;
    let totalFaceDescriptors = 0;

    if (data.stageData) {
      Object.values(data.stageData).forEach((stage: any) => {
        if (stage.students) {
          const students = Array.isArray(stage.students) ? stage.students : Object.values(stage.students);
          totalStudents += students.length;
          totalFaceDescriptors += students.filter((s: any) => s.faceDescriptor).length;
        }
        if (stage.teacherRecords) {
          Object.values(stage.teacherRecords).forEach((teacher: any) => {
            totalTeachers++;
            if (teacher.records) {
              totalRecords += Array.isArray(teacher.records) ? teacher.records.length : Object.keys(teacher.records).length;
            }
            if (teacher.recordsCompressed) {
              totalRecords += Array.isArray(teacher.recordsCompressed) ? teacher.recordsCompressed.length : Object.keys(teacher.recordsCompressed).length;
            }
            if (teacher.sessions) {
              totalSessions += Array.isArray(teacher.sessions) ? teacher.sessions.length : Object.keys(teacher.sessions).length;
            }
          });
        }
      });
    }

    return {
      academicYear: year,
      totalSizeKB: sizeKB,
      collegesCount: colleges,
      stagesCount: stages,
      totalStudents,
      totalRecords,
      totalSessions,
      totalTeachers,
      totalFaceDescriptors,
    };
  } catch (e) {
    console.error('❌ فشل جلب الإحصائيات:', e);
    throw e;
  }
};
