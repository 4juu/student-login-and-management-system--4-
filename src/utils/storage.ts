/**
 * ⚠️ DEPRECATED - مهجور ⚠️
 * ============================================
 * هذا الملف لم يعد مستخدماً في النظام الجديد!
 * جميع البيانات تُحفظ الآن في Firebase Realtime Database
 * عبر `src/firebase/dataService.ts`
 * 
 * هذا الملف يبقى للتوافق العكسي فقط (Backward Compatibility)
 * لا تستخدم دواله في أي كود جديد!
 * 
 * استخدم بدلاً منه:
 * - saveStudents, loadStudents من dataService.ts
 * - saveAttendanceRecords, loadAttendanceRecords من dataService.ts
 * - downloadBackup, resetAcademicYear من dataService.ts (الجديدة!)
 * ============================================
 */

import { Student, AttendanceRecord, AttendanceSession } from '../types/student';

const STORAGE_KEYS = {
  STUDENTS: 'attendance_system_students',
  ATTENDANCE_RECORDS: 'attendance_system_records',
  ATTENDANCE_SESSIONS: 'attendance_system_sessions',
  ACTIVE_SESSION: 'attendance_system_active_session',
  LAST_BACKUP: 'attendance_system_last_backup',
};

// @deprecated استخدم saveStudents من dataService.ts
export const saveStudents = (students: Student[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  } catch (error) {
    console.error('❌ خطأ في حفظ بيانات الطلاب:', error);
  }
};

// @deprecated استخدم loadStudents من dataService.ts
export const loadStudents = (): Student[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.error('❌ خطأ في تحميل بيانات الطلاب:', error);
  }
  return [];
};

// @deprecated
export const saveAttendanceRecords = (records: AttendanceRecord[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE_RECORDS, JSON.stringify(records));
  } catch (error) {
    console.error('❌ خطأ:', error);
  }
};

// @deprecated
export const loadAttendanceRecords = (): AttendanceRecord[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ATTENDANCE_RECORDS);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.error('❌ خطأ:', error);
  }
  return [];
};

// @deprecated استخدم downloadBackup من dataService.ts
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

// @deprecated
export const restoreFromBackup = (backupData: string): boolean => {
  try {
    const data = JSON.parse(backupData);
    if (data.students && Array.isArray(data.students)) saveStudents(data.students);
    if (data.attendanceRecords && Array.isArray(data.attendanceRecords)) {
      saveAttendanceRecords(data.attendanceRecords);
    }
    return true;
  } catch (error) {
    console.error('❌ خطأ:', error);
    return false;
  }
};

// @deprecated استخدم downloadBackup من dataService.ts
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
    console.error('❌ خطأ:', error);
    alert('❌ حدث خطأ أثناء إنشاء النسخة الاحتياطية');
  }
};

export const getStorageInfo = (): { used: number; total: number; percentage: number } => {
  let used = 0;
  try {
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        used += localStorage[key].length + key.length;
      }
    }
  } catch (error) {
    console.error('خطأ:', error);
  }
  const total = 5242880;
  const percentage = (used / total) * 100;
  return { used, total, percentage };
};

export const saveSessions = (sessions: AttendanceSession[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE_SESSIONS, JSON.stringify(sessions));
  } catch (error) {
    console.error('❌ خطأ:', error);
  }
};

export const loadSessions = (): AttendanceSession[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.ATTENDANCE_SESSIONS);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.error('❌ خطأ:', error);
  }
  return [];
};

export const saveActiveSession = (sessionId: string | null): void => {
  try {
    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, sessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
    }
  } catch (error) {
    console.error('❌ خطأ:', error);
  }
};

export const loadActiveSession = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
  } catch (error) {
    console.error('❌ خطأ:', error);
    return null;
  }
};

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