import type { FC } from 'react';
import { Crown, Landmark, LogOut, GraduationCap } from 'lucide-react';
import { User } from '../types/user';
import { Masthead } from './Masthead';
import { PwaInstallButton } from './PwaInstallButton';
import { OfflineWarningIcon } from './OfflineWarningIcon';
import { Notifications } from './Notifications';
import { Button } from './ui/button';

interface AppHeaderProps {
  currentUser: User;
  systemTitle: string;
  currentAcademicYear: string;
  isMainAdmin: boolean;
  isCollegeAdmin: boolean;
  isOffline: boolean;
  syncDone: boolean;
  onProfile: () => void;
  onLogout: () => void;
}

export const AppHeader: FC<AppHeaderProps> = ({
  currentUser,
  systemTitle,
  currentAcademicYear,
  isMainAdmin,
  isCollegeAdmin,
  isOffline,
  syncDone,
  onProfile,
  onLogout,
}) => (
  <div className="mb-8">
    <div className="flex items-center justify-between gap-3 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-11 h-11 shrink-0 bg-blue-600 rounded-full flex items-center justify-center overflow-hidden border-2 border-blue-500/40 cursor-pointer"
          onClick={onProfile}
        >
          {currentUser.photoURL ? (
            <img src={currentUser.photoURL} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-white font-bold text-lg">{currentUser.displayName.charAt(0)}</span>
          )}
        </div>
        <div className="text-right min-w-0">
          <p className="text-xs text-slate-400">مرحباً،</p>
          <p className="font-bold text-slate-100 truncate max-w-[120px] sm:max-w-none">{currentUser.displayName}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {isMainAdmin && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-300 text-xs font-medium rounded-full border border-blue-500/20">
              <Crown className="w-3.5 h-3.5" /> أدمن رئيسي
            </span>
          )}
          {isCollegeAdmin && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-300 text-xs font-medium rounded-full border border-amber-500/20">
              <Landmark className="w-3.5 h-3.5" /> أدمن كلية
            </span>
          )}
          {currentUser?.role === 'teacher' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-300 text-xs font-medium rounded-full border border-emerald-500/20">
              <GraduationCap className="w-3.5 h-3.5" /> تدريسي
            </span>
          )}
        </div>
      </div>

      <PwaInstallButton />

      {(isOffline || !syncDone) && <OfflineWarningIcon />}

      {(currentUser?.role === 'teacher' || currentUser?.role === 'admin') && <Notifications currentUser={currentUser} />}

      <Button
        variant="destructive"
        size="sm"
        onClick={onLogout}
        className="shrink-0 inline-flex items-center gap-2"
        aria-label="تسجيل الخروج"
      >
        <LogOut className="w-4 h-4" />
        <span className="hidden sm:inline">تسجيل الخروج</span>
      </Button>
    </div>

    <Masthead title={systemTitle} yearLabel={currentAcademicYear.replace('_', ' - ')} />
  </div>
);
