// src/hooks/useImageTransform.ts
import { useCallback, useRef, useState } from 'react';

interface TransformState {
  rotation: number;
  scale: number;
  translateX: number;
  translateY: number;
}

interface TouchInfo {
  id: number;
  x: number;
  y: number;
}

const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

const getDistance = (a: TouchInfo, b: TouchInfo) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const getAngle = (a: TouchInfo, b: TouchInfo) =>
  (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

const getCenter = (a: TouchInfo, b: TouchInfo) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const toTouchInfo = (t: React.Touch): TouchInfo => ({
  id: t.identifier,
  x: t.clientX,
  y: t.clientY,
});

export const useImageTransform = () => {
  const [transform, setTransform] = useState<TransformState>({
    rotation: 0,
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const stateRef = useRef(transform);
  stateRef.current = transform;

  const touchesStartRef = useRef<TouchInfo[]>([]);
  const baseRef = useRef<TransformState>({ rotation: 0, scale: 1, translateX: 0, translateY: 0 });
  const lastTapRef = useRef(0);
  const singleStartRef = useRef<TouchInfo | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map(toTouchInfo);

    if (touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 280) {
        setTransform({ rotation: 0, scale: 1, translateX: 0, translateY: 0 });
        lastTapRef.current = 0;
        singleStartRef.current = null;
        return;
      }
      lastTapRef.current = now;
      singleStartRef.current = touches[0];
    }

    if (touches.length === 2) {
      baseRef.current = { ...stateRef.current };
      touchesStartRef.current = touches;
    }

    touchesStartRef.current = touches;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map(toTouchInfo);

    if (touches.length === 1 && touchesStartRef.current.length === 1 && singleStartRef.current) {
      const dx = touches[0].x - singleStartRef.current.x;
      const dy = touches[0].y - singleStartRef.current.y;
      singleStartRef.current = touches[0];
      setTransform((prev) => ({
        ...prev,
        translateX: prev.translateX + dx,
        translateY: prev.translateY + dy,
      }));
      return;
    }

    if (touches.length === 2 && touchesStartRef.current.length === 2) {
      const s = touchesStartRef.current;
      const base = baseRef.current;

      const startDist = getDistance(s[0], s[1]);
      const curDist = getDistance(touches[0], touches[1]);
      const distRatio = curDist / startDist;

      const startAngle = getAngle(s[0], s[1]);
      const curAngle = getAngle(touches[0], touches[1]);
      const angleDiff = curAngle - startAngle;

      const startCenter = getCenter(s[0], s[1]);
      const curCenter = getCenter(touches[0], touches[1]);
      const dx = curCenter.x - startCenter.x;
      const dy = curCenter.y - startCenter.y;

      setTransform({
        rotation: base.rotation + angleDiff,
        scale: clamp(base.scale * distRatio, 0.3, 4),
        translateX: base.translateX + dx,
        translateY: base.translateY + dy,
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map(toTouchInfo);
    touchesStartRef.current = touches;
    if (touches.length === 1) {
      singleStartRef.current = touches[0];
      baseRef.current = { ...stateRef.current };
    }
  }, []);

  const rotate90 = useCallback((dir: 1 | -1) => {
    setTransform((prev) => ({ ...prev, rotation: prev.rotation + dir * 90 }));
  }, []);

  const resetTransform = useCallback(() => {
    setTransform({ rotation: 0, scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const getTransformStyle = useCallback(
    () =>
      `translate(${transform.translateX}px, ${transform.translateY}px) rotate(${transform.rotation}deg) scale(${transform.scale})`,
    [transform]
  );

  return {
    transform,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    rotate90,
    resetTransform,
    getTransformStyle,
  };
};
