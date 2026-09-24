import { Suspense, lazy, type FC } from 'react';
import type { Student, AttendanceRecord, AttendanceSession } from '../types/student';
import type { AbsenceSendLogEntry, GroupSendProgress } from '../types/telegram';
import { useNavStore } from '../store/navStore';
import { useUIStore } from '../store/useUIStore';
import { useStageStore } from '../store/useStageStore';
import { useAuthStore, selectCanEditStudents } from '../store/useAuthStore';
import { StageTabs } from './StageTabs';
import { TabFallback, StageLoading } from './Fallbacks';
import { LoadingState } from '../components/loading/LoadingState';

// 🚀 تحميل متأخر للمكونات الثقيلة (تُحمَّل عند الحاجة فقط — خفض حجم الحزمة الأولية)
const StudentManager = lazy(() =>
  import('../components/StudentManager').then(m => ({ default: m.StudentManager }))
);
const StudentsViewer = lazy(() =>
  import('../components/StudentsViewer').then(m => ({ default: m.StudentsViewer }))
);
const AttendanceLogin = lazy(() =>
  import('../components/AttendanceLogin').then(m => ({ default: m.AttendanceLogin }))
);
const AttendanceRecords = lazy(() =>
  import('../components/AttendanceRecords').then(m => ({ default: m.AttendanceRecords }))
);
const SessionManager = lazy(() =>
  import('../components/SessionManager').then(m => ({ default: m.SessionManager }))
);

export interface StageContentProps {
  onCreateSession: (session: AttendanceSession) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newName: string) => void;
  onMarkAbsent: (sessionId: string, studentIds: string[]) => void;
  onAttendanceRecord: (record: AttendanceRecord) => void;
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onAddStudent: (student: Student) => void;
  onAddMultipleStudents: (students: Student[]) => void;
  onDeleteStudent: (id: string) => void;
  onDeleteSelectedStudents: (ids: string[]) => void;
  onSortByName: () => void;
  onSortByGroup: () => void;
  onClearRecords: () => void;
  onUpdateRecord: (recordId: string, updates: Partial<AttendanceRecord>) => void;
  onDeleteRecord: (recordId: string) => void;
  absenceSendLogs: AbsenceSendLogEntry[];
  isSending: boolean;
  currentSendingSessionId: string | null;
  sendGroups: GroupSendProgress[];
  sendDoneCount: number;
  sendTotalGroups: number;
  completedGroupData: Record<string, GroupSendProgress[]>;
}

export const StageContent: FC<StageContentProps> = ({
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onMarkAbsent,
  onAttendanceRecord,
  onUpdateStudent,
  onAddStudent,
  onAddMultipleStudents,
  onDeleteStudent,
  onDeleteSelectedStudents,
  onSortByName,
  onSortByGroup,
  onClearRecords,
  onUpdateRecord,
  onDeleteRecord,
  absenceSendLogs,
  isSending,
  currentSendingSessionId,
  sendGroups,
  sendDoneCount,
  sendTotalGroups,
  completedGroupData,
}) => {
  const storeActiveTab = useNavStore((s) => s.activeTab);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  // أي تبويب غير تابع للمرحلة (أو غير معروف) يُعامَل كـ«السجلات» بدل شاشة فارغة
  const activeTab =
    storeActiveTab === 'sessions' || storeActiveTab === 'login' || storeActiveTab === 'manage' || storeActiveTab === 'records'
      ? storeActiveTab
      : 'sessions';
  const dataLoaded = useUIStore((s) => s.dataLoaded);
  const setProfileStudent = useUIStore((s) => s.setProfileStudent);
  const students = useStageStore((s) => s.students);
  const sessions = useStageStore((s) => s.sessions);
  const records = useStageStore((s) => s.records);
  const activeSessionId = useStageStore((s) => s.activeSessionId);
  const currentUser = useAuthStore((s) => s.currentUser);
  const canEditStudents = useAuthStore(selectCanEditStudents);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;
  const teacherBio = currentUser?.bio || currentUser?.displayName || '';

  return (
    <div className="max-w-6xl mx-auto">
      <StageTabs />

      {!dataLoaded ? (
        <StageLoading />
      ) : (
      <div key={`stage-tab-${activeTab}`} className="animate-pageEnter">
        {activeTab === 'sessions' && (
          <Suspense fallback={<TabFallback />}>
            <SessionManager
              sessions={sessions} activeSessionId={activeSessionId}
              onCreateSession={onCreateSession} onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession} onRenameSession={onRenameSession}
              students={students} records={records} onMarkAbsent={onMarkAbsent}
              absenceSendLogs={absenceSendLogs}
              isSending={isSending}
              currentSendingSessionId={currentSendingSessionId}
              sendGroups={sendGroups}
              sendDoneCount={sendDoneCount}
              sendTotalGroups={sendTotalGroups}
              completedGroupData={completedGroupData}
            />
          </Suspense>
        )}
        {activeTab === 'login' && (
          <div className="max-w-lg mx-auto">
            {!activeSessionId ? (
              <div className="glass-card-sm p-6 text-center">
                <p className="text-amber-300 font-medium mb-4">لا يوجد سجل نشط!</p>
                <button onClick={() => setActiveTab('sessions')} className="btn-base btn-primary px-6 py-2">
                  انتقل لإدارة السجلات
                </button>
              </div>
            ) : students.length === 0 ? (
              <div className="glass-card-sm p-6 text-center">
                <p className="text-amber-300 font-medium">لا يوجد طلاب في هذه المرحلة</p>
              </div>
            ) : (
              <Suspense fallback={<TabFallback />}>
                <AttendanceLogin
                  students={students} activeSessionId={activeSessionId}
                  activeSession={activeSession}
                  records={records} onAttendanceRecord={onAttendanceRecord}
                  onUpdateStudent={onUpdateStudent} currentUser={currentUser}
                />
              </Suspense>
            )}
          </div>
        )}
        {activeTab === 'manage' && (
          <Suspense fallback={<LoadingState size="md" className="py-24" />}>
            {canEditStudents ? (
              <StudentManager
                students={students} onAddStudent={onAddStudent}
                onAddMultipleStudents={onAddMultipleStudents} onUpdateStudent={onUpdateStudent}
                onDeleteStudent={onDeleteStudent} onDeleteSelectedStudents={onDeleteSelectedStudents}
                onSortByName={onSortByName} onSortByGroup={onSortByGroup}
                onOpenProfile={setProfileStudent}
              />
            ) : (
              <StudentsViewer students={students} onOpenProfile={setProfileStudent} />
            )}
          </Suspense>
        )}
        {activeTab === 'records' && (
          <Suspense fallback={<LoadingState size="md" className="py-24" />}>
            <AttendanceRecords
              records={records} sessions={sessions} students={students}
              activeSessionId={activeSessionId} onClearRecords={onClearRecords}
              onUpdateRecord={onUpdateRecord} onDeleteRecord={onDeleteRecord}
              teacherBio={teacherBio}
            />
          </Suspense>
        )}
      </div>
      )}
    </div>
  );
};
