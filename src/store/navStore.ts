import { create } from 'zustand';
import type { PendingRegistration } from '../types/registration';

export type Tab =
  | 'stage-selector'
  | 'colleges'
  | 'login'
  | 'manage'
  | 'records'
  | 'sessions'
  | 'teachers'
  | 'profile'
  | 'system-settings';

interface NavState {
  activeTab: Tab;
  showSendLink: boolean;
  showSendCodeLink: boolean;
  showTestLink: boolean;
  showAttendanceLink: boolean;
  showPendingRegistrations: boolean;
  pendingCount: number;
  /** قائمة الطلبات الكاملة — يملؤها useNavigation (مشترك واحد) وتقرؤها نافذة PendingRegistrations */
  pendingRequests: PendingRegistration[];
  setActiveTab: (tab: Tab) => void;
  setShowSendLink: (open: boolean) => void;
  setShowSendCodeLink: (open: boolean) => void;
  setShowTestLink: (open: boolean) => void;
  setShowAttendanceLink: (open: boolean) => void;
  setShowPendingRegistrations: (open: boolean) => void;
  setPendingCount: (count: number) => void;
  setPendingRequests: (requests: PendingRegistration[]) => void;
  resetNav: () => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  activeTab: 'stage-selector',
  showSendLink: false,
  showSendCodeLink: false,
  showTestLink: false,
  showAttendanceLink: false,
  showPendingRegistrations: false,
  pendingCount: 0,
  pendingRequests: [],
  setActiveTab: (tab) => {
    const prev = get().activeTab;
    set({ activeTab: tab });
    // كل تبويب جديد يبدأ من راس الصفحة (حتى لو نزلت قبلها)
    if (prev !== tab && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    }
  },
  setShowSendLink: (showSendLink) => set({ showSendLink }),
  setShowSendCodeLink: (showSendCodeLink) => set({ showSendCodeLink }),
  setShowTestLink: (showTestLink) => set({ showTestLink }),
  setShowAttendanceLink: (showAttendanceLink) => set({ showAttendanceLink }),
  setShowPendingRegistrations: (showPendingRegistrations) => set({ showPendingRegistrations }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setPendingRequests: (pendingRequests) => set({ pendingRequests }),
  resetNav: () =>
    set({
      activeTab: 'stage-selector',
      showSendLink: false,
      showSendCodeLink: false,
      showTestLink: false,
      showAttendanceLink: false,
      showPendingRegistrations: false,
      pendingRequests: [],
    }),
}));
