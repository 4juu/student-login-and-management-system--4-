import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
} from '../../services/faceAI/descriptors';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface FaceEnrollModalProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  /** يفتح التسجيل مباشرة لهؤلاء الطلاب بدون خطوة الاختيار */
  initialSelectedIds?: string[];
  onClose: () => void;
}

const SAMPLES_NEEDED = 3;
const MIN_REL_SIZE = 0.14;

interface Result {
  studentId: string;
  name: string;
  ok: boolean;
  reason?: string;
}

export const FaceEnrollModal: React.FC<FaceEnrollModalProps> = ({
  students,
  onUpdateStudent,
  initialSelectedIds,
  onClose,
}) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI();

  // قائمة الانتظار: نحتفظ فقط بالطلاب الموجودين فعلاً في القائمة
  const validPreset = useMemo(
    () => (initialSelectedIds ?? []).filter(id => students.some(s => s.id === id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [phase, setPhase] = useState<'select' | 'live' | 'summary'>(validPreset.length ? 'live' : 'select');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds ?? []));
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<string[]>(validPreset);
  const [qi, setQi] = useState(0);
  const [samples, setSamples] = useState(0);
  const [feedback, setFeedback] = useState('وجّه الوجه داخل الدائرة');
  const [flash, setFlash] = useState<'ok' | 'fail' | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [camError, setCamError] = useState(false);
  const [faceInBoundary, setFaceInBoundary] = useState(false);
  const [canCapture, setCanCapture] = useState(false);

  // عزل النافذة عن تمرير الصفحة الخلفية
  useBodyScrollLock(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const samplesDataRef = useRef<Float32Array[]>([]);
  const studentsRef = useRef(students);
  studentsRef.current = students;

  const filtered = useMemo(() => {
    const q = search.trim();
    const list = q ? students.filter(s => s.name.includes(q) || s.code.includes(q)) : students;
    return [...list].sort((a, b) => {
      const av = hasValidDescriptor(a.faceDescriptor) ? 0 : 1;
      const bv = hasValidDescriptor(b.faceDescriptor) ? 0 : 1;
      return av - bv || a.name.localeCompare(b.name, 'ar');
    });
  }, [students, search]);

  const total = queue.length;
  const currentStudent = queue[qi] ? students.find(s => s.id === queue[qi]) : undefined;

  // ── الكاميرا ──
  useEffect(() => {
    if (!engineReady || phase !== 'live') return;
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
        console.error('[face-enroll] فشل فتح الكاميرا:', e);
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
  }, [engineReady, phase]);

  // ── إنهاء طالب والانتقال للتالي ──
  const qiRef = useRef(qi);
  qiRef.current = qi;
  const queueLenRef = useRef(queue.length);
  queueLenRef.current = queue.length;

  const finishStudent = useCallback((studentId: string, name: string, ok: boolean, reason?: string) => {
    setResults(prev => [...prev, { studentId, name, ok, reason }]);
    setFlash(ok ? 'ok' : 'fail');
    setTimeout(() => { if (mountedRef.current) setFlash(null); }, 900);
    samplesDataRef.current = [];
    setSamples(0);
    setFeedback(ok ? 'تم الحفظ ✓' : reason || 'تعذر التسجيل');
    setTimeout(() => {
      if (!mountedRef.current) return;
      setFeedback('وجّه الوجه داخل الدائرة');
      if (qiRef.current + 1 >= queueLenRef.current) setPhase('summary');
      else setQi(i => i + 1);
    }, 1000);
  }, []);

  // إعادة تعيين حالة الوجه عند التبديل بين الطلاب
  useEffect(() => {
    setFaceInBoundary(false);
    setCanCapture(false);
    setFeedback('وجّه الوجه داخل الدائرة');
  }, [qi]);

  // ── حلقة كشف الوجه (بدون التقاط تلقائي) ──
  useEffect(() => {
    if (phase !== 'live' || !engineReady || !cameraReady || !currentStudent) return;

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
        const inside = (dx * dx + dy * dy) <= 1;

        setFaceInBoundary(inside);
        setCanCapture(inside);

        if (inside) {
          setFeedback('تم وضع الوجه ✓');
        } else {
          setFeedback('وجّه وجهك داخل الإطار البيضاوي');
        }
      } catch (e) {
        console.warn('[face-enroll] خطأ في حلقة الكشف:', e);
      } finally {
        busyRef.current = false;
      }
    }, 200);

    return () => clearInterval(iv);
  }, [phase, engineReady, cameraReady, currentStudent]);

  // ── التقاط يدوي عند الضغط على الزر ──
  const handleCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !mountedRef.current || busyRef.current || v.readyState < 2 || !currentStudent) return;
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

      if ((res.quality.composite ?? 0) < 0.45) {
        setFeedback(res.quality.brightness < 0.3 ? 'الإضاءة ضعيفة جداً' : 'ثبّت وجهك ونظر للكاميرا');
        return;
      }

      samplesDataRef.current.push(new Float32Array(res.descriptor));
      setSamples(samplesDataRef.current.length);
      setFeedback(`تم التقاط العينة ${samplesDataRef.current.length}/${SAMPLES_NEEDED}`);
      try { navigator.vibrate?.(30); } catch {}

      if (samplesDataRef.current.length >= SAMPLES_NEEDED) {
        const dim = samplesDataRef.current[0].length;
        const avg = new Float32Array(dim);
        for (const s of samplesDataRef.current) for (let i = 0; i < dim; i++) avg[i] += s[i];
        for (let i = 0; i < dim; i++) avg[i] /= samplesDataRef.current.length;
        const finalDesc = l2Normalize(avg);

        const tamper = checkForTampering(finalDesc, studentsRef.current, currentStudent.id);
        const quality = Math.round(((res.quality.composite + 0.8) / 2) * 100) / 100;

        if (tamper.tampered) {
          setFeedback(`هذا الوجه مطابق لبصمة ${tamper.matchedWith}`);
          setFlash('fail');
          setTimeout(() => { if (mountedRef.current) { setFlash(null); setFeedback('وجّه الوجه داخل الدائرة'); } }, 1200);
          samplesDataRef.current = [];
          setSamples(0);
          return;
        }

        onUpdateStudent(currentStudent.id, {
          faceDescriptor: descriptorToStorage(finalDesc, { samples: SAMPLES_NEEDED, quality }),
          faceRegisteredAt: new Date().toISOString(),
        });
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
        setFlash('ok');
        finishStudent(currentStudent.id, currentStudent.name, true);
      }
    } catch (e) {
      console.warn('[face-enroll] خطأ في التقاط البصمة:', e);
    } finally {
      busyRef.current = false;
    }
  }, [currentStudent, onUpdateStudent, finishStudent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const startEnrollment = () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    setQueue(ids);
    queueLenRef.current = ids.length;
    setResults([]);
    setSamples(0);
    samplesDataRef.current = [];
    setFaceInBoundary(false);
    setCanCapture(false);
    setQi(0);
    setPhase('live');
  };

  /** تخطي الطالب الحالي دون حفظ */
  const skipStudent = () => {
    if (!currentStudent) return;
    setResults(prev => [...prev, { studentId: currentStudent.id, name: currentStudent.name, ok: false, reason: 'تم التخطي' }]);
    samplesDataRef.current = [];
    setSamples(0);
    setFeedback('وجّه الوجه داخل الدائرة');
    if (qiRef.current + 1 >= queueLenRef.current) setPhase('summary');
    else setQi(i => i + 1);
  };

  const toggleStudent = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const okCount = results.filter(r => r.ok).length;

  return createPortal(
    <div dir="rtl" className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-3">
      {!engineReady && <EngineOverlay progress={progress} error={error} onRetry={retry} onCancel={onClose} />}

      <div className="bg-slate-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-lg max-h-[96vh] overflow-y-auto overscroll-contain">
        {/* رأس */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-5 py-4 border-b border-white/8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <path d="M9 10h.01M15 10h.01M9.5 14.5c.7.6 1.5.9 2.5.9s1.8-.3 2.5-.9" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-extrabold text-base leading-tight">تسجيل بصمة الوجه</h2>
            <p className="text-[11px] text-slate-400">
              {phase === 'select' && 'اختر طالباً أو أكثر — التقاط يدوي لكل طالب'}
              {phase === 'live' && total > 0 && `الطالب ${qi + 1} من ${total}`}
              {phase === 'summary' && `اكتمل: ${okCount} نجح · ${results.length - okCount} فشل`}
            </p>
          </div>
          <button onClick={onClose} aria-label="إغلاق"
            className="w-9 h-9 rounded-full bg-white/8 hover:bg-red-500/80 text-white flex items-center justify-center transition active:scale-90">
            ✕
          </button>
        </div>

        {/* خطوة الاختيار */}
        {phase === 'select' && (
          <div className="p-5">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الرمز..."
              className="w-full mb-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-slate-400">{selected.size} محدد</span>
              <button
                onClick={() => setSelected(selected.size === students.length ? new Set() : new Set(students.map(s => s.id)))}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300"
              >
                {selected.size === students.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
              </button>
            </div>
            <ul className="max-h-[46vh] overflow-y-auto space-y-1.5 mb-4 pl-1">
              {filtered.map(s => {
                const has = hasValidDescriptor(s.faceDescriptor);
                const isSel = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => toggleStudent(s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-right transition ${
                        isSel ? 'bg-indigo-500/15 border-indigo-400/50' : 'bg-white/4 border-white/8 hover:bg-white/8'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] shrink-0 ${
                        isSel ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-500'
                      }`}>{isSel ? '✓' : ''}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                        <span className="block text-[11px] text-slate-400">
                          كود {s.code}{has && ' · لديه بصمة (ستُستبدل)'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={startEnrollment}
              disabled={selected.size === 0}
              className="w-full bg-gradient-to-l from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold py-3 rounded-xl transition active:scale-[0.98]"
            >
              ابدأ الالتقاط ({selected.size})
            </button>
          </div>
        )}

        {/* خطوة الالتقاط */}
        {phase === 'live' && currentStudent && (
          <div className="p-5">
            <div className="rounded-2xl overflow-hidden relative bg-black mb-4" style={{ aspectRatio: '4 / 3' }}>
              <video ref={videoRef} playsInline muted autoPlay
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* دليل بيضاوي — يتغير لونه حسب وضع الوجه */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className={`w-[52%] h-[78%] rounded-[50%] border-3 border-dashed transition-all duration-300 ${
                    faceInBoundary
                      ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]'
                      : samples > 0
                      ? 'border-emerald-400/70'
                      : 'border-white/35'
                  }`}
                  style={{ borderWidth: 3 }}
                />
              </div>

              {/* وميض النجاح/الفشل */}
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
                  <p className="text-slate-400 text-xs mt-1">تأكد من منح إذن الكاميرا للموقع</p>
                  <button onClick={onClose} className="mt-3 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-lg transition">إغلاق</button>
                </div>
              )}
            </div>

            <p className="text-center text-white font-extrabold mb-1">{currentStudent.name}</p>
            <p className={`text-center text-sm font-bold mb-3 ${
              faceInBoundary ? 'text-emerald-400' :
              feedback.includes('✓') ? 'text-emerald-400' :
              feedback.startsWith('لا') || feedback.startsWith('اقترب') || feedback.startsWith('ابتد') || feedback.startsWith('الإضاءة') ? 'text-amber-400' : 'text-slate-300'
            }`}>
              {feedback}
            </p>

            {/* زر التقاط — يظهر فقط عندما يكون الوجه جاهزاً */}
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
                📸 التقاط العينة ({samples + 1}/{SAMPLES_NEEDED})
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

            <div className="flex gap-2">
              <button onClick={skipStudent} className="flex-1 py-2.5 rounded-xl bg-white/6 hover:bg-white/12 text-slate-300 text-sm font-bold transition">
                تخطي الطالب
              </button>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/6 hover:bg-white/12 text-slate-300 text-sm font-bold transition">
                إيقاف وإغلاق
              </button>
            </div>
          </div>
        )}

        {phase === 'live' && !currentStudent && (
          <div className="p-5 text-center">
            <p className="text-slate-300 font-bold text-sm mb-3">تعذر العثور على بيانات الطالب في قائمة الانتظار.</p>
            <div className="flex gap-2">
              <button onClick={() => setPhase('summary')} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-sm transition">عرض النتائج</button>
              <button onClick={onClose} className="flex-1 bg-white/6 hover:bg-white/12 text-slate-300 font-bold py-2.5 rounded-xl text-sm transition">إغلاق</button>
            </div>
          </div>
        )}

        {/* ملخص */}
        {phase === 'summary' && (
          <div className="p-5">
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">{okCount === results.length ? '🎉' : '📋'}</div>
              <p className="text-white font-extrabold">
                تم تسجيل {okCount} من {results.length} بصمة بنجاح
              </p>
            </div>
            <ul className="space-y-1.5 mb-5 max-h-[42vh] overflow-y-auto">
              {results.map(r => (
                <li key={r.studentId} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm ${
                  r.ok ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-red-500/10 border-red-500/25'
                }`}>
                  <span>{r.ok ? '✅' : '❌'}</span>
                  <span className="flex-1 font-bold text-white truncate">{r.name}</span>
                  {!r.ok && r.reason && <span className="text-[11px] text-red-300 text-left max-w-[55%]">{r.reason}</span>}
                </li>
              ))}
            </ul>
            <button onClick={onClose} className="w-full bg-gradient-to-l from-indigo-600 to-violet-600 text-white font-extrabold py-3 rounded-xl transition active:scale-[0.98]">
              تم
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
