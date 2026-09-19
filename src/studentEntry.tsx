import { lazy, Suspense, useEffect, useState } from 'react';
import './components/SelfRegister/selfRegister.css';

const SelfEnrollPage = lazy(() =>
  import('./components/SelfRegister/SelfEnrollPage').then(m => ({ default: m.SelfEnrollPage }))
);
const FaceTestPage = lazy(() =>
  import('./components/face/FaceTestPage').then(m => ({ default: m.FaceTestPage }))
);

/** صرف مدخل خفيف لصفحة الطالب — دون تحميل لوحة التحكم كاملة */
function detectToken(): { reg: string | null; test: string | null; att: string | null } {
  try {
    let reg: string | null = null;
    let test: string | null = null;
    let att: string | null = null;
    const params = new URLSearchParams(window.location.search);
    reg = params.get('reg');
    test = params.get('test');
    att = params.get('att');

    if (!reg && !test && !att && window.location.hash) {
      const hashStr = window.location.hash.replace(/^#\/?/, '');
      const hp = new URLSearchParams(hashStr);
      reg = hp.get('reg');
      test = hp.get('test');
      att = hp.get('att');
    }

    if (!reg && !test && !att) {
      const m1 = window.location.href.match(/[?&#]reg=([^&#]+)/);
      if (m1?.[1]) reg = decodeURIComponent(m1[1]);
      const m2 = window.location.href.match(/[?&#]test=([^&#]+)/);
      if (m2?.[1]) test = decodeURIComponent(m2[1]);
      const m3 = window.location.href.match(/[?&#]att=([^&#]+)/);
      if (m3?.[1]) att = decodeURIComponent(m3[1]);
    }

    if (!reg) reg = sessionStorage.getItem('pendingRegToken');
    if (reg) sessionStorage.setItem('pendingRegToken', reg);
    return { reg, test, att };
  } catch {
    return { reg: sessionStorage.getItem('pendingRegToken'), test: null, att: null };
  }
}

export default function StudentEntry() {
  const [tokens, setTokens] = useState<{ reg: string | null; test: string | null; att: string | null }>({ reg: null, test: null, att: null });
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setTokens(detectToken());
    setChecked(true);
  }, []);

  const handleExit = () => {
    try { sessionStorage.removeItem('pendingRegToken'); } catch {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('reg');
      url.searchParams.delete('test');
      url.searchParams.delete('att');
      window.history.replaceState({}, '', `${url.pathname}`);
    } catch {}
  };

  if (!checked) {
    return <div className="min-h-screen" style={{ background: '#0A1224' }} />;
  }

  // لا يوجد أي توكن
  if (!tokens.reg && !tokens.test && !tokens.att) {
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

  // صفحة اختبار البصمة
  if (tokens.test) {
    return (
      <Suspense fallback={
        <div className="flex min-h-screen items-center justify-center" style={{ background: '#0A1224' }}>
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
        </div>
      }>
        <FaceTestPage testToken={tokens.test} onExit={handleExit} />
      </Suspense>
    );
  }

  // صفحة تسجيل البصمة (حضور أو تسجيل ذاتي)
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#0A1224' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
      </div>
    }>
      <SelfEnrollPage token={tokens.att || tokens.reg!} onExit={handleExit} />
    </Suspense>
  );
}
