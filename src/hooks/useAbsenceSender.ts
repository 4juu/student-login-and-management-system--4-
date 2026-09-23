import { useState, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { Student, AttendanceRecord, Stage } from '../types/student';
import { User } from '../types/user';
import { TelegramConfig, AbsenceSendLogEntry, GroupSendProgress } from '../types/telegram';
import { buildQueueFromGroups, sendQueuedMessages } from '../services/telegramService';

interface UseAbsenceSenderParams {
  stages: Stage[];
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  selectedStageId: string | null;
  currentUser: User | null;
  telegramConfig: TelegramConfig | null;
  currentAcademicYear: string;
  setAttendanceRecords: Dispatch<SetStateAction<AttendanceRecord[]>>;
}

export function useAbsenceSender({
  stages,
  students,
  attendanceRecords,
  selectedStageId,
  currentUser,
  telegramConfig,
  currentAcademicYear,
  setAttendanceRecords,
}: UseAbsenceSenderParams) {
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
  const markAbsentInFlightRef = useRef(new Set<string>());

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

    // 🚀 إرسال عبر التلغرام (خلفية)
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
  }, [stages, selectedStageId, currentUser, students, attendanceRecords, telegramConfig, currentAcademicYear, setAttendanceRecords]);

  return {
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
    markAbsentInFlightRef,
    handleMarkAbsent,
  };
}
