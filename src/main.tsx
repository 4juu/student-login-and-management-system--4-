import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChunkLoadErrorBoundary } from './components/ChunkLoadErrorBoundary';
import './index.css';

const App = lazy(() => import('./App'));
const StudentEntry = lazy(() => import('./studentEntry'));

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
      await navigator.serviceWorker.register('/sw.js');
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