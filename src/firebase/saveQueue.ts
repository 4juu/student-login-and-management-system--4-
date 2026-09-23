// Debounced save queue with automatic retry (3 attempts, exponential backoff)

import { hasOutboxEntries } from "../lib/offlineOutbox";

const MAX_RETRIES = 3;
const retryQueues = new Map<string, { fn: () => Promise<void>; attempts: number }>();
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaveFunctions = new Map<string, () => Promise<void>>();

export const cancelAllPendingSaves = (): void => {
  for (const [key, timeout] of pendingSaves) {
    clearTimeout(timeout);
    pendingSaves.delete(key);
    pendingSaveFunctions.delete(key);
  }
  retryQueues.clear();
};

const retryWithBackoff = async (key: string, fn: () => Promise<void>, attempt: number = 1): Promise<void> => {
  try {
    await fn();
    retryQueues.delete(key);
  } catch (e) {
    console.warn(`⚠️ [${attempt}/${MAX_RETRIES}] فشلت محاولة الحفظ: ${key}`);
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(r => setTimeout(r, delay));
      return retryWithBackoff(key, fn, attempt + 1);
    }
    console.error(`❌ فشل الحفظ بعد ${MAX_RETRIES} محاولات: ${key}`, e);
    retryQueues.delete(key);
  }
};

export const getPendingSavesCount = (): number => retryQueues.size;

export const getDebouncedSavesCount = (): number => pendingSaves.size;

export const hasPendingWrites = async (): Promise<boolean> =>
  pendingSaves.size > 0 || retryQueues.size > 0 || (await hasOutboxEntries());

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

export const flushAllPendingSaves = async (): Promise<void> => {
  const keys = Array.from(pendingSaves.keys());
  if (keys.length === 0 && retryQueues.size === 0) return;


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
  for (const [key, { fn, attempts }] of retryQueues) {
    await retryWithBackoff(key, fn, attempts + 1);
  }
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
}
