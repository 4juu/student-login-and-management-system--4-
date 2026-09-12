import { lazy, Suspense, useEffect, useState } from 'react';
import './components/SelfRegister/selfRegister.css';

const SelfEnrollPage = lazy(() =>
  import('./components/SelfRegister/SelfEnrollPage').then(m => ({ default: m.SelfEnrollPage }))
);

/** صرف مدخل خفيف لصفحة الطالب — دون تحميل لوحة التحكم كاملة */
function detectRegToken(): string | null {
  try {
    let token: string | null = null;
    const params = new URLSearchParams(window.location.search);
    token = params.get('reg');

    if (!token && window.location.hash) {
      const hashStr = window.location.hash.replace(/^#\/?/, '');
      token = new URLSearchParams(hashStr).get('reg');
    }

    if (!token) {
      const match = window.location.href.match(/[?&#]reg=([^&#]+)/);
      if (match?.[1]) token = decodeURIComponent(match[1]);
    }

    if (!token) token = sessionStorage.getItem('pendingRegToken');
    if (token) sessionStorage.setItem('pendingRegToken', token);
    return token;
  } catch {
    return sessionStorage.getItem('pendingRegToken');
  }
}

export default function StudentEntry() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setToken(detectRegToken());
    setChecked(true);
  }, []);

  const handleExit = () => {
    try {
      sessionStorage.removeItem('pendingRegToken');
    } catch {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('reg');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch {}
  };

  if (!checked) {
    return <div className="min-h-screen" style={{ background: '#0A1224' }} />;
  }

  if (!token) {
    return (
      <div dir="rtl" className="sel-bg flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[16px] bg-gradient-to-br from-[#1458E2] to-[#2B7BFF] shadow-[0_8px_20px_rgba(20,88,226,0.4)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="9" cy="10" r="2" />
              <path d="M15 8h2M15 12h2M7 16h10" />
            </svg>
          </div>
          <div className="text-lg font-extrabold text-[#F3F7FF]">الرابط غير مكتمل</div>
          <p className="mt-2 text-sm leading-7 text-[#93A5C8]">
            للتسجيل الذاتي يرجى فتح الرابط الذي أرسلته لك إدارة الكلية كاملاً.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" style={{ background: '#0A1224' }}>
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <SelfEnrollPage token={token} onExit={handleExit} />
    </Suspense>
  );
}