import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession, Stage, College } from "../types/student";
import { User } from "../types/user";
import { TelegramConfig } from "../types/telegram";
import { queueOutbox, getOutboxEntries, clearOutbox, hasOutboxEntries } from "../lib/offlineOutbox";

// ============================================================
// 🔄 SAVE QUEUE مع Retry تلقائي (3 محاولات مع Exponential Backoff)
// ============================================================

const MAX_RETRIES = 3;
const retryQueues = new Map<string, { fn: () => Promise<void>; attempts: number }>();
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaveFunctions = new Map<string, () => Promise<void>>();

export const cancelAllPendingSaves = (): void => {
  for (const [key, timeout] of pendingSaves) {
    clearTimeout(timeout);
    pendingSaves.delete(key);
    pendingSaveFunctions.delete(key);
  }
  retryQueues.clear();
};

const retryWithBackoff = async (key: string, fn: () => Promise<void>, attempt: number = 1): Promise<void> => {
  try {
    await fn();
    retryQueues.delete(key);
  } catch (e) {
    console.warn(`⚠️ [${attempt}/${MAX_RETRIES}] فشلت محاولة الحفظ: ${key}`);
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(r => setTimeout(r, delay));
      return retryWithBackoff(key, fn, attempt + 1);
    }
    console.error(`❌ فشل الحفظ بعد ${MAX_RETRIES} محاولات: ${key}`, e);
    retryQueues.delete(key);
  }
};

export const getPendingSavesCount = (): number => retryQueues.size;

export const getDebouncedSavesCount = (): number => pendingSaves.size;

export const hasPendingWrites = async (): Promise<boolean> =>
  pendingSaves.size > 0 || retryQueues.size > 0 || (await hasOutboxEntries());

// ============================================================
// 🎓 ACADEMIC YEAR MANAGEMENT
// ============================================================
// السنة الأكاديمية تبدأ من سبتمبر وتنتهي في أغسطس
// مثال: من سبتمبر 2024 إلى أغسطس 2025 = "2024_2025"
// ============================================================

export const getCurrentAcademicYear = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  // إذا كنا في سبتمبر أو بعده، السنة الأكاديمية = السنة الحالية_السنة القادمة
  // إذا كنا قبل سبتمبر، السنة الأكاديمية = السنة الماضية_السنة الحالية
  if (month >= 9) {
    return `${year}_${year + 1}`;
  } else {
    return `${year - 1}_${year}`;
  }
};

// 🆕 الحصول على السنة الأكاديمية المحفوظة (أو الحالية)
let _cachedAcademicYear: string | null = null;

export const getActiveAcademicYear = async (): Promise<string> => {
  if (_cachedAcademicYear) return _cachedAcademicYear;
  
  try {
    const snap = await get(ref(database, 'system/metadata/currentAcademicYear'));
    if (snap.exists()) {
      _cachedAcademicYear = snap.val();
      return _cachedAcademicYear!;
    }
  } catch {}
  
  // إذا ما موجودة، احفظ السنة الحالية
  const current = getCurrentAcademicYear();
  try {
    await set(ref(database, 'system/metadata/currentAcademicYear'), current);
  } catch {}
  
  _cachedAcademicYear = current;
  return current;
};

// 🆕 تحديث السنة الأكاديمية (يستخدم عند التصفير)
const setActiveAcademicYear = async (year: string): Promise<void> => {
  _cachedAcademicYear = year;
  await set(ref(database, 'system/metadata/currentAcademicYear'), year);
};

// 🆕 عنوان النظام (يحفظه الأدمن الرئيسي من الإعدادات - يُعرض للجميع)
const SYSTEM_TITLE_DEFAULT = 'نظام إدارة الحضور الجامعي';

export const loadSystemTitle = async (): Promise<string> => {
  try {
    const snap = await get(ref(database, 'system/metadata/systemTitle'));
    if (snap.exists()) {
      const title = String(snap.val()).trim();
      if (title) return title;
    }
  } catch {}
  return SYSTEM_TITLE_DEFAULT;
};

export const saveSystemTitle = async (title: string): Promise<void> => {
  await set(ref(database, 'system/metadata/systemTitle'), title.trim());
};

// ============================================================
// 🔑 المسارات (الآن تحت academicYears)
// ============================================================

const getYearBasePath = (year: string, adminUid: string) =>
  `academicYears/${year}/userData/${adminUid}`;

const getStagePath = (year: string, adminUid: string, stageId: string, sub: string) =>
  `${getYearBasePath(year, adminUid)}/stageData/${stageId}/${sub}`;

const getTeacherDataPath = (
  year: string,
  adminUid: string,
  stageId: string,
  teacherId: string,
  sub: string
) => `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/${sub}`;

const getCollegesPath = (year: string, adminUid: string) => 
  `${getYearBasePath(year, adminUid)}/colleges`;

const getStagesPath = (year: string, adminUid: string) => 
  `${getYearBasePath(year, adminUid)}/stages`;

// ============================================================
// 💾 LOCAL STORAGE (نفس الكود السابق)
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

const isDangerousEmpty = (newData: unknown[]): boolean => {
  return Array.isArray(newData) && newData.length === 0;
};

const stripUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) clean[k] = v;
  }
  return clean;
};

// ============================================================
// ⏱️ DEBOUNCED SAVES (نفس الكود السابق)
// ============================================================

const SAVE_DELAY = 2000;

const debouncedSave = (key: string, saveFn: () => Promise<void>): void => {
  const existing = pendingSaves.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  pendingSaveFunctions.set(key, saveFn);

  const timeout = setTimeout(async () => {
    pendingSaves.delete(key);
    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      retryQueues.set(key, { fn, attempts: 0 });
      await retryWithBackoff(key, fn);
    }
  }, SAVE_DELAY);

  pendingSaves.set(key, timeout);
};

export const flushAllPendingSaves = async (): Promise<void> => {
  const keys = Array.from(pendingSaves.keys());
  if (keys.length === 0 && retryQueues.size === 0) return;

  console.log(`💾 Flushing ${keys.length + retryQueues.size} pending saves...`);

  for (const key of keys) {
    const timeout = pendingSaves.get(key);
    if (timeout) clearTimeout(timeout);
    pendingSaves.delete(key);

    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      retryQueues.set(key, { fn, attempts: 0 });
      await retryWithBackoff(key, fn);
    }
  }

  // Also flush any remaining retry items
  for (const [key, { fn, attempts }] of retryQueues) {
    await retryWithBackoff(key, fn, attempts + 1);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    pendingSaves.forEach((timeout, key) => {
      clearTimeout(timeout);
      const fn = pendingSaveFunctions.get(key);
      if (fn) {
        retryQueues.set(key, { fn, attempts: 0 });
        retryWithBackoff(key, fn).catch(() => {});
      }
    });
    pendingSaves.clear();
    pendingSaveFunctions.clear();
  });
}

// ============================================================
// 🏛️ COLLEGES
// ============================================================

export const saveColleges = async (
  adminUid: string,
  colleges: College[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(colleges)) {
      console.warn('🛑 منع حفظ كليات فارغة');
      return;
    }
  }

  saveLocal(LS.colleges(adminUid), colleges);

  const year = await getActiveAcademicYear();
  const saveKey = `colleges_${adminUid}`;
  
  debouncedSave(saveKey, async () => {
    await set(ref(database, getCollegesPath(year, adminUid)), colleges.map(c => stripUndefined(c as any)));
  });
};

export const loadColleges = async (adminUid: string): Promise<College[]> => {
  const local = loadLocal<College[]>(LS.colleges(adminUid), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getCollegesPath(year, adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: College[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.colleges(adminUid), arr);
      }
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📖 STAGES
// ============================================================

export const saveStages = async (
  adminUid: string,
  stages: Stage[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(stages)) {
      console.warn('🛑 منع حفظ مراحل فارغة');
      return;
    }
  }

  saveLocal(LS.stages(adminUid), stages);

  const year = await getActiveAcademicYear();
  const saveKey = `stages_${adminUid}`;
  
  debouncedSave(saveKey, async () => {
    await set(ref(database, getStagesPath(year, adminUid)), stages.map(s => stripUndefined(s as any)));
  });
};

export const loadStages = async (adminUid: string): Promise<Stage[]> => {
  const local = loadLocal<Stage[]>(LS.stages(adminUid), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(ref(database, getStagesPath(year, adminUid)));
    if (snap.exists()) {
      const data = snap.val();
      const arr: Stage[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.stages(adminUid), arr);
      }
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 👥 STUDENTS
// ============================================================

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
        saveLocal(LS.students(adminUid, stageId), arr);
        return arr;
      }
      return local;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 📝 ATTENDANCE RECORDS (مع الضغط الذكي التلقائي)
// ============================================================

export const saveAttendanceRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  records: AttendanceRecord[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(records)) {
      console.warn('🛑 منع حفظ سجلات فارغة');
      return;
    }
  }

  saveLocal(LS.records(adminUid, stageId, teacherId), records);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(`records_${adminUid}_${stageId}_${teacherId}`, records);
  }

  const year = await getActiveAcademicYear();
  const saveKey = `records_${adminUid}_${stageId}_${teacherId}`;
  
  debouncedSave(saveKey, async () => {
    const { compressRecord } = await import('./dataServiceCompressed');
    const compressed = records.map(compressRecord);
    
    await set(
      ref(database, `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`),
      compressed
    );
    
    console.log(`💾 حفظ مضغوط: ${records.length} سجل`);
  });
};

export const loadAttendanceRecords = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<AttendanceRecord[]> => {
  const local = loadLocal<AttendanceRecord[]>(LS.records(adminUid, stageId, teacherId), []);
  try {
    const year = await getActiveAcademicYear();
    
    // 🆕 جرب الصيغة المضغوطة أولاً
    const compressedPath = `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;
    const compressedSnap = await get(ref(database, compressedPath));
    
    if (compressedSnap.exists()) {
      const { decompressRecord } = await import('./dataServiceCompressed');
      const data = compressedSnap.val();
      const compressed = Array.isArray(data) ? data : Object.values(data);
      const decompressed = compressed.map((c: any) => decompressRecord(c));
      if (decompressed.length > 0 || local.length === 0) {
        saveLocal(LS.records(adminUid, stageId, teacherId), decompressed);
      }
      return decompressed;
    }
    
    // إذا ما لگى مضغوط، جرب القديم (للتوافق العكسي)
    const oldSnap = await get(
      ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'records'))
    );
    if (oldSnap.exists()) {
      const data = oldSnap.val();
      const arr: AttendanceRecord[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.records(adminUid, stageId, teacherId), arr);
      }
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
  teacherId: string,
  sessions: AttendanceSession[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    if (isDangerousEmpty(sessions)) {
      console.warn('🛑 منع حفظ جلسات فارغة');
      return;
    }
  }

  saveLocal(LS.sessions(adminUid, stageId, teacherId), sessions);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(`sessions_${adminUid}_${stageId}_${teacherId}`, sessions);
  }

  const year = await getActiveAcademicYear();
  const saveKey = `sessions_${adminUid}_${stageId}_${teacherId}`;
  
  debouncedSave(saveKey, async () => {
    await set(
      ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'sessions')),
      sessions.map(s => stripUndefined(s as any))
    );
  });
};

export const loadSessions = async (
  adminUid: string,
  stageId: string,
  teacherId: string
): Promise<AttendanceSession[]> => {
  const local = loadLocal<AttendanceSession[]>(LS.sessions(adminUid, stageId, teacherId), []);
  try {
    const year = await getActiveAcademicYear();
    const snap = await get(
      ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'sessions'))
    );
    if (snap.exists()) {
      const data = snap.val();
      const arr: AttendanceSession[] = Array.isArray(data) ? data : Object.values(data);
      if (arr.length > 0 || local.length === 0) {
        saveLocal(LS.sessions(adminUid, stageId, teacherId), arr);
      }
      return arr;
    }
    return local;
  } catch {
    return local;
  }
};

// ============================================================
// 🎯 ACTIVE SESSION (فوري بدون Debounce)
// ============================================================

export const saveActiveSession = async (
  adminUid: string,
  stageId: string,
  teacherId: string,
  sessionId: string | null
): Promise<void> => {
  saveLocal(LS.activeSession(adminUid, stageId, teacherId), sessionId);
  try {
    const year = await getActiveAcademicYear();
    if (sessionId) {
      await set(
        ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession')),
        sessionId
      );
    } else {
      await remove(
        ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession'))
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
    const year = await getActiveAcademicYear();
    const snap = await get(
      ref(database, getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession'))
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

    const year = await getActiveAcademicYear();
    await remove(ref(database, `${getYearBasePath(year, adminUid)}/stageData/${stageId}`));
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
// 👤 USER PROFILE (تبقى تحت /users/ مباشرة - مو تحت السنة)
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
  const saveKey = `user_${uid}`;

  const existing = pendingSaves.get(saveKey);
  if (existing) clearTimeout(existing);

  pendingSaveFunctions.set(saveKey, async () => {
    await set(ref(database, `users/${uid}`), {
      ...userData,
      lastUpdated: new Date().toISOString()
    });
  });

  const timeout = setTimeout(async () => {
    pendingSaves.delete(saveKey);
    const fn = pendingSaveFunctions.get(saveKey);
    pendingSaveFunctions.delete(saveKey);
    if (fn) {
      retryQueues.set(saveKey, { fn, attempts: 0 });
      await retryWithBackoff(saveKey, fn);
    }
  }, 3000);

  pendingSaves.set(saveKey, timeout);
};

// ============================================================
// 🔁 SYNC PENDING
// ============================================================

export const syncPendingChanges = async (_uid: string): Promise<void> => {
  await flushAllPendingSaves();
};

// ============================================================
// 📦 OUTBOX - رفع البيانات المحفوظة أثناء انقطاع الاتصال
// ============================================================

export const applyOutbox = async (): Promise<void> => {
  const entries = await getOutboxEntries();
  if (entries.length === 0) return;

  console.log(`📦 تطبيق ${entries.length} عنصر من صندوق الأوفلاين...`);
  const year = await getActiveAcademicYear();

  for (const entry of entries) {
    try {
      if (entry.key.startsWith('students_')) {
        const rest = entry.key.slice('students_'.length);
        const sid = rest.slice(rest.lastIndexOf('_') + 1);
        const uid = rest.slice(0, rest.lastIndexOf('_'));
        await set(
          ref(database, getStagePath(year, uid, sid, 'students')),
          (entry.data as unknown[]).map(stripUndefined as any)
        );
      } else if (entry.key.startsWith('records_')) {
        const rest = entry.key.slice('records_'.length);
        const tid = rest.slice(rest.lastIndexOf('_') + 1);
        const middle = rest.slice(0, rest.lastIndexOf('_'));
        const sid = middle.slice(middle.lastIndexOf('_') + 1);
        const uid = middle.slice(0, middle.lastIndexOf('_'));
        const { compressRecord } = await import('./dataServiceCompressed');
        const compressed = (entry.data as AttendanceRecord[]).map(compressRecord);
        await set(
          ref(database, `${getYearBasePath(year, uid)}/stageData/${sid}/teacherRecords/${tid}/recordsCompressed`),
          compressed
        );
      } else if (entry.key.startsWith('sessions_')) {
        const rest = entry.key.slice('sessions_'.length);
        const tid = rest.slice(rest.lastIndexOf('_') + 1);
        const middle = rest.slice(0, rest.lastIndexOf('_'));
        const sid = middle.slice(middle.lastIndexOf('_') + 1);
        const uid = middle.slice(0, middle.lastIndexOf('_'));
        await set(
          ref(database, getTeacherDataPath(year, uid, sid, tid, 'sessions')),
          (entry.data as unknown[]).map(stripUndefined as any)
        );
      }
    } catch (e) {
      console.error('❌ فشل تطبيق عنصر من صندوق الأوفلاين:', entry.key, e);
    }
  }

  await clearOutbox();
  console.log('✅ تم رفع صندوق الأوفلاين بالكامل');
};

// ============================================================
// 🆕 RESET (بدء سنة أكاديمية جديدة)
// ============================================================

/**
 * 🔢 حساب السنة الأكاديمية القادمة
 * مثال: "2024_2025" → "2025_2026"
 */
export const getNextAcademicYear = (currentYear: string): string => {
  const [start, end] = currentYear.split('_').map(Number);
  return `${start + 1}_${end + 1}`;
};

/**
 * ✅ التحقق من صيغة السنة الأكاديمية اليدوية
 * مثال صحيح: "2025_2026"
 */
export const isValidAcademicYearFormat = (year: string): boolean => {
  const match = /^(\d{4})_(\d{4})$/.exec(year.trim());
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end === start + 1;
};

/**
 * 🔄 بدء سنة أكاديمية جديدة
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
    console.log('🔄 بدء سنة أكاديمية جديدة...');
    
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
    
    console.log(`🗓️ الانتقال من ${oldYear} إلى ${newYear}`);
    
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
      console.log('✅ تم نقل الكليات والمراحل إلى السنة الجديدة');
    }
    
    // 4️⃣ احذف الطلاب وسجلات الحضور والجلسات فقط من السنة القديمة
    await remove(ref(database, `${getYearBasePath(oldYear, adminUid)}/stageData`));
    console.log('✅ تم حذف الطلاب وسجلات الحضور');
    
    // 5️⃣ تعطيل صلاحيات كل التدريسيين (الحسابات تبقى)
    await deactivateAllTeachers(adminUid);
    
    // 6️⃣ امسح LocalStorage بالكامل (إلا الإعدادات الشخصية)
    clearAllLocalData(adminUid);
    
    // 7️⃣ حدّث السنة الأكاديمية الحالية
    await setActiveAcademicYear(newYear);
    
    // 8️⃣ سجّل عملية التصفير
    await set(ref(database, `system/metadata/lastReset`), {
      from: oldYear,
      to: newYear,
      resetAt: new Date().toISOString(),
      resetBy: adminUid
    });
    
    console.log('✅ تم بدء السنة الجديدة بنجاح!');
    
    return { oldYear, newYear };
  } catch (e) {
    console.error('❌ فشل بدء السنة الجديدة:', e);
    throw new Error('فشل بدء السنة الجديدة. تأكد من اتصالك بالإنترنت.');
  }
};

/**
 * 🚫 تعطيل كل التدريسيين (يبقون مسجّلين لكن بدون صلاحيات)
 */
const deactivateAllTeachers = async (adminUid: string): Promise<void> => {
  try {
    const usersSnap = await get(ref(database, 'users'));
    if (!usersSnap.exists()) return;
    
    const allUsers = usersSnap.val();
    const updates: { [key: string]: any } = {};
    const now = new Date().toISOString();
    
    Object.entries(allUsers).forEach(([uid, user]: [string, any]) => {
      // عطّل التدريسيين فقط (مو الأدمن)
      if (user.role === 'teacher' && user.adminId === adminUid) {
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
      console.log(`✅ تم تعطيل ${Object.keys(updates).length / 3} تدريسي`);
    }
  } catch (e) {
    console.warn('⚠️ فشل تعطيل التدريسيين:', e);
  }
};

/**
 * 🧹 مسح كل البيانات المحلية (LocalStorage)
 */
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
  console.log(`🧹 تم مسح ${keysToRemove.length} عنصر من LocalStorage`);
};

// ============================================================
// 📊 STATISTICS (لمراقبة حجم البيانات والفاتورة)
// ============================================================

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

/**
 * 📋 عرض كل السنوات الأكاديمية الموجودة
 */
export const listAllAcademicYears = async (): Promise<string[]> => {
  try {
    const snap = await get(ref(database, 'academicYears'));
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).sort().reverse();
  } catch {
    return [];
  }
};

// ============================================================
// 🤖 TELEGRAM CONFIG
// ============================================================

export const saveTelegramConfig = async (
  adminUid: string,
  config: TelegramConfig
): Promise<void> => {
  const year = await getActiveAcademicYear();
  const path = `${getYearBasePath(year, adminUid)}/telegramConfig`;
  await set(ref(database, path), config);
  saveLocal(`telegramConfig_${adminUid}`, config);
};

export const loadTelegramConfig = async (
  adminUid: string
): Promise<TelegramConfig | null> => {
  const year = await getActiveAcademicYear();
  const path = `${getYearBasePath(year, adminUid)}/telegramConfig`;
  try {
    const snap = await get(ref(database, path));
    if (snap.exists()) {
      const config = snap.val() as TelegramConfig;
      saveLocal(`telegramConfig_${adminUid}`, config);
      return config;
    }
  } catch (e) {
    console.warn('⚠️ فشل تحميل تهيئة التلغرام:', e);
  }
  return loadLocal<TelegramConfig | null>(`telegramConfig_${adminUid}`, null);
};