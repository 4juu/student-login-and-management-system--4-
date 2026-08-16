import { useEffect, useState } from 'react';

// قياس مناطق الأمان (env) مرة واحدة عند فتح النافذة لتبقى ثابتة
// مهما تمدد/انكمش شريط المتصفح أو تغير اتجاه الجهاز
export const useSafeArea = () => {
  const [topSafe, setTopSafe] = useState(0);
  const [bottomSafe, setBottomSafe] = useState(0);

  useEffect(() => {
    const measure = (edge: 'top' | 'bottom') => {
      const probe = document.createElement('div');
      probe.style.cssText =
        `position:fixed;${edge}:0;left:0;right:0;height:0;` +
        `padding-${edge}:env(safe-area-inset-${edge},0px);pointer-events:none;visibility:hidden;`;
      document.body.appendChild(probe);
      const v = Math.max(0, Math.round(probe.getBoundingClientRect().height));
      probe.remove();
      return v;
    };
    setTopSafe(measure('top'));
    setBottomSafe(measure('bottom'));
  }, []);

  return { topSafe, bottomSafe };
};
