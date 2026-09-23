import { create } from 'zustand';
import type { SetStateAction } from 'react';
import type {
  Student,
  AttendanceRecord,
  AttendanceSession,
  College,
  Stage,
} from '../types/student';

const applyAction = <T>(prev: T, action: SetStateAction<T>): T =>
  typeof action === 'function' ? (action as (prev: T) => T)(prev) : action;

interface StageState {
  colleges: College[];
  stages: Stage[];
  selectedCollegeId: string | null;
  selectedStageId: string | null;
  students: Student[];
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  setColleges: (action: SetStateAction<College[]>) => void;
  setStages: (action: SetStateAction<Stage[]>) => void;
  setSelectedCollegeId: (id: string | null) => void;
  setSelectedStageId: (id: string | null) => void;
  setStudents: (action: SetStateAction<Student[]>) => void;
  setRecords: (action: SetStateAction<AttendanceRecord[]>) => void;
  setSessions: (action: SetStateAction<AttendanceSession[]>) => void;
  setActiveSessionId: (id: string | null) => void;
  clearStageSelection: () => void;
}

export const useStageStore = create<StageState>((set) => ({
  colleges: [],
  stages: [],
  selectedCollegeId: null,
  selectedStageId: null,
  students: [],
  records: [],
  sessions: [],
  activeSessionId: null,
  setColleges: (action) => set((s) => ({ colleges: applyAction(s.colleges, action) })),
  setStages: (action) => set((s) => ({ stages: applyAction(s.stages, action) })),
  setSelectedCollegeId: (selectedCollegeId) => set({ selectedCollegeId }),
  setSelectedStageId: (selectedStageId) => set({ selectedStageId }),
  setStudents: (action) => set((s) => ({ students: applyAction(s.students, action) })),
  setRecords: (action) => set((s) => ({ records: applyAction(s.records, action) })),
  setSessions: (action) => set((s) => ({ sessions: applyAction(s.sessions, action) })),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  clearStageSelection: () =>
    set({
      selectedCollegeId: null,
      selectedStageId: null,
      students: [],
      records: [],
      sessions: [],
      activeSessionId: null,
    }),
}));
