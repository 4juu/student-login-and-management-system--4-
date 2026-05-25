import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, goOnline, goOffline } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDP_kzHoZnMvi0mE4uDF5-zgRTM1QLZHdE",
  authDomain: "student-system-ai-d3487.firebaseapp.com",
  databaseURL: "https://student-system-ai-d3487-default-rtdb.firebaseio.com",
  projectId: "student-system-ai-d3487",
  storageBucket: "student-system-ai-d3487.firebasestorage.app",
  messagingSenderId: "38392100329",
  appId: "1:38392100329:web:cdcd0e7e993505872c4778",
  measurementId: "G-CQQCGL9HCS"
};

// ============================================================
// 🔥 التطبيق الرئيسي (للأدمن والتدريسي العادي)
// ============================================================
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
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('🟢 رجع الاتصال - تفعيل Firebase');
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل تفعيل Firebase online:', e);
    }
  });

  window.addEventListener('offline', () => {
    console.log('🔴 انقطع الاتصال - وضع offline');
    try {
      goOffline(database);
      setTimeout(() => {
        goOnline(database);
      }, 2000);
    } catch (e) {
      console.warn('فشل تغيير حالة Firebase:', e);
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