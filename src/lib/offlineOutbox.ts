// ============================================================
// 📦 OUTBOX - تخزين احتياطي آمن عند انقطاع الاتصال
// ============================================================
// عند انقطاع الإنترنت، كل تغيير في البيانات يُحفظ هنا (IndexedDB)
// وعند عودة الاتصال تُرفع تلقائياً إلى Firebase ثم يُمسح الصندوق.
// الضمان: حتى لو أُغلق الموقع أثناء الانقطاع، البيانات لا تضيع.

import { dbGet, dbSet, dbDelete } from './db';

const OUTBOX_KEYS_KEY = 'outbox_keys';

const getKeys = (): string[] => {
  try {
    const raw = localStorage.getItem(OUTBOX_KEYS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

const setKeys = (keys: string[]): void => {
  try {
    localStorage.setItem(OUTBOX_KEYS_KEY, JSON.stringify(keys));
  } catch {}
};

export const queueOutbox = async (key: string, data: unknown): Promise<void> => {
  try {
    await dbSet(`outbox:${key}`, data);
    const keys = getKeys();
    if (!keys.includes(key)) {
      keys.push(key);
      setKeys(keys);
    }
  } catch {
    // تجاهل - التخزين المحلي العادي (localStorage) يبقى احتياطاً
  }
};

export const getOutboxEntries = async (): Promise<{ key: string; data: unknown }[]> => {
  const entries: { key: string; data: unknown }[] = [];
  for (const key of getKeys()) {
    try {
      const data = await dbGet<unknown>(`outbox:${key}`);
      if (data !== undefined) entries.push({ key, data });
    } catch {}
  }
  return entries;
};

export const hasOutboxEntries = async (): Promise<boolean> =>
  (await getOutboxEntries()).length > 0;

export const removeOutboxEntry = async (key: string): Promise<void> => {
  try {
    await dbDelete(`outbox:${key}`);
  } catch {}
  const keys = getKeys().filter(k => k !== key);
  setKeys(keys);
};

export const clearOutbox = async (): Promise<void> => {
  const keys = getKeys();
  for (const key of keys) {
    try {
      await dbDelete(`outbox:${key}`);
    } catch {}
  }
  setKeys([]);
};
