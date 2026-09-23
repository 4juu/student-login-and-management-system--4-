import { create } from 'zustand';
import type { Student } from '../types/student';

// ملاحظة: أزرار التنقل (activeTab) ونوافذ الإرسال (showSendLink/showTestLink/
// showAttendanceLink/showPendingRegistrations) موجودة مسبقاً في navStore.ts
// هذا المتجر يحتوي فقط على حالة UI التي كان App.tsx يحتفظ بها كـ useState

interface UIState {
  dataLoaded: boolean;
  stageSyncing: boolean;
  profileStudent: Student | null;
  offlineModalDismissed: boolean;
  setDataLoaded: (loaded: boolean) => void;
  setStageSyncing: (syncing: boolean) => void;
  setProfileStudent: (student: Student | null) => void;
  setOfflineModalDismissed: (dismissed: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  dataLoaded: false,
  stageSyncing: false,
  profileStudent: null,
  offlineModalDismissed: false,
  setDataLoaded: (dataLoaded) => set({ dataLoaded }),
  setStageSyncing: (stageSyncing) => set({ stageSyncing }),
  setProfileStudent: (profileStudent) => set({ profileStudent }),
  setOfflineModalDismissed: (offlineModalDismissed) => set({ offlineModalDismissed }),
}));
