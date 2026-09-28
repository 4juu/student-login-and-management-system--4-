import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from './EngineOverlay';
import { MorphingSquare } from '../MorphingSquare';
import { faceDetectorService, grabVideoFrame } from '../../services/faceAI/detector';
import { faceEmbedder } from '../../services/faceAI/embedder';
import { openCameraStream, waitVideoDimensionsStable } from '../../services/faceAI/camera';
import { enrollPhotoSample } from '../../services/faceAI/photoEnrollment';
import type { FaceGalleryDescriptor } from '../../services/faceAI/descriptors';
import { compressBitmap } from '../../lib/image';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface PhotoCaptureStepProps {
  student: Student;
  allStudents: Student[];
  /** (المعرض الناتج، الصورة المضغوطة data URI) */
  onCaptured: (descriptor: FaceGalleryDescriptor, photo: string) => void;
  onCancel: () => void;
}

const MIN_REL_SIZE = 0.14;

export const PhotoCaptureStep: React.FC<PhotoCaptureStepProps> = ({
  student,
  allStudents,
  onCaptured,
  onCancel,
}) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  const [cameraReady, setCameraReady] = useState(false);
  const [camError, setCamError] = useState(false);
  const [feedback, setFeedback] = useState('وجّه وجهك داخل الدائرة');
  const [faceInBoundary, setFaceInBoundary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  useBodyScrollLock(true);

  const capturedRef = useRef(onCaptured);
  capturedRef.current = onCaptured;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // فتح الكاميرا
  useEffect(() => {
    if (!engineReady) return;
    let localStream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        localStream = await openCameraStream('user');
        if (cancelled) { localStream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = localStream;
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play().catch(() => {});
          await waitVideoDimensionsStable(videoRef.current);
        }
        if (cancelled) return;
        setCameraReady(true);
      } catch (e) {
        console.error('[photo-capture] فشل فتح الكاميرا:', e);
        if (!cancelled) setCamError(true);
      }
    })();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
      setCamError(false);
    };
  }, [engineReady]);

  // حلقة كشف الوجه — توجيه فقط، الالتقاط يدوي
  useEffect(() => {
    if (!engineReady || !cameraReady) return;

    const iv = window.setInterval(async () => {
      const v = videoRef.current;
      if (!v || !mountedRef.current || busyRef.current || v.readyState < 2) return;
      busyRef.current = true;
      try {
        const faces = faceDetectorService.detect(v, performance.now());
        const canvas = canvasRef.current;
        if (canvas && v.videoWidth) {
          canvas.width = v.clientWidth; canvas.height = v.clientHeight;
          const g = canvas.getContext('2d');
          if (g) {
            g.clearRect(0, 0, canvas.width, canvas.height);
            if (faces[0]) {
              const sx = canvas.width / v.videoWidth, sy = canvas.height / v.videoHeight;
              const bx = (v.videoWidth - faces[0].box.x - faces[0].box.width) * sx;
              const by = faces[0].box.y * sy;
              g.strokeStyle = '#34d399'; g.lineWidth = 3.5; g.lineCap = 'round';
              const c = Math.min(faces[0].box.width * sx, faces[0].box.height * sy) * 0.22;
              g.beginPath();
              g.moveTo(bx, by + c); g.quadraticCurveTo(bx, by, bx + c, by);
              g.moveTo(bx + faces[0].box.width * sx - c, by); g.quadraticCurveTo(bx + faces[0].box.width * sx, by, bx + faces[0].box.width * sx, by + c);
              g.moveTo(bx + faces[0].box.width * sx, by + faces[0].box.height * sy - c); g.quadraticCurveTo(bx + faces[0].box.width * sx, by + faces[0].box.height * sy, bx + faces[0].box.width * sx - c, by + faces[0].box.height * sy);
              g.moveTo(bx + c, by + faces[0].box.height * sy); g.quadraticCurveTo(bx, by + faces[0].box.height * sy, bx, by + faces[0].box.height * sy - c);
              g.stroke();
            }
          }
        }

        if (!faces[0]) {
          setFaceInBoundary(false);
          setFeedback('لا أرى وجهاً — تأكد من الإضاءة');
          return;
        }

        const face = faces[0];
        const relSize = face.box.width / v.videoWidth;
        if (relSize < MIN_REL_SIZE) {
          setFaceInBoundary(false);
          setFeedback('اقترب من الكاميرا قليلاً');
          return;
        }
        if (relSize > 0.85) {
          setFaceInBoundary(false);
          setFeedback('ابتعد قليلاً — الوجه قريب جداً');
          return;
        }

        const ecx = v.videoWidth / 2;
        const ecy = v.videoHeight / 2;
        const erx = v.videoWidth * 0.26;
        const ery = v.videoHeight * 0.39;
        const fcx = face.box.x + face.box.width / 2;
        const fcy = face.box.y + face.box.height / 2;
        const dx = (fcx - ecx) / erx;
        const dy = (fcy - ecy) / ery;
        const insideEllipse = (dx * dx + dy * dy) <= 1;

        setFaceInBoundary(insideEllipse);
        if (insideEllipse) setFeedback('ممتاز — اضغط «التقاط الصورة»');
      } catch (e) {
        console.warn('[photo-capture] خطأ في حلقة الكشف:', e);
      } finally {
        busyRef.current = false;
      }
    }, 200);

    return () => clearInterval(iv);
  }, [engineReady, cameraReady]);

  const handleCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !mountedRef.current || busyRef.current || v.readyState < 2 || saving) return;
    busyRef.current = true;
    setSaving(true);
    try {
      const faces = faceDetectorService.detect(v, performance.now());
      if (!faces[0]) { setFeedback('لا أرى وجهاً'); return; }

      const bmp = await grabVideoFrame(v, 640);
      if (!bmp) {
        setFeedback('تعذر قراءة إطار الكاميرا — أعد المحاولة');
        return;
      }
      const scale = bmp.width / v.videoWidth;
      const res = await faceEmbedder.embed(bmp, {
        x: faces[0].box.x * scale,
        y: faces[0].box.y * scale,
        width: faces[0].box.width * scale,
        height: faces[0].box.height * scale,
      });
      if (!mountedRef.current) return;

      const rawDesc = res.descriptor as ArrayLike<number> | undefined;
      if (!rawDesc || rawDesc.length === 0) {
        setFeedback('تعذر استخراج البصمة — حسّن الإضاءة وأعد المحاولة');
        return;
      }

      if ((res.quality.composite ?? 0) < 0.50) {
        setFeedback(res.quality.brightness < 0.3 ? 'الإضاءة ضعيفة جداً' : 'ثبّت وجهك وانظر للكاميرا');
        return;
      }

      const photo = await compressBitmap(bmp);
      const query = new Float32Array(rawDesc);
      const quality = Math.round(((res.quality.composite + 0.8) / 2) * 100) / 100;

      const result = enrollPhotoSample({
        query,
        quality,
        studentId: student.id,
        students: allStudents,
        existing: student.faceDescriptor,
      });

      if (!result.ok) {
        if (result.reason === 'tamper') {
          setFatal(`هذه الصورة تشبه طالباً مسجلاً مسبقاً (${result.matchedWith})`);
          return;
        }
        if (result.reason === 'duplicate') {
          setFeedback('هذه الصورة محفوظة مسبقاً لهذا الطالب');
          return;
        }
        setFeedback('تعذر قراءة الصورة — أعد المحاولة');
        return;
      }

      capturedRef.current(result.gallery, photo);
      try { navigator.vibrate?.(40); } catch {}
    } catch (e) {
      console.warn('[photo-capture] خطأ في التقاط الصورة:', e);
      if (mountedRef.current) {
        const detail = e instanceof Error ? e.message : String(e ?? '');
        setFeedback(detail ? `${detail} — أعد المحاولة` : 'تعذر معالجة الصورة — أعد المحاولة');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [student, allStudents, saving]);

  if (fatal) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">تعذر حفظ الصورة</h2>
          <p className="text-sm text-white/60 mb-6">{fatal}</p>
          <button onClick={onCancel} className="btn-base btn-secondary w-full py-3">رجوع</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
      {!engineReady && <EngineOverlay progress={progress} error={error} onRetry={retry} onCancel={onCancel} />}

      {engineReady && (
        <div className="w-full max-w-md glass-card p-5">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-white">تسجيل صورة الطالبة</h2>
            <p className="text-xs text-white/50 mt-1">
              مرحباً <span className="font-bold text-indigo-300">{student.name}</span> — صورة واحدة واضحة للوجه
            </p>
          </div>

          <div className="mb-4 rounded-2xl bg-gradient-to-l from-indigo-500/15 to-violet-500/15 border border-indigo-400/30 p-4 text-center">
            <p className="text-lg font-extrabold text-white leading-snug">انظر للكاميرا داخل الدائرة</p>
            <p className="text-[11px] text-indigo-200/80 mt-1.5">إضاءة جيدة + وجه واضح — ستُراجَع الصورة من الإدارة</p>
          </div>

          <div className="rounded-2xl overflow-hidden relative bg-black w-full mb-4" style={{ aspectRatio: '4 / 3', maxWidth: 380, margin: '0 auto' }}>
            <video ref={videoRef} playsInline muted autoPlay
              aria-label="معاينة الكاميرا"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} aria-label="إطار كشف الوجه" className="absolute inset-0 w-full h-full pointer-events-none" />

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`w-[52%] h-[78%] rounded-[50%] border-3 border-dashed transition-all duration-300 ${
                  faceInBoundary
                    ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]'
                    : 'border-white/35'
                }`}
                style={{ borderWidth: 3 }}
              />
            </div>

            {!cameraReady && !camError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <MorphingSquare size="md" />
              </div>
            )}

            {camError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-center px-4">
                <span className="text-3xl mb-2">🚫</span>
                <p className="text-red-300 font-bold text-sm">تعذر فتح الكاميرا</p>
                <button onClick={onCancel} className="mt-3 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-lg transition">إغلاق</button>
              </div>
            )}
          </div>

          <p className={`text-center text-sm font-bold mb-3 ${
            faceInBoundary ? 'text-emerald-400' :
            feedback.includes('ضعيفة') || feedback.includes('اقترب') || feedback.includes('ابتد') ? 'text-amber-400' : 'text-slate-300'
          }`}>{feedback}</p>

          <button
            onClick={handleCapture}
            disabled={saving}
            className={`w-full mb-3 py-3 rounded-xl text-sm font-extrabold transition-all duration-200 active:scale-[0.97] ${
              faceInBoundary && !saving
                ? 'bg-gradient-to-l from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/30'
                : 'bg-white/10 text-slate-300 border border-white/10'
            }`}
          >
            {saving ? 'جاري المعالجة…' : 'التقاط الصورة'}
          </button>

          <button onClick={onCancel} className="w-full py-2.5 rounded-xl bg-white/6 hover:bg-white/12 text-slate-300 text-sm font-bold transition flex items-center justify-center gap-2">
            <XCircle className="w-4 h-4" /> إلغاء
          </button>
        </div>
      )}
    </div>
  );
};

export default PhotoCaptureStep;
