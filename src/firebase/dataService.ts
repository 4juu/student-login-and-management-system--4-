import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession, Stage, College } from "../types/student";
import { User } from "../types/user";

// ============================================================
// 🔑 المسارات
// ============================================================
const getStagePath = (adminUid: string, stageId: string, sub: string) =>
  `userData/${adminUid}/stageData/${stageId}/${sub}`;

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
// ⏱️ DEBOUNCED SAVES (تقليل عمليات الكتابة بـ 80%)
// ============================================================
// الفكرة: بدل ما نرفع كل تعديل صغير لـ Firebase فوراً،
// ننتظر 2 ثانية، ولو إجى تعديل ثاني نلغي القديم.
// هذا يقلل كتابات Firebase بشكل كبير ويوفر Bandwidth.
// ============================================================

const SAVE_DELAY = 2000; // 2 ثانية
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaveFunctions = new Map<string, () => Promise<void>>();

const debouncedSave = (key: string, saveFn: () => Promise<void>): void => {
  // ألغِ الحفظ السابق المعلق
  const existing = pendingSaves.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // احفظ الدالة الأحدث
  pendingSaveFunctions.set(key, saveFn);

  // اجدول حفظ جديد
  const timeout = setTimeout(async () => {
    pendingSaves.delete(key);
    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      try {
        await fn();
        console.log(`💾 Debounced save: ${key}`);
      } catch (e) {
        console.warn(`⚠️ Debounced save failed: ${key}`, e);
      }
    }
  }, SAVE_DELAY);

  pendingSaves.set(key, timeout);
};

// 🆕 احفظ كل التعديلات المعلقة فوراً (يستدعى قبل المغادرة/تسجيل الخروج)
export const flushAllPendingSaves = async (): Promise<void> => {
  const keys = Array.from(pendingSaves.keys());
  if (keys.length === 0) return;

  console.log(`💾 Flushing ${keys.length} pending saves...`);

  for (const key of keys) {
    const timeout = pendingSaves.get(key);
    if (timeout) clearTimeout(timeout);
    pendingSaves.delete(key);

    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      try {
        await fn();
      } catch (e) {
        console.warn(`⚠️ Flush save failed: ${key}`, e);
      }
    }
  }
};

// 🆕 احفظ كل التعديلات المعلقة قبل إغلاق الصفحة
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // نلغي الـ timers ونحفظ مباشرة (sync)
    pendingSaves.forEach((timeout, key) => {
      clearTimeout(timeout);
      const fn = pendingSaveFunctions.get(key);
      if (fn) {
        // محاولة سريعة للحفظ (قد لا تنجح بسبب إغلاق الصفحة)
        fn().catch(() => {});
      }
    });
    pendingSaves.clear();
    pendingSaveFunctions.clear();
  });
}

// ============================================================
// 🏛️ COLLEGES (مشترك - مع Debounce)
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

  // ✅ احفظ محلياً فوراً
  saveLocal(LS.colleges(adminUid), colleges);

  // ⏱️ ارفع لـ Firebase بتأخير
  const saveKey = `colleges_${adminUid}`;
  debouncedSave(saveKey, async () => {
    try {
      await set(ref(database, getCollegesPath(adminUid)), colleges);
    } catch (e) {
      console.warn('⚠️ فشل حفظ الكليات:', e);
    }
  });
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
// 📖 STAGES (مشترك - مع Debounce)
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

  const saveKey = `stages_${adminUid}`;
  debouncedSave(saveKey, async () => {
    try {
      await set(ref(database, getStagesPath(adminUid)), stages);
    } catch (e) {
      console.warn('⚠️ فشل حفظ المراحل:', e);
    }
  });
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
// 👥 STUDENTS (مشترك - مع Debounce)
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

  const saveKey = `students_${adminUid}_${stageId}`;
  debouncedSave(saveKey, async () => {
    try {
      await set(ref(database, getStagePath(adminUid, stageId, 'students')), students);
    } catch (e) {
      console.warn('⚠️ فشل حفظ الطلاب:', e);
    }
  });
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
// 📝 ATTENDANCE RECORDS (منفصل لكل تدريسي - مع Debounce)
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

  const saveKey = `records_${adminUid}_${stageId}_${teacherId}`;
  debouncedSave(saveKey, async () => {
    try {
      await set(
        ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'records')),
        records
      );
    } catch (e) {
      console.warn('⚠️ فشل حفظ السجلات:', e);
    }
  });
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
// 📅 SESSIONS (منفصل لكل تدريسي - مع Debounce)
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

  const saveKey = `sessions_${adminUid}_${stageId}_${teacherId}`;
  debouncedSave(saveKey, async () => {
    try {
      await set(
        ref(database, getTeacherDataPath(adminUid, stageId, teacherId, 'sessions')),
        sessions
      );
    } catch (e) {
      console.warn('⚠️ فشل حفظ الجلسات:', e);
    }
  });
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
// 🎯 ACTIVE SESSION (فوري - مهم وسريع، بدون Debounce)
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
// 📦 LOAD ALL STAGE DATA
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
// 🗑️ DELETE STAGE
// ============================================================

export const deleteStageData = async (adminUid: string, stageId: string): Promise<void> => {
  try {
    // ألغِ أي حفظ معلق لهذه المرحلة
    const keysToCancel: string[] = [];
    pendingSaves.forEach((_, key) => {
      if (key.includes(stageId)) keysToCancel.push(key);
    });
    keysToCancel.forEach(key => {
      const timeout = pendingSaves.get(key);
      if (timeout) clearTimeout(timeout);
      pendingSaves.delete(key);
      pendingSaveFunctions.delete(key);
    });

    await remove(ref(database, `userData/${adminUid}/stageData/${stageId}`));
    localStorage.removeItem(LS.students(adminUid, stageId));

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
  // ✅ User data نادراً ما يتغير - استخدم Debounce خفيف (3 ثواني)
  const saveKey = `user_${uid}`;

  const existing = pendingSaves.get(saveKey);
  if (existing) clearTimeout(existing);

  pendingSaveFunctions.set(saveKey, async () => {
    try {
      await set(ref(database, `users/${uid}`), {
        ...userData,
        lastUpdated: new Date().toISOString()
      });
    } catch (e) {
      console.error('❌ Error saving user data:', e);
    }
  });

  const timeout = setTimeout(async () => {
    pendingSaves.delete(saveKey);
    const fn = pendingSaveFunctions.get(saveKey);
    pendingSaveFunctions.delete(saveKey);
    if (fn) await fn();
  }, 3000);

  pendingSaves.set(saveKey, timeout);
};

// ============================================================
// 🔁 SYNC PENDING
// ============================================================

export const syncPendingChanges = async (_uid: string): Promise<void> => {
  await flushAllPendingSaves();
};