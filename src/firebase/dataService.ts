import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession, Stage, College } from "../types/student";
import { User } from "../types/user";

// ============================================================
// 🔑 المسارات الجديدة
// ============================================================
// userData/{adminUid}/colleges/{collegeId} → بيانات الكلية
// userData/{adminUid}/stages/{stageId} → بيانات المرحلة
// userData/{adminUid}/stageData/{stageId}/students → طلاب المرحلة
// userData/{adminUid}/stageData/{stageId}/records → سجلات
// userData/{adminUid}/stageData/{stageId}/sessions → جلسات

const getStagePath = (adminUid: string, stageId: string, sub: string) => 
  `userData/${adminUid}/stageData/${stageId}/${sub}`;

const getCollegesPath = (adminUid: string) => 
  `userData/${adminUid}/colleges`;

const getStagesPath = (adminUid: string) => 
  `userData/${adminUid}/stages`;

// ============================================================
// 💾 LOCAL STORAGE
// ============================================================
const LS = {
  colleges: (uid: string) => `colleges_${uid}`,
  stages: (uid: string) => `stages_${uid}`,
  students: (uid: string, sid: string) => `students_${uid}_${sid}`,
  records: (uid: string, sid: string) => `records_${uid}_${sid}`,
  sessions: (uid: string, sid: string) => `sessions_${uid}_${sid}`,
  activeSession: (uid: string, sid: string) => `activeSession_${uid}_${sid}`,
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
// 🏛️ COLLEGES (الكليات)
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
    console.log('✅ Colleges saved');
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
// 📖 STAGES (المراحل)
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
    console.log('✅ Stages saved');
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
// 👥 STUDENTS (طلاب المرحلة)
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
    console.log('✅ Students saved for stage:', stageId);
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
// 📝 ATTENDANCE RECORDS
// ============================================================

export const saveAttendanceRecords = async (
  adminUid: string,
  stageId: string,
  records: AttendanceRecord[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceRecord[]>(LS.records(adminUid, stageId), []);
    if (isDangerousEmpty(records, local)) {
      console.warn('🛑 منع حفظ سجلات فارغة');
      return;
    }
  }
  saveLocal(LS.records(adminUid, stageId), records);
  try {
    await set(ref(database, getStagePath(adminUid, stageId, 'records')), records);
    console.log('✅ Records saved');
  } catch (e) {
    console.warn('⚠️ فشل حفظ السجلات:', e);
  }
};

export const loadAttendanceRecords = async (
  adminUid: string,
  stageId: string
): Promise<AttendanceRecord[]> => {
  const local = loadLocal<AttendanceRecord[]>(LS.records(adminUid, stageId), []);
  try {
    const snap = await get(ref(database, getStagePath(adminUid, stageId, 'records')));
    if (snap.exists()) {
      const data = snap.val();
      const arr: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.records(adminUid, stageId), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📅 SESSIONS
// ============================================================

export const saveSessions = async (
  adminUid: string,
  stageId: string,
  sessions: AttendanceSession[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceSession[]>(LS.sessions(adminUid, stageId), []);
    if (isDangerousEmpty(sessions, local)) {
      console.warn('🛑 منع حفظ جلسات فارغة');
      return;
    }
  }
  saveLocal(LS.sessions(adminUid, stageId), sessions);
  try {
    await set(ref(database, getStagePath(adminUid, stageId, 'sessions')), sessions);
    console.log('✅ Sessions saved');
  } catch (e) {
    console.warn('⚠️ فشل حفظ الجلسات:', e);
  }
};

export const loadSessions = async (
  adminUid: string,
  stageId: string
): Promise<AttendanceSession[]> => {
  const local = loadLocal<AttendanceSession[]>(LS.sessions(adminUid, stageId), []);
  try {
    const snap = await get(ref(database, getStagePath(adminUid, stageId, 'sessions')));
    if (snap.exists()) {
      const data = snap.val();
      const arr: AttendanceSession[] = Array.isArray(data) ? data : Object.values(data);
      saveLocal(LS.sessions(adminUid, stageId), arr);
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 🎯 ACTIVE SESSION
// ============================================================

export const saveActiveSession = async (
  adminUid: string,
  stageId: string,
  sessionId: string | null
): Promise<void> => {
  saveLocal(LS.activeSession(adminUid, stageId), sessionId);
  try {
    if (sessionId) {
      await set(ref(database, getStagePath(adminUid, stageId, 'activeSession')), sessionId);
    } else {
      await remove(ref(database, getStagePath(adminUid, stageId, 'activeSession')));
    }
  } catch (e) {
    console.warn('⚠️ فشل حفظ الجلسة النشطة:', e);
  }
};

export const loadActiveSession = async (
  adminUid: string,
  stageId: string
): Promise<string | null> => {
  const local = loadLocal<string | null>(LS.activeSession(adminUid, stageId), null);
  try {
    const snap = await get(ref(database, getStagePath(adminUid, stageId, 'activeSession')));
    if (snap.exists()) {
      const value = snap.val();
      saveLocal(LS.activeSession(adminUid, stageId), value);
      return value;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📦 LOAD ALL STAGE DATA
// ============================================================

export const loadStageData = async (adminUid: string, stageId: string) => {
  const [students, records, sessions, activeSessionId] = await Promise.all([
    loadStudents(adminUid, stageId),
    loadAttendanceRecords(adminUid, stageId),
    loadSessions(adminUid, stageId),
    loadActiveSession(adminUid, stageId),
  ]);
  return { students, records, sessions, activeSessionId };
};

// ============================================================
// 🗑️ DELETE STAGE (يحذف كل بيانات المرحلة)
// ============================================================

export const deleteStageData = async (adminUid: string, stageId: string): Promise<void> => {
  try {
    await remove(ref(database, `userData/${adminUid}/stageData/${stageId}`));
    localStorage.removeItem(LS.students(adminUid, stageId));
    localStorage.removeItem(LS.records(adminUid, stageId));
    localStorage.removeItem(LS.sessions(adminUid, stageId));
    localStorage.removeItem(LS.activeSession(adminUid, stageId));
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
// 🔁 SYNC PENDING (للمستقبل)
// ============================================================

export const syncPendingChanges = async (_uid: string): Promise<void> => {
  console.log('ℹ️ No pending changes to sync');
};