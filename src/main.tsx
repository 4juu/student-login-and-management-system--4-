import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChunkLoadErrorBoundary } from './components/ChunkLoadErrorBoundary';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { LoadingState } from './components/loading/LoadingState';
import { Toaster } from './components/ui/toaster';
import { initSentry } from './lib/sentry';
import './index.css';

// 📡 مراقبة الأخطاء في الإنتاج (no-op بدون VITE_SENTRY_DSN أو في التطوير)
initSentry();

// 🔄 منع استعادة موضع التمرير من المتصفح — كل صفحة/تبويب جديد يبدأ من الأعلى
try {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
} catch { /* بيئة بدون window */ }

// 🌐 مزامنة عالمية عند رجوع الإنترنت — تعمل على كل الصفحات (لوحة + روابط طالب)
// تتصفي outbox + المحاولات الفاشلة فور رجوع الاتصال بغض النظر عن حالة React
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // ننتظر قليلاً حتى يستقر اتصال Firebase ثم نصفي كل شيء
    window.setTimeout(() => {
      void import('./firebase/dataService')
        .then(({ applyOutbox, flushAllPendingSaves, retryFailedSaves }) =>
          Promise.allSettled([retryFailedSaves(), applyOutbox(), flushAllPendingSaves()]),
        )
        .catch(() => {});
    }, 400);
  });
}

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

// 🤫 كتم Console التفصيلي في الإنتاج — نبقي console.error/warn للتشخيص
if (import.meta.env.PROD) {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.info = noop;
}

// 📱 صفحة الطالب (رابط تسجيل/اختبار/حضور) تُفتح بمدخل خفيف دون تحميل لوحة التحكم كاملة
function hasStudentToken(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reg') || params.get('test') || params.get('att')) return true;
    if (
      window.location.hash &&
      new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('reg') ||
      new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('test') ||
      new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('att')
    ) {
      return true;
    }
    if (/[?&#](reg|test|att)=([^&#]+)/.test(window.location.href)) return true;
    if (sessionStorage.getItem('pendingRegToken')) return true;
  } catch {
    /* تجاهل */
  }
  return false;
}

const isStudentPath = hasStudentToken();

const Entry = isStudentPath ? StudentEntry : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ChunkLoadErrorBoundary>
        <AppErrorBoundary>
          <Suspense fallback={
            <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
              <LoadingState size="lg" />
            </div>
          }>
            <Entry />
          </Suspense>
          <Toaster />
        </AppErrorBoundary>
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

  // 📦 Background Sync: الـ SW يبلّغنا عند عودة الاتصال لتصفيية صندوق الأوفلاين
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === 'FLUSH_OUTBOX') {
      void import('./firebase/dataService')
        .then(({ applyOutbox, flushAllPendingSaves }) =>
          Promise.allSettled([applyOutbox(), flushAllPendingSaves()]),
        )
        .catch(() => {});
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