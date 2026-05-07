import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { Student, AttendanceRecord, AttendanceSession} from "../types/student";
import { User } from "../types/user";

// Get user data path
const getUserPath = (uid: string, path: string) => `userData/${uid}/${path}`;

// Students
export const saveStudents = async (uid: string, students: Student[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'students')), students);
  } catch (error) {
    console.error("Error saving students:", error);
    throw error;
  }
};

export const loadStudents = async (uid: string): Promise<Student[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'students')));
    return snapshot.exists() ? snapshot.val() : [];
  } catch (error) {
    console.error("Error loading students:", error);
    return [];
  }
};

// Attendance Records
export const saveAttendanceRecords = async (uid: string, records: AttendanceRecord[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'attendanceRecords')), records);
  } catch (error) {
    console.error("Error saving attendance records:", error);
    throw error;
  }
};

export const loadAttendanceRecords = async (uid: string): Promise<AttendanceRecord[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'attendanceRecords')));
    return snapshot.exists() ? snapshot.val() : [];
  } catch (error) {
    console.error("Error loading attendance records:", error);
    return [];
  }
};

// Sessions
export const saveSessions = async (uid: string, sessions: AttendanceSession[]): Promise<void> => {
  try {
    await set(ref(database, getUserPath(uid, 'sessions')), sessions);
  } catch (error) {
    console.error("Error saving sessions:", error);
    throw error;
  }
};

export const loadSessions = async (uid: string): Promise<AttendanceSession[]> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'sessions')));
    return snapshot.exists() ? snapshot.val() : [];
  } catch (error) {
    console.error("Error loading sessions:", error);
    return [];
  }
};

// Active Session
export const saveActiveSession = async (uid: string, sessionId: string | null): Promise<void> => {
  try {
    if (sessionId) {
      await set(ref(database, getUserPath(uid, 'activeSession')), sessionId);
    } else {
      await remove(ref(database, getUserPath(uid, 'activeSession')));
    }
  } catch (error) {
    console.error("Error saving active session:", error);
    throw error;
  }
};

export const loadActiveSession = async (uid: string): Promise<string | null> => {
  try {
    const snapshot = await get(ref(database, getUserPath(uid, 'activeSession')));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error loading active session:", error);
    return null;
  }
};

// Sync all data
export const syncAllData = async (
  uid: string,
  students: Student[],
  records: AttendanceRecord[],
  sessions: AttendanceSession[],
  activeSessionId: string | null
): Promise<void> => {
  try {
    const updates: any = {};
    updates[getUserPath(uid, 'students')] = students;
    updates[getUserPath(uid, 'attendanceRecords')] = records;
    updates[getUserPath(uid, 'sessions')] = sessions;
    
    if (activeSessionId) {
      updates[getUserPath(uid, 'activeSession')] = activeSessionId;
    }
    
    await update(ref(database), updates);
  } catch (error) {
    console.error("Error syncing data:", error);
    throw error;
  }
};

// Load all data
export const loadAllData = async (uid: string): Promise<{
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
}> => {
  try {
    const [students, attendanceRecords, sessions, activeSessionId] = await Promise.all([
      loadStudents(uid),
      loadAttendanceRecords(uid),
      loadSessions(uid),
      loadActiveSession(uid)
    ]);
    
    return {
      students,
      attendanceRecords,
      sessions,
      activeSessionId
    };
  } catch (error) {
    console.error("Error loading all data:", error);
    return {
      students: [],
      attendanceRecords: [],
      sessions: [],
      activeSessionId: null
    };
  }
};


export const saveUserData = async (
  uid: string,
  userData: User
) => {
  try {
    await set(ref(database, `users/${uid}`), userData);
  } catch (error) {
    console.error('Error saving user data:', error);
  }
};