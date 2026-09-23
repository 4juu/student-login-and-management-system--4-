import { useState, useEffect } from 'react';
import { ref as dbRef, onValue, off } from 'firebase/database';
import { database } from '../firebase/config';
import { User } from '../types/user';

export type Tab = 'stage-selector' | 'colleges' | 'login' | 'manage' | 'records' | 'settings' | 'sessions' | 'teachers' | 'profile' | 'system-settings';

function useNavigation(currentUser: User | null) {
  const [activeTab, setActiveTab] = useState<Tab>('stage-selector');
  const [showSendLink, setShowSendLink] = useState(false);
  const [showTestLink, setShowTestLink] = useState(false);
  const [showAttendanceLink, setShowAttendanceLink] = useState(false);
  const [showPendingRegistrations, setShowPendingRegistrations] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'college_admin')) {
      setPendingCount(0);
      return;
    }

    const path = `registrationSystem/pending/${currentUser.uid}`;
    const requestsRef = dbRef(database, path);

    const handleSnapshot = (snapshot: any) => {
      if (!snapshot.exists()) { setPendingCount(0); return; }
      const data = snapshot.val();
      const count = Object.values(data).filter((r: any) => r.status === 'pending').length;
      setPendingCount(count);
    };

    const unsubscribe = onValue(requestsRef, handleSnapshot, (error) => {
      console.warn('⚠️ فشل الاستماع لطلبات التسجيل:', error);
    });

    return () => { off(requestsRef); unsubscribe(); };
  }, [currentUser]);

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
