import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession } from "../types/student";
import { User } from "../types/user";

const getUserPath = (uid: string, path: string) => `userData/${uid}/${path}`;

// ============================================================
// 🔒 نظام التخزين المحلي والحماية من فقدان البيانات
// ============================================================

const LS_KEYS = {
  students: (uid: string) => `students_${uid}`,
  records: (uid: string) => `records_${uid}`,
  sessions: (uid: string) => `sessions_${uid}`,
  activeSession: (uid: string) => `activeSession_${uid}`,
  pending: (uid: string) => `pending_${uid}`,
  lastSync: (uid: string) => `lastSync_${uid}`,
};

const saveLocal = (key: string, data: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('⚠️ فشل الحفظ المحلي:', e);
  }
};

const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const addPending = (uid: string, type: string, data: unknown): void => {
  const pending = loadLocal<Record<string, unknown>>(LS_KEYS.pending(uid), {});
  pending[type] = data;
  pending.timestamp = Date.now();
  saveLocal(LS_KEYS.pending(uid), pending);
};

// 🛑 الحماية الذهبية: منع حفظ array فاضي إذا المحلي فيه بيانات
const isDangerousEmpty = (newData: unknown[], localData: unknown[]): boolean => {
  return Array.isArray(newData) && newData.length === 0 && Array.isArray(localData) && localData.length > 0;
};

// 📦 نسخة احتياطية تلقائية
const createAutoBackup = (uid: string): void => {
  try {
    const backup = {
      students: loadLocal(LS_KEYS.students(uid), []),
      records: loadLocal(LS_KEYS.records(uid), []),
      sessions: loadLocal(LS_KEYS.sessions(uid), []),
      activeSession: loadLocal(LS_KEYS.activeSession(uid), null),
      timestamp: new Date().toISOString(),
    };
    const backupKey = `backup_${uid}_${Date.now()}`;
    saveLocal(backupKey, backup);

    // الاحتفاظ بآخر 5 نسخ فقط
    const allBackups = Object.keys(localStorage)
      .filter(k => k.startsWith(`backup_${uid}_`))
      .sort();
    if (allBackups.length > 5) {
      allBackups.slice(0, allBackups.length - 5).forEach(k => localStorage.removeItem(k));
    }
  } catch (e) {
    console.warn('فشل النسخ الاحتياطي:', e);
  }
};

// ============================================================
// 📚 STUDENTS
// ============================================================

export const saveStudents = async (
  uid: string, 
  students: Student[],
  forceDelete: boolean = false // ✅ هذا اللي كان يسبب الخطأ عندك، تم إضافته
): Promise<void> => {
  // 🛑 الحماية تتفعل فقط إذا لم يكن الحذف متعمداً
  if (!forceDelete) {
    const local = loadLocal<Student[]>(LS_KEYS.students(uid), []);
    if (isDangerousEmpty(students, local)) {
      console.warn('🛑 تم منع حفظ قائمة طلاب فارغة - يوجد بيانات محلية!');
      return;
    }
  }

  // 1️⃣ حفظ محلي فوري
  saveLocal(LS_KEYS.students(uid), students);
  createAutoBackup(uid);

  // 2️⃣ Firebase
  try {
    await set(ref(database, getUserPath(uid, 'students')), students);
    saveLocal(LS_KEYS.lastSync(uid), Date.now());
    console.log('✅ Students saved to Firebase');
  } catch (error) {
    console.warn("⚠️ فشل الحفظ في Firebase - محفوظ محلياً:", error);
    addPending(uid, 'students', students);
  }
};

export const loadStudents = async (uid: string): Promise<Student[]> => {
  const local = loadLocal<Student[]>(LS_KEYS.students(uid), []);
  
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'students')));
    if (snapshot.exists()) {
      const fbData = snapshot.val();
      const fbArray: Student[] = Array.isArray(fbData) ? fbData : Object.values(fbData);
      const result = fbArray.length >= local.length ? fbArray : local;
      saveLocal(LS_KEYS.students(uid), result);
      console.log('✅ Students loaded from Firebase');
      return result;
    }
    if (local.length > 0) {
      console.log('📦 Students loaded from local cache');
      return local;
    }
    return [];
  } catch (error) {
    console.warn("⚠️ فشل التحميل من Firebase - استخدام المحلي:", error);
    return local;
  }
};

// ============================================================
// 📝 ATTENDANCE RECORDS
// ============================================================

export const saveAttendanceRecords = async (
  uid: string, 
  records: AttendanceRecord[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceRecord[]>(LS_KEYS.records(uid), []);
    if (isDangerousEmpty(records, local)) {
      console.warn('🛑 تم منع حفظ سجل حضور فارغ - يوجد بيانات محلية!');
      return;
    }
  }

  saveLocal(LS_KEYS.records(uid), records);
  createAutoBackup(uid);

  try {
    await set(ref(database, getUserPath(uid, 'attendanceRecords')), records);
    saveLocal(LS_KEYS.lastSync(uid), Date.now());
    console.log('✅ Attendance records saved to Firebase');
  } catch (error) {
    console.warn("⚠️ فشل حفظ الحضور - محفوظ محلياً:", error);
    addPending(uid, 'attendanceRecords', records);
  }
};

export const loadAttendanceRecords = async (uid: string): Promise<AttendanceRecord[]> => {
  const local = loadLocal<AttendanceRecord[]>(LS_KEYS.records(uid), []);

  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'attendanceRecords')));
    if (snapshot.exists()) {
      const fbData = snapshot.val();
      const fbArray: AttendanceRecord[] = Array.isArray(fbData) ? fbData : Object.values(fbData);
      const result = fbArray.length >= local.length ? fbArray : local;
      saveLocal(LS_KEYS.records(uid), result);
      console.log('✅ Attendance records loaded from Firebase');
      return result;
    }
    if (local.length > 0) {
      console.log('📦 Records loaded from local cache');
      return local;
    }
    return [];
  } catch (error) {
    console.warn("⚠️ فشل تحميل الحضور - استخدام المحلي:", error);
    return local;
  }
};

// ============================================================
// 📅 SESSIONS
// ============================================================

export const saveSessions = async (
  uid: string, 
  sessions: AttendanceSession[],
  forceDelete: boolean = false
): Promise<void> => {
  if (!forceDelete) {
    const local = loadLocal<AttendanceSession[]>(LS_KEYS.sessions(uid), []);
    if (isDangerousEmpty(sessions, local)) {
      console.warn('🛑 تم منع حفظ سجلات فارغة - يوجد بيانات محلية!');
      return;
    }
  }

  saveLocal(LS_KEYS.sessions(uid), sessions);
  createAutoBackup(uid);

  try {
    await set(ref(database, getUserPath(uid, 'sessions')), sessions);
    saveLocal(LS_KEYS.lastSync(uid), Date.now());
    console.log('✅ Sessions saved to Firebase');
  } catch (error) {
    console.warn("⚠️ فشل حفظ السجلات - محفوظة محلياً:", error);
    addPending(uid, 'sessions', sessions);
  }
};

export const loadSessions = async (uid: string): Promise<AttendanceSession[]> => {
  const local = loadLocal<AttendanceSession[]>(LS_KEYS.sessions(uid), []);

  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'sessions')));
    if (snapshot.exists()) {
      const fbData = snapshot.val();
      const fbArray: AttendanceSession[] = Array.isArray(fbData) ? fbData : Object.values(fbData);
      const result = fbArray.length >= local.length ? fbArray : local;
      saveLocal(LS_KEYS.sessions(uid), result);
      console.log('✅ Sessions loaded from Firebase');
      return result;
    }
    if (local.length > 0) {
      console.log('📦 Sessions loaded from local cache');
      return local;
    }
    return [];
  } catch (error) {
    console.warn("⚠️ فشل تحميل السجلات - استخدام المحلي:", error);
    return local;
  }
};

// ============================================================
// 🎯 ACTIVE SESSION
// ============================================================

export const saveActiveSession = async (uid: string, sessionId: string | null): Promise<void> => {
  saveLocal(LS_KEYS.activeSession(uid), sessionId);

  try {
    if (sessionId) {
      await set(ref(database, getUserPath(uid, 'activeSession')), sessionId);
      console.log('✅ Active session saved to Firebase');
    } else {
      await remove(ref(database, getUserPath(uid, 'activeSession')));
      console.log('✅ Active session removed from Firebase');
    }
    saveLocal(LS_KEYS.lastSync(uid), Date.now());
  } catch (error) {
    console.warn("⚠️ فشل حفظ الجلسة النشطة - محفوظة محلياً:", error);
    addPending(uid, 'activeSession', sessionId);
  }
};

export const loadActiveSession = async (uid: string): Promise<string | null> => {
  const local = loadLocal<string | null>(LS_KEYS.activeSession(uid), null);

  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'activeSession')));
    if (snapshot.exists()) {
      const value = snapshot.val();
      saveLocal(LS_KEYS.activeSession(uid), value);
      console.log('✅ Active session loaded from Firebase');
      return value;
    }
    return local;
  } catch (error) {
    console.warn("⚠️ فشل تحميل الجلسة النشطة - استخدام المحلي:", error);
    return local;
  }
};

// ============================================================
// 👤 USER PROFILE
// ============================================================

export const saveUserProfile = async (
  uid: string,
  profileData: Partial<User>
): Promise<void> => {
  try {
    const userRef = ref(database, `users/${uid}`);
    await update(userRef, {
      ...profileData,
      lastUpdated: new Date().toISOString()
    });
    console.log('✅ User profile saved to Firebase');
  } catch (error) {
    console.error('❌ Error saving user profile:', error);
    throw error;
  }
};

export const loadUserProfile = async (uid: string): Promise<User | null> => {
  try {
    const userRef = ref(database, `users/${uid}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      console.log('✅ User profile loaded from Firebase');
      return snapshot.val();
    }
    console.log('⚠️ No user profile found in Firebase');
    return null;
  } catch (error) {
    console.error('❌ Error loading user profile:', error);
    return null;
  }
};

export const saveUserData = async (uid: string, userData: User): Promise<void> => {
  try {
    await set(ref(database, `users/${uid}`), {
      ...userData,
      lastUpdated: new Date().toISOString()
    });
    console.log('✅ Complete user data saved to Firebase');
  } catch (error) {
    console.error('❌ Error saving user data:', error);
    throw error;
  }
};

// ============================================================
// 🔄 SYNC ALL
// ============================================================

export const syncAllData = async (
  uid: string,
  students: Student[],
  records: AttendanceRecord[],
  sessions: AttendanceSession[],
  activeSessionId: string | null
): Promise<void> => {
  try {
    const updates: Record<string, unknown> = {};
    updates[getUserPath(uid, 'students')] = students;
    updates[getUserPath(uid, 'attendanceRecords')] = records;
    updates[getUserPath(uid, 'sessions')] = sessions;
    if (activeSessionId) {
      updates[getUserPath(uid, 'activeSession')] = activeSessionId;
    }
    await update(ref(database), updates);

    saveLocal(LS_KEYS.students(uid), students);
    saveLocal(LS_KEYS.records(uid), records);
    saveLocal(LS_KEYS.sessions(uid), sessions);
    saveLocal(LS_KEYS.activeSession(uid), activeSessionId);
    saveLocal(LS_KEYS.lastSync(uid), Date.now());

    console.log('✅ All data synced to Firebase');
  } catch (error) {
    console.error("❌ Error syncing data:", error);
    throw error;
  }
};

export const loadAllData = async (uid: string): Promise<{
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
}> => {
  try {
    console.log('📥 Loading all data for user:', uid);
    const [students, attendanceRecords, sessions, activeSessionId] = await Promise.all([
      loadStudents(uid),
      loadAttendanceRecords(uid),
      loadSessions(uid),
      loadActiveSession(uid)
    ]);
    console.log('✅ All data loaded successfully');
    return { students, attendanceRecords, sessions, activeSessionId };
  } catch (error) {
    console.error("❌ Error loading all data:", error);
    return {
      students: loadLocal<Student[]>(LS_KEYS.students(uid), []),
      attendanceRecords: loadLocal<AttendanceRecord[]>(LS_KEYS.records(uid), []),
      sessions: loadLocal<AttendanceSession[]>(LS_KEYS.sessions(uid), []),
      activeSessionId: loadLocal<string | null>(LS_KEYS.activeSession(uid), null),
    };
  }
};

// ============================================================
// 🔁 PENDING SYNC (مزامنة التغييرات المعلقة عند رجوع النت)
// ============================================================

export const syncPendingChanges = async (uid: string): Promise<void> => {
  const pending = loadLocal<Record<string, unknown>>(LS_KEYS.pending(uid), {});
  const keys = Object.keys(pending).filter(k => k !== 'timestamp');
  
  if (keys.length === 0) {
    console.log('ℹ️ لا توجد تغييرات معلقة');
    return;
  }

  console.log(`🔄 مزامنة ${keys.length} تغيير معلق...`);

  try {
    const updates: Record<string, unknown> = {};
    
    if (pending.students) {
      updates[getUserPath(uid, 'students')] = pending.students;
    }
    if (pending.attendanceRecords) {
      updates[getUserPath(uid, 'attendanceRecords')] = pending.attendanceRecords;
    }
    if (pending.sessions) {
      updates[getUserPath(uid, 'sessions')] = pending.sessions;
    }
    if (pending.activeSession !== undefined) {
      if (pending.activeSession) {
        updates[getUserPath(uid, 'activeSession')] = pending.activeSession;
      }
    }

    if (Object.keys(updates).length > 0) {
      await update(ref(database), updates);
      localStorage.removeItem(LS_KEYS.pending(uid));
      saveLocal(LS_KEYS.lastSync(uid), Date.now());
      console.log('✅ تمت مزامنة جميع التغييرات المعلقة');
    }
  } catch (error) {
    console.error('❌ فشلت مزامنة التغييرات المعلقة:', error);
  }
};

export const syncLocalDataToFirebase = async (uid: string): Promise<void> => {
  try {
    console.log('🔄 Syncing data to Firebase for user:', uid);
    const data = await loadAllData(uid);
    await syncAllData(
      uid,
      data.students,
      data.attendanceRecords,
      data.sessions,
      data.activeSessionId
    );
    await syncPendingChanges(uid);
    console.log('✅ Data synced to Firebase');
  } catch (error) {
    console.error('❌ Error syncing local data:', error);
  }
};

// ============================================================
// 🗑️ DELETE & BACKUP
// ============================================================

export const deleteAllUserData = async (uid: string): Promise<void> => {
  try {
    await remove(ref(database, `userData/${uid}`));
    await remove(ref(database, `users/${uid}`));
    
    Object.values(LS_KEYS).forEach(keyFn => {
      localStorage.removeItem(keyFn(uid));
    });
    Object.keys(localStorage)
      .filter(k => k.startsWith(`backup_${uid}_`))
      .forEach(k => localStorage.removeItem(k));
    
    console.log('✅ All user data deleted from Firebase');
  } catch (error) {
    console.error('❌ Error deleting user data:', error);
    throw error;
  }
};

export const backupAllData = async (uid: string): Promise<unknown> => {
  try {
    const allData = await loadAllData(uid);
    const userProfile = await loadUserProfile(uid);
    return {
      userData: allData,
      userProfile,
      timestamp: new Date().toISOString(),
      version: '2.0'
    };
  } catch (error) {
    console.error('❌ Error creating backup:', error);
    throw error;
  }
};

export const restoreFromBackup = async (uid: string, backup: {
  userData?: {
    students?: Student[];
    attendanceRecords?: AttendanceRecord[];
    sessions?: AttendanceSession[];
    activeSessionId?: string | null;
  };
  userProfile?: User;
}): Promise<void> => {
  try {
    if (backup.userData) {
      await syncAllData(
        uid,
        backup.userData.students || [],
        backup.userData.attendanceRecords || [],
        backup.userData.sessions || [],
        backup.userData.activeSessionId || null
      );
    }
    if (backup.userProfile) {
      await saveUserData(uid, backup.userProfile);
    }
    console.log('✅ Data restored from backup successfully');
  } catch (error) {
    console.error('❌ Error restoring from backup:', error);
    throw error;
  }
};

// ============================================================
// 🌐 مراقبة حالة النت
// ============================================================

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('🟢 رجع الاتصال بالإنترنت');
  });

  window.addEventListener('offline', () => {
    console.log('🔴 انقطع الاتصال بالإنترنت - الوضع المحلي');
  });
}