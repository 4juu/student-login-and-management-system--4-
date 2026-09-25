import { useEffect } from 'react';

// عدّاد عالمي: أول نافذة مفتوحة تحفظ حالة الصفحة وتقفلها، آخر نافذة تُغلق يستعيد التمرير
// (يمنع تعارض نافذتين متداخلتين/متعاقبتين في إعادة الحالة)
let lockCount = 0;
let saved: { html: string; body: string; pad: string } | null = null;

// يقفل تمرير الصفحة الخلفية أثناء فتح النوافذ المنبثقة حتى لا تتحرك خلفها
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    if (lockCount === 0) {
      saved = { html: html.style.overflow, body: body.style.overflow, pad: body.style.paddingRight };
      const scrollbarW = window.innerWidth - html.clientWidth;
      if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0 && saved) {
        html.style.overflow = saved.html;
        body.style.overflow = saved.body;
        body.style.paddingRight = saved.pad;
        saved = null;
      }
    };
  }, [active]);
}
