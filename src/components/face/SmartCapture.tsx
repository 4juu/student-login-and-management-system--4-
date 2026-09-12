import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, X, AlertCircle, Loader2 } from 'lucide-react';
import { analyzeCardFrame, resetDetector, type CardDetection } from '../../services/cardDetector';
import { detectCardCorners, type QuadCorners } from '../../services/cardCorners';
import { dewarpCard } from '../../services/dewarp';
import { opencvLoader } from '../../services/opencvLoader';
import type { OCVCV, OCVMat } from '../../services/opencvTypes';

const CARD_RATIO = 85.6 / 53.98;

interface SmartCaptureProps {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

export const SmartCapture: React.FC<SmartCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cvRef = useRef<OCVCV | null>(null);
  const animRef = useRef<number>(0);
  const lastAnalysisRef = useRef<number>(0);
  const stableSinceRef = useRef<number>(0);
  const lastCornersRef = useRef<QuadCorners | null>(null);
  const detectingRef = useRef<boolean>(false);
  const capturedRef = useRef<boolean>(false);
  const frameRef = useRef<OCVMat | null>(null);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadProgress, setLoadProgress] = useState({ percent: 0, detail: 'تهيئة محرك كشف البطاقة...' });
  const [retryKey, setRetryKey] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [corners, setCorners] = useState<QuadCorners | null>(null);
  const [detection, setDetection] = useState<CardDetection>({
    status: 'no_card', message: 'وجّه الكاميرا نحو البطاقة', coverage: 0, blurScore: 0,
  });

  const FRAME_INTERVAL = 120;
  const STABLE_FRAMES = 8;

  // ── 1) تحميل OpenCV أولاً — الكاميرا لا تُفتح قبل اكتماله ──
  useEffect(() => {
    let mounted = true;
    const off = opencvLoader.onProgress(p => {
      if (mounted) setLoadProgress(p);
    });

    opencvLoader
      .ensureReady()
      .then(cv => {
        if (!mounted) return;
        cvRef.current = cv;
        setLoadState('ready');
      })
      .catch(e => {
        if (!mounted) return;
        console.error('[smart-capture] فشل تحميل OpenCV:', e);
        setCameraError(e instanceof Error ? e.message : 'تعذر تحميل محرك الكشف');
        setLoadState('error');
      });

    return () => {
      mounted = false;
      off();
    };
  }, [retryKey]);

  const handleRetryLoad = () => {
    opencvLoader.reset();
    setCameraError('');
    setLoadProgress({ percent: 0, detail: 'تهيئة محرك كشف البطاقة...' });
    setLoadState('loading');
    setRetryKey(k => k + 1);
  };

  // ── 2) فتح الكاميرا فقط بعد جاهزية المحرك ──
  useEffect(() => {
    if (loadState !== 'ready') return;
    let mounted = true;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        if (mounted) setCameraError('الكاميرا غير متاحة');
      }
    };
    start();

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      resetDetector();
      if (frameRef.current) {
        try { frameRef.current.delete(); } catch {}
        frameRef.current = null;
      }
    };
  }, [loadState]);

  // ── 3) حلقة الكشف عن البطاقة ──
  useEffect(() => {
    const video = videoRef.current;
    const cv = cvRef.current;
    if (loadState !== 'ready' || !video || cameraError || !cv) return;

    const loop = async (ts: number) => {
      if (
        !capturedRef.current &&
        !capturing &&
        !detectingRef.current &&
        ts - lastAnalysisRef.current >= FRAME_INTERVAL &&
        video.readyState >= 2
      ) {
        detectingRef.current = true;
        try {
          await runDetection(cv, video, ts);
        } finally {
          detectingRef.current = false;
        }
        lastAnalysisRef.current = ts;
      }
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [loadState, cameraError, capturing]);

  const runDetection = async (cv: OCVCV, video: HTMLVideoElement, _ts: number) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;

    // صندوق النتائج — use the video itself via imread-like draw
    const src = new cv.Mat(vw, vh, cv.CV_8UC4);
    const frame = new cv.Mat(vw, vh, cv.CV_8UC4);
    try {
      // نسخ إطار الفيديو إلى مصفوفة OpenCV
      const canvas = document.createElement('canvas');
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0, vw, vh);
      const imgData = ctx.getImageData(0, 0, vw, vh);
      src.data.set(new Uint8Array(imgData.data.buffer));
      cv.cvtColor(src, frame, cv.COLOR_RGBA2BGR);

      // فحص جودة الإطار (بوابات cardDetector الحالية)
      const roi = {
        x: 0, y: 0, w: vw, h: vh,
      };
      const quality = analyzeCardFrame(video, roi);
      setDetection(prev => (prev.status === 'ready' && quality.status === 'ready' ? prev : quality));

      // كشف الزوايا
      const quad = detectCardCorners(cv, frame);
      if (quad) {
        setCorners(quad);
      }

      if (quad && quality.status === 'ready') {
        // استقرار: يجب أن تكون الزوايا ثابتة لعدة إطارات
        const prev = lastCornersRef.current;
        let stable = false;
        if (prev) {
          const drift = (
            Math.hypot(prev.topLeft.x - quad.topLeft.x, prev.topLeft.y - quad.topLeft.y) +
            Math.hypot(prev.bottomRight.x - quad.bottomRight.x, prev.bottomRight.y - quad.bottomRight.y)
          ) / (2 * prev.width);
          stable = drift < 0.05;
        }
        lastCornersRef.current = quad;

        if (stable) {
          stableSinceRef.current += 1;
        } else {
          stableSinceRef.current = 0;
        }

        // Auto-capture بعد الاستقرار لعدد إطارات كافٍ
        if (stableSinceRef.current >= STABLE_FRAMES && !capturedRef.current) {
          capturedRef.current = true;
          setCapturing(true);
          try {
            const dewarped = await dewarpCard(cv, frame, quad, 1400);
            onCapture(dewarped.file);
          } catch (e) {
            console.error('[smart-capture] فشل التقويم:', e);
            // fallback: تسليم الصورة الأصلية
            const blob = await frameToBlob(canvas);
            onCapture(blob);
            setCapturing(false);
          } finally {
            capturedRef.current = false;
          }
        }
      } else {
        lastCornersRef.current = null;
        stableSinceRef.current = 0;
      }
    } finally {
      src.delete();
      frame.delete();
    }
  };

  const frameToBlob = (canvas: HTMLCanvasElement): Promise<File> =>
    new Promise((resolve, reject) => {
      canvas.toBlob(b => {
        if (b) resolve(new File([b], 'id-card.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        else reject(new Error('فشل التقاط الإطار'));
      }, 'image/jpeg', 0.95);
    });

  const handleManualCapture = useCallback(async () => {
    const stream = streamRef.current;
    const cv = cvRef.current;
    if (!stream || !cv || capturing) return;

    setCapturing(true);
    cancelAnimationFrame(animRef.current);

    const video = videoRef.current!;
    const vw = video.videoWidth, vh = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0);

    const src = new cv.Mat(vw, vh, cv.CV_8UC4);
    const frame = new cv.Mat(vw, vh, cv.CV_8UC4);

    try {
      const imgData = ctx.getImageData(0, 0, vw, vh);
      src.data.set(new Uint8Array(imgData.data.buffer));
      cv.cvtColor(src, frame, cv.COLOR_RGBA2BGR);

      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;

      const quad = corners || (detectCardCorners(cv, frame) as QuadCorners | null);
      if (quad) {
        const dewarped = await dewarpCard(cv, frame, quad, 1400);
        onCapture(dewarped.file);
        return;
      }
      const fallback = await frameToBlob(canvas);
      onCapture(fallback);
    } catch (e) {
      console.error('[smart-capture] فشل الالتقاط اليدوي:', e);
      setCapturing(false);
      setCameraError('تعذر الالتقاط — حاول مرة أخرى');
    } finally {
      cancelAnimationFrame(animRef.current);
      src.delete();
      frame.delete();
      setCapturing(false);
    }
  }, [capturing, corners]);

  // ── 4) بوابة التحميل ──
  if (loadState !== 'ready') {
    const isError = loadState === 'error';
    return (
      <div className="fixed inset-0 z-50 bg-[#0B1220] flex items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-sm text-center">
          <div className="relative w-28 h-28 mx-auto mb-8">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={isError ? '#f43f5e' : '#6366f1'}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${Math.min(100, loadProgress.percent) / 100 * 326.7} 326.7`}
                className="transition-all duration-500 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              {isError ? (
                <AlertCircle className="w-12 h-12 text-red-400" />
              ) : (
                <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
              )}
            </div>
          </div>

          <h2 className="text-white text-lg font-extrabold mb-1.5">
            {isError ? 'تعذر تحميل محرك الكشف' : 'تهيئة محرك كشف البطاقة'}
          </h2>
          <p className="text-sm text-slate-400 mb-6">
            {isError ? cameraError : 'يعمل بالكامل على جهازك — لا تُرفع أي صورة'}
          </p>

          {!isError && (
            <>
              <div className="h-1.5 bg-white/8 rounded-full overflow-hidden mb-5">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-indigo-500 to-violet-500 transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, loadProgress.percent)}%` }}
                />
              </div>
              <div className="space-y-1.5 text-right">
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-500/10 text-indigo-200">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="flex-1">محرك كشف البطاقة</span>
                  <span className="tabular-nums text-[10px] opacity-70">{Math.round(loadProgress.percent)}%</span>
                </div>
              </div>
              <p className="text-slate-500 text-[11px] mt-4">{loadProgress.detail}</p>
            </>
          )}

          {isError && (
            <div className="flex items-center gap-3 justify-center">
              <button
                onClick={onCancel}
                className="bg-white/10 hover:bg-white/15 text-white px-8 py-2.5 rounded-xl text-sm font-bold transition active:scale-95"
              >
                إلغاء
              </button>
              <button
                onClick={handleRetryLoad}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold transition active:scale-95"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 5) واجهة الكاميرا ──
  const borderColor =
    detection.status === 'ready' ? '#22c55e' :
    detection.status === 'blurry' || detection.status === 'moving' ? '#eab308' :
    '#ef4444';

  const bgOpacity = detection.status === 'ready' ? 0.35 : 0.55;

  // تحويل زوايا الفيديو لإحداثيات العرض
  const renderCorners = (() => {
    const video = videoRef.current;
    if (!video || !corners || !video.videoWidth) return null;
    const scale = Math.min(
      (window.innerWidth || 1) / (video.videoWidth || 1),
      ((window.innerHeight * 0.75) || 1) / (video.videoHeight || 1),
    );
    const w = video.videoWidth * scale;
    const h = video.videoHeight * scale;
    // مركزية العرض (video object-cover يعبأ الشاشة)
    const offX = (window.innerWidth - w) / 2;
    const offY = (window.innerHeight * 0.78 - h) / 2;

    const proj = (p: { x: number; y: number }) => ({
      left: offX + p.x * scale,
      top: offY + p.y * scale,
    });

    return {
      tl: proj(corners.topLeft),
      tr: proj(corners.topRight),
      br: proj(corners.bottomRight),
      bl: proj(corners.bottomLeft),
    };
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" dir="rtl">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* مرشد ثابت بنسبة البطاقة */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: '82%',
              maxWidth: 380,
              aspectRatio: `${CARD_RATIO} / 1`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,${bgOpacity})`,
              border: `2px dashed ${borderColor}`,
              borderRadius: 12,
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}
          >
            {!capturing && detection.status !== 'ready' && (
              <div className="absolute inset-0 overflow-hidden rounded-[9px] pointer-events-none">
                <div
                  className="absolute left-0 right-0 h-0.5 animate-scan"
                  style={{ background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* زوايا مكتشفة حيّة فوق البطاقة */}
        {renderCorners && !capturing && (
          <div className="pointer-events-none absolute" style={{ position: 'absolute', inset: 0 }}>
            {[renderCorners.tl, renderCorners.tr, renderCorners.br, renderCorners.bl].map((pt, i) => (
              <div
                key={i}
                className="absolute w-4 h-4 rounded-full"
                style={{
                  left: pt.left - 8,
                  top: pt.top - 8,
                  background: detection.status === 'ready' ? '#22c55e' : '#eab308',
                  boxShadow: '0 0 8px rgba(0,0,0,0.5)',
                }}
              />
            ))}
          </div>
        )}

        <div className="absolute top-4 left-0 right-0 flex justify-center z-20">
          <div
            className="px-4 py-2 rounded-full text-sm font-bold shadow-lg backdrop-blur-sm flex items-center gap-2"
            style={{
              background: detection.status === 'ready' ? 'rgba(34,197,94,0.85)' : 'rgba(0,0,0,0.65)',
              color: '#fff',
              transition: 'background 0.3s',
            }}
          >
            {capturing ? (
              <>⏺ جاري التقاط الصورة...</>
            ) : detection.status === 'ready' ? (
              <>✓ {detection.message}</>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" />
                {detection.message}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="bg-black/90 backdrop-blur-sm px-6 py-5 flex flex-col items-center gap-3">
        <p className="text-xs text-gray-400 text-center leading-relaxed">
          ضع البطاقة داخل الإطار — يجري الالتقاط تلقائياً عند تثبيتها
        </p>

        <div className="flex items-center gap-3 w-full max-w-xs">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95"
          >
            <X className="w-4 h-4" /> إلغاء
          </button>

          <button
            onClick={handleManualCapture}
            disabled={!streamRef.current || capturing}
            className="flex-[2] py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95"
          >
            <Camera className="w-4 h-4" /> {capturing ? 'جاري الالتقاط...' : 'تصوير يدوي'}
          </button>
        </div>

        {cameraError && (
          <p className="text-xs text-amber-400 text-center">{cameraError}</p>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .animate-scan { animation: scan 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
};