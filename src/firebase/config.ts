import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { forceLongPolling, getDatabase, goOffline, goOnline } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDP_kzHoZnMvi0mE4uDF5-zgRTM1QLZHdE",
  authDomain: "student-system-ai-d3487.firebaseapp.com",
  databaseURL: "https://student-system-ai-d3487-default-rtdb.firebaseio.com/",
  projectId: "student-system-ai-d3487",
  storageBucket: "student-system-ai-d3487.firebasestorage.app",
  messagingSenderId: "38392100329",
  appId: "1:38392100329:web:cdcd0e7e993505872c4778",
  measurementId: "G-CQQCGL9HCS"
};

// ============================================================
// 🔥 التطبيق الرئيسي (للأدمن والتدريسي العادي)
// ============================================================
export const dbURL = firebaseConfig.databaseURL!.replace(/\/+$/, '');
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// بعض الشبكات تسمح بالإنترنت العام لكنها تحجب WebSocket؛ استخدم نقل HTTP
// المدعوم عبر هذه الشبكات كي لا تبقى عمليات الكتابة معلقة أو تفشل Offline.
forceLongPolling();
export const database = getDatabase(app);

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
  // المتصفح يعلّق WebSocket عندما يحفظ الصفحة في BFCache. أوقف Firebase
  // عند pagehide وأعد تشغيله عند استعادة الصفحة كي لا تبقى قاعدة البيانات Offline.
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) return;
    try {
      goOffline(database);
    } catch (e) {
      console.warn('فشل إيقاف Firebase قبل BFCache:', e);
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل إعادة اتصال Firebase بعد BFCache:', e);
    }
  });

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
