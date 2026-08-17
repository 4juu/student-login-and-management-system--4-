// src/hooks/useImageTilt.ts
import { useCallback, useEffect, useState } from 'react';

/**
 * كشف ميل الصورة باستخدام Projection Profile
 * (مستوحى من arabic-ocr — horizontal projection variance)
 */
const detectTiltFromImage = (img: HTMLImageElement): number => {
  const SIZE = 120;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = imageData.data;

  // تحويل لرمادي + threshold
  const binary = new Uint8Array(SIZE * SIZE);
  let sumGray = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const gray = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    binary[i] = gray;
    sumGray += gray;
  }

  const threshold = sumGray / (SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    binary[i] = binary[i] < threshold ? 1 : 0;
  }

  let bestAngle = 0;
  let bestVariance = 0;

  for (let angle = -15; angle <= 15; angle += 0.5) {
    const rad = (angle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const projection = new Float32Array(SIZE);

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (binary[y * SIZE + x] === 0) continue;
        const srcY = Math.round(-sinA * (x - SIZE / 2) + cosA * (y - SIZE / 2) + SIZE / 2);
        if (srcY >= 0 && srcY < SIZE) {
          projection[srcY]++;
        }
      }
    }

    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < SIZE; i++) {
      sum += projection[i];
      sumSq += projection[i] * projection[i];
    }
    const mean = sum / SIZE;
    const variance = sumSq / SIZE - mean * mean;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  return bestAngle;
};

export const useImageTilt = (imageUrl: string | null) => {
  const [detectedAngle, setDetectedAngle] = useState(0);
  const [userRotation, setUserRotation] = useState(0);

  useEffect(() => {
    if (!imageUrl) {
      setDetectedAngle(0);
      setUserRotation(0);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const angle = detectTiltFromImage(img);
      setDetectedAngle(angle);
      setUserRotation(0);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const updateUserRotation = useCallback((rotation: number) => {
    setUserRotation(rotation);
  }, []);

  const adjustedAngle = detectedAngle + userRotation;
  const absAngle = Math.abs(adjustedAngle % 360);
  const normalizedAngle = absAngle > 180 ? 360 - absAngle : absAngle;

  const isLevel = normalizedAngle <= 3;
  const level: 'green' | 'yellow' | 'red' = normalizedAngle <= 3
    ? 'green'
    : normalizedAngle <= 10
      ? 'yellow'
      : 'red';

  return {
    detectedAngle,
    isLevel,
    level,
    adjustedAngle,
    userRotation,
    updateUserRotation,
  };
};
