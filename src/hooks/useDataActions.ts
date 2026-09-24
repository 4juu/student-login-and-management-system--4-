// إجراءات CRUD للمجموعات — كانت موزعة كـ24 useCallback في App.tsx
// (فُصلت هنا: كل منطق الكليدج/المرحلة/الطلاب/السجلات/الجلسات في مكان واحد)
import { useCallback, type ReactNode } from 'react';
import type { College, Stage, Student, AttendanceRecord, AttendanceSession } from '../types/student';
import type { User } from '../types/user';
import { deleteStageData, cancelAllPendingSaves } from '../firebase/dataService';

type Updater<T> = T | ((prev: T) => T);

export type StagesDataMap = Record<
  string,
  { students: Student[]; records: AttendanceRecord[]; sessions: AttendanceSession[] }
>;

interface ConfirmAction {
  (options: { title: string; message?: string; confirmLabel?: string; icon?: ReactNode }): Promise<boolean>;
}

interface RefLike<T> {
  current: T;
}

interface IntentionalDeleteFlags {
  students: boolean;
  records: boolean;
  sessions: boolean;
  colleges: boolean;
  stages: boolean;
}

interface UseDataActionsParams {
  stages: Stage[];
  currentUser: User | null;
  confirmAction: ConfirmAction;
  intentionalDeleteRef: RefLike<IntentionalDeleteFlags>;
  userModifiedStudentsRef: RefLike<boolean>;
  processedAttendanceRef: RefLike<Set<string>>;
  markAbsentInFlightRef: RefLike<Set<string>>;
  setColleges: (v: Updater<College[]>) => void;
  setStages: (v: Updater<Stage[]>) => void;
  setStudents: (v: Updater<Student[]>) => void;
  setAttendanceRecords: (v: Updater<AttendanceRecord[]>) => void;
  setSessions: (v: Updater<AttendanceSession[]>) => void;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  setAllStagesData: (v: Updater<StagesDataMap>) => void;
}

export function useDataActions({
  stages,
  currentUser,
  confirmAction,
  intentionalDeleteRef,
  userModifiedStudentsRef,
  processedAttendanceRef,
  markAbsentInFlightRef,
  setColleges,
  setStages,
  setStudents,
  setAttendanceRecords,
  setSessions,
  activeSessionId,
  setActiveSessionId,
  setAllStagesData,
}: UseDataActionsParams) {
  const handleAddCollege = useCallback((college: College) => setColleges(prev => [...prev, college]), [setColleges]);

  const handleDeleteCollege = useCallback((collegeId: string) => {
    intentionalDeleteRef.current.colleges = true;
    intentionalDeleteRef.current.stages = true;
    setColleges(prev => prev.filter(c => c.id !== collegeId));
    const stagesToDelete = stages.filter(s => s.collegeId === collegeId);
    setStages(prev => prev.filter(s => s.collegeId !== collegeId));
    stagesToDelete.forEach(stage => {
      deleteStageData(currentUser!.uid, stage.id);
      setAllStagesData(prev => { const updated = { ...prev }; delete updated[stage.id]; return updated; });
    });
  }, [stages, currentUser, setColleges, setStages, setAllStagesData, intentionalDeleteRef]);

  const handleAddStage = useCallback((stage: Stage) => setStages(prev => [...prev, stage]), [setStages]);

  const handleDeleteStage = useCallback((stageId: string) => {
    intentionalDeleteRef.current.stages = true;
    setStages(prev => prev.filter(s => s.id !== stageId));
    deleteStageData(currentUser!.uid, stageId);
    setAllStagesData(prev => { const updated = { ...prev }; delete updated[stageId]; return updated; });
  }, [currentUser, setStages, setAllStagesData, intentionalDeleteRef]);

  const handleAddStudent = useCallback((student: Student) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, student]);
  }, [setStudents, userModifiedStudentsRef]);

  const handleAddMultipleStudents = useCallback((newStudents: Student[]) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, ...newStudents]);
  }, [setStudents, userModifiedStudentsRef]);

  const handleUpdateStudent = useCallback((id: string, updates: Partial<Student>) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev =>
      prev.map(student => {
        if (student.id !== id) return student;
        const merged: any = { ...student, ...updates };
        Object.keys(updates).forEach(key => {
          const value = (updates as any)[key];
          if (value === undefined || value === null || value === '') delete merged[key];
        });
        return merged as Student;
      })
    );
  }, [setStudents, userModifiedStudentsRef]);

  const handleDeleteStudent = useCallback(async (id: string) => {
    const ok = await confirmAction({
      title: 'حذف طالب',
      message: 'هل أنت متأكد من حذف هذا الطالب؟',
      confirmLabel: 'حذف',
    });
    if (ok) {
      userModifiedStudentsRef.current = true;
      intentionalDeleteRef.current.students = true;
      intentionalDeleteRef.current.records = true;
      setStudents(prev => prev.filter(s => s.id !== id));
      setAttendanceRecords(prev => prev.filter(r => r.studentId !== id));
    }
  }, [confirmAction, setStudents, setAttendanceRecords, intentionalDeleteRef, userModifiedStudentsRef]);

  const handleDeleteSelectedStudents = useCallback((ids: string[]) => {
    userModifiedStudentsRef.current = true;
    intentionalDeleteRef.current.students = true;
    intentionalDeleteRef.current.records = true;
    setStudents(prev => prev.filter(s => !ids.includes(s.id)));
    setAttendanceRecords(prev => prev.filter(r => !ids.includes(r.studentId)));
  }, [setStudents, setAttendanceRecords, intentionalDeleteRef, userModifiedStudentsRef]);

  const handleSortByName = useCallback(() => {
    setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  }, [setStudents]);

  const handleSortByGroup = useCallback(() => {
    setStudents(prev => [...prev].sort((a, b) => {
      const ga = a.group || 'ZZZ';
      const gb = b.group || 'ZZZ';
      const la = ga.charAt(0).toUpperCase();
      const lb = gb.charAt(0).toUpperCase();
      if (la !== lb) return la.localeCompare(lb);
      const na = parseInt(ga.slice(1)) || 0;
      const nb = parseInt(gb.slice(1)) || 0;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name, 'ar');
    }));
  }, [setStudents]);

  const handleAttendanceRecord = useCallback((record: AttendanceRecord) => {
    if (record.status === 'present') {
      const cacheKey = `${record.sessionId}_${record.studentId}`;
      if (processedAttendanceRef.current.has(cacheKey)) return;
      processedAttendanceRef.current.add(cacheKey);
      setAttendanceRecords(prev => {
        const filtered = prev.filter(
          r => !(r.sessionId === record.sessionId && r.studentId === record.studentId && r.status === 'absent')
        );
        return [...filtered, record];
      });
    } else {
      setAttendanceRecords(prev => [...prev, record]);
    }
  }, [setAttendanceRecords, processedAttendanceRef]);

  const handleClearRecords = useCallback(() => {
    cancelAllPendingSaves();
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setAttendanceRecords([]);
  }, [markAbsentInFlightRef, setAttendanceRecords, intentionalDeleteRef]);

  const handleUpdateRecord = useCallback((recordId: string, updates: Partial<AttendanceRecord>) => {
    setAttendanceRecords(prev => prev.map(r => r.id === recordId ? { ...r, ...updates } : r));
  }, [setAttendanceRecords]);

  const handleDeleteRecord = useCallback((recordId: string) => {
    intentionalDeleteRef.current.records = true;
    setAttendanceRecords(prev => prev.filter(r => r.id !== recordId));
  }, [setAttendanceRecords, intentionalDeleteRef]);

  const handleCreateSession = useCallback((session: AttendanceSession) => {
    setSessions(prev => [...prev.map(s => ({ ...s, isActive: false })), session]);
    setActiveSessionId(session.id);
  }, [setSessions, setActiveSessionId]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.map(s => ({ ...s, isActive: s.id === sessionId })));
    setActiveSessionId(sessionId);
  }, [setSessions, setActiveSessionId]);

  const handleRenameSession = useCallback((sessionId: string, newName: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName } : s));
  }, [setSessions]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    intentionalDeleteRef.current.sessions = true;
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  }, [activeSessionId, markAbsentInFlightRef, setSessions, setAttendanceRecords, setActiveSessionId, intentionalDeleteRef]);

  return {
    handleAddCollege,
    handleDeleteCollege,
    handleAddStage,
    handleDeleteStage,
    handleAddStudent,
    handleAddMultipleStudents,
    handleUpdateStudent,
    handleDeleteStudent,
    handleDeleteSelectedStudents,
    handleSortByName,
    handleSortByGroup,
    handleAttendanceRecord,
    handleClearRecords,
    handleUpdateRecord,
    handleDeleteRecord,
    handleCreateSession,
    handleSelectSession,
    handleRenameSession,
    handleDeleteSession,
  };
}
