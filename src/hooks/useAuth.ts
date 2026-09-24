import { useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { User } from '../types/user';
import { auth, database } from '../firebase/config';
import { signIn, signOut } from '../firebase/authService';
import { saveUserData, flushAllPendingSaves } from '../firebase/dataService';
import { clearLocalDatabases } from '../lib/offlineOutbox';
import {
  useAuthStore,
  selectIsAdmin,
  selectIsCollegeAdmin,
  selectCanEditStudents,
  selectCanSendAttendanceLink,
} from '../store/useAuthStore';

interface UseAuthParams {
  resetData: () => void;
  loadInitialData: (user: User) => Promise<void>;
  registerToken?: string | null;
}

interface UseAuthReturn {
  currentUser: User | null;
  loading: boolean;
  logoutConfirmOpen: boolean;
  loggingOut: boolean;

  handleLogin: (email: string, password: string) => Promise<void>;
  handleLogout: () => void;
  confirmLogout: () => Promise<void>;
  cancelLogout: () => void;
  handleUpdateProfile: (updatedUser: User) => void;

  isAdmin: boolean;
  isMainAdmin: boolean;
  isCollegeAdmin: boolean;
  canEditStudents: boolean;
  canSendAttendanceLink: boolean;

  getAdminUid: () => string;
  getTeacherId: () => string;
}

export function useAuth({ resetData, loadInitialData, registerToken = null }: UseAuthParams): UseAuthReturn {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const loading = useAuthStore((s) => s.loading);
  const setLoading = useAuthStore((s) => s.setLoading);
  const logoutConfirmOpen = useAuthStore((s) => s.logoutConfirmOpen);
  const setLogoutConfirmOpen = useAuthStore((s) => s.setLogoutConfirmOpen);
  const loggingOut = useAuthStore((s) => s.loggingOut);
  const setLoggingOut = useAuthStore((s) => s.setLoggingOut);

  useEffect(() => {
    if (registerToken) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const { ref: dbRefImport, get, set } = await import('firebase/database');
          const userRef = dbRefImport(database, `users/${firebaseUser.uid}`);
          const snapshot = await get(userRef);

          let userData: User;
          if (snapshot.exists()) {
            userData = snapshot.val();
          } else {
            userData = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
              role: firebaseUser.email?.toLowerCase() === 'mujtabahaitham@gmail.com' ? 'admin' : 'teacher',
              active: true,
              createdAt: firebaseUser.metadata.creationTime || new Date().toISOString(),
              lastLogin: new Date().toISOString()
            };
            await set(userRef, userData);
          }

          setCurrentUser(userData);
          await loadInitialData(userData);
        } catch (error) {
          console.error('❌ Error loading user:', error);
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
        resetData();
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [registerToken]);

  useEffect(() => {
    if (currentUser && loading === false) saveUserData(currentUser.uid, currentUser);
  }, [currentUser]);

  const handleLogin = async (email: string, password: string) => {
    const user = await signIn(email, password);
    setCurrentUser(user);
  };

  const handleLogout = () => setLogoutConfirmOpen(true);
  const cancelLogout = () => setLogoutConfirmOpen(false);

  const confirmLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    flushAllPendingSaves();
    await signOut();
    setCurrentUser(null);
    resetData();
    // مسح IndexedDB (كاش المرحلة + الأوفلاين) — يمنع تسريب بيانات مستخدم سابق
    void clearLocalDatabases();
    setLogoutConfirmOpen(false);
    setLoggingOut(false);
  };

  const handleUpdateProfile = useCallback((updatedUser: User) => setCurrentUser(updatedUser), []);

  const isAdmin = useAuthStore(selectIsAdmin);
  const isCollegeAdmin = useAuthStore(selectIsCollegeAdmin);
  const canEditStudents = useAuthStore(selectCanEditStudents);
  const isMainAdmin = isAdmin;
  const canSendAttendanceLink = useAuthStore(selectCanSendAttendanceLink);

  const getAdminUid = useCallback((): string => {
    if (!currentUser) return '';
    if (currentUser.role === 'admin') return currentUser.uid;
    return currentUser.adminId || currentUser.uid;
  }, [currentUser]);

  const getTeacherId = useCallback((): string => {
    return currentUser?.uid || '';
  }, [currentUser]);

  return {
    currentUser,
    loading,
    logoutConfirmOpen,
    loggingOut,

    handleLogin,
    handleLogout,
    confirmLogout,
    cancelLogout,
    handleUpdateProfile,

    isAdmin,
    isMainAdmin,
    isCollegeAdmin,
    canEditStudents,
    canSendAttendanceLink,

    getAdminUid,
    getTeacherId,
  };
}
