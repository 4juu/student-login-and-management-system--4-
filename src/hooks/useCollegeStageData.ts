import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Student, AttendanceRecord, AttendanceSession, College, Stage } from '../types/student';
import { User } from '../types/user';
import {
  saveColleges,
  saveStages,
  loadStageData,
  deleteStageData as deleteStageDataFromDB,
  flushAllPendingSaves,
  getCurrentAcademicYear,
} from '../firebase/dataService';
import { getCachedStageData, setCachedStageData } from '../lib/stageCache';

export interface StageLoadResult {
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
}

interface UseCollegeStageDataParams {
  currentUser: User | null;
  dataLoaded: boolean;
  setDataLoaded: (value: boolean) => void;
  getAdminUid: () => string;
  getTeacherId: () => string;
  onStageSelected?: (data: StageLoadResult) => void;
  onStageDeselected?: () => void;
  onStageDataDeleted?: (stageId: string) => void;
}

export default function useCollegeStageData({
  currentUser,
  dataLoaded,
  setDataLoaded,
  getAdminUid,
  getTeacherId,
  onStageSelected,
  onStageDeselected,
  onStageDataDeleted,
}: UseCollegeStageDataParams) {
  const [colleges, setColleges] = useState<College[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const intentionalDeleteRef = useRef({
    colleges: false,
    stages: false,
  });

  const userModifiedStudentsRef = useRef(false);

  const currentAcademicYear = getCurrentAcademicYear();

  // --- Derived ---
  const selectedStage = useMemo(
    () => stages.find(s => s.id === selectedStageId) ?? null,
    [stages, selectedStageId]
  );
  const selectedCollege = useMemo(
    () => colleges.find(c => c.id === selectedCollegeId) ?? null,
    [colleges, selectedCollegeId]
  );

  // --- Effects: Auto-save colleges/stages ---
  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.colleges;
      saveColleges(currentUser.uid, colleges, force);
      if (force) intentionalDeleteRef.current.colleges = false;
    }
  }, [colleges, currentUser, dataLoaded]);

  useEffect(() => {
    if (currentUser?.role === 'admin' && dataLoaded) {
      const force = intentionalDeleteRef.current.stages;
      saveStages(currentUser.uid, stages, force);
      if (force) intentionalDeleteRef.current.stages = false;
    }
  }, [stages, currentUser, dataLoaded]);

  // --- Handlers ---
  const handleSelectStage = useCallback(
    async (collegeId: string, stageId: string) => {
      setSelectedCollegeId(collegeId);
      setSelectedStageId(stageId);
      setDataLoaded(false);
      userModifiedStudentsRef.current = false;

      const adminUid = getAdminUid();
      const teacherId = getTeacherId();

      try {
        const cached = await getCachedStageData(adminUid, currentAcademicYear, stageId, teacherId);
        if (cached) {
          onStageSelected?.({
            students: cached.students,
            records: cached.records,
            sessions: cached.sessions,
            activeSessionId: cached.activeSessionId,
          });
          setDataLoaded(true);
        }
      } catch {
        // ignore — show normal loading screen
      }

      try {
        const data = await loadStageData(adminUid, stageId, teacherId);

        onStageSelected?.({
          students: data.students,
          records: data.records,
          sessions: data.sessions,
          activeSessionId: data.activeSessionId,
        });
        setDataLoaded(true);

        void setCachedStageData(adminUid, currentAcademicYear, stageId, teacherId, data);
      } catch (e) {
        console.error('Error loading stage:', e);
      } finally {
        setTimeout(() => setDataLoaded(true), 300);
      }
    },
    [currentUser, currentAcademicYear, getAdminUid, getTeacherId, setDataLoaded, onStageSelected]
  );

  const handleBackToStages = useCallback(() => {
    flushAllPendingSaves();
    setSelectedCollegeId(null);
    setSelectedStageId(null);
    onStageDeselected?.();
  }, [onStageDeselected]);

  const handleAddCollege = useCallback((college: College) => {
    setColleges(prev => [...prev, college]);
  }, []);

  const handleDeleteCollege = useCallback(
    (collegeId: string) => {
      intentionalDeleteRef.current.colleges = true;
      intentionalDeleteRef.current.stages = true;
      setColleges(prev => prev.filter(c => c.id !== collegeId));

      const stagesToDelete = stages.filter(s => s.collegeId === collegeId);
      setStages(prev => prev.filter(s => s.collegeId !== collegeId));

      stagesToDelete.forEach(stage => {
        deleteStageDataFromDB(currentUser!.uid, stage.id);
        onStageDataDeleted?.(stage.id);
      });
    },
    [stages, currentUser, onStageDataDeleted]
  );

  const handleAddStage = useCallback((stage: Stage) => {
    setStages(prev => [...prev, stage]);
  }, []);

  const handleDeleteStage = useCallback(
    (stageId: string) => {
      intentionalDeleteRef.current.stages = true;
      setStages(prev => prev.filter(s => s.id !== stageId));
      deleteStageDataFromDB(currentUser!.uid, stageId);
      onStageDataDeleted?.(stageId);
    },
    [currentUser, onStageDataDeleted]
  );

  const resetData = useCallback(() => {
    setDataLoaded(false);
    setColleges([]);
    setStages([]);
    setSelectedCollegeId(null);
    setSelectedStageId(null);
  }, [setDataLoaded]);

  return {
    colleges,
    setColleges,
    stages,
    setStages,
    selectedCollegeId,
    selectedStageId,
    selectedStage,
    selectedCollege,
    handleSelectStage,
    handleBackToStages,
    handleAddCollege,
    handleDeleteCollege,
    handleAddStage,
    handleDeleteStage,
    resetData,
  };
}
