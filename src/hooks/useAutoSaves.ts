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

/** بذرة/مقارنة hash لمنع echo writes: إعادة حفظ نفس ما وصل للتو من السيرفر */
const stableHash = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return `u_${Date.now()}`;
  }
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
  // hash آخر قيمة حُفظت/فُرِّغت لكل مفتاح (يشمل stageId) — المفتاح غير المعروف يُزرع فقط
  const lastSavedHashRef = useRef<Map<string, string>>(new Map());
  const lastActiveSessionRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.colleges;
      const key = `colleges:${currentUser.uid}`;
      const hash = stableHash(colleges);
      const last = lastSavedHashRef.current.get(key);
      if (!force) {
        if (last === undefined) {
          lastSavedHashRef.current.set(key, hash);
          return;
        }
        if (last === hash) return;
      }
      saveColleges(currentUser.uid, colleges, force);
      lastSavedHashRef.current.set(key, hash);
      if (force) intentionalDeleteRef.current.colleges = false;
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [colleges, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.stages;
      const key = `stages:${currentUser.uid}`;
      const hash = stableHash(stages);
      const last = lastSavedHashRef.current.get(key);
      if (!force) {
        if (last === undefined) {
          lastSavedHashRef.current.set(key, hash);
          return;
        }
        if (last === hash) return;
      }
      saveStages(currentUser.uid, stages, force);
      lastSavedHashRef.current.set(key, hash);
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
      const hash = stableHash(students);
      const last = lastSavedHashRef.current.get(key);
      if (!force) {
        if (last === undefined) {
          lastSavedHashRef.current.set(key, hash);
        } else if (last !== hash) {
          saveStudents(adminUid, selectedStageId, students, force);
          lastSavedHashRef.current.set(key, hash);
        }
      } else {
        saveStudents(adminUid, selectedStageId, students, force);
        lastSavedHashRef.current.set(key, hash);
        intentionalDeleteRef.current.students = false;
      }
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
      const hash = stableHash(attendanceRecords);
      const last = lastSavedHashRef.current.get(key);
      if (!force) {
        if (last === undefined) {
          lastSavedHashRef.current.set(key, hash);
        } else if (last !== hash) {
          saveAttendanceRecords(adminUid, selectedStageId, teacherId, attendanceRecords, force);
          lastSavedHashRef.current.set(key, hash);
        }
      } else {
        saveAttendanceRecords(adminUid, selectedStageId, teacherId, attendanceRecords, force);
        lastSavedHashRef.current.set(key, hash);
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
      const hash = stableHash(sessions);
      const last = lastSavedHashRef.current.get(key);
      if (!force) {
        if (last === undefined) {
          lastSavedHashRef.current.set(key, hash);
        } else if (last !== hash) {
          saveSessions(adminUid, selectedStageId, teacherId, sessions, force);
          lastSavedHashRef.current.set(key, hash);
        }
      } else {
        saveSessions(adminUid, selectedStageId, teacherId, sessions, force);
        lastSavedHashRef.current.set(key, hash);
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
