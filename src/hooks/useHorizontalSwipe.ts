import { useEffect, useRef } from 'react';

interface SwipeNavOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabled?: boolean;
  threshold?: number;
}

export function useHorizontalSwipe({ onSwipeLeft, onSwipeRight, enabled = true, threshold = 60 }: SwipeNavOptions) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      // لا تُفعَّل السحب عند فتح نافذة منبثقة (تغلق scroll عبر modal hook)
      if (document.body.style.overflow === 'hidden') return;
      startRef.current = { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 };
    };

    const onTouchEnd = (e: TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const change = e.changedTouches[0];
      if (!change) return;
      const dx = change.clientX - start.x;
      const dy = change.clientY - start.y;
      // تجاهل السحب الرأسي (التمرير الطولي) إلا إذا كان أفقي بالغالب
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, threshold, onSwipeLeft, onSwipeRight]);

  return null;
}