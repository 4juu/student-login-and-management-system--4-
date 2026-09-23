import type { FC } from 'react';
import { ClipboardList, PenLine, Users, BarChart3, CalendarDays } from 'lucide-react';
import type { Tab } from '../hooks/useNavigation';

interface StageTabBarProps {
  activeTab: Tab;
  sessionsCount: number;
  studentsCount: number;
  recordsCount: number;
  canEditStudents: boolean;
  canSendAttendanceLink: boolean;
  onTabChange: (tab: Tab) => void;
  onOpenAttendanceLink: () => void;
}

export const StageTabBar: FC<StageTabBarProps> = ({
  activeTab,
  sessionsCount,
  studentsCount,
  recordsCount,
  canEditStudents,
  canSendAttendanceLink,
  onTabChange,
  onOpenAttendanceLink,
}) => (
  <div className="flex overflow-x-auto flex-nowrap md:flex-wrap gap-2 md:gap-3 pb-1 md:pb-0 justify-start md:justify-center mb-4 md:mb-6 scrollbar-none">
    <button
      onClick={() => onTabChange('sessions')}
      className={`tab-btn shrink-0 ${activeTab === 'sessions' ? 'active' : ''}`}
    >
      <ClipboardList className="w-4 h-4 inline-block align-middle ml-1" /> السجلات ({sessionsCount})
    </button>
    <button
      onClick={() => onTabChange('login')}
      className={`tab-btn shrink-0 ${activeTab === 'login' ? 'active' : ''}`}
    >
      <PenLine className="w-4 h-4 inline-block align-middle ml-1" /> تسجيل الحضور
    </button>
    <button
      onClick={() => onTabChange('manage')}
      className={`tab-btn shrink-0 ${activeTab === 'manage' ? 'active' : ''}`}
    >
      <Users className="w-4 h-4 inline-block align-middle ml-1" /> {canEditStudents ? `إدارة الطلاب (${studentsCount})` : `الطلاب (${studentsCount})`}
    </button>
    <button
      onClick={() => onTabChange('records')}
      className={`tab-btn shrink-0 ${activeTab === 'records' ? 'active' : ''}`}
    >
      <BarChart3 className="w-4 h-4 inline-block align-middle ml-1" /> سجل الحضور ({recordsCount})
    </button>
    {canSendAttendanceLink && (
      <button
        onClick={onOpenAttendanceLink}
        className="btn-base btn-primary shrink-0 text-xs py-1.5 px-2"
        title="إنشاء رابط تقرير الحضور والغياب للطلاب"
      >
        <CalendarDays className="w-4 h-4 inline-block align-middle ml-1" /> رابط الحضور والغياب
      </button>
    )}
  </div>
);
