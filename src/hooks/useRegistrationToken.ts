import { useState, useEffect, useCallback } from 'react';

function extractToken(name: string, params: URLSearchParams): string | null {
  let token = params.get(name);
  if (!token && window.location.hash) {
    const hashStr = window.location.hash.replace(/^#\/?/, '');
    token = new URLSearchParams(hashStr).get(name);
  }
  if (!token) {
    const match = window.location.href.match(new RegExp(`[?&#]${name}=([^&#]+)`));
    if (match?.[1]) token = decodeURIComponent(match[1]);
  }
  return token;
}

export default function useRegistrationToken() {
  const [registerToken, setRegisterToken] = useState<string | null>(null);
  const [testToken, setTestToken] = useState<string | null>(null);
  const [attToken, setAttToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    const detectToken = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        let token = extractToken('reg', params);

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

        const testTkn = extractToken('test', params);
        if (testTkn) setTestToken(testTkn);

        const attTkn = extractToken('att', params);
        if (attTkn) setAttToken(attTkn);

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

  const clearUrlParam = (name: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  };

  const handleExitSelfRegister = useCallback(() => {
    setRegisterToken(null);
    sessionStorage.removeItem('pendingRegToken');
    clearUrlParam('reg');
  }, []);

  const handleExitTest = useCallback(() => {
    setTestToken(null);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleExitAtt = useCallback(() => {
    setAttToken(null);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  return {
    registerToken,
    testToken,
    attToken,
    tokenChecked,
    handleExitSelfRegister,
    handleExitTest,
    handleExitAtt,
  };
}
