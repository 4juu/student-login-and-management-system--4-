import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession, Stage, College } from "../types/student";
import { User } from "../types/user";

// ============================================================
// 🔑 المسارات
// ============================================================
// مشترك بين الأدمن وكل تدريسييه:
// userData/{adminUid}/colleges
// userData/{adminUid}/stages
// userData/{adminUid}/stageData/{stageId}/students
//
// 🆕 منفصل لكل تدريسي (والأدمن نفسه يعتبر تدريسي بسجله الخاص):
// userData/{adminUid}/stageData/{stageId}/teacherRecords/{teacherId}/records
// userData/{adminUid}/stageData/{stageId}/teacherRecords/{teacherId}/sessions
// userData/{adminUid}/stageData/{stageId}/teacherRecords/{teacherId}/activeSession
// ============================================================

const getStagePath = (adminUid: string, stageId: string, sub: string) =>
  `userData/${adminUid}/stageData/${stageId}/${sub}`;

// 🆕 مسار خاص بكل تدريسي
const getTeacherDataPath = (
  adminUid: string,
  stageId: string,
  teacherId: string,
  sub: string
) => `userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/${sub}`;

const getCollegesPath = (adminUid: string) => `userData/${adminUid}/colleges`;
const getStagesPath = (adminUid: string) => `userData/${adminUid}/stages`;

// ============================================================
// 💾 LOCAL STORAGE
// ============================================================
const LS = {
  colleges: (uid: string) => `colleges_${uid}`,
  stages: (uid: string) => `stages_${uid}`,
  students: (uid: string, sid: string) => `students_${uid}_${sid}`,
  // 🆕 السجلات والجلسات تتضمن teacherId
  records: (uid: string, sid: string, tid: string) => `records_${uid}_${sid}_${tid}`,
  sessions: (uid: string, sid: string, tid: string) => `sessions_${uid}_${sid}_${tid}`,
  activeSession: (uid: string, sid: string, tid: string) => `activeSession_${uid}_${sid}_${tid}`,
};

const saveLocal = (key: string, data: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
};

const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch { return fallback; }
};

const isDangerousEmpty = (newData: unknown[], localData: unknown[]): boolean => {
  return Array.isArray(newData) && newData.length === 0 &&
         Array.isArray(localData) && localData.length > 0;
};

// ============================================================
// 🏛️ COLLEGES (مشترك)
// ============================================================

export const saveColleges = async (
  adminUid: string,
  colleges: College[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<College[]>(LS.colleges(adminUid), []);
    if (isDangerousEmpty(colleges, local)) {
      console.warn('🛑 منع حفظ كليات فارغة');
      return;
    }
  }
  saveLocal(LS.colleges(adminUid), colleges);
  try {
    await set(ref(database, getCollegesPath(adminUid)), colleges);
  } catch (e) {
    console.warn('⚠️ فشل حفظ الكليات:', e);
  }
};

export const loadColleges = async (adminUid: string): Promise<College[]> => {
  const local = loadLocal<College[]>(LS.colleges(adminUid), []);
  try {
    const snap = await get(ref(database, getCollegesPath(adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: College[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.colleges(adminUid), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📖 STAGES (مشترك)
// ============================================================

export const saveStages = async (
  adminUid: string,
  stages: Stage[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<Stage[]>(LS.stages(adminUid), []);
    if (isDangerousEmpty(stages, local)) {
      console.warn('🛑 منع حفظ مراحل فارغة');
      return;
    }
  }
  saveLocal(LS.stages(adminUid), stages);
  try {
    await set(ref(database, getStagesPath(adminUid)), stages);
  } catch (e) {
    console.warn('⚠️ فشل حفظ المراحل:', e);
  }
};

export const loadStages = async (adminUid: string): Promise<Stage[]> => {
  const local = loadLocal<Stage[]>(LS.stages(adminUid), []);
  try {
    const snap = await get(ref(database, getStagesPath(adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: Stage[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.stages(adminUid), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 👥 STUDENTS (مشترك بين كل التدريسيين)
// ============================================================

export const saveStudents = async (
  adminUid: string,
  stageId: string,
  students: Student[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<Student[]>(LS.students(adminUid, stageId), []);
    if (isDangerousEmpty(students, local)) {
      console.warn('🛑 منع حفظ طلاب فارغين');
      return;
    }
  }
  saveLocal(LS.students(adminUid, stageId), students);
  try {
    await set(ref(database, getStagePath(adminUid, stageId, 'students')), students);
  } catch (e) {
    console.warn('⚠️ فشل حفظ الطلاب:', e);
  }
};

export const loadStudents = async (adminUid: string, stageId: string): Promise<Student[]> => {
  const local = loadLocal<Student[]>(LS.students(adminUid, stageId), []);
  try {
    const snap = await get(ref(database, getStagePath(adminUid, stageId, 'students')));
    if (snap.exists()) {
      const data = snap.val();
      const arr: Student[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.students(adminUid, stageId), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📝 ATTENDANCE RECORDS (🆕 منفصل لكل تدريسي)
// ============================================================

export const saveAttendanceRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  records: AttendanceRecord[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceRecord[]>(LS.records(adminUid, stageId, teacherId), []);
    if (isDangerousEmpty(records, local)) {
      console.warn('🛑 منع حفظ سجلات فارغة');
      return;
    }
  }
  saveLocal(LS.records(adminUid, stageId, teacherId), records);
  try {
    await set(
      ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'records')),
      records
    );
    console.log('✅ Records saved for teacher:', teacherId);
  } catch (e) {
    console.warn('⚠️ فشل حفظ السجلات:', e);
  }
};

export const loadAttendanceRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<AttendanceRecord[]> => {
  const local = loadLocal<AttendanceRecord[]>(LS.records(adminUid, stageId, teacherId), []);
  try {
    const snap = await get(
      ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'records'))
    );
    if (snap.exists()) {
      const data = snap.val();
      const arr: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.records(adminUid, stageId, teacherId), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📅 SESSIONS (🆕 منفصل لكل تدريسي)
// ============================================================

export const saveSessions = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  sessions: AttendanceSession[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceSession[]>(LS.sessions(adminUid, stageId, teacherId), []);
    if (isDangerousEmpty(sessions, local)) {
      console.warn('🛑 منع حفظ جلسات فارغة');
      return;
    }
  }
  saveLocal(LS.sessions(adminUid, stageId, teacherId), sessions);
  try {
    await set(
      ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'sessions')),
      sessions
    );
    console.log('✅ Sessions saved for teacher:', teacherId);
  } catch (e) {
    console.warn('⚠️ فشل حفظ الجلسات:', e);
  }
};

export const loadSessions = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<AttendanceSession[]> => {
  const local = loadLocal<AttendanceSession[]>(LS.sessions(adminUid, stageId, teacherId), []);
  try {
    const snap = await get(
      ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'sessions'))
    );
    if (snap.exists()) {
      const data = snap.val();
      const arr: AttendanceSession[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.sessions(adminUid, stageId, teacherId), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 🎯 ACTIVE SESSION (🆕 منفصل لكل تدريسي)
// ============================================================

export const saveActiveSession = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  sessionId: string | null
): Promise<void> => {
  saveLocal(LS.activeSession(adminUid, stageId, teacherId), sessionId);
  try {
    if (sessionId) {
      await set(
        ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'activeSession')),
        sessionId
      );
    } else {
      await remove(
        ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'activeSession'))
      );
    }
  } catch (e) {
    console.warn('⚠️ فشل حفظ الجلسة النشطة:', e);
  }
};

export const loadActiveSession = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<string | null> => {
  const local = loadLocal<string | null>(LS.activeSession(adminUid, stageId, teacherId), null);
  try {
    const snap = await get(
      ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'activeSession'))
    );
    if (snap.exists()) {
      const value = snap.val();
      saveLocal(LS.activeSession(adminUid, stageId, teacherId), value);
      return value;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📦 LOAD ALL STAGE DATA (🆕 يقبل teacherId)
// ============================================================

export const loadStageData = async (
  adminUid: string,
  stageId: string,
  teacherId: string
) => {
  const [students, records, sessions, activeSessionId] = await Promise.all([
    loadStudents(adminUid, stageId),
    loadAttendanceRecords(adminUid, stageId, teacherId),
    loadSessions(adminUid, stageId, teacherId),
    loadActiveSession(adminUid, stageId, teacherId),
  ]);
  return { students, records, sessions, activeSessionId };
};

// ============================================================
// 🗑️ DELETE STAGE (يحذف كل بيانات المرحلة لجميع التدريسيين)
// ============================================================

export const deleteStageData = async (adminUid: string, stageId: string): Promise<void> => {
  try {
    await remove(ref(database, `userData/${adminUid}/stageData/${stageId}`));
    localStorage.removeItem(LS.students(adminUid, stageId));
    // امسح كل مفاتيح السجلات/الجلسات لكل التدريسيين من localStorage
    Object.keys(localStorage).forEach((k) => {
      if (
        k.startsWith(`records_${adminUid}_${stageId}_`) ||
        k.startsWith(`sessions_${adminUid}_${stageId}_`) ||
        k.startsWith(`activeSession_${adminUid}_${stageId}_`)
      ) {
        localStorage.removeItem(k);
      }
    });
    console.log('✅ Stage data deleted:', stageId);
  } catch (e) {
    console.error('❌ فشل حذف بيانات المرحلة:', e);
  }
};

// ============================================================
// 👤 USER PROFILE
// ============================================================

export const saveUserProfile = async (uid: string, profileData: Partial<User>): Promise<void> => {
  try {
    await update(ref(database, `users/${uid}`), {
      ...profileData,
      lastUpdated: new Date().toISOString()
    });
  } catch (e) {
    console.error('❌ Error saving user profile:', e);
    throw e;
  }
};

export const loadUserProfile = async (uid: string): Promise<User | null> => {
  try {
    const snap = await get(ref(database, `users/${uid}`));
    return snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
};

export const saveUserData = async (uid: string, userData: User): Promise<void> => {
  try {
    await set(ref(database, `users/${uid}`), {
      ...userData,
      lastUpdated: new Date().toISOString()
    });
  } catch (e) {
    console.error('❌ Error saving user data:', e);
    throw e;
  }
};

// ============================================================
// 🔁 SYNC PENDING
// ============================================================

export const syncPendingChanges = async (_uid: string): Promise<void> => {
  console.log('ℹ️ No pending changes to sync');
};