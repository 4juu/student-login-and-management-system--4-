import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from './EngineOverlay';
import {
  faceDetectorService,
  grabVideoFrame,
} from '../../services/faceAI/detector';
import { faceEmbedder } from '../../services/faceAI/embedder';
import { openCameraStream, waitVideoDimensionsStable } from '../../services/faceAI/camera';
import {
  checkForTampering,
  descriptorToStorage,
  hasValidDescriptor,
  l2Normalize,
  StoredFaceDescriptor,
} from '../../services/faceAI/descriptors';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface SelfCaptureStepProps {
  student: Student;
  allStudents: Student[];
  onCaptured: (descriptor: StoredFaceDescriptor) => void;
  onCancel: () => void;
}

const SAMPLES_NEEDED = 3;
const MIN_REL_SIZE = 0.14;

type CapturePhase = 'front' | 'right' | 'left';
const CAPTURE_PHASES: { key: CapturePhase; instruction: string; icon: string }[] = [
  { key: 'front', instruction: 'وجّه وجهك للمام', icon: '👤' },
  { key: 'right', instruction: 'أمال وجهك لليمين قليلاً', icon: '👉' },
  { key: 'left', instruction: 'أمال وجهك لليسار قليلاً', icon: '👈' },
];

export const SelfCaptureStep: React.FC<SelfCaptureStepProps> = ({ student, allStudents, onCaptured, onCancel }) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const samplesDataRef = useRef<Float32Array[]>([]);

  const [cameraReady, setCameraReady] = useState(false);
  const [camError, setCamError] = useState(false);
  const [samples, setSamples] = useState(0);
  const [feedback, setFeedback] = useState('وجّه وجهك داخل الدائرة');
  const [flash, setFlash] = useState<'ok' | 'fail' | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [faceInBoundary, setFaceInBoundary] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('front');

  useBodyScrollLock(true);

  const capturedRef = useRef(onCaptured);
  capturedRef.current = onCaptured;

  const othersWithFace = useMemo(
    () => allStudents.filter(s => s.id !== student.id && hasValidDescriptor(s.faceDescriptor)),
    [allStudents, student.id],
  );
  const othersRef = useRef(othersWithFace);
  othersRef.current = othersWithFace;

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
        console.error('[self-capture] فشل فتح الكاميرا:', e);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── حلقة كشف الوجه (بدون التقاط تلقائي) ──
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
          setCanCapture(false);
          setFeedback('لا أرى وجهاً — تأكد من الإضاءة');
          return;
        }

        const face = faces[0];
        const relSize = face.box.width / v.videoWidth;
        if (relSize < MIN_REL_SIZE) {
          setFaceInBoundary(false);
          setCanCapture(false);
          setFeedback('اقترب من الكاميرا قليلاً');
          return;
        }
        if (relSize > 0.85) {
          setFaceInBoundary(false);
          setCanCapture(false);
          setFeedback('ابتعد قليلاً — الوجه قريب جداً');
          return;
        }

        // فحص: هل مركز الوجه داخل البيضاوي؟
        const ecx = v.videoWidth / 2;
        const ecy = v.videoHeight / 2;
        const erx = v.videoWidth * 0.26;
        const ery = v.videoHeight * 0.39;
        const fcx = face.box.x + face.box.width / 2;
        const fcy = face.box.y + face.box.height / 2;
        const dx = (fcx - ecx) / erx;
        const dy = (fcy - ecy) / ery;
        const insideEllipse = (dx * dx + dy * dy) <= 1;

        // تحديد موضع الوجه
        const offsetRatio = (ecx - fcx) / v.videoWidth;
        let pos: 'center' | 'left' | 'right' = 'center';
        if (offsetRatio > 0.06) pos = 'right';
        else if (offsetRatio < -0.06) pos = 'left';

        setFaceInBoundary(insideEllipse);

        const phaseMatch =
          (capturePhase === 'front' && pos === 'center') ||
          (capturePhase === 'right' && pos === 'right') ||
          (capturePhase === 'left' && pos === 'left');

        setCanCapture(insideEllipse && phaseMatch);

        if (phaseMatch && insideEllipse) {
          setFeedback('تم ✓ — اضغط التقاط');
        } else if (!insideEllipse) {
          setFeedback(CAPTURE_PHASES.find(p => p.key === capturePhase)!.instruction);
        } else {
          const expected = capturePhase === 'right' ? 'أمال لليمين' : 'أمال لليسار';
          setFeedback(`أكمل الزاوية: ${expected}`);
        }
      } catch (e) {
        console.warn('[self-capture] خطأ في حلقة الكشف:', e);
      } finally {
        busyRef.current = false;
      }
    }, 200);

    return () => clearInterval(iv);
  }, [engineReady, cameraReady, capturePhase]);

  // ── التقاط يدوي ──
  const handleCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !mountedRef.current || busyRef.current || v.readyState < 2) return;
    busyRef.current = true;
    try {
      const faces = faceDetectorService.detect(v, performance.now());
      if (!faces[0]) { setFeedback('لا أرى وجهاً'); return; }

      const bmp = await grabVideoFrame(v, 640);
      if (!bmp) return;
      const scale = bmp.width / v.videoWidth;
      const res = await faceEmbedder.embed(bmp, {
        x: faces[0].box.x * scale,
        y: faces[0].box.y * scale,
        width: faces[0].box.width * scale,
        height: faces[0].box.height * scale,
      });
      if (!mountedRef.current) return;

      if ((res.quality.composite ?? 0) < 0.50) {
        setFeedback(res.quality.brightness < 0.3 ? 'الإضاءة ضعيفة جداً' : 'ثبّت وجهك وانظر للكاميرا');
        return;
      }

      samplesDataRef.current.push(new Float32Array(res.descriptor));
      const sampleCount = samplesDataRef.current.length;
      setSamples(sampleCount);
      try { navigator.vibrate?.(30); } catch {}

      // الانتقال للزاوية التالية
      if (sampleCount === 1) {
        setCapturePhase('right');
        setFeedback('تم — الآن أمال لليمين');
      } else if (sampleCount === 2) {
        setCapturePhase('left');
        setFeedback('تم — الآن أمال لليسار');
      }

      if (sampleCount >= SAMPLES_NEEDED) {
        // دمج العينات الثلاث ثم تطبيع L2
        const dim = samplesDataRef.current[0].length;
        const avg = new Float32Array(dim);
        for (const s of samplesDataRef.current) for (let i = 0; i < dim; i++) avg[i] += s[i];
        for (let i = 0; i < dim; i++) avg[i] /= samplesDataRef.current.length;
        const finalDesc = l2Normalize(avg);

        // فحص الاحتيال
        const tamper = checkForTampering(finalDesc, othersRef.current, student.id);
        if (tamper.tampered) {
          setFlash('fail');
          setFatal(`هذا الوجه مسجل مسبقاً لطالب آخر (${tamper.matchedWith})`);
          return;
        }

        // حفظ البصمة مع العينات الأصلية
        const quality = Math.round(((res.quality.composite + 0.8) / 2) * 100) / 100;
        capturedRef.current(descriptorToStorage(finalDesc, {
          samples: SAMPLES_NEEDED,
          quality,
          alt: samplesDataRef.current.map(s => l2Normalize(s)),
        }));

        setFlash('ok');
        try {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            g.gain.setValueAtTime(0.08, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.16);
            setTimeout(() => { ctx.close().catch(() => {}); }, 250);
          }
        } catch {}
        try { navigator.vibrate?.([40, 30, 40]); } catch {}
      }
    } catch (e) {
      console.warn('[self-capture] خطأ في التقاط البصمة:', e);
    } finally {
      busyRef.current = false;
    }
  }, [student.id]);

  if (fatal) {
    return (
      <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">تعذر تسجيل البصمة</h2>
          <p className="text-sm text-white/60 mb-6">{fatal}</p>
          <button onClick={onCancel} className="btn-base btn-secondary w-full py-3">
            رجوع
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1220] flex items-center justify-center p-4" dir="rtl">
      {!engineReady && <EngineOverlay progress={progress} error={error} onRetry={retry} onCancel={onCancel} />}

      {engineReady && (
        <div className="w-full max-w-md glass-card p-5">
          {/* رأس */}
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-white">تسجيل بصمة الوجه</h2>
            <p className="text-xs text-white/50 mt-1">مرحباً <span className="font-bold text-indigo-300">{student.name}</span> — التقط من 3 زوايا</p>
          </div>

          {/* الكاميرا */}
          <div className="rounded-2xl overflow-hidden relative bg-black w-full mb-4" style={{ aspectRatio: '4 / 3', maxWidth: 380, margin: '0 auto' }}>
            <video ref={videoRef} playsInline muted autoPlay
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            {/* دليل بيضاوي */}
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

            {/* وميض */}
            {flash && (
              <div className={`absolute inset-0 flex items-center justify-center backdrop-blur-sm ${
                flash === 'ok' ? 'bg-emerald-600/40' : 'bg-red-600/40'
              }`}>
                <span className="text-6xl">{flash === 'ok' ? '✅' : '⚠️'}</span>
              </div>
            )}

            {!cameraReady && !camError && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="inline-block w-9 h-9 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
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

          {/* التغذية الراجعة */}
          <p className={`text-center text-sm font-bold mb-3 ${
            faceInBoundary ? 'text-emerald-400' :
            feedback.includes('✓') ? 'text-emerald-400' :
            feedback.startsWith('لا') || feedback.startsWith('اقترب') || feedback.startsWith('ابتد') || feedback.includes('ضعيفة') ? 'text-amber-400' : 'text-slate-300'
          }`}>{feedback}</p>

          {/* دليل الزوايا الثلاث */}
          {samples < SAMPLES_NEEDED && (
            <div className="flex items-center justify-center gap-1.5 mb-3">
              {CAPTURE_PHASES.map((p, i) => {
                const done = i < samples;
                const active = i === samples;
                return (
                  <div key={p.key} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                    done ? 'bg-emerald-500/20 text-emerald-300' :
                    active ? 'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40' :
                    'bg-white/5 text-slate-500'
                  }`}>
                    <span>{done ? '✓' : p.icon}</span>
                    <span className="hidden sm:inline">{p.instruction}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* زر التقاط */}
          {samples < SAMPLES_NEEDED && (
            <button
              onClick={handleCapture}
              disabled={!canCapture}
              className={`w-full mb-3 py-3 rounded-xl text-sm font-extrabold transition-all duration-200 active:scale-[0.97] ${
                canCapture
                  ? 'bg-gradient-to-l from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/30 cursor-pointer'
                  : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
              }`}
            >
              📸 التقاط — {CAPTURE_PHASES[samples].instruction} ({samples + 1}/{SAMPLES_NEEDED})
            </button>
          )}

          {/* نقاط العينات */}
          <div className="flex items-center justify-center gap-2 mb-4">
            {Array.from({ length: SAMPLES_NEEDED }).map((_, i) => (
              <span key={i} className={`h-2 rounded-full transition-all duration-300 ${
                i < samples ? 'w-8 bg-emerald-500' : 'w-4 bg-white/15'
              }`} />
            ))}
          </div>

          <button onClick={onCancel} className="w-full py-2.5 rounded-xl bg-white/6 hover:bg-white/12 text-slate-300 text-sm font-bold transition">
            إلغاء
          </button>
        </div>
      )}
    </div>
  );
};
