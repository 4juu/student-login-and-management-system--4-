import { create } from 'zustand';

export type Tab =
  | 'stage-selector'
  | 'colleges'
  | 'login'
  | 'manage'
  | 'records'
  | 'settings'
  | 'sessions'
  | 'teachers'
  | 'profile'
  | 'system-settings';

interface NavState {
  activeTab: Tab;
  showSendLink: boolean;
  showTestLink: boolean;
  showAttendanceLink: boolean;
  showPendingRegistrations: boolean;
  pendingCount: number;
  setActiveTab: (tab: Tab) => void;
  setShowSendLink: (open: boolean) => void;
  setShowTestLink: (open: boolean) => void;
  setShowAttendanceLink: (open: boolean) => void;
  setShowPendingRegistrations: (open: boolean) => void;
  setPendingCount: (count: number) => void;
  resetNav: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeTab: 'stage-selector',
  showSendLink: false,
  showTestLink: false,
  showAttendanceLink: false,
  showPendingRegistrations: false,
  pendingCount: 0,
  setActiveTab: (activeTab) => set({ activeTab }),
  setShowSendLink: (showSendLink) => set({ showSendLink }),
  setShowTestLink: (showTestLink) => set({ showTestLink }),
  setShowAttendanceLink: (showAttendanceLink) => set({ showAttendanceLink }),
  setShowPendingRegistrations: (showPendingRegistrations) => set({ showPendingRegistrations }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  resetNav: () =>
    set({
      activeTab: 'stage-selector',
      showSendLink: false,
      showTestLink: false,
      showAttendanceLink: false,
      showPendingRegistrations: false,
    }),
}));
