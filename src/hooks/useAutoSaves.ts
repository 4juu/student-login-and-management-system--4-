import { useEffect, useRef, type MutableRefObject } from 'react';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
import { User } from '../types/user';
import {
  saveColleges,
  saveStages,
  saveStudents,
  saveAttendanceRecords,
  saveSessions,
  saveActiveSession,
} from '../firebase/dataService';
import { debouncedPreSave } from '../firebase/saveQueue';

export interface IntentionalDeleteFlags {
  students: boolean;
  records: boolean;
  sessions: boolean;
  colleges: boolean;
  stages: boolean;
}

interface UseAutoSavesParams {
  currentUser: User | null;
  dataLoaded: boolean;
  colleges: College[];
  stages: Stage[];
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  selectedStageId: string | null;
  universityDataLoaded: boolean;
  intentionalDeleteRef: MutableRefObject<IntentionalDeleteFlags>;
  getAdminUid: () => string;
  getTeacherId: () => string;
  setAllStagesData: React.Dispatch<React.SetStateAction<Record<string, { students: Student[]; records: AttendanceRecord[]; sessions: AttendanceSession[] }>>>;
}

/**
 * قرار الحفظ بمقارنة مرجعية رخيصة O(1) — بديل JSON.stringify الكامل
 * (المصفوفات تُبنى immutably في التطبيق ولا يوجد مستمع يعيد نفس المحتوى بمرجع جديد)
 * البذرة: أول ملاحظة تُخزَّن فقط (تمنع echo write عند التحميل)
 *
 * الجدولة عبر saveQueue.debouncedPreSave (موديول) لا setTimeout داخل useEffect —
 * كان cleanup يلغي المؤقّت عند أي تغيّر deps/تنقل ⇒ الحذف لا يُكتب أبداً
 * ويعود السجل عند إعادة الدخول للمرحلة.
 */
const consumeChange = (
  saved: Map<string, unknown>,
  key: string,
  value: unknown,
  force: boolean
): boolean => {
  if (force) {
    saved.set(key, value);
    return true;
  }
  const last = saved.get(key);
  if (last === undefined) {
    saved.set(key, value);
    return false;
  }
  if (last === value) return false;
  saved.set(key, value);
  return true;
};

export function useAutoSaves({
  currentUser,
  dataLoaded,
  colleges,
  stages,
  students,
  attendanceRecords,
  sessions,
  activeSessionId,
  selectedStageId,
  universityDataLoaded,
  intentionalDeleteRef,
  getAdminUid,
  getTeacherId,
  setAllStagesData,
}: UseAutoSavesParams) {
  // آخر قيمة حُفظت/فُرِّغت لكل مفتاح (يشمل stageId) — مقارنة مرجعية بدل hash نصّي
  const lastSavedRef = useRef<Map<string, unknown>>(new Map());
  const lastActiveSessionRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const key = `colleges:${currentUser.uid}`;
    debouncedPreSave(key, async () => {
      const force = intentionalDeleteRef.current.colleges;
      // الفارغ بلا حذف مقصود = echo لبيانات محمّلة — لا حفظ ولا تحذير
      if (consumeChange(lastSavedRef.current, key, colleges, force) && (force || colleges.length > 0)) {
        await saveColleges(currentUser.uid, colleges, force);
      }
      if (force) intentionalDeleteRef.current.colleges = false;
    });
  }, [colleges, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const key = `stages:${currentUser.uid}`;
    debouncedPreSave(key, async () => {
      const force = intentionalDeleteRef.current.stages;
      if (consumeChange(lastSavedRef.current, key, stages, force) && (force || stages.length > 0)) {
        await saveStages(currentUser.uid, stages, force);
      }
      if (force) intentionalDeleteRef.current.stages = false;
    });
  }, [stages, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId && (currentUser.role === 'admin' || currentUser.role === 'college_admin'))) return;
    const adminUid = getAdminUid();
    const teacherId = getTeacherId();
    const key = `students:${adminUid}:${selectedStageId}`;
    debouncedPreSave(key, async () => {
      const force = intentionalDeleteRef.current.students;
      if (consumeChange(lastSavedRef.current, key, students, force) && (force || students.length > 0)) {
        await saveStudents(adminUid, selectedStageId, students, force, teacherId);
      }
      if (force) intentionalDeleteRef.current.students = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { records: [], sessions: [] }), students },
        }));
      }
    });
  }, [students, currentUser, dataLoaded, selectedStageId, universityDataLoaded, intentionalDeleteRef, getAdminUid, getTeacherId, setAllStagesData]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId)) return;
    const adminUid = getAdminUid();
    const teacherId = getTeacherId();
    const key = `records:${adminUid}:${selectedStageId}:${teacherId}`;
    debouncedPreSave(key, async () => {
      const force = intentionalDeleteRef.current.records;
      if (consumeChange(lastSavedRef.current, key, attendanceRecords, force) && (force || attendanceRecords.length > 0)) {
        await saveAttendanceRecords(adminUid, selectedStageId, teacherId, attendanceRecords, force);
      }
      if (force) intentionalDeleteRef.current.records = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], sessions: [] }), records: attendanceRecords },
        }));
      }
    });
  }, [attendanceRecords, currentUser, dataLoaded, selectedStageId, universityDataLoaded, intentionalDeleteRef, getAdminUid, getTeacherId, setAllStagesData]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId)) return;
    const adminUid = getAdminUid();
    const teacherId = getTeacherId();
    const key = `sessions:${adminUid}:${selectedStageId}:${teacherId}`;
    debouncedPreSave(key, async () => {
      const force = intentionalDeleteRef.current.sessions;
      if (consumeChange(lastSavedRef.current, key, sessions, force) && (force || sessions.length > 0)) {
        await saveSessions(adminUid, selectedStageId, teacherId, sessions, force);
      }
      if (force) intentionalDeleteRef.current.sessions = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], records: [] }), sessions },
        }));
      }
    });
  }, [sessions, currentUser, dataLoaded, selectedStageId, universityDataLoaded, intentionalDeleteRef, getAdminUid, getTeacherId, setAllStagesData]);

  // activeSession: بذرة عند أول ملاحظة لكل مرحلة/معلّم + حارس "لم يتغيّر" — يمنع echo write عند التحميل
  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId)) return;
    const adminUid = getAdminUid();
    const teacherId = getTeacherId();
    const key = `${adminUid}:${selectedStageId}:${teacherId}`;
    if (!lastActiveSessionRef.current.has(key)) {
      lastActiveSessionRef.current.set(key, activeSessionId);
      return;
    }
    if (lastActiveSessionRef.current.get(key) === activeSessionId) return;
    lastActiveSessionRef.current.set(key, activeSessionId);
    saveActiveSession(adminUid, selectedStageId, teacherId, activeSessionId);
  }, [activeSessionId, currentUser, dataLoaded, selectedStageId, getAdminUid, getTeacherId]);
}
