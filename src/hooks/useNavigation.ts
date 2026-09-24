import { useEffect } from 'react';
import { ref as dbRef, onValue, off } from 'firebase/database';
import { database } from '../firebase/config';
import { User } from '../types/user';
import { useNavStore } from '../store/navStore';

export type { Tab } from '../store/navStore';

function useNavigation(currentUser: User | null) {
  const activeTab = useNavStore((s) => s.activeTab);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const showSendLink = useNavStore((s) => s.showSendLink);
  const setShowSendLink = useNavStore((s) => s.setShowSendLink);
  const showTestLink = useNavStore((s) => s.showTestLink);
  const setShowTestLink = useNavStore((s) => s.setShowTestLink);
  const showAttendanceLink = useNavStore((s) => s.showAttendanceLink);
  const setShowAttendanceLink = useNavStore((s) => s.setShowAttendanceLink);
  const showPendingRegistrations = useNavStore((s) => s.showPendingRegistrations);
  const setShowPendingRegistrations = useNavStore((s) => s.setShowPendingRegistrations);
  const pendingCount = useNavStore((s) => s.pendingCount);
  const setPendingCount = useNavStore((s) => s.setPendingCount);
  const setPendingRequests = useNavStore((s) => s.setPendingRequests);

  useEffect(() => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'college_admin')) {
      setPendingCount(0);
      setPendingRequests([]);
      return;
    }

    const path = `registrationSystem/pending/${currentUser.uid}`;
    const requestsRef = dbRef(database, path);

    const handleSnapshot = (snapshot: any) => {
      if (!snapshot.exists()) {
        setPendingCount(0);
        setPendingRequests([]);
        return;
      }
      const data = snapshot.val();
      const arr = Object.entries(data).map(([id, r]: [string, any]) => ({ ...r, id }));
      arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPendingCount(arr.filter((r: any) => r.status === 'pending').length);
      setPendingRequests(arr);
    };

    const unsubscribe = onValue(requestsRef, handleSnapshot, (error) => {
      console.warn('⚠️ فشل الاستماع لطلبات التسجيل:', error);
    });

    return () => { off(requestsRef); unsubscribe(); };
  }, [currentUser, setPendingCount, setPendingRequests]);

  return {
    activeTab,
    setActiveTab,
    showSendLink,
    setShowSendLink,
    showTestLink,
    setShowTestLink,
    showAttendanceLink,
    setShowAttendanceLink,
    showPendingRegistrations,
    setShowPendingRegistrations,
    pendingCount,
    setPendingCount,
  };
}

export default useNavigation;
