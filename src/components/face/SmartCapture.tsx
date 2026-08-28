import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Upload, X, AlertCircle } from 'lucide-react';
import { analyzeCardFrame, resetDetector, CardDetection } from '../../services/cardDetector';

const CARD_RATIO = 85.6 / 53.98;

interface SmartCaptureProps {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

export const SmartCapture: React.FC<SmartCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const lastAnalysisRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraError, setCameraError] = useState('');
  const [detection, setDetection] = useState<CardDetection>({
    status: 'no_card', message: 'وجّه الكاميرا نحو البطاقة', coverage: 0, blurScore: 0,
  });
  const [readyCount, setReadyCount] = useState(0);

  const FRAME_INTERVAL = 120;

  useEffect(() => {
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
        if (mounted) setCameraError('الكاميرا غير متاحة — استخدم رفع الصورة من المعرض');
      }
    };
    start();
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      resetDetector();
    };
  }, []);

  const getROI = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const frameW = vw * 0.82;
    const frameH = frameW / CARD_RATIO;
    const x = (vw - frameW) / 2;
    const y = (vh - frameH) / 2;
    return { x, y, w: frameW, h: frameH };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || cameraError) return;

    const loop = (ts: number) => {
      if (ts - lastAnalysisRef.current >= FRAME_INTERVAL && video.readyState >= 2) {
        const roi = getROI();
        if (roi) {
          const result = analyzeCardFrame(video, roi);
          setDetection(prev => {
            if (prev.status === 'ready' && result.status === 'ready') return prev;
            return result;
          });
          if (result.status === 'ready') {
            setReadyCount(c => c + 1);
          } else {
            setReadyCount(0);
          }
        }
        lastAnalysisRef.current = ts;
      }
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [cameraError, getROI]);

  useEffect(() => {
    if (detection.status === 'ready' && readyCount >= 3) {
      handleCaptureInternal();
    }
  }, [readyCount, detection.status]);

  const handleCaptureInternal = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(animRef.current);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        onCapture(new File([blob], 'id-card.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
      }
    }, 'image/jpeg', 0.95);
  }, [onCapture]);

  const handleGallerySelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    streamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(animRef.current);
    onCapture(f);
  }, [onCapture]);

  const borderColor =
    detection.status === 'ready' ? '#22c55e' :
    detection.status === 'blurry' || detection.status === 'moving' ? '#eab308' :
    '#ef4444';

  const bgOpacity = detection.status === 'ready' ? 0.35 : 0.55;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" dir="rtl">
      {/* Camera feed */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Dark overlay with card cutout */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{
              width: '82%',
              maxWidth: 380,
              aspectRatio: `${CARD_RATIO} / 1`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,${bgOpacity})`,
              border: `3px solid ${borderColor}`,
              borderRadius: 12,
              transition: 'border-color 0.3s, box-shadow 0.3s',
            }}
          >
            {/* Corner marks */}
            <div className="absolute -top-1 -left-1 w-7 h-7 border-t-[3px] border-l-[3px] rounded-tl-xl" style={{ borderColor }} />
            <div className="absolute -top-1 -right-1 w-7 h-7 border-t-[3px] border-r-[3px] rounded-tr-xl" style={{ borderColor }} />
            <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-[3px] border-l-[3px] rounded-bl-xl" style={{ borderColor }} />
            <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-[3px] border-r-[3px] rounded-br-xl" style={{ borderColor }} />

            {/* Scan line animation */}
            {detection.status !== 'ready' && (
              <div className="absolute inset-0 overflow-hidden rounded-[9px] pointer-events-none">
                <div
                  className="absolute left-0 right-0 h-0.5 animate-scan"
                  style={{ background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="absolute top-4 left-0 right-0 flex justify-center z-20">
          <div
            className="px-4 py-2 rounded-full text-sm font-bold shadow-lg backdrop-blur-sm flex items-center gap-2"
            style={{
              background: detection.status === 'ready' ? 'rgba(34,197,94,0.85)' : 'rgba(0,0,0,0.65)',
              color: '#fff',
              transition: 'background 0.3s',
            }}
          >
            {detection.status === 'ready' ? (
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

      {/* Bottom controls */}
      <div className="bg-black/90 backdrop-blur-sm px-6 py-5 flex flex-col items-center gap-3">
        <p className="text-xs text-gray-400 text-center leading-relaxed">
          ضع البطاقة داخل الإطار — التصوير تلقائي عند الاستقرار
        </p>

        <div className="flex items-center gap-4 w-full max-w-xs">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95"
          >
            <X className="w-4 h-4" /> إلغاء
          </button>

          <button
            onClick={handleCaptureInternal}
            disabled={!streamRef.current}
            className="flex-1 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95"
          >
            <Camera className="w-4 h-4" /> التقط
          </button>

          <button
            onClick={handleGallerySelect}
            className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition active:scale-95"
          >
            <Upload className="w-4 h-4" /> معرض
          </button>
        </div>

        {cameraError && (
          <p className="text-xs text-amber-400 text-center">{cameraError}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

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
