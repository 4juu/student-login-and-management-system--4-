// Attendance records (compressed), sessions, active session, stage load/delete

import { ref, set, get, remove } from "firebase/database";
import { database } from "./config";
import { AttendanceRecord, AttendanceSession } from "../types/student";
import { getActiveAcademicYear } from "./academicYear";
import { getYearBasePath, getTeacherDataPath } from "./paths";
import { LS, saveLocal, loadLocal, isDangerousEmpty, stripUndefined } from "./localCache";
import { debouncedSave, cancelPendingSavesWhere } from "./saveQueue";
import { queueOutbox } from "../lib/offlineOutbox";
import { loadStudents, loadDescriptorOverrides } from "./studentsService";

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

    // جرب الصيغة المضغوطة أولاً
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

/** Load all stage data in parallel and merge descriptor overrides into students. */
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
  try {
    const overrides = await loadDescriptorOverrides(adminUid, stageId);
    if (overrides) {
      for (let i = 0; i < students.length; i++) {
        const ov = overrides[students[i].id];
        if (ov?.faceDescriptor && ov.updatedAt > 0) {
          students[i] = { ...students[i], faceDescriptor: ov.faceDescriptor };
        }
      }
    }
  } catch (e) { console.warn('[loadStageData] فشل دمج descriptorOverrides:', e); }
  return { students, records, sessions, activeSessionId };
};

export const deleteStageData = async (adminUid: string, stageId: string): Promise<void> => {
  try {
    cancelPendingSavesWhere(key => key.includes(stageId));

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
  } catch (e) {
    console.error('❌ فشل حذف بيانات المرحلة:', e);
  }
};
