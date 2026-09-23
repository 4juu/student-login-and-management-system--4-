import { useEffect, type MutableRefObject } from 'react';
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
  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.colleges;
      saveColleges(currentUser.uid, colleges, force);
      if (force) intentionalDeleteRef.current.colleges = false;
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [colleges, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser?.role === 'admin' && dataLoaded)) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.stages;
      saveStages(currentUser.uid, stages, force);
      if (force) intentionalDeleteRef.current.stages = false;
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [stages, currentUser, dataLoaded, intentionalDeleteRef]);

  useEffect(() => {
    if (!(currentUser && dataLoaded && selectedStageId && (currentUser.role === 'admin' || currentUser.role === 'college_admin'))) return;
    const timeoutId = setTimeout(() => {
      const force = intentionalDeleteRef.current.students;
      saveStudents(getAdminUid(), selectedStageId, students, force);
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
      saveAttendanceRecords(getAdminUid(), selectedStageId, getTeacherId(), attendanceRecords, force);
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
      saveSessions(getAdminUid(), selectedStageId, getTeacherId(), sessions, force);
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

  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      saveActiveSession(getAdminUid(), selectedStageId, getTeacherId(), activeSessionId);
    }
  }, [activeSessionId, currentUser, dataLoaded, selectedStageId, getAdminUid, getTeacherId]);
}
