import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, goOnline } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// ============================================================
// 🔥 التطبيق الرئيسي (للأدمن والتدريسي العادي)
// ============================================================
export const dbURL = firebaseConfig.databaseURL!.replace(/\/+$/, '');
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

// ============================================================
// 🔥 التطبيق الثانوي (لإنشاء حسابات التدريسيين بدون التأثير على جلسة الأدمن)
// ============================================================
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

// ============================================================
// 🌐 مراقبة حالة الاتصال بالإنترنت
// ============================================================
// ملاحظة: لا نستخدم goOffline() هنا عمداً، لأنه يجمّد إرسال البيانات
// المعلقة ويسبب عدم اكتمال المزامنة بعد رجوع الاتصال.
// نكتفي بتفعيل goOnline() عند رجوع الاتصال ونترك SDK يعيد الاتصال تلقائياً.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل تفعيل Firebase online:', e);
    }
  });

  if (navigator.onLine) {
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل تفعيل Firebase:', e);
    }
  }
}

export default app;