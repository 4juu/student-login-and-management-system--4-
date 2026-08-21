import { useEffect } from 'react';

// يقفل تمرير الصفحة الخلفية أثناء فتح النوافذ المنبثقة حتى لا تتحرك خلفها
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevPadRight = body.style.paddingRight;

    const scrollbarW = window.innerWidth - html.clientWidth;
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.paddingRight = prevPadRight;
    };
  }, [active]);
}
