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

// 🅿️ تسجيل Service Worker للتثبيت (PWA) بدون أي كاش
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}