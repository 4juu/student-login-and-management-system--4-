import { useEffect } from 'react';

// عدّاد عالمي: أول نافذة مفتوحة تحفظ حالة الصفحة وتقفلها، آخر نافذة تُغلق يستعيد التمرير
// (يمنع تعارض نافذتين متداخلتين/متعاقبتين في إعادة الحالة)
let lockCount = 0;
let saved: { html: string; body: string; pad: string; x: number; y: number } | null = null;

// يقفل تمرير الصفحة الخلفية أثناء فتح النوافذ المنبثقة حتى لا تتحرك خلفها
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    if (lockCount === 0) {
      saved = {
        html: html.style.overflow,
        body: body.style.overflow,
        pad: body.style.paddingRight,
        x: window.scrollX,
        y: window.scrollY,
      };
      const scrollbarW = window.innerWidth - html.clientWidth;
      if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      // بعض المتصفحات تقفز بموضع التمرير عند الإقفال — نثبّته
      if (html.scrollLeft !== saved.x || html.scrollTop !== saved.y) {
        html.scrollLeft = saved.x;
        html.scrollTop = saved.y;
      }
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0 && saved) {
        html.style.overflow = saved.html;
        body.style.overflow = saved.body;
        body.style.paddingRight = saved.pad;
        // استعادة موضع التمرير الأصلي (القفزة تحدث عند الإقفال لا الفتح)
        if (html.scrollLeft !== saved.x || html.scrollTop !== saved.y) {
          html.scrollLeft = saved.x;
          html.scrollTop = saved.y;
        }
        saved = null;
      }
    };
  }, [active]);
}
