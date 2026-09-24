// Debounced save queue with automatic retry (3 attempts, exponential backoff)

import { hasOutboxEntries, queueOutbox } from "../lib/offlineOutbox";

const MAX_RETRIES = 3;
const retryQueues = new Map<string, { fn: () => Promise<void>; attempts: number }>();
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaveFunctions = new Map<string, () => Promise<void>>();
/** بيانات أوفلاين لوكيل التخزين الاحتياطي عند فشل كل المحاولات */
const outboxFallbacks = new Map<string, { key: string; data: unknown }>();

export const cancelAllPendingSaves = (): void => {
  for (const [key, timeout] of pendingSaves) {
    clearTimeout(timeout);
    pendingSaves.delete(key);
    pendingSaveFunctions.delete(key);
  }
  retryQueues.clear();
  outboxFallbacks.clear();
};

/**
 * يسجّل نسخة احتياطية تُرفع لاحقاً إلى outbox إذا فشلت كل محاولات الحفظ.
 * يمنع ضياع البيانات عند طول الانقطاع أو فشل Firebase رغم وجود النت.
 */
export const registerOutboxFallback = (saveKey: string, outboxKey: string, data: unknown): void => {
  outboxFallbacks.set(saveKey, { key: outboxKey, data });
};

const persistToOutbox = async (saveKey: string): Promise<void> => {
  const fb = outboxFallbacks.get(saveKey);
  if (!fb) return;
  try {
    await queueOutbox(fb.key, fb.data);
  } catch {
    /* localStorage احتياطي */
  }
};

// مفاتيح قيد المعاينة الآن — يمنع تكاثف سلاسل backoff على نفس المفتاح
// (كان سبب تجمد الصفحة عند رجوع النت: كل مُشغّل مزامنة يبادر سلسلة جديدة للمفتاح نفسه)
const retryingKeys = new Set<string>();

// الحلقة الداخلية (تستدعي نفسها عند إعادة المحاولة) — تتجاوز الحاجز لأنها ضمن نفس السلسلة
const runRetryLoop = async (key: string, fn: () => Promise<void>, attempt: number): Promise<void> => {
  // لا نستهلك المحاولات أثناء انقطاع الإنترنت — ننتظر حدث online
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    retryQueues.set(key, { fn, attempts: 0 });
    return;
  }
  try {
    await fn();
    retryQueues.delete(key);
    outboxFallbacks.delete(key);
  } catch (e) {
    console.warn(`⚠️ [${attempt}/${MAX_RETRIES}] فشلت محاولة الحفظ: ${key}`);
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(r => setTimeout(r, delay));
      return runRetryLoop(key, fn, attempt + 1);
    }
    console.error(`❌ فشل الحفظ بعد ${MAX_RETRIES} محاولات — يُحفظ في outbox: ${key}`, e);
    // ضمان عدم فقد البيانات: نصفيها تلقائياً عند رجوع النت
    await persistToOutbox(key);
    retryQueues.delete(key);
    outboxFallbacks.delete(key);
  }
};

const retryWithBackoff = async (key: string, fn: () => Promise<void>, attempt: number = 1): Promise<void> => {
  if (retryingKeys.has(key)) return;
  retryingKeys.add(key);
  try {
    await runRetryLoop(key, fn, attempt);
  } finally {
    retryingKeys.delete(key);
  }
};

export const getPendingSavesCount = (): number => retryQueues.size;

export const getDebouncedSavesCount = (): number => pendingSaves.size;

export const hasPendingWrites = async (): Promise<boolean> =>
  pendingSaves.size > 0 || retryQueues.size > 0 || outboxFallbacks.size > 0 || (await hasOutboxEntries());

const SAVE_DELAY = 2000;

export const debouncedSave = (key: string, saveFn: () => Promise<void>): void => {
  const existing = pendingSaves.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  pendingSaveFunctions.set(key, saveFn);

  const timeout = setTimeout(async () => {
    pendingSaves.delete(key);
    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      retryQueues.set(key, { fn, attempts: 0 });
      await retryWithBackoff(key, fn);
    }
  }, SAVE_DELAY);

  pendingSaves.set(key, timeout);
};

/**
 * يعيد محاولة كل ما فشل سابقاً — يُستدعى عند رجوع الاتصال
 * لضمان تصفيية outbox + retryQueues المعلقة.
 * single-flight: نداءات متزامنة تندمج في جولة واحدة (مع إعادة جولة إن طُلب أثناء التنفيذ)
 * — يمنع تكاثف مُشغّلي المزامنة الثلاثة (main.tsx + saveQueue online + useOnlineStatus).
 */
let retryFlight: Promise<void> | null = null;
let retryRerun = false;

const doRetryFailedSaves = async (): Promise<void> => {
  for (const [key, { fn, attempts }] of Array.from(retryQueues.entries())) {
    await retryWithBackoff(key, fn, attempts);
  }
  // أي عنصر سقط من retryQueues وله outbox fallback → يُرفع الآن
  for (const key of Array.from(outboxFallbacks.keys())) {
    if (!retryQueues.has(key)) {
      await persistToOutbox(key);
      outboxFallbacks.delete(key);
    }
  }
};

export const retryFailedSaves = async (): Promise<void> => {
  if (retryFlight) {
    retryRerun = true;
    return retryFlight;
  }
  retryFlight = (async () => {
    try {
      do {
        retryRerun = false;
        await doRetryFailedSaves();
      } while (retryRerun);
    } finally {
      retryFlight = null;
    }
  })();
  return retryFlight;
};

/** Schedule a save with a custom delay (used by user profile saves). */
export const scheduleSave = (key: string, saveFn: () => Promise<void>, delayMs: number): void => {
  const existing = pendingSaves.get(key);
  if (existing) clearTimeout(existing);

  pendingSaveFunctions.set(key, saveFn);

  const timeout = setTimeout(async () => {
    pendingSaves.delete(key);
    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);
    if (fn) {
      retryQueues.set(key, { fn, attempts: 0 });
      await retryWithBackoff(key, fn);
    }
  }, delayMs);

  pendingSaves.set(key, timeout);
};

/** Cancel all pending debounced saves whose key matches the predicate. */
export const cancelPendingSavesWhere = (match: (key: string) => boolean): void => {
  const keysToCancel: string[] = [];
  pendingSaves.forEach((_, key) => {
    if (match(key)) keysToCancel.push(key);
  });
  keysToCancel.forEach(key => {
    const timeout = pendingSaves.get(key);
    if (timeout) clearTimeout(timeout);
    pendingSaves.delete(key);
    pendingSaveFunctions.delete(key);
  });
};

// single-flight لتصفية الكتابات (نفس منطق retryFailedSaves — يمنع التداخل المتوازي)
let flushFlight: Promise<void> | null = null;
let flushRerun = false;

const doFlushAllPendingSaves = async (): Promise<void> => {
  const keys = Array.from(pendingSaves.keys());
  const hasRetry = retryQueues.size > 0 || outboxFallbacks.size > 0;
  if (keys.length === 0 && !hasRetry) return;

  for (const key of keys) {
    const timeout = pendingSaves.get(key);
    if (timeout) clearTimeout(timeout);
    pendingSaves.delete(key);

    const fn = pendingSaveFunctions.get(key);
    pendingSaveFunctions.delete(key);

    if (fn) {
      retryQueues.set(key, { fn, attempts: 0 });
      await retryWithBackoff(key, fn);
    }
  }

  // Also flush any remaining retry items
  for (const [key, { fn, attempts }] of Array.from(retryQueues.entries())) {
    await retryWithBackoff(key, fn, attempts + 1);
  }

  // ما تبقى في outbox fallback ولم يُرفع
  for (const key of Array.from(outboxFallbacks.keys())) {
    if (!retryQueues.has(key)) {
      await persistToOutbox(key);
      outboxFallbacks.delete(key);
    }
  }
};

export const flushAllPendingSaves = async (): Promise<void> => {
  if (flushFlight) {
    flushRerun = true;
    return flushFlight;
  }
  flushFlight = (async () => {
    try {
      do {
        flushRerun = false;
        await doFlushAllPendingSaves();
      } while (flushRerun);
    } finally {
      flushFlight = null;
    }
  })();
  return flushFlight;
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    pendingSaves.forEach((timeout, key) => {
      clearTimeout(timeout);
      const fn = pendingSaveFunctions.get(key);
      if (fn) {
        retryQueues.set(key, { fn, attempts: 0 });
        retryWithBackoff(key, fn).catch(() => {});
      }
    });
    pendingSaves.clear();
    pendingSaveFunctions.clear();
  });

  // عند رجوع الإنترنت: أعد كل المحاولات الفاشلة فوراً
  window.addEventListener('online', () => {
    void retryFailedSaves().catch(() => {});
  });
}
