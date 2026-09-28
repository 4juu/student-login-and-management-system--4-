import { create } from 'zustand';
import type { User } from '../types/user';

interface AuthState {
  currentUser: User | null;
  loading: boolean;
  logoutConfirmOpen: boolean;
  loggingOut: boolean;
  setCurrentUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setLogoutConfirmOpen: (open: boolean) => void;
  setLoggingOut: (loggingOut: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  loading: true,
  logoutConfirmOpen: false,
  loggingOut: false,
  setCurrentUser: (currentUser) => set({ currentUser }),
  setLoading: (loading) => set({ loading }),
  setLogoutConfirmOpen: (logoutConfirmOpen) => set({ logoutConfirmOpen }),
  setLoggingOut: (loggingOut) => set({ loggingOut }),
}));

export const selectIsAdmin = (s: AuthState) => s.currentUser?.role === 'admin';
export const selectIsMainAdmin = selectIsAdmin;
export const selectIsCollegeAdmin = (s: AuthState) => s.currentUser?.role === 'college_admin';

/** معرّف صاحب البيانات (uid للأدمن، adminId لباقي الأدوار) — نفس منطق getAdminUid في useAuth */
export const selectDataAdminUid = (s: AuthState): string => {
  const u = s.currentUser;
  if (!u) return '';
  return u.role === 'admin' ? u.uid : u.adminId || u.uid;
};
export const selectCanEditStudents = (s: AuthState) =>
  s.currentUser?.role === 'admin' || s.currentUser?.role === 'college_admin';
export const selectCanSendAttendanceLink = (s: AuthState) =>
  s.currentUser?.role === 'admin' ||
  s.currentUser?.role === 'college_admin' ||
  s.currentUser?.role === 'teacher';
