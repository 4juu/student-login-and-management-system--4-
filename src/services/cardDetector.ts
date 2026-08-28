const CARD_RATIO = 85.6 / 53.98;

export interface CardDetection {
  status: 'no_card' | 'too_far' | 'too_close' | 'off_center' | 'blurry' | 'moving' | 'ready';
  message: string;
  coverage: number;
  blurScore: number;
}

function avgBrightness(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return sum / (w * h);
}

function laplacianVariance(data: Uint8ClampedArray, w: number, h: number): number {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  let sum = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap = -4 * gray[y * w + x]
        + gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1] + gray[y * w + x + 1];
      sum += lap * lap;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function brightPixelRatio(data: Uint8ClampedArray): number {
  let bright = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (v > 160) bright++;
    total++;
  }
  return total > 0 ? bright / total : 0;
}

function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (!b || a.length !== b.length) return 0;
  let diff = 0;
  const step = 16;
  for (let i = 0; i < a.length; i += step * 4) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / (a.length / step / 4);
}

let prevData: Uint8ClampedArray | null = null;

export function analyzeCardFrame(
  video: HTMLVideoElement,
  roi: { x: number; y: number; w: number; h: number }
): CardDetection {
  const sw = 320;
  const sh = Math.round(sw / CARD_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, sw, sh);

  const rx = Math.max(0, Math.round(roi.x * sw / video.videoWidth));
  const ry = Math.max(0, Math.round(roi.y * sh / video.videoHeight));
  const rw = Math.min(sw - rx, Math.round(roi.w * sw / video.videoWidth));
  const rh = Math.min(sh - ry, Math.round(roi.h * sh / video.videoHeight));

  if (rw <= 0 || rh <= 0) {
    return { status: 'no_card', message: 'وجّه الكاميرا نحو البطاقة', coverage: 0, blurScore: 0 };
  }

  const imgData = ctx.getImageData(rx, ry, rw, rh);
  const d = imgData.data;

  const brightness = avgBrightness(d, rw, rh);
  const blur = laplacianVariance(d, rw, rh);
  const coverage = brightPixelRatio(d);
  const stability = prevData ? frameDiff(d, prevData) : 0;
  prevData = new Uint8ClampedArray(d);

  if (brightness < 60) {
    return { status: 'no_card', message: 'أضاء المنطقة جيداً — الإضاءة خافتة', coverage, blurScore: blur };
  }
  if (brightness > 240) {
    return { status: 'no_card', message: 'الإضاءة مفرطة — تجنب الانعكاس', coverage, blurScore: blur };
  }
  if (blur < 80) {
    return { status: 'blurry', message: 'ثبّت الكاميرا — الصورة غير واضحة', coverage, blurScore: blur };
  }
  if (coverage < 0.25) {
    return { status: 'too_far', message: 'قرّب البطاقة', coverage, blurScore: blur };
  }
  if (coverage > 0.92) {
    return { status: 'too_close', message: 'أبعد البطاقة قليلاً', coverage, blurScore: blur };
  }
  if (stability > 25) {
    return { status: 'moving', message: 'ثبّت البطاقة', coverage, blurScore: blur };
  }
  return { status: 'ready', message: 'ممتاز — جاهز للتصوير', coverage, blurScore: blur };
}

export function resetDetector(): void {
  prevData = null;
}
