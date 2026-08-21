import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Student, AttendanceSession } from '../../types/student';
import { useFaceAI } from '../../hooks/useFaceAI';
import { EngineOverlay } from './EngineOverlay';
import {
  faceDetectorService,
  grabVideoFrame,
  type DetectedFace,
} from '../../services/faceAI/detector';
import { openCameraStream, waitVideoDimensionsStable } from '../../services/faceAI/camera';
import { faceEmbedder, type Box } from '../../services/faceAI/embedder';
import {
  findBestMatch,
  hasValidDescriptor,
  MATCH_LOOSE,
} from '../../services/faceAI/descriptors';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface FaceScannerProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ScanStatus = 'idle' | 'scanning' | 'unknown' | 'marked' | 'already';

interface LogEntry {
  key: string;
  id: string;
  name: string;
  code?: string;
  group?: string;
  status: 'marked' | 'already' | 'unknown';
  confidence: number;
  time: string;
}

const RECOGNITION_COOLDOWN = 30_000;
const MIN_FACE_PX = 56;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

const AVATAR_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-violet-500'];

export const FaceScanner: React.FC<FaceScannerProps> = ({
  students,
  onMarkAttendance,
  alreadyPresentIds,
  onClose,
}) => {
  const { ready: engineReady, progress, error, retry } = useFaceAI();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopTimerRef = useRef<number>(0);
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const lastTickRef = useRef(0);
  const lastSeenRef = useRef(0);
  const staleCountRef = useRef(0);
  const engineWasBrokenRef = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [groupMode, setGroupMode] = useState(false);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [kiosk, setKiosk] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasHwZoom, setHasHwZoom] = useState(false);

  // عزل النافذة عن تمرير الصفحة الخلفية
  useBodyScrollLock(true);

  const roster = useMemo(() => students.filter(s => hasValidDescriptor(s.faceDescriptor)), [students]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const presentRef = useRef(alreadyPresentIds);
  presentRef.current = alreadyPresentIds;
  const markRef = useRef(onMarkAttendance);
  markRef.current = onMarkAttendance;

  const cooldowns = useRef(new Map<string, number>());
  const hwZoomRange = useRef<{ min: number; max: number; step: number } | null>(null);
  const loggedIdsRef = useRef(new Set<string>());

  // ── تطبيق التقريب العتادي إن كان مدعوماً ──
  const digitalZoom = hasHwZoom ? 1 : zoom;

  useEffect(() => {
    if (!cameraReady || !hasHwZoom) return;
    const range = hwZoomRange.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !range) return;
    const target = range.min + ((range.max - range.min) * (zoom - 1)) / (MAX_ZOOM - 1);
    track.applyConstraints({
      advanced: [{ zoom: Math.min(range.max, Math.max(range.min, target)) } as unknown as MediaTrackConstraintSet],
    }).catch(() => {});
  }, [zoom, hasHwZoom, cameraReady, facing]);

  // ── صوت النجاح + اهتزاز ──
  const celebrate = useCallback(() => {
    try { navigator.vibrate?.([40, 30, 60]); } catch {}
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      [{ f: 523, t: 0 }, { f: 784, t: 0.09 }, { f: 1047, t: 0.18 }].forEach(({ f, t }) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime + t);
        g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.22);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
      });
      setTimeout(() => { ctx.close().catch(() => {}); }, 600);
    } catch {}
  }, []);

  // ── فتح/إغلاق الكاميرا ──
  useEffect(() => {
    if (!engineReady) return;
    let localStream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        localStream = await openCameraStream(facing);
        if (cancelled) { localStream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = localStream;

        // فحص دعم التقريب العتادي في الكاميرا الحالية (أمامية/خلفية)
        try {
          const track = localStream.getVideoTracks()[0];
          const caps = typeof track?.getCapabilities === 'function'
            ? (track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } })
            : null;
          if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
            hwZoomRange.current = caps.zoom;
            if (!cancelled) setHasHwZoom(true);
          } else {
            hwZoomRange.current = null;
            if (!cancelled) setHasHwZoom(false);
          }
        } catch {
          hwZoomRange.current = null;
          if (!cancelled) setHasHwZoom(false);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play().catch(() => {});
          // إخفاء مرحلة تفاوض الدقة حتى تستقر الأبعاد — يمنع قفزة التكبير الأولى
          await waitVideoDimensionsStable(videoRef.current);
        }
        if (cancelled) return;
        setZoom(1);
        setCameraReady(true);
      } catch (e) {
        console.error('[face-scanner] فشل فتح الكاميرا:', e);
      }
    })();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach(t => t.stop());
      if (streamRef.current === localStream) streamRef.current = null;
      setCameraReady(false);
    };
  }, [engineReady, facing]);

  // ── إضافة سجل للقائمة ──
  const pushLog = useCallback((entry: Omit<LogEntry, 'key' | 'time'>) => {
    setLogs(prev => [{
      ...entry,
      key: `${entry.id}_${Date.now()}`,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    }, ...prev].slice(0, 40));
  }, []);

  // ── حلقة المسح ──
  useEffect(() => {
    if (!engineReady || !cameraReady) return;
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

      // محاكاة التقريب رقمياً على طبقة الرسم لتطابق ما يراه المستخدم
      g.save();
      if (digitalZoom > 1) {
        g.translate(cw / 2, ch / 2);
        g.scale(digitalZoom, digitalZoom);
        g.translate(-cw / 2, -ch / 2);
      }

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
        // أقواس الزوايا الأربعة
        const c = Math.min(bw, bh) * 0.22;
        const x1 = bx - pad, y1 = by - pad, x2 = bx + bw + pad, y2 = by + bh + pad;
        g.beginPath();
        g.moveTo(x1, y1 + c); g.quadraticCurveTo(x1, y1, x1 + c, y1);
        g.moveTo(x2 - c, y1); g.quadraticCurveTo(x2, y1, x2, y1 + c);
        g.moveTo(x2, y2 - c); g.quadraticCurveTo(x2, y2, x2 - c, y2);
        g.moveTo(x1 + c, y2); g.quadraticCurveTo(x1, y2, x1, y2 - c);
        g.stroke();
        // توهج خفيف
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
      g.restore();
    };

    const tick = async () => {
      if (!runningRef.current || !mountedRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) {
        loopTimerRef.current = window.setTimeout(tick, 100);
        return;
      }

      const interval = performance.now() - lastSeenRef.current < 1500 ? 200 : 400;
      const nowTs = performance.now();
      if (nowTs - lastTickRef.current < interval) {
        loopTimerRef.current = window.setTimeout(tick, 20);
        return;
      }
      lastTickRef.current = nowTs;
      busyRef.current = true;

      let liveBoxes: Array<{ box: Box; label?: string; color: string; sub?: string }> = [];

      try {
        // ١) كشف سريع عبر MediaPipe (موديل جوجل)
        const detections: DetectedFace[] = faceDetectorService.detect(video, nowTs);

        // ═══ استعادة تلقائية: إذا المحرك تعطّل أثناء التشغيل ═══
        if (!faceDetectorService.ready) {
          engineWasBrokenRef.current = true;
          staleCountRef.current = 0;
          retry();
          if (runningRef.current && mountedRef.current) {
            loopTimerRef.current = window.setTimeout(tick, 200);
          }
          return;
        }

        if (detections.length > 0) {
          lastSeenRef.current = nowTs;
          staleCountRef.current = 0;
        } else {
          staleCountRef.current++;
        }

        // ═══ استعادة تلقائية: كشف فارغ طويل despite الكاميرا جاهزة ═══
        if (staleCountRef.current > 40 && cameraReady) {
          console.warn('[face-scanner] كشف فارغ متواصل — إعادة تهيئة المحرك');
          staleCountRef.current = 0;
          engineWasBrokenRef.current = true;
          retry();
          if (runningRef.current && mountedRef.current) {
            loopTimerRef.current = window.setTimeout(tick, 200);
          }
          return;
        }

        // وضع فردي: الوجه الأكبر فقط — جماعي: كل الوجوه
        const targets = groupMode ? detections : detections.slice(0, 1);
        const bigEnough = targets.filter(d => d.box.width >= MIN_FACE_PX && d.box.height >= MIN_FACE_PX);

        if (bigEnough.length === 0) {
          setStatus('idle');
          drawBoxes(liveBoxes);
        } else {
          // ٢) استخراج البصمات داخل العامل
          const bmp = await grabVideoFrame(video, 640);
          if (!bmp) { drawBoxes(liveBoxes); return; }
          const scale = bmp.width / video.videoWidth;
          const results = await faceEmbedder.embedBatch(
            bmp,
            bigEnough.map(d => ({
              x: d.box.x * scale,
              y: d.box.y * scale,
              width: d.box.width * scale,
              height: d.box.height * scale,
            })),
          );
          if (!runningRef.current || !mountedRef.current) return;

          const now = Date.now();
          let anyUnknown = false;
          let markedAny = false;

          for (const res of results) {
            const vbw = res.box.width / scale, vbh = res.box.height / scale;
            const vbx = res.box.x / scale, vby = res.box.y / scale;
            const boxInVideo: Box = { x: vbx, y: vby, width: vbw, height: vbh };

            const match = findBestMatch(new Float32Array(res.descriptor), rosterRef.current, MATCH_LOOSE);

            if (!match || match.confidence < 70) {
              anyUnknown = true;
              liveBoxes.push({ box: boxInVideo, label: 'غير معروف', color: '#fbbf24' });
              continue;
            }

            const student = match.item;
            const alreadyMarked = presentRef.current.has(student.id);
            const lastHit = cooldowns.current.get(student.id) ?? 0;

            if (alreadyMarked || now - lastHit < RECOGNITION_COOLDOWN) {
              liveBoxes.push({
                box: boxInVideo,
                label: student.name.split(' ')[0],
                sub: alreadyMarked ? 'مسجل ✓' : undefined,
                color: '#34d399',
              });
              // سجل واحد فقط لكل طالب طوال الجلسة — لا تكرار
              if (alreadyMarked && !loggedIdsRef.current.has(student.id)) {
                loggedIdsRef.current.add(student.id);
                pushLog({ id: student.id, name: student.name, code: student.code, group: student.group, status: 'already', confidence: match.confidence });
              }
              continue;
            }

            cooldowns.current.set(student.id, now);
            markedAny = true;
            liveBoxes.push({ box: boxInVideo, label: student.name.split(' ')[0], sub: 'حاضر ✓', color: '#34d399' });
            if (!loggedIdsRef.current.has(student.id)) {
              loggedIdsRef.current.add(student.id);
              pushLog({ id: student.id, name: student.name, code: student.code, group: student.group, status: 'marked', confidence: match.confidence });
            }

            Promise.resolve(markRef.current(student)).catch(e => console.error('[face-scanner] فشل تسجيل الحضور:', e));
          }

          if (markedAny) {
            setStatus('marked');
            celebrate();
            setTimeout(() => { if (mountedRef.current) setStatus('scanning'); }, 1600);
          } else if (anyUnknown) {
            setStatus('unknown');
          } else {
            setStatus('scanning');
          }
          drawBoxes(liveBoxes);
        }
      } catch (e) {
        console.warn('[face-scanner] خطأ في دورة المسح:', e);
      } finally {
        busyRef.current = false;
        if (runningRef.current && mountedRef.current) {
          loopTimerRef.current = window.setTimeout(tick, 50);
        }
      }
    };

    tick();
    return () => {
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, cameraReady, groupMode, digitalZoom, celebrate, pushLog]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // إعادة تعيين عدّاد الفراغ عند جاهزية المحرك بعد إعادة تهيئة
  useEffect(() => {
    if (engineReady) {
      staleCountRef.current = 0;
      engineWasBrokenRef.current = false;
    }
  }, [engineReady]);

  const statusPill = (() => {
    if (!engineReady || !cameraReady) return { icon: '⏳', text: 'جاري التحضير...', cls: 'bg-white/10 text-slate-300' };
    if (engineWasBrokenRef.current) return { icon: '🔄', text: 'جاري إعادة تهيئة المحرك...', cls: 'bg-amber-500/90 text-white' };
    switch (status) {
      case 'marked': return { icon: '🎉', text: 'تم تسجيل الحضور!', cls: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/40' };
      case 'unknown': return { icon: '❓', text: 'وجه غير مسجل', cls: 'bg-amber-500/90 text-amber-950' };
      case 'scanning': return { icon: '✨', text: 'أبقِ وجهك داخل الإطار', cls: 'bg-indigo-500/90 text-white' };
      default: return roster.length === 0
        ? { icon: '📭', text: 'لا يوجد طلاب ببصمة مسجلة', cls: 'bg-red-500/80 text-white' }
        : { icon: '👁️', text: 'في انتظار وجه...', cls: 'bg-white/10 text-slate-300' };
    }
  })();

  const markedCount = useMemo(
    () => new Set(logs.filter(l => l.status === 'marked').map(l => l.id)).size,
    [logs],
  );

  return createPortal(
    <div dir="rtl" className={`fixed inset-0 z-[9999] flex flex-col ${kiosk ? 'bg-black' : 'bg-slate-950/95 backdrop-blur-sm'}`}>
      {!engineReady && <EngineOverlay progress={progress} error={error} onRetry={retry} onCancel={onClose} />}

      {/* الشريط العلوي */}
      <header className={`shrink-0 flex items-center gap-2 px-3 sm:px-5 py-3 ${kiosk ? 'bg-black' : 'bg-slate-900/80 border-b border-white/8'}`}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
            <ScanGlyph />
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-extrabold text-sm leading-tight truncate">الحضور ببصمة الوجه</h1>
            <p className="text-[11px] text-slate-400">
              {roster.length > 0 ? `${roster.length} طالب مؤهل` : 'لا يوجد طلاب ببصمة'} · حاضر الآن: {markedCount}
            </p>
          </div>
        </div>
        <button
          onClick={() => setGroupMode(m => !m)}
          className={`px-3 py-1.5 rounded-full text-xs font-bold transition active:scale-95 ${
            groupMode ? 'bg-emerald-500 text-white' : 'bg-white/8 text-slate-300 hover:bg-white/15'
          }`}
          title="الوضع الفردي يطابق أكبر وجه فقط، والجماعي يطابق كل الوجوه في الكادر"
        >
          {groupMode ? '👥 جماعي' : '👤 فردي'}
        </button>
        <button
          onClick={() => setFacing(f => (f === 'user' ? 'environment' : 'user'))}
          aria-label="تبديل الكاميرا"
          className="w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 text-white flex items-center justify-center transition active:scale-90"
        >
          🔄
        </button>
        <button
          onClick={() => setKiosk(k => !k)}
          aria-label="وضع العرض"
          className="hidden sm:flex w-9 h-9 rounded-full bg-white/8 hover:bg-white/15 text-white items-center justify-center transition active:scale-90"
        >
          {kiosk ? '🗗' : '⛶'}
        </button>
        <button
          onClick={onClose}
          aria-label="إغلاق"
          className="w-9 h-9 rounded-full bg-white/8 hover:bg-red-500/80 text-white flex items-center justify-center transition active:scale-90"
        >
          ✕
        </button>
      </header>

      {/* منطقة الكاميرا */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
          style={{ transform: `${facing === 'user' ? 'scaleX(-1) ' : ''}scale(${digitalZoom})` }}
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* دليل الإطار */}
        {engineReady && cameraReady && status !== 'marked' && (
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

        {/* أزرار التقريب — تعمل مع الكاميرا الأمامية والخلفية */}
        {engineReady && cameraReady && (
          <div className="absolute bottom-4 left-3 flex items-center gap-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 p-1 shadow-lg pointer-events-auto">
            <button
              onClick={() => setZoom(z => Math.max(1, Math.round((z - ZOOM_STEP) * 100) / 100))}
              disabled={zoom <= 1}
              aria-label="تصغير"
              className="w-8 h-8 rounded-full text-white text-lg font-bold leading-none disabled:opacity-30 hover:bg-white/10 active:scale-90 flex items-center justify-center transition"
            >−</button>
            <span className="text-white text-[11px] font-extrabold w-10 text-center tabular-nums">
              {zoom.toFixed(2).replace(/\.?0+$/, '')}×{hasHwZoom ? '' : ''}
            </span>
            <button
              onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100))}
              disabled={zoom >= MAX_ZOOM}
              aria-label="تكبير"
              className="w-8 h-8 rounded-full text-white text-lg font-bold leading-none disabled:opacity-30 hover:bg-white/10 active:scale-90 flex items-center justify-center transition"
            >+</button>
          </div>
        )}

        {/* شريط الحالة */}
        <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none px-4">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-extrabold backdrop-blur-md transition-all duration-300 ${statusPill.cls}`}>
            <span>{statusPill.icon}</span>
            <span>{statusPill.text}</span>
          </div>
        </div>

        {roster.length === 0 && engineReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-auto">
            <div className="text-center px-6">
              <div className="text-5xl mb-3">📭</div>
              <p className="text-white font-extrabold">لا يوجد طلاب ببصمة وجه</p>
              <p className="text-slate-400 text-sm mt-1">سجّل بصمات الطلاب من صفحة إدارة الطلاب أولاً</p>
              <button onClick={onClose} className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition active:scale-95">
                حسناً
              </button>
            </div>
          </div>
        )}
      </div>

      {/* قائمة السجل */}
      {!kiosk && (
        <aside className="shrink-0 h-36 sm:h-44 bg-slate-900/85 border-t border-white/8 overflow-y-auto overscroll-contain">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-1">
              <span className="text-2xl opacity-50">📋</span>
              <p className="text-xs font-bold">سجل الحضور سيظهر هنا مباشرة</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {logs.map(log => (
                <li key={log.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-9 h-9 rounded-full ${AVATAR_COLORS[log.name.length % AVATAR_COLORS.length]} flex items-center justify-center text-white text-xs font-extrabold shrink-0`}>
                    {log.name.trim().charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{log.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {log.group && <span>كروب {log.group} · </span>}ثقة {log.confidence}%
                    </p>
                  </div>
                  <div className="text-left shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      log.status === 'marked' ? 'bg-emerald-500/15 text-emerald-300'
                        : log.status === 'already' ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-slate-500/15 text-slate-400'
                    }`}>
                      {log.status === 'marked' ? '✔ حاضر' : log.status === 'already' ? '↺ مسبقاً' : '؟'}
                    </span>
                    <p className="text-[10px] text-slate-500 mt-0.5">{log.time}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      <style>{`
        @keyframes pulseSlow { 0%,100% { opacity:.35 } 50% { opacity:.75 } }
        .animate-pulse-slow { animation: pulseSlow 2.4s ease-in-out infinite; }
      `}</style>
    </div>,
    document.body
  );
};

function ScanGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M8 12h8" />
    </svg>
  );
}
