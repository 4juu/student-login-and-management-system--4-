import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

/**
 * Prevents showing the distorted default 300x150 video frame before real dimensions arrive.
 * Only shows video when actual dimensions are available.
 */
export const useCameraReady = (videoRef: RefObject<HTMLVideoElement | null>) => {
  const [videoReady, setVideoReady] = useState(false);

  const markReady = useCallback(() => {
    const v = videoRef.current;
    if (v && v.videoWidth >= MIN_WIDTH && v.videoHeight >= MIN_HEIGHT) {
      setVideoReady(true);
      return true;
    }
    return false;
  }, [videoRef]);

  const handleVideoReady = useCallback(() => {
    if (markReady()) return;
    window.setTimeout(markReady, 120);
  }, [markReady]);

  const resetVideoReady = useCallback(() => {
    setVideoReady(false);
  }, []);

  const armForceReady = useCallback(() => {
    // No force-ready: wait for real dimensions
  }, []);

  return { videoReady, handleVideoReady, resetVideoReady, armForceReady };
};
