// ============================================================
// 🌐 مراقبة الاتصال بالإنترنت + اكتمال المزامنة
// ============================================================
// الدمج بين navigator.onLine و حالة اتصال Firebase الفعلية (.info/connected)
// يرجع:
// - isOffline: صحيح عند انقطاع الانترنت أو السيرفر
// - syncDone: صحيح فقط بعد رفع كل البيانات المعلقة (outbox + retries)

import { useEffect, useRef, useState, useCallback } from 'react';
import { ref as dbRef, onValue } from 'firebase/database';
import { database } from '../firebase/config';
import { applyOutbox, flushAllPendingSaves, hasPendingWrites } from '../firebase/dataService';

export function useOnlineStatus(): { isOffline: boolean; syncDone: boolean } {
  const [navigatorOnline, setNavigatorOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [firebaseOnline, setFirebaseOnline] = useState(true);
  const [syncDone, setSyncDone] = useState(true);
  const prevOffline = useRef(false);

  const isOffline = !navigatorOnline || !firebaseOnline;

  useEffect(() => {
    const on = () => setNavigatorOnline(true);
    const off = () => setNavigatorOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const connectedRef = dbRef(database, '.info/connected');
    const unsub = onValue(connectedRef, (snap) => {
      setFirebaseOnline(!!snap.val());
    });
    return () => unsub();
  }, []);

  const syncNow = useCallback(async () => {
    try {
      await applyOutbox();
      await flushAllPendingSaves();
    } catch (e) {
      console.error('❌ فشل المزامنة بعد عودة الاتصال:', e);
    }
  }, []);

  useEffect(() => {
    const wasOffline = prevOffline.current;
    prevOffline.current = isOffline;

    if (isOffline) {
      setSyncDone(false);
      return;
    }

    if (wasOffline) {
      setSyncDone(false);
      void syncNow();
    }

    const id = window.setInterval(async () => {
      try {
        const pending = await hasPendingWrites();
        if (!pending) {
          setSyncDone(true);
          window.clearInterval(id);
        }
      } catch {
        window.clearInterval(id);
      }
    }, 500);

    return () => window.clearInterval(id);
  }, [isOffline, syncNow]);

  return { isOffline, syncDone };
}
