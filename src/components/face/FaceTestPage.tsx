import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Student } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from './EngineOverlay';
import {
  faceDetectorService,
  grabVideoFrame,
  type DetectedFace,
} from '../../services/faceAI/detector';
import { openCameraStream, waitVideoDimensionsStable } from '../../services/faceAI/camera';
import { faceEmbedder, type Box } from '../../services/faceAI/embedder';
import { FaceTracker, type TrackBox } from '../../services/faceAI/tracker';
import {
  hasValidDescriptor,
  isGalleryDescriptor,
  updateGallery,
  MATCH_LOOSE,
  MIN_RECOG_CONFIDENCE,
  CONFIRM_FRAMES,
} from '../../services/faceAI/descriptors';
import { buildGallery, findBestMatchIndexed } from '../../services/faceAI/gallery';
import { estimatePose, poseToBin } from '../../services/faceAI/pose';
import { getTestLink, validateTestLink, formatRemainingMs, getServerNow } from '../../services/tokenService';
import { loadStageStudentsWithOverrides } from '../SelfRegister/SelfEnrollPage';
import { updateStudentDescriptorOverride } from '../../firebase/dataService';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface FaceTestPageProps {
  testToken: string;
  onExit: () => void;
}

type TestPhase = 'loading' | 'invalid' | 'ready' | 'scanning' | 'enhancing' | 'success';

const MIN_FACE_PX = 22;
const MAX_FACES_PER_FRAME = 10;
const REEMBED_MIN_INTERVAL = 150;
const REEMBED_MOVE_THRESHOLD = 0.08;

const ENHANCE_DURATION_MS = 10_000;

export const FaceTestPage: React.FC<FaceTestPageProps> = ({
  testToken,
  onExit,
}) => {
  const { ready: engineReady, progress, error: engineError, retry } = useFaceAI();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopTimerRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const lastTickRef = useRef(0);
  const lastSeenRef = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [phase, setPhase] = useState<TestPhase>('loading');
  const [matchedStudent, setMatchedStudent] = useState<Student | null>(null);
  const [noMatchOverlay, setNoMatchOverlay] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [enhanceCountdown, setEnhanceCountdown] = useState<number>(10);

  useBodyScrollLock(phase === 'scanning' || phase === 'enhancing');

  const studentsRef = useRef<Student[]>([]);
  const galleryRef = useRef<ReturnType<typeof buildGallery>>([]);
  const trackerRef = useRef(new FaceTracker());
  const faceSeenRef = useRef(0);

  // ── refs للتحسين التلقائي ──
  const enhancingRef = useRef(false);
  const enhanceStartRef = useRef(0);
  const enhancedCountRef = useRef(0);
  const savedDescriptorRef = useRef<any>(null);
  const linkDataRef = useRef<{ adminUid: string; stageId: string } | null>(null);

  // ── تحميل بيانات الرابط وطلاب المرحلة ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const link = await getTestLink(testToken);
        if (cancelled) return;
        if (!link || !validateTestLink(link).valid) {
          setPhase('invalid');
          return;
        }
        setExpiresAt(link.expiresAt);
        setRemainingMs(link.expiresAt - getServerNow());
        linkDataRef.current = { adminUid: link.adminUid, stageId: link.stageId };
        const s = await loadStageStudentsWithOverrides(link.adminUid, link.stageId);
        if (cancelled) return;
        studentsRef.current = s;
        const approved = s.filter(st => hasValidDescriptor(st.faceDescriptor));
        galleryRef.current = buildGallery(approved);
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [testToken]);

  // ── إنفاذ انتهاء صلاحية الرابط فعلياً (فحص دوري) ──
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = expiresAt - getServerNow();
      if (left <= 0) {
        runningRef.current = false;
        setRemainingMs(0);
        setPhase('invalid');
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const id = window.setInterval(tick, 20000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  // ── فتح/إغلاق الكاميرا ──
  useEffect(() => {
    if ((phase !== 'scanning' && phase !== 'enhancing') || !engineReady) return;
    let localStream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        localStream = await openCameraStream(facing);
        if (cancelled) { localStream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = localStream;
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play().catch(() => {});
          await waitVideoDimensionsStable(videoRef.current);
          // انتظار إضافي لاستقرار الكاميرا полностью (منع الزوم القفز)
          await new Promise(r => setTimeout(r, 400));
        }
        if (cancelled) return;
        setCameraReady(true);
      } catch (e) {
        console.error('[face-test] فشل فتح الكاميرا:', e);
      }
    })();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach(t => t.stop());
      if (streamRef.current === localStream) streamRef.current = null;
      setCameraReady(false);
    };
  }, [phase, engineReady, facing]);

  // ── تنظيف عند الخروج ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      trackerRef.current.reset();
    };
  }, []);

  // ── إيقاف المسح ──
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

  // ── بدء المسح ──
  const startScan = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    trackerRef.current.reset();
    faceSeenRef.current = 0;
    setNoMatchOverlay(false);
    setPhase('scanning');
  }, []);

  // ── حلقة المسح ──
  useEffect(() => {
    if ((phase !== 'scanning' && phase !== 'enhancing') || !engineReady || !cameraReady) return;
    runningRef.current = true;

    const drawBoxes = (
      faces: Array<{ box: Box; label?: string; color: string; sub?: string }>,
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
      const mirrored = facing === 'user';

      for (const f of faces) {
        const bx = mirrored ? (vw - f.box.x - f.box.width) * sxScale : f.box.x * sxScale;
        const by = f.box.y * syScale;
        const bw = f.box.width * sxScale;
        const bh = f.box.height * sxScale;
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

      let liveBoxes: Array<{ box: Box; label?: string; color: string; sub?: string }> = [];

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
            trackerRef.current.shouldReembed(t.trackId, nowTs, REEMBED_MIN_INTERVAL, REEMBED_MOVE_THRESHOLD)
          );

            if (needEmbed.length > 0) {
            const currentMaxWidth = faceEmbedder.recommendedMaxWidth;
            const bmp = await grabVideoFrame(video, currentMaxWidth);
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

            let anyMatched = false;

            for (let i = 0; i < results.length; i++) {
              const res = results[i];
              const trackId = needEmbed[i].trackId;
              const raw = new Float32Array(res.descriptor);
              const smoothed = trackerRef.current.addEmbedding(trackId, raw, nowTs);

              const match = findBestMatchIndexed(smoothed, galleryRef.current, MATCH_LOOSE, res.quality.composite);
              trackerRef.current.setCache(trackId, match?.item.id ?? null, match?.confidence ?? 0);

              const vbw = res.box.width / scale, vbh = res.box.height / scale;
              const vbx = res.box.x / scale, vby = res.box.y / scale;
              const boxInVideo: Box = { x: vbx, y: vby, width: vbw, height: vbh };

              // ── وضع التحسين: حفظ العناقيد للمطابق ──
              if (enhancingRef.current && matchedStudent && match && match.item.id === matchedStudent.id) {
                try {
                  const origDet = detections.find(d =>
                    Math.abs(d.box.x - needEmbed[i].box.x) < 1 &&
                    Math.abs(d.box.y - needEmbed[i].box.y) < 1
                  );
                  const pose = estimatePose(origDet?.keypoints);
                  if (pose && savedDescriptorRef.current && isGalleryDescriptor(savedDescriptorRef.current)) {
                    const bin = poseToBin(pose);
                    const result = updateGallery(savedDescriptorRef.current, smoothed, res.quality.composite, bin);
                    if (result.action === 'merged' || result.action === 'created') {
                      savedDescriptorRef.current = result.gallery;
                      enhancedCountRef.current += 1;
                    }
                  }
                } catch { /* تجاهل */ }

                liveBoxes.push({ box: boxInVideo, label: matchedStudent.name.split(' ')[0], sub: 'تحسين البصمة', color: '#34d399' });
                continue;
              }

              if (!match || match.confidence < MIN_RECOG_CONFIDENCE) {
                const smallFace = res.box.width < MIN_FACE_PX * 1.7;
                liveBoxes.push({ box: boxInVideo, label: smallFace ? 'اقترب قليلاً' : 'غير معروف', color: '#fbbf24' });
                continue;
              }

              const student = studentsRef.current.find(s => s.id === match.item.id);
              if (!student) continue;

              anyMatched = true;

              const confirmCount = trackerRef.current.bumpConfirm(trackId, student.id);

              if (confirmCount < CONFIRM_FRAMES) {
                liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'جاري التحقق...', color: '#818cf8' });
                continue;
              }

              // ✅ تأكيد كامل — البدء بتحسين البصمة
              setMatchedStudent(student);
              enhancedCountRef.current = 0;
              savedDescriptorRef.current = student.faceDescriptor;
              enhancingRef.current = true;
              enhanceStartRef.current = performance.now();
              setEnhanceCountdown(10);
              setPhase('enhancing');
              trackerRef.current.removeTrack(trackId);
              liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'تم التعرف', color: '#34d399' });
              drawBoxes(liveBoxes);
              return;
            }

            if (!anyMatched && bigEnough.length > 0) {
              faceSeenRef.current += 1;
              if (faceSeenRef.current >= 8) {
                setNoMatchOverlay(true);
              }
            }
          }

          // الوجوه من الكاش
          for (const t of tracked) {
            if (needEmbed.some(n => n.trackId === t.trackId)) continue;
            if (!trackerRef.current.hasTrack(t.trackId)) continue;
            const cache = trackerRef.current.getCache(t.trackId);
            if (!cache || !cache.cachedMatchId) {
              liveBoxes.push({ box: t.box, color: 'rgba(255,255,255,0.3)' });
              continue;
            }

            const boxInVideo: Box = { x: t.box.x, y: t.box.y, width: t.box.width, height: t.box.height };
            const student = studentsRef.current.find(s => s.id === cache.cachedMatchId);

            if (student && cache.cachedConfidence >= MIN_RECOG_CONFIDENCE) {
              const confirmCount = trackerRef.current.bumpConfirm(t.trackId, student.id);

              if (confirmCount >= CONFIRM_FRAMES) {
                setMatchedStudent(student);
                enhancedCountRef.current = 0;
                savedDescriptorRef.current = student.faceDescriptor;
                enhancingRef.current = true;
                enhanceStartRef.current = performance.now();
                setEnhanceCountdown(10);
                setPhase('enhancing');
                trackerRef.current.removeTrack(t.trackId);
                liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'تم التعرف', color: '#34d399' });
                drawBoxes(liveBoxes);
                return;
              } else {
                liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'جاري التحقق...', color: '#818cf8' });
              }
            } else {
              liveBoxes.push({ box: boxInVideo, label: 'غير معروف', color: '#fbbf24' });
            }
          }

          drawBoxes(liveBoxes);
        }
      } catch (e) {
        console.warn('[face-test] خطأ في دورة المسح:', e);
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
  }, [phase, engineReady, cameraReady, facing, retry, stopScan]);

  // ── عداد تحسين البصمة (10 ثواني) ──
  useEffect(() => {
    if (phase !== 'enhancing') return;
    const start = performance.now();
    let raf: number;
    const tick = () => {
      const elapsed = performance.now() - start;
      const left = Math.max(0, Math.ceil((ENHANCE_DURATION_MS - elapsed) / 1000));
      setEnhanceCountdown(left);
      if (left > 0 && mountedRef.current) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // ── إنهاء التحسين وحفظ البصمة ──
  useEffect(() => {
    if (phase !== 'enhancing') return;
    const timer = window.setTimeout(async () => {
      enhancingRef.current = false;
      runningRef.current = false;
      if (loopTimerRef.current) { clearTimeout(loopTimerRef.current); loopTimerRef.current = 0; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }

      // حفظ البصمة في descriptorOverrides — يُحفظ دائماً عند وجود طالب مطابق
      console.log(`[face-test] محاولة الحفظ — matchedStudent=${!!matchedStudent}, descriptor=${!!savedDescriptorRef.current}, linkData=${!!linkDataRef.current}`);
      if (matchedStudent && savedDescriptorRef.current && linkDataRef.current) {
        try {
          // تحديث الكاش المحلي
          const students = studentsRef.current;
          const idx = students.findIndex(s => s.id === matchedStudent.id);
          if (idx >= 0) {
            students[idx] = { ...students[idx], faceDescriptor: savedDescriptorRef.current };
            studentsRef.current = students;
            galleryRef.current = buildGallery(students.filter(s => hasValidDescriptor(s.faceDescriptor)));
          }
          // حفظ في Firebase عبر descriptorOverrides (لا يتطلب تسجيل دخول)
          console.log(`[face-test] حفظ بصمة الطالب: ${matchedStudent.id} — ${matchedStudent.name}`);
          await updateStudentDescriptorOverride(
            linkDataRef.current.adminUid,
            linkDataRef.current.stageId,
            matchedStudent.id,
            savedDescriptorRef.current,
          );
        } catch (e) {
          console.error('[face-test] ❌ فشل حفظ البصمة:', e);
        }
      } else {
        console.warn('[face-test] تم تخطي الحفظ — 조건不符:', { matchedStudent: !!matchedStudent, descriptor: !!savedDescriptorRef.current, linkData: !!linkDataRef.current });
      }

      if (mountedRef.current) setPhase('success');
    }, ENHANCE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase, matchedStudent]);

  const statusPill = (() => {
    if (phase === 'enhancing') {
      return { icon: '⏳', text: 'يرجى الانتظار', cls: 'bg-emerald-500/90 text-white' };
    }
    if (!engineReady || !cameraReady) return { icon: '⏳', text: 'جاري التحضير...', cls: 'bg-white/10 text-slate-300' };
    return { icon: '✨', text: 'أبقِ وجهك داخل الإطار', cls: 'bg-indigo-500/90 text-white' };
  })();

  // ── شاشات ما قبل المسح (loading / invalid / no-face / ready) ──
  const preScanUI = (() => {
    if (phase === 'loading') {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm" dir="rtl">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-[3px] border-indigo-500 border-t-transparent" />
            <p className="text-slate-300 text-sm font-bold">جاري التحقق من الرابط...</p>
          </div>
        </div>
      );
    }

    if (phase === 'invalid') {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm" dir="rtl">
          <div className="text-center px-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <svg className="h-8 w-8 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">الرابط غير صالح</h2>
            <p className="text-sm text-slate-400 mb-4">الرابط منتهي أو غير موجود. احصل على رابط جديد من الإدارة.</p>
            <button onClick={onExit} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition active:scale-95">
              العودة
            </button>
          </div>
        </div>
      );
    }

    if (phase === 'ready') {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 backdrop-blur-sm" dir="rtl">
          <div className="text-center px-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_8px_20px_rgba(99,102,241,0.3)]">
              <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
                <circle cx="12" cy="10" r="3" />
                <path d="M12 13c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2">اختبار بصمة الوجه</h2>
            <p className="text-sm text-slate-400 mb-1">هذه صفحة لاختبار بصمة وجهك</p>
            {remainingMs > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-300 mb-3">
                <svg className="h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                صلاحية الرابط متبقية: {formatRemainingMs(remainingMs)}
              </div>
            )}
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-5">
              <p className="text-xs text-slate-300 leading-6">
                <svg className="inline h-3.5 w-3.5 ml-1 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                لكي يعمل الاختبار، يجب أن تكون بصمتك <strong className="text-amber-300">محفوظة في النظام وموافق عليها</strong> من قبل الإدارة.
                إذا لم تسجل بصمتك بعد، استخدم رابط التسجيل أولاً.
              </p>
            </div>
            <button
              onClick={startScan}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm shadow-lg hover:shadow-xl transition active:scale-95"
            >
              {engineReady ? 'ابدأ الاختبار' : 'جاري تحميل المحرك...'}
            </button>
          </div>
        </div>
      );
    }

    return null;
  })();

  // ── شاشة النجاح ──
  const successOverlay = phase === 'success' && matchedStudent ? (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto">
      <div className="text-center px-6 max-w-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
          <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <h2 className="text-xl font-extrabold text-emerald-300 mb-2">البصمة تعمل!</h2>
        <p className="text-sm text-slate-300 mb-1">تم التعرف على وجهك بنجاح</p>
        <p className="text-base font-bold text-white mb-4">{matchedStudent.name}</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              setMatchedStudent(null);
              setNoMatchOverlay(false);
              enhancedCountRef.current = 0;
              savedDescriptorRef.current = null;
              faceSeenRef.current = 0;
              setPhase('ready');
              trackerRef.current.reset();
            }}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm shadow-lg active:scale-95 transition"
          >
            اختبار مرة ثانية
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return createPortal(
    <>
      {preScanUI}
      {successOverlay}

      {(phase === 'scanning' || phase === 'enhancing') && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[9999] flex flex-col bg-slate-950/95 backdrop-blur-sm"
          onTouchMove={(e) => { e.preventDefault(); }}
          style={{ touchAction: 'none' }}
        >
          {!engineReady && <EngineOverlay progress={progress} error={engineError} onRetry={retry} onCancel={() => { stopScan(); onExit(); }} />}

          {/* أزرار عائمة */}
          {engineReady && (
            <div className="absolute left-3 z-30 flex items-center gap-2 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top, 12px) + 12px)' }}>
              <button
                onClick={() => { stopScan(); setPhase('ready'); }}
                aria-label="إغلاق"
                className="pointer-events-auto w-11 h-11 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition active:scale-90 shadow-lg"
              >
                ✕
              </button>
              <button
                onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}
                aria-label="تبديل الكاميرا"
                className="pointer-events-auto w-11 h-11 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white flex items-center justify-center transition active:scale-90 shadow-lg"
              >
                🔄
              </button>
            </div>
          )}

          {/* منطقة الكاميرا */}
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
              style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            {/* دليل الإطار */}
            {engineReady && cameraReady && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div
                  className="rounded-[38%] border-2 border-dashed border-white/25 animate-pulse-slow transition-all duration-500"
                  style={{ width: 'min(58%, 340px)', height: 'min(62%, 420px)' }}
                />
              </div>
            )}

            {!cameraReady && engineReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <div className="text-center">
                  <div className="inline-block w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
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

            {/* overlay: لا توجد بصمة */}
            {noMatchOverlay && !matchedStudent && (
<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto">
                <div className="text-center px-6 max-w-sm">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15">
                    <svg className="h-8 w-8 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                  </div>
                  <h2 className="text-lg font-bold text-amber-300 mb-2">لم يتم التعرف على بصمتك</h2>
                  <p className="text-sm text-slate-400 mb-4">
                    يرجى تسجيل البصمة من خلال رابط تسجيل بصمة الوجه المرسل من قبل الإدارة.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => {
                        stopScan();
                        setNoMatchOverlay(false);
                        setMatchedStudent(null);
                        faceSeenRef.current = 0;
                        trackerRef.current.reset();
                        setPhase('ready');
                      }}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-[#1458E2] to-[#2B7BFF] text-white font-bold text-sm shadow-lg active:scale-95 transition"
                    >
                      موافق
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* شريط علوي رفيع: التعرف ناجح — جاري تحسين البصمة (الكاميرا تبقى مرئية وشغالة طوال الوقت) */}
            {phase === 'enhancing' && matchedStudent && (
              <div className="absolute top-0 right-0 left-0 z-[9999] pointer-events-none" dir="rtl">
                <div className="mx-3 mt-3 overflow-hidden rounded-2xl bg-gradient-to-l from-emerald-600 to-emerald-500 shadow-xl shadow-emerald-900/30 ring-1 ring-white/20">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/30 bg-white/20">
                      <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                    {enhanceCountdown > 0 ? (
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-extrabold text-white leading-tight">أهلاً {matchedStudent.name.split(' ')[0]}</h2>
                        <p className="mt-0.5 text-xs font-medium text-emerald-50/90">تم التعرف على بصمتك — جارٍ تحسينها... {enhanceCountdown} ثوانٍ</p>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-white leading-tight">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-emerald-600">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                          </span>
                          تم التعرف
                        </h2>
                        <p className="mt-0.5 text-xs font-medium text-emerald-50/90">تم التعرف على بصمتك وشكراً لك ✓</p>
                      </div>
                    )}
                    <div className="shrink-0 text-2xl font-extrabold text-white tabular-nums leading-none">{enhanceCountdown}</div>
                  </div>
                  <div className="h-1.5 w-full bg-black/20">
                    <div
                      className="h-full bg-white/90 transition-all duration-1000 ease-linear"
                      style={{ width: `${((10 - enhanceCountdown) / 10) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <style>{`
            @keyframes pulseSlow { 0%,100% { opacity:.35 } 50% { opacity:.75 } }
            .animate-pulse-slow { animation: pulseSlow 2.4s ease-in-out infinite; }
          `}</style>
        </div>
      )}
    </>,
    document.body
  );
};
