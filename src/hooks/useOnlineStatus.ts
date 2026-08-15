// ============================================================
// 🌐 مراقبة الاتصال بالإنترنت + اكتمال المزامنة
// ============================================================
// الدمج بين navigator.onLine و حالة اتصال Firebase الفعلية (.info/connected)
// يرجع:
// - isOffline: صحيح عند انقطاع الانترنت أو السيرفر
// - syncDone: صحيح فقط بعد رفع كل البيانات المعلقة (outbox + retries)

import { useEffect, useRef, useState, useCallback } from 'react';
import { ref as dbRef, onValue, goOnline } from 'firebase/database';
import { database } from '../firebase/config';
import { applyOutbox, flushAllPendingSaves, hasPendingWrites } from '../firebase/dataService';

// مدة سماح: لا نعتبر الاتصال بالسيرفر مقطوعاً إلا بعد بقاء
// .info/connected = false لمدة كافية (يمنع التذبذب عند إعادة الاتصال)
const FIREBASE_GRACE_MS = 6000;
// المدة بين محاولات التأكد من اكتمال المزامنة
const POLL_MS = 600;

export function useOnlineStatus(): { isOffline: boolean; syncDone: boolean } {
  const [navigatorOnline, setNavigatorOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [firebaseOnline, setFirebaseOnline] = useState(true);
  const [syncDone, setSyncDone] = useState(true);
  const prevOffline = useRef(false);

  const isOffline = !navigatorOnline || !firebaseOnline;

  // أحداث المتصفح (online/offline)
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

  // حالة الاتصال الفعلية بالسيرفر (مع مهلة سماح)
  useEffect(() => {
    const connectedRef = dbRef(database, '.info/connected');
    let graceTimer: number | undefined;

    const unsub = onValue(connectedRef, (snap) => {
      const connected = !!snap.val();
      if (connected) {
        if (graceTimer) {
          window.clearTimeout(graceTimer);
          graceTimer = undefined;
        }
        setFirebaseOnline(true);
      } else if (!graceTimer) {
        graceTimer = window.setTimeout(() => {
          setFirebaseOnline(false);
          graceTimer = undefined;
        }, FIREBASE_GRACE_MS);
      }
    });

    return () => {
      unsub();
      if (graceTimer) window.clearTimeout(graceTimer);
    };
  }, []);

  const syncNow = useCallback(async () => {
    try {
      goOnline(database);
    } catch {}
    try {
      await applyOutbox();
    } catch (e) {
      console.error('❌ فشل تطبيق صندوق الأوفلاين:', e);
    }
    try {
      await flushAllPendingSaves();
    } catch (e) {
      console.error('❌ فشل تصفير الكتابات المعلقة:', e);
    }
  }, []);

  useEffect(() => {
    const wasOffline = prevOffline.current;
    prevOffline.current = isOffline;

    if (isOffline) {
      setSyncDone(false);
      return;
    }

    // عند رجوع الاتصال: ابدأ المزامنة فوراً
    if (wasOffline) {
      setSyncDone(false);
      void syncNow();
    }

    // متابعة دورية حتى اكتمال كل الكتابات (مع إعادة محاولة مستمرة)
    const id = window.setInterval(async () => {
      if (!navigatorOnline) return;
      try {
        const pending = await hasPendingWrites();
        if (!pending) {
          setSyncDone(true);
          window.clearInterval(id);
        } else {
          void syncNow();
        }
      } catch {
        window.clearInterval(id);
      }
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [isOffline, navigatorOnline, syncNow]);

  return { isOffline, syncDone };
}
