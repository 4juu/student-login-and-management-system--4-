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

export const useImageTransform = () => {
  const [transform, setTransform] = useState<TransformState>({
    rotation: 0,
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const touchesRef = useRef<TouchInfo[]>([]);
  const lastDistRef = useRef(0);
  const lastAngleRef = useRef(0);
  const lastCenterRef = useRef({ x: 0, y: 0 });
  const baseTransformRef = useRef<TransformState>({ rotation: 0, scale: 1, translateX: 0, translateY: 0 });
  const lastTapRef = useRef(0);

  const getTouchDistance = (t1: TouchInfo, t2: TouchInfo) => {
    const dx = t2.x - t1.x;
    const dy = t2.y - t1.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchAngle = (t1: TouchInfo, t2: TouchInfo) => {
    return (Math.atan2(t2.y - t1.y, t2.x - t1.x) * 180) / Math.PI;
  };

  const getTouchCenter = (t1: TouchInfo, t2: TouchInfo) => ({
    x: (t1.x + t2.x) / 2,
    y: (t1.y + t2.y) / 2,
  });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const now = Date.now();
    const touches = Array.from(e.touches).map((t) => ({
      id: t.identifier,
      x: t.clientX,
      y: t.clientY,
    }));
    touchesRef.current = touches;

    if (touches.length === 1) {
      const timeSinceLastTap = now - lastTapRef.current;
      if (timeSinceLastTap < 300) {
        setTransform({ rotation: 0, scale: 1, translateX: 0, translateY: 0 });
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
    }

    if (touches.length === 2) {
      lastDistRef.current = getTouchDistance(touches[0], touches[1]);
      lastAngleRef.current = getTouchAngle(touches[0], touches[1]);
      lastCenterRef.current = getTouchCenter(touches[0], touches[1]);
      baseTransformRef.current = { ...transform };
    }
  }, [transform]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map((t) => ({
      id: t.identifier,
      x: t.clientX,
      y: t.clientY,
    }));

    if (touches.length === 1 && touchesRef.current.length === 1) {
      const dx = touches[0].x - touchesRef.current[0].x;
      const dy = touches[0].y - touchesRef.current[0].y;
      setTransform((prev) => ({
        ...prev,
        translateX: prev.translateX + dx,
        translateY: prev.translateY + dy,
      }));
    }

    if (touches.length === 2 && touchesRef.current.length === 2) {
      const base = baseTransformRef.current;

      const dist = getTouchDistance(touches[0], touches[1]);
      const angle = getTouchAngle(touches[0], touches[1]);
      const center = getTouchCenter(touches[0], touches[1]);

      const distRatio = dist / lastDistRef.current;
      const angleDiff = angle - lastAngleRef.current;
      const dx = center.x - lastCenterRef.current.x;
      const dy = center.y - lastCenterRef.current.y;

      setTransform({
        rotation: base.rotation + angleDiff,
        scale: clamp(base.scale * distRatio, 0.3, 4),
        translateX: base.translateX + dx,
        translateY: base.translateY + dy,
      });
    }

    touchesRef.current = touches;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map((t) => ({
      id: t.identifier,
      x: t.clientX,
      y: t.clientY,
    }));
    touchesRef.current = touches;

    if (touches.length < 2) {
      baseTransformRef.current = { ...transform };
    }
  }, [transform]);

  const rotate90 = useCallback((direction: 1 | -1) => {
    setTransform((prev) => ({
      ...prev,
      rotation: prev.rotation + direction * 90,
    }));
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
