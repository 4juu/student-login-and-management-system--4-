import { useEffect, useState } from 'react';

const measureEnv = (edge: 'top' | 'bottom') => {
  const probe = document.createElement('div');
  probe.style.cssText =
    `position:fixed;${edge}:0;left:0;right:0;height:0;` +
    `padding-${edge}:env(safe-area-inset-${edge},0px);pointer-events:none;visibility:hidden;`;
  document.body.appendChild(probe);
  const v = Math.max(0, Math.round(probe.getBoundingClientRect().height));
  probe.remove();
  return v;
};

// topSafe: يتبع visualViewport.offsetTop الحيّ حتى لا يقفز الـ X عند
// طي/إظهار شريط المتصفح (iOS)، مع قياس env كحد أدنى (حالة الشاشة الممتدة).
// bottomSafe: قيمة مجمدة عند الفتح (أسفل الشاشة مستقر دائماً).
export const useSafeArea = () => {
  const [bottomSafe, setBottomSafe] = useState(0);
  const [topSafe, setTopSafe] = useState(0);
  const [vvTop, setVvTop] = useState(0);

  useEffect(() => {
    setTopSafe(measureEnv('top'));
    setBottomSafe(measureEnv('bottom'));
    const vv = window.visualViewport;
    if (vv) {
      const update = () => setVvTop(Math.round(vv.offsetTop));
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
  }, []);

  return { topSafe: Math.max(topSafe, vvTop), bottomSafe };
};
