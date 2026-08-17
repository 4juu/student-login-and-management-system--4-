// src/hooks/useImageTilt.ts
import { useCallback, useEffect, useRef, useState } from 'react';

interface TiltResult {
  detectedAngle: number;
  isLevel: boolean;
  level: 'green' | 'yellow' | 'red';
}

const SIZE = 120;

const detectTiltFromImage = (img: HTMLImageElement): number => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);

  const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = imageData.data;
  const gray = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  }

  const edges = new Float32Array(SIZE * SIZE);
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const gx =
        -gray[(y - 1) * SIZE + (x - 1)] +
        gray[(y - 1) * SIZE + (x + 1)] +
        -2 * gray[y * SIZE + (x - 1)] +
        2 * gray[y * SIZE + (x + 1)] +
        -gray[(y + 1) * SIZE + (x - 1)] +
        gray[(y + 1) * SIZE + (x + 1)];
      const gy =
        -gray[(y - 1) * SIZE + (x - 1)] +
        -2 * gray[(y - 1) * SIZE + x] +
        -gray[(y - 1) * SIZE + (x + 1)] +
        gray[(y + 1) * SIZE + (x - 1)] +
        2 * gray[(y + 1) * SIZE + x] +
        gray[(y + 1) * SIZE + (x + 1)];
      edges[y * SIZE + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  let bestAngle = 0;
  let bestVariance = 0;

  for (let angle = -15; angle <= 15; angle += 1) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const projection = new Float32Array(SIZE);
    let count = 0;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const srcX = Math.round(
          cos * (x - SIZE / 2) + sin * (y - SIZE / 2) + SIZE / 2
        );
        const srcY = Math.round(
          -sin * (x - SIZE / 2) + cos * (y - SIZE / 2) + SIZE / 2
        );
        if (srcX >= 0 && srcX < SIZE && srcY >= 0 && srcY < SIZE) {
          projection[y] += edges[srcY * SIZE + srcX];
          count++;
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
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      setDetectedAngle(0);
      setUserRotation(0);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
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

  const result: TiltResult = { detectedAngle, isLevel, level };

  return {
    ...result,
    adjustedAngle,
    userRotation,
    updateUserRotation,
  };
};
