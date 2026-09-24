// Attendance records (compressed), sessions, active session, stage load/delete

import { ref, set, get, remove, update } from "firebase/database";
import { database } from "./config";
import { AttendanceRecord, AttendanceSession } from "../types/student";
import { getActiveAcademicYear } from "./academicYear";
import { getYearBasePath, getTeacherDataPath, getStudentAttendancePath, getStudentAttendanceTidsPath } from "./paths";
import { LS, saveLocal, loadLocal, isDangerousEmpty, stripUndefined } from "./localCache";
import { debouncedSave, scheduleSave, cancelPendingSavesWhere, registerOutboxFallback } from "./saveQueue";
import { queueOutbox } from "../lib/offlineOutbox";
import { loadStudents, loadDescriptorOverrides } from "./studentsService";

// lastIndexed: recordId → studentId لكل مفتاح حفظ — لكتابة فارق فقط في فهرس studentAttendance
const attIndexState = new Map<string, Map<string, string>>();

const attIndexKey = (year: string, adminUid: string, stageId: string, teacherId: string) =>
  `${year}/${adminUid}/${stageId}/${teacherId}`;

/**
 * يبني تحديثات فهرس studentAttendance بالفارق فقط (ما تغيّر منذ آخر حفظ)
 * بدون إرسالها — لتجميعها مع كتابات أخرى في طلب update() واحد.
 */
export const buildStudentAttendanceIndexUpdates = async (
  year: string,
  adminUid: string,
  stageId: string,
  teacherId: string,
  records: AttendanceRecord[],
): Promise<Record<string, unknown>> => {
  const { compressRecord } = await import("./dataServiceCompressed");
  const key = attIndexKey(year, adminUid, stageId, teacherId);
  const prev = attIndexState.get(key);
  const current = new Map<string, string>();
  const updates: Record<string, unknown> = {};
  const base = getStudentAttendancePath(year, adminUid, stageId);

  for (const rec of records) {
    if (!rec?.id || !rec.studentId) continue;
    current.set(rec.id, rec.studentId);
    if (!prev || prev.get(rec.id) !== rec.studentId) {
      updates[`${base}/${rec.studentId}/${rec.id}`] = compressRecord(rec);
    }
  }

  if (prev) {
    for (const [rid, sid] of prev) {
      if (!current.has(rid)) {
        updates[`${base}/${sid}/${rid}`] = null;
      }
    }
  }

  updates[getStudentAttendanceTidsPath(year, adminUid, stageId) + `/${teacherId}`] = Date.now();
  attIndexState.set(key, current);
  return updates;
};

/**
 * يكتب فهرس studentAttendance بالفارق فقط (ما تغيّر منذ آخر حفظ).
 * يُستدعى من الحفظ المؤجّل ومن تطبيق outbox.
 */
export const writeStudentAttendanceIndex = async (
  year: string,
  adminUid: string,
  stageId: string,
  teacherId: string,
  records: AttendanceRecord[],
): Promise<void> => {
  const updates = await buildStudentAttendanceIndexUpdates(year, adminUid, stageId, teacherId, records);
  if (Object.keys(updates).length > 0) {
    await update(ref(database), updates);
  }
};

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

  const year = await getActiveAcademicYear();
  const saveKey = `records_${adminUid}_${stageId}_${teacherId}`;
  registerOutboxFallback(saveKey, saveKey, records, getTeacherDataPath(year, adminUid, stageId, teacherId, 'recordsCompressed'));

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(saveKey, records, getTeacherDataPath(year, adminUid, stageId, teacherId, 'recordsCompressed'));
  }

  debouncedSave(saveKey, async () => {
    const { compressRecord } = await import('./dataServiceCompressed');
    const compressed = records.map(compressRecord);
    const recordsPath = `${getYearBasePath(year, adminUid)}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;

    // طلب update() واحد: السجلات المضغوطة + فهرس studentAttendance (بدون round-trip ثانٍ)
    let indexUpdates: Record<string, unknown> = {};
    try {
      indexUpdates = await buildStudentAttendanceIndexUpdates(year, adminUid, stageId, teacherId, records);
    } catch (e) {
      console.warn('⚠️ فشل تحديث فهرس studentAttendance:', e);
    }
    await update(ref(database), { [recordsPath]: compressed, ...indexUpdates });
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

  const year = await getActiveAcademicYear();
  const saveKey = `sessions_${adminUid}_${stageId}_${teacherId}`;
  registerOutboxFallback(saveKey, saveKey, sessions, getTeacherDataPath(year, adminUid, stageId, teacherId, 'sessions'));

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    void queueOutbox(saveKey, sessions, getTeacherDataPath(year, adminUid, stageId, teacherId, 'sessions'));
  }

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
    const saveKey = `activeSession_${adminUid}_${stageId}_${teacherId}`;
    // نسخة احتياطية تُرفع عند عودة الاتصال (نفس نمط بقية الحفظ)
    registerOutboxFallback(saveKey, saveKey, sessionId, getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession'));

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void queueOutbox(saveKey, sessionId, getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession'));
    }

    // delay قصير (250ms) — الجلسة النشطة حساسة لزمن التبديل
    scheduleSave(saveKey, async () => {
      const path = getTeacherDataPath(year, adminUid, stageId, teacherId, 'activeSession');
      if (sessionId) {
        await set(ref(database, path), sessionId);
      } else {
        await remove(ref(database, path));
      }
    }, 250);
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
  const [students, records, sessions, activeSessionId, overrides] = await Promise.all([
    loadStudents(adminUid, stageId),
    loadAttendanceRecords(adminUid, stageId, teacherId),
    loadSessions(adminUid, stageId, teacherId),
    loadActiveSession(adminUid, stageId, teacherId),
    loadDescriptorOverrides(adminUid, stageId).catch(e => {
      console.warn('[loadStageData] فشل جلب descriptorOverrides:', e);
      return null;
    }),
  ]);
  if (overrides) {
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      if (!student) continue;
      const ov = overrides[student.id];
      if (ov?.faceDescriptor && ov.updatedAt > 0) {
        students[i] = { ...student, faceDescriptor: ov.faceDescriptor };
      }
    }
  }
  return { students, records, sessions, activeSessionId };
};

export const deleteStageData = async (adminUid: string, stageId: string): Promise<void> => {
  try {
    cancelPendingSavesWhere(key => key.includes(stageId));

    const year = await getActiveAcademicYear();
    await Promise.all([
      remove(ref(database, `${getYearBasePath(year, adminUid)}/stageData/${stageId}`)),
      remove(ref(database, `${getYearBasePath(year, adminUid)}/studentAttendance/${stageId}`)),
    ]);
    localStorage.removeItem(LS.students(adminUid, stageId));

    // مسح حالة فهرس studentAttendance في الذاكرة لهذه المرحلة
    for (const k of Array.from(attIndexState.keys())) {
      if (k.includes(`/${adminUid}/${stageId}/`)) attIndexState.delete(k);
    }

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
