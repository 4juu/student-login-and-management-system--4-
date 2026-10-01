import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { faceDetectorService, grabVideoFrame, type DetectedFace } from '../../services/faceAI/detector';
import { openCameraStream, waitVideoDimensionsStable } from '../../services/faceAI/camera';
import { faceEmbedder, type Box } from '../../services/faceAI/embedder';
import { FaceTracker, type TrackBox } from '../../services/faceAI/tracker';
import {
  hasValidDescriptor,
  MATCH_LOOSE,
  MIN_RECOG_CONFIDENCE,
  requiredConfirmFrames,
} from '../../services/faceAI/descriptors';
import { buildGallery, findBestMatchIndexed } from '../../services/faceAI/gallery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { MorphingSquare } from '../MorphingSquare';

interface FaceReportGateProps {
  students: Student[];
  onMatched: (student: Student) => void;
  onCancel: () => void;
}

type GatePhase = 'scanning' | 'found';

const MIN_FACE_PX = 22;
const MAX_FACES_PER_FRAME = 10;
const REEMBED_MIN_INTERVAL = 150;
const REEMBED_UNKNOWN_INTERVAL = 100;
const REEMBED_MOVE_THRESHOLD = 0.08;
const NO_MATCH_FRAMES = 12;
const FOUND_FLASH_MS = 3000;

/**
 * بوابة تقرير الحضور بالوجه — الكاميرا تنفتح مباشرة والتعرف على الطالب
 * يعرض التقرير فوراً (لمحة قصيرة بالاسم ثم الانتقال). بلا مسار بديل.
 */
export const FaceReportGate: React.FC<FaceReportGateProps> = ({ students, onMatched, onCancel }) => {
  const { ready: engineReady, retry } = useFaceAI();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopTimerRef = useRef(0);
  const rafRef = useRef(0);
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const lastTickRef = useRef(0);
  const lastSeenRef = useRef(0);
  const faceSeenRef = useRef(0);
  const trackerRef = useRef(new FaceTracker());
  const galleryRef = useRef<ReturnType<typeof buildGallery>>([]);
  const studentsRef = useRef<Student[]>(students);
  const foundRef = useRef(false);
  const onMatchedRef = useRef(onMatched);
  const flashTimerRef = useRef(0);

  const [phase, setPhase] = useState<GatePhase>('scanning');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [noMatchOverlay, setNoMatchOverlay] = useState(false);
  const [matchedStudent, setMatchedStudent] = useState<Student | null>(null);

  useBodyScrollLock(true);

  // طلاب مرخّصون ببصمة وجه — إن لم تكن لأحد بصمة نعرض رسالة بدل الكاميرا
  const registered = useMemo(() => students.filter(s => hasValidDescriptor(s.faceDescriptor)), [students]);
  const hasAnyBiometric = registered.length > 0;

  useEffect(() => {
    studentsRef.current = students;
    galleryRef.current = buildGallery(registered);
  }, [students, registered]);

  useEffect(() => { onMatchedRef.current = onMatched; }, [onMatched]);

  // ── فتح/إغلاق الكاميرا — تلقائي بمجرد جهوزية المحرك ──
  const needsCamera = engineReady && phase === 'scanning' && hasAnyBiometric;
  useEffect(() => {
    if (!needsCamera) return;
    let localStream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        setCameraError(false);
        localStream = await openCameraStream('user');
        if (cancelled) { localStream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = localStream;
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play().catch(() => {});
          await waitVideoDimensionsStable(videoRef.current);
          await new Promise(r => setTimeout(r, 300));
        }
        if (cancelled) return;
        setCameraReady(true);
      } catch (e) {
        console.warn('[face-report] فشل فتح الكاميرا:', e);
        if (!cancelled) setCameraError(true);
      }
    })();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach(t => t.stop());
      if (streamRef.current === localStream) streamRef.current = null;
      setCameraReady(false);
    };
  }, [needsCamera, cameraAttempt]);

  // ── تنظيف عند الخروج ──
  useEffect(() => {
    const tracker = trackerRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      tracker.reset();
    };
  }, []);

  const stopScan = useCallback(() => {
    runningRef.current = false;
    if (loopTimerRef.current) { clearTimeout(loopTimerRef.current); loopTimerRef.current = 0; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  // ── لحظة التعرف: إيقاف الكاميرا + لمحة بالاسم ثم فتح التقرير ──
  const handleMatched = useCallback((student: Student) => {
    if (foundRef.current) return;
    foundRef.current = true;
    stopScan();
    setMatchedStudent(student);
    setPhase('found');
    flashTimerRef.current = window.setTimeout(() => {
      onMatchedRef.current(student);
    }, FOUND_FLASH_MS);
  }, [stopScan]);

  // ── حلقة المسح (نفس النصيجة المجرّبة في FaceTestPage) ──
  useEffect(() => {
    if (phase !== 'scanning' || !engineReady || !cameraReady) return;
    runningRef.current = true;

    const drawBoxes = (
      faces: Array<{ box: Box; label?: string | undefined; color: string; sub?: string | undefined }>,
    ) => {
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;
      const cw = video.clientWidth, ch = video.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      const g = canvas.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, cw, ch);
      const vw = video.videoWidth, vh = video.videoHeight;
      const sxScale = cw / vw, syScale = ch / vh;
      const mirrored = true;

      for (const f of faces) {
        const bx = mirrored ? (vw - f.box.x - f.box.width) * sxScale : f.box.x * sxScale;
        const by = f.box.y * syScale;
        const bw = f.box.width * sxScale;
        const bh = f.box.height * syScale;
        const pad = Math.round(bw * 0.06);

        g.save();
        g.strokeStyle = f.color;
        g.lineWidth = 3.5;
        g.lineCap = 'round';
        const c = Math.min(bw, bh) * 0.22;
        const x1 = bx - pad, y1 = by - pad, x2 = bx + bw + pad, y2 = by + bh + pad;
        g.beginPath();
        g.moveTo(x1, y1 + c); g.quadraticCurveTo(x1, y1, x1 + c, y1);
        g.moveTo(x2 - c, y1); g.quadraticCurveTo(x2, y1, x2, y1 + c);
        g.moveTo(x2, y2 - c); g.quadraticCurveTo(x2, y2, x2 - c, y2);
        g.moveTo(x1 + c, y2); g.quadraticCurveTo(x1, y2, x1, y2 - c);
        g.stroke();
        g.globalAlpha = 0.25;
        g.lineWidth = 9;
        g.stroke();
        g.restore();

        if (f.label) {
          const text = f.sub ? `${f.label} · ${f.sub}` : f.label;
          g.font = 'bold 13px system-ui, sans-serif';
          const tw = g.measureText(text).width + 18;
          const ly = Math.max(4, y1 - 26);
          g.fillStyle = f.color;
          g.beginPath();
          g.roundRect(x1 + (bw + pad * 2 - tw) / 2, ly, tw, 21, 10);
          g.fill();
          g.fillStyle = '#fff';
          g.textAlign = 'center';
          g.fillText(text, x1 + (bw + pad * 2) / 2, ly + 14.5);
        }
      }
    };

    const tick = async () => {
      if (!runningRef.current || !mountedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) {
        rafRef.current = requestAnimationFrame(() => { loopTimerRef.current = window.setTimeout(tick, 50); });
        return;
      }

      const interval = performance.now() - lastSeenRef.current < 1500 ? 50 : 200;
      const nowTs = performance.now();
      if (nowTs - lastTickRef.current < interval) {
        rafRef.current = requestAnimationFrame(() => { loopTimerRef.current = window.setTimeout(tick, 10); });
        return;
      }
      lastTickRef.current = nowTs;
      busyRef.current = true;

      const liveBoxes: Array<{ box: Box; label?: string | undefined; color: string; sub?: string | undefined }> = [];

      try {
        const detections: DetectedFace[] = faceDetectorService.detect(video, nowTs);

        if (!faceDetectorService.ready) {
          retry();
          if (runningRef.current && mountedRef.current) {
            loopTimerRef.current = window.setTimeout(tick, 200);
          }
          return;
        }

        if (detections.length > 0) lastSeenRef.current = nowTs;

        const bigEnough = detections
          .filter(d => d.box.width >= MIN_FACE_PX && d.box.height >= MIN_FACE_PX)
          .slice(0, MAX_FACES_PER_FRAME);

        if (bigEnough.length === 0) {
          trackerRef.current.update([]);
          faceSeenRef.current = 0;
          setNoMatchOverlay(false);
          drawBoxes(liveBoxes);
        } else {
          const boxes: TrackBox[] = bigEnough.map(d => ({ ...d.box, keypoints: d.keypoints }));
          const tracked = trackerRef.current.update(boxes);
          const needEmbed = tracked.filter(t =>
            trackerRef.current.shouldReembed(t.trackId, nowTs, REEMBED_MIN_INTERVAL, REEMBED_MOVE_THRESHOLD, REEMBED_UNKNOWN_INTERVAL)
          );

          let sawConfident = false;

          if (needEmbed.length > 0) {
            const bmp = await grabVideoFrame(video, faceEmbedder.recommendedMaxWidth);
            if (!bmp) { drawBoxes(liveBoxes); return; }
            const scale = bmp.width / video.videoWidth;
            const results = await faceEmbedder.embedBatch(
              bmp,
              needEmbed.map(t => ({
                x: t.box.x * scale,
                y: t.box.y * scale,
                width: t.box.width * scale,
                height: t.box.height * scale,
                keypoints: t.box.keypoints?.map(kp => ({ x: kp.x * scale, y: kp.y * scale })),
              })),
            );
            bmp.close();
            if (!runningRef.current || !mountedRef.current) return;

            for (let i = 0; i < results.length; i++) {
              const res = results[i];
              const embTrack = needEmbed[i];
              if (!res || !embTrack) continue;
              const raw = new Float32Array(res.descriptor);
              const smoothed = trackerRef.current.addEmbedding(embTrack.trackId, raw, nowTs);
              const match = findBestMatchIndexed(
                trackerRef.current.getQueries(embTrack.trackId, smoothed),
                galleryRef.current, MATCH_LOOSE, res.quality.composite,
              );
              trackerRef.current.setCache(
                embTrack.trackId, match?.item.id ?? null, match?.confidence ?? 0,
                match?.distance ?? 1, match?.margin ?? 1,
              );

              const vbw = res.box.width / scale, vbh = res.box.height / scale;
              const vbx = res.box.x / scale, vby = res.box.y / scale;
              const boxInVideo: Box = { x: vbx, y: vby, width: vbw, height: vbh };

              if (!match || match.confidence < MIN_RECOG_CONFIDENCE) {
                const smallFace = res.box.width < MIN_FACE_PX * 1.7;
                liveBoxes.push({ box: boxInVideo, label: smallFace ? 'اقترب قليلاً' : 'غير معروف', color: '#fbbf24' });
                continue;
              }

              const student = studentsRef.current.find(s => s.id === match.item.id);
              if (!student) continue;
              sawConfident = true;

              const confirmCount = trackerRef.current.bumpConfirm(embTrack.trackId, student.id);
              const requiredFrames = requiredConfirmFrames(match.distance, match.margin);
              if (confirmCount < requiredFrames) {
                liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'جاري التحقق...', color: '#818cf8' });
                continue;
              }

              liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'تم التعرف', color: '#34d399' });
              drawBoxes(liveBoxes);
              handleMatched(student);
              return;
            }
          }

          // وجوه من الكاش — تُعامَل بنفس بوابة التأكيد
          for (const t of tracked) {
            if (needEmbed.some(n => n.trackId === t.trackId)) continue;
            if (!trackerRef.current.hasTrack(t.trackId)) continue;
            const cache = trackerRef.current.getCache(t.trackId);
            const boxInVideo: Box = { x: t.box.x, y: t.box.y, width: t.box.width, height: t.box.height };
            if (!cache || !cache.cachedMatchId) {
              liveBoxes.push({ box: boxInVideo, color: 'rgba(255,255,255,0.3)' });
              continue;
            }

            const student = studentsRef.current.find(s => s.id === cache.cachedMatchId);
            if (student && cache.cachedConfidence >= MIN_RECOG_CONFIDENCE) {
              sawConfident = true;
              const confirmCount = trackerRef.current.bumpConfirm(t.trackId, student.id);
              const requiredFrames = requiredConfirmFrames(cache.cachedDistance, cache.cachedMargin);
              if (confirmCount >= requiredFrames) {
                liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'تم التعرف', color: '#34d399' });
                drawBoxes(liveBoxes);
                handleMatched(student);
                return;
              }
              liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'جاري التحقق...', color: '#818cf8' });
            } else {
              liveBoxes.push({ box: boxInVideo, label: 'غير معروف', color: '#fbbf24' });
            }
          }

          if (!sawConfident) {
            faceSeenRef.current += 1;
            if (faceSeenRef.current >= NO_MATCH_FRAMES) setNoMatchOverlay(true);
          }

          drawBoxes(liveBoxes);
        }
      } catch (e) {
        console.warn('[face-report] خطأ في دورة المسح:', e);
      } finally {
        busyRef.current = false;
        if (runningRef.current && mountedRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            loopTimerRef.current = window.setTimeout(tick, 16);
          });
        }
      }
    };

    tick();
    return () => {
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, engineReady, cameraReady, retry, handleMatched]);

  const statusPill = !engineReady || !cameraReady
    ? { icon: '⏳', text: 'جاري التحضير...', cls: 'bg-white/10 text-slate-300' }
    : { icon: '✨', text: 'أبقِ وجهك داخل الإطار', cls: 'bg-indigo-500/90 text-white' };

  // ── المرحلة بلا أي بصمة مسجّلة في المرحلة ──
  if (!hasAnyBiometric) {
    return (
      <div dir="rtl" className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0B1220] p-4 animate-fadeIn">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15">
            <svg className="h-8 w-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-extrabold text-white mb-2">لم تُسجَّل بصمات وجه لهذه المرحلة</h2>
          <p className="text-sm text-slate-400 mb-6">راجع إدارة الكلية لتسجيل بصمة الوجه لعرض تقرير الحضور.</p>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg active:scale-95 transition"
          >
            العودة للرئيسية
          </button>
        </div>
      </div>
    );
  }

  if (!engineReady) {
    return (
      <div dir="rtl" className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0B1220] p-4">
        <div className="text-center">
          <MorphingSquare size="md" className="mx-auto mb-3" />
          <p className="text-slate-300 text-sm font-bold">جاري تحضير محرك التعرف...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="مسح الوجه لعرض تقرير الحضور"
      className="fixed inset-0 z-[9999] flex flex-col bg-slate-950/95 backdrop-blur-sm animate-fadeIn"
      onTouchMove={(e) => { e.preventDefault(); }}
      style={{ touchAction: 'none' }}
    >
      {/* زر العودة */}
      <div className="absolute left-3 z-30 flex items-center gap-2 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top, 12px) + 12px)' }}>
        <button
          type="button"
          onClick={() => { stopScan(); onCancel(); }}
          aria-label="العودة"
          className="pointer-events-auto w-11 h-11 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition active:scale-90 shadow-lg"
        >
          ✕
        </button>
      </div>

      {/* منطقة الكاميرا */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="معاينة الكاميرا"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas ref={canvasRef} aria-label="تحديد الوجه" className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* دليل الإطار */}
        {cameraReady && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className="rounded-[38%] border-2 border-dashed border-white/25 animate-pulse-slow transition-all duration-500"
              style={{ width: 'min(58%, 340px)', height: 'min(62%, 420px)' }}
            />
          </div>
        )}

        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="text-center">
              <MorphingSquare size="md" className="mx-auto mb-3" />
              <p className="text-slate-300 text-sm font-bold">جاري فتح الكاميرا...</p>
            </div>
          </div>
        )}

        {/* شريط الحالة */}
        <div className="absolute inset-x-0 flex justify-center pointer-events-none px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-extrabold backdrop-blur-md transition-all duration-300 ${statusPill.cls}`}>
            <span>{statusPill.icon}</span>
            <span>{statusPill.text}</span>
          </div>
        </div>

        {/* فشل الكاميرا */}
        {cameraError && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 backdrop-blur-sm p-6">
            <div className="text-center max-w-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/15">
                <svg className="h-8 w-8 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 1l-6 6m-6-6l6 6m-6-6v6M1 23l6-6m6 6l-6-6m6 6v-6" />
                </svg>
              </div>
              <h2 className="text-lg font-extrabold text-white mb-2">تعذّر فتح الكاميرا</h2>
              <p className="text-sm text-slate-400 mb-5">اسمح للتطبيق باستخدام الكاميرا من إعدادات المتصفح ثم أعد المحاولة.</p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setCameraAttempt(a => a + 1)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg active:scale-95 transition"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={() => { stopScan(); onCancel(); }}
                  className="w-full py-3 rounded-xl bg-white/10 text-white font-bold text-sm active:scale-95 transition"
                >
                  العودة
                </button>
              </div>
            </div>
          </div>
        )}

        {/* لا مطابقة */}
        {noMatchOverlay && !cameraError && phase === 'scanning' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 backdrop-blur-sm p-6">
            <div className="text-center max-w-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15">
                <svg className="h-8 w-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-extrabold text-amber-300 mb-2">لم يتم التعرف على وجهك</h2>
              <p className="text-sm text-slate-400 mb-5">تأكد من الإضاءة الجيدة ووجّه وجهك داخل الإطار. إن لم تكن بصمتك مسجّلة لدى الإدارة فلن يظهر تقريرك.</p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNoMatchOverlay(false);
                    faceSeenRef.current = 0;
                    trackerRef.current.reset();
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg active:scale-95 transition"
                >
                  محاولة مرة أخرى
                </button>
                <button
                  type="button"
                  onClick={() => { stopScan(); onCancel(); }}
                  className="w-full py-3 rounded-xl bg-white/10 text-white font-bold text-sm active:scale-95 transition"
                >
                  العودة
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* لمحة التعرف ثم فتح التقرير */}
      {phase === 'found' && matchedStudent && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="text-center px-6 max-w-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
              <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-2">أهلاً {matchedStudent.name}</h2>
            <p className="text-sm text-slate-400">جارٍ فتح تقرير الحضور والغياب...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FaceReportGate;
