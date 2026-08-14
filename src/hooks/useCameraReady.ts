import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

// الحد الأدنى لأبعاد الفيديو الحقيقية — قبل ذلك يعرض المتصفح الحجم الافتراضي 300×150
// ويسبب قصّاً خاطئاً عبر object-cover (تقريب الكاميرا ثم القفزة للوضع الطبيعي)
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const FORCE_READY_MS = 2500;

/**
 * يمنع ظهور إطار الكاميرا المشوّه (بحجم 300×150 الافتراضي) قبل تحميل الأبعاد الحقيقية.
 * يعرض الفيديو فقط عند توفر الأبعاد الفعلية للتيار، مع مهلة أمان حتى لا تعلق الكاميرا مخفية.
 */
export const useCameraReady = (videoRef: RefObject<HTMLVideoElement | null>) => {
  const [videoReady, setVideoReady] = useState(false);
  const forceTimer = useRef<number | null>(null);

  const clearForceTimer = useCallback(() => {
    if (forceTimer.current !== null) {
      window.clearTimeout(forceTimer.current);
      forceTimer.current = null;
    }
  }, []);

  const markReady = useCallback(() => {
    const v = videoRef.current;
    if (v && v.videoWidth >= MIN_WIDTH && v.videoHeight >= MIN_HEIGHT) {
      clearForceTimer();
      setVideoReady(true);
      return true;
    }
    return false;
  }, [videoRef, clearForceTimer]);

  const handleVideoReady = useCallback(() => {
    if (markReady()) return;
    // بعض المتصفحات تُشعل الحدث قبل توفر الأبعاد الفعلية
    window.setTimeout(markReady, 120);
  }, [markReady]);

  const resetVideoReady = useCallback(() => {
    clearForceTimer();
    setVideoReady(false);
  }, [clearForceTimer]);

  const armForceReady = useCallback(() => {
    clearForceTimer();
    forceTimer.current = window.setTimeout(() => {
      setVideoReady(true);
    }, FORCE_READY_MS);
  }, [clearForceTimer]);

  useEffect(() => clearForceTimer, [clearForceTimer]);

  return { videoReady, handleVideoReady, resetVideoReady, armForceReady };
};
