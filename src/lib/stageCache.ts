import { Student, AttendanceRecord, AttendanceSession } from '../types/student';
import { dbGet, dbSet } from './db';

export interface StageCacheData {
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  cachedAt: number;
}

const cacheKey = (adminUid: string, year: string, stageId: string, teacherId: string): string =>
  `stage:${adminUid}:${year}:${stageId}:${teacherId}`;

// 🆕 قراءة كاش المرحلة من IndexedDB (مع احتياط من localStorage للتوافق مع النسخ السابقة)
export const getCachedStageData = async (
  adminUid: string,
  year: string,
  stageId: string,
  teacherId: string
): Promise<StageCacheData | null> => {
  try {
    const data = await dbGet<StageCacheData>(cacheKey(adminUid, year, stageId, teacherId));
    if (data && Array.isArray(data.students) && Array.isArray(data.records) && Array.isArray(data.sessions)) {
      return data;
    }
  } catch {
    // تجاهل - نكمل للاحتياط
  }

  try {
    const studentsRaw = localStorage.getItem(`students_${adminUid}_${stageId}`);
    const recordsRaw = localStorage.getItem(`records_${adminUid}_${stageId}_${teacherId}`);
    const sessionsRaw = localStorage.getItem(`sessions_${adminUid}_${stageId}_${teacherId}`);
    const activeRaw = localStorage.getItem(`activeSession_${adminUid}_${stageId}_${teacherId}`);

    if (studentsRaw && recordsRaw && sessionsRaw) {
      return {
        students: JSON.parse(studentsRaw) as Student[],
        records: JSON.parse(recordsRaw) as AttendanceRecord[],
        sessions: JSON.parse(sessionsRaw) as AttendanceSession[],
        activeSessionId: activeRaw ? (JSON.parse(activeRaw) as string | null) : null,
        cachedAt: Date.now(),
      };
    }
  } catch {
    // تجاهل
  }

  return null;
};

export const setCachedStageData = async (
  adminUid: string,
  year: string,
  stageId: string,
  teacherId: string,
  data: Omit<StageCacheData, 'cachedAt'>
): Promise<void> => {
  await dbSet(cacheKey(adminUid, year, stageId, teacherId), {
    ...data,
    cachedAt: Date.now(),
  });
};
