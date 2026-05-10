import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase, goOnline, goOffline } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCIrOxhpgn9xRF7tAJZqByvl_8sllSbMck",
  authDomain: "student-system-login-nust-muj.firebaseapp.com",
  databaseURL: "https://student-system-login-nust-muj-default-rtdb.firebaseio.com",
  projectId: "student-system-login-nust-muj",
  storageBucket: "student-system-login-nust-muj.firebasestorage.app",
  messagingSenderId: "698150905447",
  appId: "1:698150905447:web:89345791765760437256c2",
  measurementId: "G-NZNKFS0K7Q"
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