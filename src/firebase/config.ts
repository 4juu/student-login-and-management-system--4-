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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);
export const analytics = getAnalytics(app);

// ============================================================
// 🌐 مراقبة حالة الاتصال بالإنترنت
// ============================================================
if (typeof window !== 'undefined') {
  // عند رجوع النت → فعّل اتصال Firebase
  window.addEventListener('online', () => {
    console.log('🟢 رجع الاتصال - تفعيل Firebase');
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل تفعيل Firebase online:', e);
    }
  });

  // عند انقطاع النت → خلي Firebase يعرف (يمنع المحاولات الفاشلة)
  window.addEventListener('offline', () => {
    console.log('🔴 انقطع الاتصال - وضع offline');
    try {
      goOffline(database);
      // ⏰ بعد ثانيتين رجّعه online حتى لما يرجع النت يزامن
      setTimeout(() => {
        goOnline(database);
      }, 2000);
    } catch (e) {
      console.warn('فشل تغيير حالة Firebase:', e);
    }
  });

  // 🔄 تأكد إن Firebase online من البداية
  if (navigator.onLine) {
    try {
      goOnline(database);
    } catch (e) {
      console.warn('فشل تفعيل Firebase:', e);
    }
  }
}

export default app;