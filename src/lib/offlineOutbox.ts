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

// ============================================================
// 🔁 Background Sync — تسجيل تصفيية تلقائية عند عودة الاتصال
// الـ SW يستمع لحدث sync ويببلّغ النوافذ (أو يفتح التطبيق) لتصفيية الصندوق
// ============================================================
const OUTBOX_SYNC_TAG = 'flush-outbox';

type SyncManagerLike = { register: (tag: string) => Promise<void> };

export const requestOutboxBackgroundSync = async (): Promise<void> => {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & { sync?: SyncManagerLike }).sync;
    await sync?.register(OUTBOX_SYNC_TAG);
  } catch {
    // المتصفح لا يدعم Background Sync — يبقى الاعتماد على المزامنة عند فتح التطبيق
  }
};

export const queueOutbox = async (key: string, data: unknown, path?: string): Promise<void> => {
  try {
    // تثبيت المسار وقت الطبع: سنة أكاديمية قد تتغير قبل التصفيية
    await dbSet(`outbox:${key}`, path ? { data, path } : { data });
    const keys = getKeys();
    if (!keys.includes(key)) {
      keys.push(key);
      setKeys(keys);
    }
    await requestOutboxBackgroundSync();
  } catch {
    // تجاهل - التخزين المحلي الع:normal (localStorage) يبقى احتياطاً
  }
};

export const getOutboxEntries = async (): Promise<{ key: string; data: unknown; path?: string | undefined }[]> => {
  const keys = getKeys();
  if (keys.length === 0) return [];
  // توازي: قراءة كل العناصر دفعة واحدة بدل تسلسل IDB
  const loaded = await Promise.all(
    keys.map(async key => {
      try {
        const raw = await dbGet<unknown>(`outbox:${key}`);
        return { key, raw };
      } catch {
        return { key, raw: undefined as unknown };
      }
    })
  );
  const entries: { key: string; data: unknown; path?: string | undefined }[] = [];
  for (const { key, raw } of loaded) {
    if (raw === undefined) continue;
    // الصيغة الجديدة { data, path? } مقابل البيانات الخام في النسخ القديمة
    if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
      const wrapped = raw as { data: unknown; path?: string };
      entries.push({ key, data: wrapped.data, path: wrapped.path });
    } else {
      entries.push({ key, data: raw });
    }
  }
  return entries;
};

// O(1): يفحص سجل المفاتيح فقط (بدون قراءة كل الحمولات في كل استطلاع)
export const hasOutboxEntries = async (): Promise<boolean> => getKeys().length > 0;

export const removeOutboxEntry = async (key: string): Promise<void> => {
  try {
    await dbDelete(`outbox:${key}`);
  } catch {}
  const keys = getKeys().filter(k => k !== key);
  setKeys(keys);
};

/** حذف عدة عناصر دفعة واحدة: IDB متوازٍ + تحديث مفاتيح localStorage مرة وحدة */
export const removeOutboxEntries = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  await Promise.all(
    keys.map(k =>
      dbDelete(`outbox:${k}`).catch(() => {})
    )
  );
  const toRemove = new Set(keys);
  setKeys(getKeys().filter(k => !toRemove.has(k)));
};

export const clearOutbox = async (): Promise<void> => {
  const keys = getKeys();
  await Promise.all(
    keys.map(k =>
      dbDelete(`outbox:${k}`).catch(() => {})
    )
  );
  setKeys([]);
};

/** مسح كل محتويات IndexedDB (كاش المرحلة + الأوفلاين) — عند تسجيل الخروج/تغيير السنة */
export const clearLocalDatabases = async (): Promise<void> => {
  try {
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('attendance_system_cache');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {
    // تجاهل
  }
};
