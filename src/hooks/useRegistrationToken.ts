import { useState, useEffect, useCallback } from 'react';

export default function useRegistrationToken() {
  const [registerToken, setRegisterToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    const detectToken = () => {
      try {
        let token: string | null = null;
        const params = new URLSearchParams(window.location.search);
        token = params.get('reg');

        if (!token && window.location.hash) {
          const hashStr = window.location.hash.replace(/^#\/?/, '');
          const hashParams = new URLSearchParams(hashStr);
          token = hashParams.get('reg');
        }

        if (!token) {
          const match = window.location.href.match(/[?&#]reg=([^&#]+)/);
          if (match?.[1]) token = decodeURIComponent(match[1]);
        }

        if (!token) token = sessionStorage.getItem('pendingRegToken');

        if (token) {
          // رابط أُنجز التقرير فيه مسبقاً → ننظفه ونعرض صفحة الدخول بدلاً من إعادة خطوة التحقق
          const doneToken = sessionStorage.getItem('selfEnrollDoneToken');
          if (doneToken && doneToken === token) {
            sessionStorage.removeItem('pendingRegToken');
            const url = new URL(window.location.href);
            url.searchParams.delete('reg');
            url.hash = '';
            window.history.replaceState({}, '', url.toString());
          } else {
            sessionStorage.setItem('pendingRegToken', token);
            setRegisterToken(token);
          }
        }

        setTokenChecked(true);
      } catch (e) {
        console.error(e);
        setTokenChecked(true);
      }
    };

    detectToken();
    window.addEventListener('pageshow', detectToken);
    return () => window.removeEventListener('pageshow', detectToken);
  }, []);

  const handleExitSelfRegister = useCallback(() => {
    setRegisterToken(null);
    sessionStorage.removeItem('pendingRegToken');
    const url = new URL(window.location.href);
    url.searchParams.delete('reg');
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  }, []);

  return { registerToken, tokenChecked, handleExitSelfRegister };
}
