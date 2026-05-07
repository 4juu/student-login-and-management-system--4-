import { Student, AttendanceRecord, AttendanceSession } from '../types/student';

// DEPRECATED: This file is kept for backward compatibility only
// All data is now stored in Firebase Realtime Database
// No localStorage limits (5MB) - unlimited storage in Firebase!

const STORAGE_KEYS = {
  STUDENTS: 'attendance_system_students',
  ATTENDANCE_RECORDS: 'attendance_system_records',
  ATTENDANCE_SESSIONS: 'attendance_system_sessions',
  ACTIVE_SESSION: 'attendance_system_active_session',
  LAST_BACKUP: 'attendance_system_last_backup',
};

// Save students to localStorage with error handling
export const saveStudents = (students: Student[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
    console.log('✅ تم حفظ بيانات الطلاب بنجاح');
  } catch (error) {
    console.error('❌ خطأ في حفظ بيانات الطلاب:', error);
    alert('تحذير: لم يتم حفظ البيانات. تأكد من وجود مساحة كافية.');
  }
};

// Load students from localStorage
export const loadStudents = (): Student[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    if (saved) {
      const students = JSON.parse(saved);
      console.log(`✅ تم تحميل ${students.length} طالب من الذاكرة`);
      return students;
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل بيانات الطلاب:', error);
  }
  return [];
};

// Save attendance records to localStorage with error handling
export const saveAttendanceRecords = (records: AttendanceRecord[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE_RECORDS, JSON.stringify(records));
    console.log('✅ تم حفظ سجلات الحضور بنجاح');
  } catch (error) {
    console.error('❌ خطأ في حفظ سجلات الحضور:', error);
    alert('تحذير: لم يتم حفظ السجلات. تأكد من وجود مساحة كافية.');
  }
};

// Load attendance records from localStorage
export const loadAttendanceRecords = (): AttendanceRecord[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ATTENDANCE_RECORDS);
    if (saved) {
      const records = JSON.parse(saved);
      console.log(`✅ تم تحميل ${records.length} سجل حضور من الذاكرة`);
      return records;
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل سجلات الحضور:', error);
  }
  return [];
};

// Create backup of all data
export const createBackup = (): string => {
  const data = {
    students: loadStudents(),
    attendanceRecords: loadAttendanceRecords(),
    timestamp: new Date().toISOString(),
    version: '1.0',
  };
  
  localStorage.setItem(STORAGE_KEYS.LAST_BACKUP, new Date().toISOString());
  return JSON.stringify(data, null, 2);
};

// Restore from backup
export const restoreFromBackup = (backupData: string): boolean => {
  try {
    const data = JSON.parse(backupData);
    
    if (data.students && Array.isArray(data.students)) {
      saveStudents(data.students);
    }
    
    if (data.attendanceRecords && Array.isArray(data.attendanceRecords)) {
      saveAttendanceRecords(data.attendanceRecords);
    }
    
    return true;
  } catch (error) {
    console.error('❌ خطأ في استعادة النسخة الاحتياطية:', error);
    return false;
  }
};

// Download backup file
export const downloadBackup = (): void => {
  try {
    const backupData = createBackup();
    const blob = new Blob([backupData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const fileName = `نسخة_احتياطية_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert('✅ تم تنزيل النسخة الاحتياطية بنجاح!');
  } catch (error) {
    console.error('❌ خطأ في تنزيل النسخة الاحتياطية:', error);
    alert('❌ حدث خطأ أثناء إنشاء النسخة الاحتياطية');
  }
};

// Get storage usage info
export const getStorageInfo = (): { used: number; total: number; percentage: number } => {
  let used = 0;
  
  try {
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length;
      }
    }
  } catch (error) {
    console.error('خطأ في حساب المساحة المستخدمة:', error);
  }
  
  // localStorage typically has 5-10MB limit, we'll assume 5MB (5242880 bytes)
  const total = 5242880;
  const percentage = (used / total) * 100;
  
  return {
    used,
    total,
    percentage,
  };
};

// Save sessions to localStorage
export const saveSessions = (sessions: AttendanceSession[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE_SESSIONS, JSON.stringify(sessions));
    console.log('✅ تم حفظ السجلات بنجاح');
  } catch (error) {
    console.error('❌ خطأ في حفظ السجلات:', error);
  }
};

// Load sessions from localStorage
export const loadSessions = (): AttendanceSession[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ATTENDANCE_SESSIONS);
    if (saved) {
      const sessions = JSON.parse(saved);
      console.log(`✅ تم تحميل ${sessions.length} سجل`);
      return sessions;
    }
  } catch (error) {
    console.error('❌ خطأ في تحميل السجلات:', error);
  }
  return [];
};

// Save active session ID
export const saveActiveSession = (sessionId: string | null): void => {
  try {
    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, sessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
    }
  } catch (error) {
    console.error('❌ خطأ في حفظ السجل النشط:', error);
  }
};

// Load active session ID
export const loadActiveSession = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
  } catch (error) {
    console.error('❌ خطأ في تحميل السجل النشط:', error);
    return null;
  }
};

// Check if storage is available
export const isStorageAvailable = (): boolean => {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (error) {
    return false;
  }
};
