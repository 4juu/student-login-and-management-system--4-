import type { FC } from 'react';
import { AppHeader as AppHeaderBase } from '../components/AppHeader';
import { useNavStore } from '../store/navStore';
import { useAuthStore, selectIsMainAdmin, selectIsCollegeAdmin } from '../store/useAuthStore';

interface AppHeaderLayoutProps {
  systemTitle: string;
  currentAcademicYear: string;
  isOffline: boolean;
  syncDone: boolean;
  onLogout: () => void;
}

export const AppHeader: FC<AppHeaderLayoutProps> = ({
  systemTitle,
  currentAcademicYear,
  isOffline,
  syncDone,
  onLogout,
}) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isMainAdmin = useAuthStore(selectIsMainAdmin);
  const isCollegeAdmin = useAuthStore(selectIsCollegeAdmin);
  const setActiveTab = useNavStore((s) => s.setActiveTab);

  if (!currentUser) return null;

  return (
    <AppHeaderBase
      currentUser={currentUser}
      systemTitle={systemTitle}
      currentAcademicYear={currentAcademicYear}
      isMainAdmin={isMainAdmin}
      isCollegeAdmin={isCollegeAdmin}
      isOffline={isOffline}
      syncDone={syncDone}
      onProfile={() => setActiveTab('profile')}
      onLogout={onLogout}
    />
  );
};
