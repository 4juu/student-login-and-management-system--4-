import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession } from "../types/student";
import { User } from "../types/user";

const getUserPath = (uid: string, path: string) => `userData/${uid}/${path}`;

export const saveStudents = async (uid: string, students: Student[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'students')), students);
    console.log('✅ Students saved to Firebase');
  } catch (error) {
    console.error("❌ Error saving students:", error);
    throw error;
  }
};

export const loadStudents = async (uid: string): Promise<Student[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'students')));
    if (snapshot.exists()) {
      console.log('✅ Students loaded from Firebase');
      return snapshot.val();
    }
    return [];
  } catch (error) {
    console.error("❌ Error loading students:", error);
    return [];
  }
};

export const saveAttendanceRecords = async (uid: string, records: AttendanceRecord[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'attendanceRecords')), records);
    console.log('✅ Attendance records saved to Firebase');
  } catch (error) {
    console.error("❌ Error saving attendance records:", error);
    throw error;
  }
};

export const loadAttendanceRecords = async (uid: string): Promise<AttendanceRecord[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'attendanceRecords')));
    if (snapshot.exists()) {
      console.log('✅ Attendance records loaded from Firebase');
      return snapshot.val();
    }
    return [];
  } catch (error) {
    console.error("❌ Error loading attendance records:", error);
    return [];
  }
};

export const saveSessions = async (uid: string, sessions: AttendanceSession[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'sessions')), sessions);
    console.log('✅ Sessions saved to Firebase');
  } catch (error) {
    console.error("❌ Error saving sessions:", error);
    throw error;
  }
};

export const loadSessions = async (uid: string): Promise<AttendanceSession[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'sessions')));
    if (snapshot.exists()) {
      console.log('✅ Sessions loaded from Firebase');
      return snapshot.val();
    }
    return [];
  } catch (error) {
    console.error("❌ Error loading sessions:", error);
    return [];
  }
};

export const saveActiveSession = async (uid: string, sessionId: string | null): Promise<void> => {
  try {
    if (sessionId) {
      await set(ref(database, getUserPath(uid, 'activeSession')), sessionId);
      console.log('✅ Active session saved to Firebase');
    } else {
      await remove(ref(database, getUserPath(uid, 'activeSession')));
      console.log('✅ Active session removed from Firebase');
    }
  } catch (error) {
    console.error("❌ Error saving active session:", error);
    throw error;
  }
};

export const loadActiveSession = async (uid: string): Promise<string | null> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'activeSession')));
    if (snapshot.exists()) {
      console.log('✅ Active session loaded from Firebase');
      return snapshot.val();
    }
    return null;
  } catch (error) {
    console.error("❌ Error loading active session:", error);
    return null;
  }
};

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
    console.log('📥 Loading all data from Firebase for user:', uid);
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
    return { students: [], attendanceRecords: [], sessions: [], activeSessionId: null };
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
    console.log('✅ Data synced to Firebase');
  } catch (error) {
    console.error('❌ Error syncing local data:', error);
  }
};

export const deleteAllUserData = async (uid: string): Promise<void> => {
  try {
    await remove(ref(database, `userData/${uid}`));
    await remove(ref(database, `users/${uid}`));
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