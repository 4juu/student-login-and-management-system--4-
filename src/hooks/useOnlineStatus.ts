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
import { applyOutbox, flushAllPendingSaves, hasPendingWrites, retryFailedSaves } from '../firebase/dataService';

// مدة سماح: لا نعتبر الاتصال بالسيرفر مقطوعاً إلا بعد بقاء
// .info/connected = false لمدة كافية (يمنع التذبذب عند إعادة الاتصال)
const FIREBASE_GRACE_MS = 6000;
// متابعة تصاعدية: تبدأ سريعة عند رجوع الاتصال ثم تتباطأ لتقليل الاستعلام
const POLL_MIN_MS = 2000;
const POLL_MAX_MS = 10000;
const POLL_BACKOFF_FACTOR = 1.5;

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

  const syncRunningRef = useRef(false);

  const syncNow = useCallback(async () => {
    // حاجز reentrancy: المُستمعون المتعددون (online event + interval 600ms)
    // لا يُطلقون جولة مزامنة جديدة أثناء تنفيذ جولة حالية
    if (syncRunningRef.current) return;
    syncRunningRef.current = true;
    try {
      try {
        goOnline(database);
      } catch {}
      // 1+2 بالتوازي (مستقلتان وكلتاهما single-flight) ثم 3 بعد اكتمالهما
      await Promise.allSettled([
        retryFailedSaves().catch(e => {
          console.error('❌ فشل إعادة محاولات الحفظ:', e);
        }),
        applyOutbox().catch(e => {
          console.error('❌ فشل تطبيق صندوق الأوفلاين:', e);
        }),
      ]);
      // 3) صفّي أي كتابات معلّقة متبقية
      try {
        await flushAllPendingSaves();
      } catch (e) {
        console.error('❌ فشل تصفير الكتابات المعلقة:', e);
      }
    } finally {
      syncRunningRef.current = false;
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

    // متابعة دورية حتى اكتمال كل الكتابات — تصاعدية (سريع ثم بطيء)
    let delay = POLL_MIN_MS;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!navigatorOnline) {
          // إعادة ضبط التأخير أثناء الانقطاع — عند الرجوع نبدأ بفحص سريع again
          delay = POLL_MIN_MS;
          schedule();
          return;
        }
        try {
          const pending = await hasPendingWrites();
          if (!pending) {
            setSyncDone(true);
            return;
          }
          void syncNow();
        } catch (e) {
          // لا نتوقف عند خطأ مؤقت — التوقف كان يُجمّد العلامة الحمراء للأبد
          console.warn('⏳ تعذر التحقق من الكتابات المعلقة — ستُعاد المحاولة', e);
        }
        delay = Math.min(Math.round(delay * POLL_BACKOFF_FACTOR), POLL_MAX_MS);
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isOffline, navigatorOnline, syncNow]);

  return { isOffline, syncDone };
}
