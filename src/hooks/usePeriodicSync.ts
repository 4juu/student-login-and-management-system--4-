// ============================================================
// ⏱️ مزامنة دورية — تحديث البيانات المهمة كل ساعة
// - يعمل فقط عندما مرئي التبويب (document.visibilityState)
// - عند العودة للخلفية→الواجهة إن مضى وقت كافٍ يتم التحديث فوراً
// - ينظّف المؤقت كاملاً عند فك التحميل
// ============================================================

import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // ساعة واحدة

export function usePeriodicSync(
  onSync: () => void | Promise<void>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  const onSyncRef = useRef(onSync);

  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    let lastRunAt = Date.now();

    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      lastRunAt = Date.now();
      try {
        void onSyncRef.current();
      } catch {
        // لا ندع خطأ المزامنة الدورية يكسر التطبيق
      }
    };

    const timer = window.setInterval(run, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRunAt >= intervalMs) {
        run();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs]);
}

export default usePeriodicSync;
