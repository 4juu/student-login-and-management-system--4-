import type { FC } from 'react';
import { StageTabBar } from '../components/StageTabBar';
import { useNavStore } from '../store/navStore';
import { useStageStore } from '../store/useStageStore';
import { useAuthStore, selectCanEditStudents, selectCanSendAttendanceLink } from '../store/useAuthStore';

export const StageTabs: FC = () => {
  const activeTab = useNavStore((s) => s.activeTab);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const setShowAttendanceLink = useNavStore((s) => s.setShowAttendanceLink);
  const sessionsCount = useStageStore((s) => s.sessions.length);
  const studentsCount = useStageStore((s) => s.students.length);
  const recordsCount = useStageStore((s) => s.records.length);
  const canEditStudents = useAuthStore(selectCanEditStudents);
  const canSendAttendanceLink = useAuthStore(selectCanSendAttendanceLink);

  return (
    <StageTabBar
      activeTab={activeTab}
      sessionsCount={sessionsCount}
      studentsCount={studentsCount}
      recordsCount={recordsCount}
      canEditStudents={canEditStudents}
      canSendAttendanceLink={canSendAttendanceLink}
      onTabChange={setActiveTab}
      onOpenAttendanceLink={() => setShowAttendanceLink(true)}
    />
  );
};
