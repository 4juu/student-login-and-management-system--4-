import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
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

interface SelfCaptureStepProps {
  student: Student;
  allStudents: Student[];
  onCaptured: (descriptor: StoredFaceDescriptor) => void;
  onCancel: () => void;
}

const SAMPLES_NEEDED = 3;
const SAMPLE_GAP_MS = 450;
const MIN_REL_SIZE = 0.14;

export const SelfCaptureStep: React.FC<SelfCaptureStepProps> = ({ student, allStudents, onCaptured, onCancel }) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastSampleAtRef = useRef(0);
  const mountedRef = useRef(true);
  const samplesDataRef = useRef<Float32Array[]>([]);

  const [cameraReady, setCameraReady] = useState(false);
  const [samples, setSamples] = useState(0);
  const [feedback, setFeedback] = useState('وجّه وجهك داخل الدائرة');
  const [fatal, setFatal] = useState<string | null>(null);

  const capturedRef = useRef(onCaptured);
  capturedRef.current = onCaptured;

  const othersWithFace = useMemo(
    () => allStudents.filter(s => s.id !== student.id && hasValidDescriptor(s.faceDescriptor)),
    [allStudents, student.id],
  );
  const othersRef = useRef(othersWithFace);
  othersRef.current = othersWithFace;

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
          // إخفاء مرحلة تفاوض الدقة حتى تستقر الأبعاد — يمنع قفزة التكبير الأولى
          await waitVideoDimensionsStable(videoRef.current);
        }
        if (cancelled) return;
        setCameraReady(true);
      } catch (e) {
        console.error('[self-capture] فشل فتح الكاميرا:', e);
        setFatal('لم نتمكن من فتح الكاميرا — تأكد من منح الإذن');
      }
    })();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [engineReady]);

  const finalize = useCallback(() => {
    const arr = samplesDataRef.current;
    if (!arr.length) return;
    const dim = arr[0].length;
    const avg = new Float32Array(dim);
    for (const s of arr) for (let i = 0; i < dim; i++) avg[i] += s[i];
    for (let i = 0; i < dim; i++) avg[i] /= arr.length;
    const finalDesc = l2Normalize(avg);

    const tamper = checkForTampering(finalDesc, othersRef.current, student.id);
    if (tamper.tampered) {
      samplesDataRef.current = [];
      setSamples(0);
      setFatal(`هذا الوجه مسجل مسبقاً لطالب آخر (${tamper.matchedWith})`);
      return;
    }
    capturedRef.current(descriptorToStorage(finalDesc, { samples: arr.length }));
  }, [student.id]);

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
          if (g) g.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (!faces[0]) { setFeedback('لا أرى وجهاً — تأكد من الإضاءة'); return; }
        const relSize = faces[0].box.width / v.videoWidth;
        if (relSize < MIN_REL_SIZE) { setFeedback('اقترب قليلاً من الكاميرا'); return; }

        const now = Date.now();
        if (now - lastSampleAtRef.current < SAMPLE_GAP_MS) return;
        lastSampleAtRef.current = now;

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

        if ((res.quality.composite ?? 0) < 0.45) {
          setFeedback(res.quality.brightness < 0.3 ? 'الإضاءة ضعيفة جداً' : 'ثبّت وجهك وانظر للكاميرا');
          return;
        }

        samplesDataRef.current.push(new Float32Array(res.descriptor));
        setSamples(samplesDataRef.current.length);

        if (samplesDataRef.current.length >= SAMPLES_NEEDED) {
          setFeedback('اكتمل الالتقاط ✓');
          setTimeout(() => { if (mountedRef.current) finalize(); }, 500);
        } else {
          setFeedback(`رائع! ثبّت الوضعية (${samplesDataRef.current.length}/${SAMPLES_NEEDED})`);
        }
      } catch (e) {
        console.warn('[self-capture] خطأ في دورة الالتقاط:', e);
      } finally {
        busyRef.current = false;
      }
    }, 220);

    return () => clearInterval(iv);
  }, [engineReady, cameraReady, finalize]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
      {!engineReady && (
        <div className="w-full max-w-md glass-card p-8 text-center">
          <div className="inline-block w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-white font-bold">{progress.detail}</p>
          {error && (
            <>
              <p className="text-red-400 text-sm mt-2 font-bold">{error}</p>
              <button onClick={retry} className="mt-3 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold">إعادة المحاولة</button>
            </>
          )}
          <button onClick={onCancel} className="block mx-auto mt-4 text-slate-400 hover:text-slate-200 text-sm underline underline-offset-4">إلغاء</button>
        </div>
      )}

      {engineReady && (
        <div className="w-full max-w-md glass-card p-5">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-white">تسجيل بصمة الوجه</h2>
            <p className="text-xs text-white/50 mt-1">مرحباً <span className="font-bold text-indigo-300">{student.name}</span> — التقط تلقائي، فقط ثبّت وجهك</p>
          </div>

          <div className="rounded-2xl overflow-hidden relative bg-black w-full mb-4" style={{ aspectRatio: '4 / 3', maxWidth: 380, margin: '0 auto' }}>
            <video ref={videoRef} playsInline muted autoPlay
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }} />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className={`w-[52%] h-[78%] rounded-[50%] border-dashed transition-colors duration-300 ${samples > 0 ? 'border-emerald-400/70' : 'border-white/35'}`} style={{ borderWidth: 3 }} />
            </div>
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="inline-block w-9 h-9 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          <p className={`text-center text-sm font-bold mb-4 ${
            feedback.includes('✓') ? 'text-emerald-400'
              : feedback.startsWith('لا') || feedback.startsWith('اقترب') || feedback.includes('ضعيفة') ? 'text-amber-400'
              : 'text-slate-300'
          }`}>{feedback}</p>

          <div className="flex items-center justify-center gap-2 mb-5">
            {Array.from({ length: SAMPLES_NEEDED }).map((_, i) => (
              <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i < samples ? 'w-8 bg-emerald-500' : 'w-4 bg-white/15'}`} />
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
