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
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.colleges;
      const key = `colleges:${currentUser.uid}`;
      if (consumeChange(lastSavedRef.current, key, colleges, force)) {
        saveColleges(currentUser.uid, colleges, force);
      }
      if (force) intentionalDeleteRef.current.colleges = false;
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [colleges, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.stages;
      const key = `stages:${currentUser.uid}`;
      if (consumeChange(lastSavedRef.current, key, stages, force)) {
        saveStages(currentUser.uid, stages, force);
      }
      if (force) intentionalDeleteRef.current.stages = false;
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [stages, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId && (currentUser.role === 'admin' || currentUser.role === 'college_admin'))) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.students;
      const adminUid = getAdminUid();
      const key = `students:${adminUid}:${selectedStageId}`;
      if (consumeChange(lastSavedRef.current, key, students, force)) {
        saveStudents(adminUid, selectedStageId, students, force);
      }
      if (force) intentionalDeleteRef.current.students = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { records: [], sessions: [] }), students },
        }));
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [students, currentUser, dataLoaded, selectedStageId, universityDataLoaded, intentionalDeleteRef, getAdminUid, setAllStagesData]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.records;
      const adminUid = getAdminUid();
      const teacherId = getTeacherId();
      const key = `records:${adminUid}:${selectedStageId}:${teacherId}`;
      if (consumeChange(lastSavedRef.current, key, attendanceRecords, force)) {
        saveAttendanceRecords(adminUid, selectedStageId, teacherId, attendanceRecords, force);
      }
      if (force) intentionalDeleteRef.current.records = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], sessions: [] }), records: attendanceRecords },
        }));
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [attendanceRecords, currentUser, dataLoaded, selectedStageId, universityDataLoaded, intentionalDeleteRef, getAdminUid, getTeacherId, setAllStagesData]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.sessions;
      const adminUid = getAdminUid();
      const teacherId = getTeacherId();
      const key = `sessions:${adminUid}:${selectedStageId}:${teacherId}`;
      if (consumeChange(lastSavedRef.current, key, sessions, force)) {
        saveSessions(adminUid, selectedStageId, teacherId, sessions, force);
      }
      if (force) intentionalDeleteRef.current.sessions = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], records: [] }), sessions },
        }));
      }
    }, 500);
    return () => clearTimeout(timeoutId);
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
