export type FacingMode = 'user' | 'environment';

export async function openCameraStream(facing: FacingMode = 'user'): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
}

// المتصفح قد يبدأ البث بدقة افتراضية (4:3) ثم يطبّق الدقة المطلوبة (16:9) بعد لحظات،
// ما يسبب "قفزة تكبير" مرئية مع object-cover. ننتظر حتى تستقر الأبعاد قبل إظهار الفيديو.
export async function waitVideoDimensionsStable(
  video: HTMLVideoElement,
  timeoutMs = 4000,
): Promise<void> {
  if (video.readyState < 1) {
    await new Promise<void>(resolve => {
      const onMeta = () => { cleanup(); resolve(); };
      const cleanup = () => video.removeEventListener('loadedmetadata', onMeta);
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      window.setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    });
  }

  const start = performance.now();
  let lastW = -1;
  let lastH = -1;
  let stableCount = 0;

  while (performance.now() - start < timeoutMs) {
    await new Promise(r => window.setTimeout(r, 120));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0 && w === lastW && h === lastH) {
      stableCount++;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
    }
    lastW = w;
    lastH = h;
  }
}
