import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChunkLoadErrorBoundary } from './components/ChunkLoadErrorBoundary';
import './index.css';

const App = lazy(() => import('./App'));
const StudentEntry = lazy(() => import('./studentEntry'));

// 🆕 فحص الإصدار القسري: كل بناء جديد يحمل إصداراً فريداً.
// لو نسخة الجهاز أقدم من المنشورة، نمسح كاشات SW القديمة، نلغي تسجيلاتها العالقة،
// ونعيد تحميلاً طازجاً — وهذا يضمن وصول أي تحديث للنسخة المثبّتة دون أي انتظار.
const APP_VERSION = __APP_VERSION__;

function forceFreshState() {
  try {
    if ('caches' in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => Promise.resolve(r.unregister()).then(() => true).catch(() => false))))
        .then(() => {
          localStorage.setItem('appVersion', APP_VERSION);
          window.location.reload();
        })
        .catch(() => {
          localStorage.setItem('appVersion', APP_VERSION);
          window.location.reload();
        });
    } else {
      localStorage.setItem('appVersion', APP_VERSION);
      window.location.reload();
    }
  } catch {
    try {
      localStorage.setItem('appVersion', APP_VERSION);
    } catch {}
    window.location.reload();
  }
}

try {
  // فحص الإصدار الإجباري يعمل في الإنتاج فقط — أي بناء جديد ⟵ إعادة تحميل طازج
  if (import.meta.env.PROD) {
    const prev = localStorage.getItem('appVersion');
    if (prev && prev !== APP_VERSION) {
      forceFreshState();
    } else {
      localStorage.setItem('appVersion', APP_VERSION);
    }
  }
} catch {
  /* تجاهل — بيئة بدون localStorage */
}

// 📱 صفحة الطالب (رابط تسجيل ذاتي) تُفتح بمدخل خفيف دون تحميل لوحة التحكم كاملة
function hasRegToken(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('reg')) return true;
    if (
      window.location.hash &&
      new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('reg')
    ) {
      return true;
    }
    if (/[?&#]reg=([^&#]+)/.test(window.location.href)) return true;
    if (sessionStorage.getItem('pendingRegToken')) return true;
  } catch {
    /* تجاهل */
  }
  return false;
}

const isStudentPath = hasRegToken();

const Entry = isStudentPath ? StudentEntry : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ChunkLoadErrorBoundary>
        <Suspense fallback={<div className="min-h-screen bg-[#0B1220]" />}>
          <Entry />
        </Suspense>
      </ChunkLoadErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);

// 🅿️ تسجيل Service Worker للتثبيت (PWA) + تحديث فوري عند كل نشر جديد
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // updateViaCache: 'none' → المتصفح لا يستعمل أي HTTP cache عند تحديث سكربت الـ SW
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      // نتحقق من إصدار أحدث عند كل عودة للتطبيق وظهور التبويب
      const checkForUpdate = () => {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => reg?.update?.())
          .catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.setInterval(checkForUpdate, 60 * 60 * 1000);
    } catch {
      /* بيئة لا تدعم SW — يُهمل */
    }
  });

  // عند تفعيل SW جديد (skipWaiting) ينتقل التحكم ويعيد تحميل الصفحة لتعرض النسخة الجديدة
  let refreshing = false;
  const reloadOnce = () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
}