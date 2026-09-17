import { useState, useEffect, useRef, useCallback } from 'react';
import { Student, AttendanceRecord, AttendanceSession, Stage } from '../types/student';
import { User } from '../types/user';
import { TelegramConfig, AbsenceSendLogEntry, GroupSendProgress } from '../types/telegram';
import { buildQueueFromGroups, sendQueuedMessages } from '../services/telegramService';
import {
  saveStudents,
  saveAttendanceRecords,
  saveSessions,
  saveActiveSession,
  cancelAllPendingSaves,
  getCurrentAcademicYear,
} from '../firebase/dataService';

export interface AllStagesData {
  [stageId: string]: {
    students: Student[];
    records: AttendanceRecord[];
    sessions: AttendanceSession[];
  };
}

export interface UseSessionDataParams {
  currentUser: User | null;
  getAdminUid: () => string;
  getTeacherId: () => string;
  selectedStageId: string | null;
  telegramConfig: TelegramConfig | null;
  stages: Stage[];
  dataLoaded: boolean;
  universityDataLoaded: boolean;
  allStagesData: AllStagesData;
  setAllStagesData: React.Dispatch<React.SetStateAction<AllStagesData>>;
  intentionalDeleteRef: React.MutableRefObject<Record<string, boolean>>;
}

export interface UseSessionDataReturn {
  students: Student[];
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>;
  attendanceRecords: AttendanceRecord[];
  setAttendanceRecords: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  sessions: AttendanceSession[];
  setSessions: React.Dispatch<React.SetStateAction<AttendanceSession[]>>;
  activeSessionId: string | null;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  profileStudent: Student | null;
  setProfileStudent: React.Dispatch<React.SetStateAction<Student | null>>;
  stageSyncing: boolean;
  setStageSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  userModifiedStudentsRef: React.MutableRefObject<boolean>;
  processedAttendanceRef: React.MutableRefObject<Set<string>>;
  markAbsentInFlightRef: React.MutableRefObject<Set<string>>;
  handleAddStudent: (student: Student) => void;
  handleAddMultipleStudents: (newStudents: Student[]) => void;
  handleUpdateStudent: (id: string, updates: Partial<Student>) => void;
  handleDeleteStudent: (id: string) => void;
  handleDeleteSelectedStudents: (ids: string[]) => void;
  handleSortByName: () => void;
  handleSortByGroup: () => void;
  handleAttendanceRecord: (record: AttendanceRecord) => void;
  handleClearRecords: () => void;
  handleUpdateRecord: (recordId: string, updates: Partial<AttendanceRecord>) => void;
  handleDeleteRecord: (recordId: string) => void;
  handleCreateSession: (session: AttendanceSession) => void;
  handleSelectSession: (sessionId: string) => void;
  handleRenameSession: (sessionId: string, newName: string) => void;
  handleDeleteSession: (sessionId: string) => void;
  handleMarkAbsent: (sessionId: string, studentIds: string[]) => void;
  sendModalOpen: boolean;
  setSendModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sendGroups: GroupSendProgress[];
  sendSubjectName: string;
  isSending: boolean;
  sendDoneCount: number;
  sendTotalGroups: number;
  currentSendingSessionId: string | null;
  absenceSendLogs: AbsenceSendLogEntry[];
  completedGroupData: Record<string, GroupSendProgress[]>;
}

export default function useSessionData({
  currentUser,
  getAdminUid,
  getTeacherId,
  selectedStageId,
  telegramConfig,
  stages,
  dataLoaded,
  universityDataLoaded,
  allStagesData: _allStagesData,
  setAllStagesData,
  intentionalDeleteRef,
}: UseSessionDataParams): UseSessionDataReturn {
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [stageSyncing, setStageSyncing] = useState(false);

  const userModifiedStudentsRef = useRef(false);
  const processedAttendanceRef = useRef(new Set<string>());
  const markAbsentInFlightRef = useRef(new Set<string>());

  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendGroups, setSendGroups] = useState<GroupSendProgress[]>([]);
  const [sendSubjectName, setSendSubjectName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendDoneCount, setSendDoneCount] = useState(0);
  const [sendTotalGroups, setSendTotalGroups] = useState(0);
  const sendAbortRef = useRef<AbortController | null>(null);
  const [currentSendingSessionId, setCurrentSendingSessionId] = useState<string | null>(null);
  const [absenceSendLogs, setAbsenceSendLogs] = useState<AbsenceSendLogEntry[]>([]);
  const [completedGroupData, setCompletedGroupData] = useState<Record<string, GroupSendProgress[]>>({});

  const currentAcademicYear = getCurrentAcademicYear();

  // ─── Auto-save students ───
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId && (currentUser.role === 'admin' || currentUser.role === 'college_admin')) {
      const force = intentionalDeleteRef.current.students;
      saveStudents(getAdminUid(), selectedStageId, students, force);
      if (force) intentionalDeleteRef.current.students = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { records: [], sessions: [] }), students },
        }));
      }
    }
  }, [students, currentUser, dataLoaded, selectedStageId, universityDataLoaded, getAdminUid, intentionalDeleteRef, setAllStagesData]);

  // ─── Auto-save attendance records ───
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.records;
      saveAttendanceRecords(getAdminUid(), selectedStageId, getTeacherId(), attendanceRecords, force);
      if (force) intentionalDeleteRef.current.records = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], sessions: [] }), records: attendanceRecords },
        }));
      }
    }
  }, [attendanceRecords, currentUser, dataLoaded, selectedStageId, universityDataLoaded, getAdminUid, getTeacherId, intentionalDeleteRef, setAllStagesData]);

  // ─── Auto-save sessions ───
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      const force = intentionalDeleteRef.current.sessions;
      saveSessions(getAdminUid(), selectedStageId, getTeacherId(), sessions, force);
      if (force) intentionalDeleteRef.current.sessions = false;
      if (currentUser.role === 'admin' && universityDataLoaded) {
        setAllStagesData(prev => ({
          ...prev,
          [selectedStageId]: { ...(prev[selectedStageId] || { students: [], records: [] }), sessions },
        }));
      }
    }
  }, [sessions, currentUser, dataLoaded, selectedStageId, universityDataLoaded, getAdminUid, getTeacherId, intentionalDeleteRef, setAllStagesData]);

  // ─── Auto-save activeSessionId ───
  useEffect(() => {
    if (currentUser && dataLoaded && selectedStageId) {
      saveActiveSession(getAdminUid(), selectedStageId, getTeacherId(), activeSessionId);
    }
  }, [activeSessionId, currentUser, dataLoaded, selectedStageId, getAdminUid, getTeacherId]);

  // ─── Handlers ───

  const handleAddStudent = useCallback((student: Student) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, student]);
  }, []);

  const handleAddMultipleStudents = useCallback((newStudents: Student[]) => {
    userModifiedStudentsRef.current = true;
    setStudents(prev => [...prev, ...newStudents]);
  }, []);

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
  }, []);

  const handleDeleteStudent = useCallback((id: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا الطالب؟')) {
      userModifiedStudentsRef.current = true;
      intentionalDeleteRef.current.students = true;
      intentionalDeleteRef.current.records = true;
      setStudents(prev => prev.filter(s => s.id !== id));
      setAttendanceRecords(prev => prev.filter(r => r.studentId !== id));
    }
  }, [intentionalDeleteRef]);

  const handleDeleteSelectedStudents = useCallback((ids: string[]) => {
    userModifiedStudentsRef.current = true;
    intentionalDeleteRef.current.students = true;
    intentionalDeleteRef.current.records = true;
    setStudents(prev => prev.filter(s => !ids.includes(s.id)));
    setAttendanceRecords(prev => prev.filter(r => !ids.includes(r.studentId)));
  }, [intentionalDeleteRef]);

  const handleSortByName = useCallback(() => {
    setStudents(prev => [...prev].sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  }, []);

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
  }, []);

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
  }, []);

  const handleClearRecords = useCallback(() => {
    cancelAllPendingSaves();
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setAttendanceRecords([]);
  }, [intentionalDeleteRef]);

  const handleUpdateRecord = useCallback((recordId: string, updates: Partial<AttendanceRecord>) => {
    setAttendanceRecords(prev => prev.map(r => r.id === recordId ? { ...r, ...updates } : r));
  }, []);

  const handleDeleteRecord = useCallback((recordId: string) => {
    intentionalDeleteRef.current.records = true;
    setAttendanceRecords(prev => prev.filter(r => r.id !== recordId));
  }, [intentionalDeleteRef]);

  const handleCreateSession = useCallback((session: AttendanceSession) => {
    setSessions(prev => [...prev.map(s => ({ ...s, isActive: false })), session]);
    setActiveSessionId(session.id);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.map(s => ({ ...s, isActive: s.id === sessionId })));
    setActiveSessionId(sessionId);
  }, []);

  const handleRenameSession = useCallback((sessionId: string, newName: string) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName } : s));
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    intentionalDeleteRef.current.sessions = true;
    intentionalDeleteRef.current.records = true;
    markAbsentInFlightRef.current.clear();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setAttendanceRecords(prev => prev.filter(r => r.sessionId !== sessionId));
    if (activeSessionId === sessionId) setActiveSessionId(null);
  }, [activeSessionId, intentionalDeleteRef]);

  // ─── handleMarkAbsent (big one) ───
  const handleMarkAbsent = useCallback(async (sessionId: string, studentIds: string[]) => {
    const stage = stages.find(s => s.id === selectedStageId);
    const stageName = stage?.name || '';
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const time = now.toLocaleTimeString('ar-EG');

    const subjectName = currentUser?.bio || currentUser?.displayName || stageName || '';
    const teacherName = currentUser?.displayName || '';

    const studentMap = new Map(students.map(s => [s.id, s] as const));

    const markedForSession = new Set(
      attendanceRecords
        .filter(r => r.sessionId === sessionId && (r.status === 'absent' || r.status === 'present'))
        .map(r => r.studentId)
    );

    const absentCountMap = new Map<string, number>();
    for (const r of attendanceRecords) {
      if (r.status !== 'absent') continue;
      absentCountMap.set(r.studentId, (absentCountMap.get(r.studentId) || 0) + 1);
    }

    const studentsByGroup = new Map<string, typeof studentIds>();
    for (const studentId of studentIds) {
      const student = studentMap.get(studentId);
      if (!student) continue;
      const group = student.group || 'بدون كروب';
      if (!studentsByGroup.has(group)) studentsByGroup.set(group, []);
      studentsByGroup.get(group)!.push(studentId);
    }

    const allNewRecords: AttendanceRecord[] = [];
    const groupDataList: Array<{
      groupName: string;
      absentStudents: Array<{ name: string; count: number }>;
    }> = [];

    for (const [group, groupStudentIds] of studentsByGroup) {
      const absentStudents: Array<{ name: string; count: number }> = [];
      const groupRecords: AttendanceRecord[] = [];

      for (const studentId of groupStudentIds) {
        const student = studentMap.get(studentId);
        if (!student) continue;

        if (markedForSession.has(studentId)) continue;

        const dedupeKey = `${sessionId}_${studentId}`;
        if (markAbsentInFlightRef.current.has(dedupeKey)) continue;
        markAbsentInFlightRef.current.add(dedupeKey);

        const absenceCount = (absentCountMap.get(studentId) || 0) + 1;

        const record: AttendanceRecord = {
          id: `absent_${Date.now()}_${studentId}`,
          studentId,
          studentName: student.name,
          studentCode: student.code || '',
          studentGroup: student.group,
          timestamp: now.toISOString(),
          date: dateKey,
          time,
          sessionId,
          status: 'absent',
          method: 'manual',
          academicYear: currentAcademicYear,
          teacherName,
          subjectName,
          absenceCount,
        };

        groupRecords.push(record);
        absentStudents.push({ name: student.name, count: absenceCount });
      }

      if (groupRecords.length > 0) {
        allNewRecords.push(...groupRecords);
        groupDataList.push({ groupName: group, absentStudents });
      }
    }

    if (allNewRecords.length > 0) {
      setAttendanceRecords(prev => [...prev, ...allNewRecords]);
    }

    // Telegram sending (background)
    if (groupDataList.length > 0) {
      const channel = telegramConfig && selectedStageId ? telegramConfig.channels[selectedStageId] : undefined;

      if (!telegramConfig || !selectedStageId || !channel?.chatId) {
        alert(
          telegramConfig
            ? '⚠️ إشعارات الغياب لم تُرسل: لا يوجد Chat ID مرتبط بهذه المرحلة.\nاذهب إلى الإعدادات ← بوت التلغرام وأدخل Chat ID لقناة هذه المادة.'
            : '⚠️ إشعارات الغياب لم تُرسل: لم يتم إعداد بوت التلغرام.\nاذهب إلى الإعدادات ← بوت التلغرام لربط البوت والقناة أولاً.'
        );
        return;
      }

      const queue = buildQueueFromGroups(telegramConfig, selectedStageId, subjectName, dateKey, groupDataList);
      if (queue.length === 0) return;

      const progressGroups: GroupSendProgress[] = groupDataList.map(g => ({
        groupName: g.groupName,
        channels: [{
          channelLabel: telegramConfig.channels[selectedStageId]?.stageName || '',
          status: 'pending' as const,
        }],
        allDone: false,
      }));

      setSendSubjectName(subjectName);
      setSendGroups(progressGroups);
      setSendDoneCount(0);
      setSendTotalGroups(groupDataList.length);
      setSendModalOpen(true);
      setIsSending(true);
      setCurrentSendingSessionId(sessionId);

      const controller = new AbortController();
      sendAbortRef.current = controller;

      sendQueuedMessages(queue, telegramConfig.botToken, (updatedItems) => {
        const done = updatedItems.filter(i => i.status === 'sent' || i.status === 'failed').length;
        setSendDoneCount(done);
        setSendGroups(prev => prev.map(g => {
          const item = updatedItems.find(i => i.groupName === g.groupName);
          if (!item) return g;
          return {
            ...g,
            channels: g.channels.map(ch => ({
              ...ch,
              status: item.status,
            })),
            allDone: item.status === 'sent' || item.status === 'failed',
          };
        }));
      }, controller.signal).then(() => {
        setIsSending(false);
        if (!controller.signal.aborted) {
          const allSent = queue.filter(i => i.status === 'sent').length;
          const logEntry: AbsenceSendLogEntry = {
            id: `log_${Date.now()}`,
            sessionId,
            date: dateKey,
            time,
            subjectName,
            groups: groupDataList.map(g => g.groupName),
            studentCount: allNewRecords.length,
            channelsSent: allSent,
            totalChannels: queue.length,
            completedAt: new Date().toISOString(),
          };
          setAbsenceSendLogs(prev => [logEntry, ...prev]);
          const completedGroups: GroupSendProgress[] = groupDataList.map(g => {
            const items = queue.filter(i => i.groupName === g.groupName);
            return {
              groupName: g.groupName,
              channels: items.map(i => ({
                channelLabel: i.channelLabel,
                status: i.status as 'sent' | 'failed' | 'pending',
              })),
              allDone: items.every(i => i.status === 'sent' || i.status === 'failed'),
            };
          });
          setCompletedGroupData(prev => ({ ...prev, [sessionId]: completedGroups }));
        }
        setCurrentSendingSessionId(null);
      }).catch(() => {
        setIsSending(false);
        setCurrentSendingSessionId(null);
      });
    }
  }, [stages, selectedStageId, currentUser, students, attendanceRecords, telegramConfig, currentAcademicYear]);

  return {
    students,
    setStudents,
    attendanceRecords,
    setAttendanceRecords,
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    profileStudent,
    setProfileStudent,
    stageSyncing,
    setStageSyncing,
    userModifiedStudentsRef,
    processedAttendanceRef,
    markAbsentInFlightRef,
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
    handleMarkAbsent,
    sendModalOpen,
    setSendModalOpen,
    sendGroups,
    sendSubjectName,
    isSending,
    sendDoneCount,
    sendTotalGroups,
    currentSendingSessionId,
    absenceSendLogs,
    completedGroupData,
  };
}
