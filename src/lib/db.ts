// 🗄️ طبقة تخزين محلية عبر IndexedDB (بدون أي مكتبة خارجية)
// تستخدم ككاش للقراءة السريعة لفتح بيانات المرحلة فوراً
// مع بقاء localStorage كاحتياط للتوافق

const DB_NAME = 'attendance_system_cache';
const STORE = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB غير متاح'));
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });

  return dbPromise;
};

/**
 * 🔒 إغلاق الاتصال المفتوح وإلغاء الاحتفاظ به
 * يُستخدم قبل/بعد حذف قاعدة البيانات: بقاء الاتصال مفتوحاً يوقف الحذف (onblocked)
 * ويبقي بيانات قديمة تظهر بعد تسجيل الخروج — وبعد الإغلاق يُفتح اتصال نظيف تلقائياً.
 */
export const closeDBConnection = async (): Promise<void> => {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // فتح مرفوض أو إغلاق متعثر — تجاهل: أول وصول لاحق يفتح اتصالاً نظيفاً
  }
};

export const dbGet = async <T,>(key: string): Promise<T | undefined> => {
  try {
    const db = await openDB();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
};

export const dbSet = async (key: string, value: unknown): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // تجاهل أخطاء التخزين - البيانات ستبقى في Firebase
  }
};

export const dbDelete = async (key: string): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // تجاهل
  }
};
