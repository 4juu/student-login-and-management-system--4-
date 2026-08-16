import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Student, AttendanceSession } from '../types/student';
import { User } from '../types/user';
import { suspendAurora, resumeAurora } from '../lib/auraControl';
import { useCameraReady } from '../hooks/useCameraReady';
import { createPortal } from 'react-dom';

// 🚀 نافذة تسجيل الوجه تُحمَّل عند فتحها فقط (مكتبة الوجوه ثقيلة)
const LazyFaceRegistration = lazy(() =>
  import('./FaceRegistration').then(m => ({ default: m.FaceRegistration }))
);
import {
  extractAllFaceDescriptors, normalizeDescriptor,
  areModelsLoaded, isDetectorReady, detectAllFacesOnly,
  IOUTracker, shouldAutoImprove, autoImproveDescriptor,
  buildDescriptorCache, findBestMatchBatchFromCache, getDescriptorCache, getCacheThreshold,
  clearDescriptorCache, compareFaces,
} from '../services/faceRecognition';

interface FaceAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  currentUser?: User | null;
  onClose: () => void;
}

type FaceMode = 'loading' | 'active' | 'info' | 'marked' | 'already_marked';

interface LogEntry {
  id: string;
  name: string;
  code: string;
  group?: string;
  status: 'marked' | 'already' | 'pending';
  confidence: number;
  time: string;
}

interface DetectedFaceBox {
  box: { x: number; y: number; width: number; height: number };
  studentId?: string;
  name?: string;
  status: 'recognized' | 'already' | 'unknown' | 'marked';
  confidence: number;
}

type CameraFacing = 'user' | 'environment';

const RECOGNITION_COOLDOWN = 10000;
const MIN_CONFIDENCE = 40;
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3];

export const FaceAttendance: React.FC<FaceAttendanceProps> = ({
  students, onMarkAttendance, onUpdateStudent,
  alreadyPresentIds, onClose,
}) => {
  const [mode, setMode] = useState<FaceMode>('loading');
  const [error, setError] = useState('');
  const [showReg, setShowReg] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [warmup, setWarmup] = useState(0);
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set(alreadyPresentIds));
  const [kiosk, setKiosk] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { videoReady, handleVideoReady, resetVideoReady, armForceReady } = useCameraReady(videoRef);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kioskRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const trackerRef = useRef<IOUTracker | null>(null);
  const mountedRef = useRef(true);
  const rafRef = useRef<number>(0);
  const lastRecognitionRef = useRef<Map<string, number>>(new Map());
  const recognizedIdsRef = useRef<Set<string>>(new Set(alreadyPresentIds));
  const alreadyPresentRef = useRef<Set<string>>(alreadyPresentIds);
  const logsRef = useRef<LogEntry[]>([]);
  const faceRunningRef = useRef(false);
  const faceLoopStartedRef = useRef(false);
  const lastFrameTime = useRef(0);
  const frameCount = useRef(0);
  // ⚡ أداء/حرارة: منع تداخل الاستدلالات + ضبط تردد الكشف
  const processingRef = useRef(false);
  const lastProcessedRef = useRef(0);
  const currentIntervalRef = useRef(250);
  const lastFaceTimeRef = useRef(0);
  const hiddenRef = useRef(false);
  const facingRef = useRef<CameraFacing>('user');

  const studentsWithFace = useMemo(() =>
    students.filter(s => s.faceDescriptor && (
      Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 : true
    )), [students]);

  const roster = useMemo(() => {
    const list = [...studentsWithFace];
    list.sort((a, b) => {
      const ap = presentIds.has(a.id) ? 1 : 0;
      const bp = presentIds.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return a.name.localeCompare(b.name, 'ar');
    });
    return list;
  }, [studentsWithFace, presentIds]);

  const avatarColors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-rose-500', 'bg-amber-500', 'bg-teal-500', 'bg-indigo-500', 'bg-pink-500'];
  const avatarColor = (s: Student) => avatarColors[s.name.length % avatarColors.length];

  const addLog = (entry: LogEntry) => {
    logsRef.current = [entry, ...logsRef.current].slice(0, 50);
    setLogs(logsRef.current);
  };

  const markPresent = (id: string) => {
    setPresentIds(prev => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    suspendAurora();
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevScroll = document.documentElement.style.overscrollBehavior;
    const prevBodyScroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'contain';
    document.body.style.overscrollBehavior = 'contain';
    setTimeout(() => {
      if (studentsWithFace.length > 0) {
        buildDescriptorCache(studentsWithFace as any, 0.5);
      }
    }, 0);
    initCamera();
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      setWarmup(areModelsLoaded() ? 2 : isDetectorReady() ? 1 : 0);
      if (isDetectorReady() && !faceLoopStartedRef.current) startFaceLoop();
    }, 200);
    setTimeout(() => clearInterval(interval), 60000);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehavior = prevScroll;
      document.body.style.overscrollBehavior = prevBodyScroll;
      cleanup();
      clearDescriptorCache();
      resumeAurora();
    };
  }, []);

  // 🛑 منع تمرير الخلفية عند وضع الكشك — حجب حركات اللمس داخل الطبقة
  useEffect(() => {
    if (!kiosk) return;
    const el = kioskRef.current;
    if (!el) return;
    const preventTouch = (e: TouchEvent) => {
      if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
    };
    el.addEventListener('touchmove', preventTouch, { passive: false });
    return () => el.removeEventListener('touchmove', preventTouch);
  }, [kiosk]);

  // 🛑 منع انزلاق الخلفية عند حدود تمرير قائمة الطلاب (iOS) مع السماح بالتمرير الداخلي
  useEffect(() => {
    if (kiosk) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    let startY = 0;
    let startScroll = 0;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startScroll = el.scrollTop;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.target as Element;
      if (t.closest('button, a, input, select, textarea')) return;
      const dy = startY - e.touches[0].clientY;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if ((startScroll <= 0 && dy < 0) || (startScroll >= maxScroll && dy > 0)) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [kiosk]);

  // ⚡ إيقاف الحلقة والكاميرا عند إخفاء التبويب (توفير حرارة/بطارية)
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        hiddenRef.current = true;
        if (faceRunningRef.current) stopFaceLoop();
        if (trackRef.current && torchOn) {
          try { trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] }); } catch {}
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        trackRef.current = null;
        setCameraReady(false);
      } else {
        hiddenRef.current = false;
        if (mountedRef.current) initCamera();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kioskEnteredRef = useRef(false);

  // ⛶ وضع الكشك — ملء شاشة فعلي مع مزامنة الخروج التلقائي
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) {
        kioskEnteredRef.current = true;
      } else if (kioskEnteredRef.current) {
        kioskEnteredRef.current = false;
        setKiosk(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleKiosk = useCallback(async () => {
    if (kiosk) {
      setKiosk(false);
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {}
      return;
    }
    // 🎬 ندخل وضع الكشك فوراً كطبقة كاملة الشاشة (يعمل حتى على iOS بدون Fullscreen API)
    setKiosk(true);
    // ثم نحاول ملء الشاشة الحقيقي إن كان مدعوماً
    try {
      const el = kioskRef.current;
      if (el && typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen();
      }
    } catch {}
  }, [kiosk]);

  const recentMarked = useMemo(() => logs.filter(l => l.status === 'marked').slice(0, 5), [logs]);

  // 📹 عند إعادة تركيب عنصر الفيديو (تبديل الوضع العادي/الكشك) نعيد ربط البث مباشرة
  const attachStream = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (studentsWithFace.length > 0) {
      buildDescriptorCache(studentsWithFace as any, 0.5);
    } else {
      clearDescriptorCache();
    }
  }, [studentsWithFace]);

  // 🛑 مزامنة alreadyPresentRef + دمج المعرفات الجديدة لتفادي Closure قديم
  useEffect(() => {
    alreadyPresentRef.current = alreadyPresentIds;
    alreadyPresentIds.forEach(id => recognizedIdsRef.current.add(id));
    setPresentIds(prev => {
      let changed = false;
      const n = new Set(prev);
      alreadyPresentIds.forEach(id => { if (!n.has(id)) { n.add(id); changed = true; } });
      return changed ? n : prev;
    });
  }, [alreadyPresentIds]);

  const cleanup = () => {
    faceRunningRef.current = false;
    faceLoopStartedRef.current = false;
    if (rafRef.current) window.clearTimeout(rafRef.current);
    rafRef.current = 0;
    if (trackRef.current && torchOn) {
      try { trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] }); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const initCamera = async () => {
    if (!mountedRef.current) return;
    setCameraReady(false);
    resetVideoReady();
    try {
      await cleanup();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingRef.current, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 24 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      const caps = (track.getCapabilities?.() || {}) as any;
      setHasTorch(!!caps.torch);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        armForceReady();
        await videoRef.current.play();
        setCameraReady(true);
        setMode('active');
        if (isDetectorReady()) startFaceLoop();
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (e.name === 'NotAllowedError') setError('الرجاء السماح باستخدام الكاميرا');
      else if (e.name === 'NotFoundError') setError('لا توجد كاميرا');
      else setError('فشل فتح الكاميرا');
    }
  };

  const toggleCamera = async () => {
      const newFacing: CameraFacing = facing === 'user' ? 'environment' : 'user';
      stopFaceLoop();
      facingRef.current = newFacing;
      resetVideoReady();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      trackRef.current = null;
      setFacing(newFacing);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const caps = (track.getCapabilities?.() || {}) as any;
      setHasTorch(!!caps.torch);
      setTorchOn(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        armForceReady();
        await videoRef.current.play();
        setCameraReady(true);
        setMode('active');
        startFaceLoop();
      }
    } catch {}
  };

  const applyZoom = async (val: number) => {
    if (!trackRef.current) return;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ zoom: val } as any] });
      setZoom(val);
    } catch {}
  };

  const toggleTorch = async () => {
    if (!trackRef.current || !hasTorch) return;
    const n = !torchOn;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ torch: n } as any] });
      setTorchOn(n);
    } catch {}
  };

  const calculateIoU = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 < x1 || y2 < y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / (a.width * a.height + b.width * b.height - inter);
  };

  const stopFaceLoop = useCallback(() => {
    faceRunningRef.current = false;
    faceLoopStartedRef.current = false;
    if (rafRef.current) window.clearTimeout(rafRef.current);
    rafRef.current = 0;
    if (trackerRef.current) trackerRef.current.reset();
  }, []);

  const playSuccess = () => {
    navigator.vibrate?.([50, 30, 50]);
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      [{ f: 523, s: 0, d: 0.1 }, { f: 659, s: 0.1, d: 0.1 }, { f: 784, s: 0.2, d: 0.2 }].forEach(({ f, s, d }) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, ctx.currentTime + s);
        g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + s + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + s + d);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + s); o.stop(ctx.currentTime + s + d + 0.05);
      });
      setTimeout(() => ctx.close(), 700);
    } catch {}
  };

  const startFaceLoop = useCallback(() => {
    if (faceLoopStartedRef.current) return;
    faceLoopStartedRef.current = true;
    if (!faceRunningRef.current) faceRunningRef.current = true;
    if (!trackerRef.current) trackerRef.current = new IOUTracker();
    lastFrameTime.current = performance.now();
    frameCount.current = 0;

    const detectedFaces = new Map<string, DetectedFaceBox>();
    const trackDescriptors = new Map<number, Float32Array[]>();

    const processFrame = async () => {
      if (!faceRunningRef.current || !mountedRef.current || hiddenRef.current) return;

      // ⚡ منع تداخل الاستدلالات — استدلال واحد بالوقت
      if (processingRef.current) {
        rafRef.current = window.setTimeout(processFrame, 60);
        return;
      }

      const nowMs = performance.now();
      const elapsed = nowMs - lastProcessedRef.current;
      if (elapsed < currentIntervalRef.current) {
        rafRef.current = window.setTimeout(processFrame, Math.max(1, currentIntervalRef.current - elapsed));
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.paused || video.ended) {
        rafRef.current = window.setTimeout(processFrame, 100);
        return;
      }

      processingRef.current = true;
      lastProcessedRef.current = performance.now();
      frameCount.current++;

      const cache = getDescriptorCache();
      const hasCache = cache && cache.length > 0;
      const recognitionReady = areModelsLoaded();

      let detections: any[] = [];
      try {
        if (recognitionReady) {
          // المرحلة 1: بحث رخيص عن الوجه بدقة منخفضة
          const facesOnly = await detectAllFacesOnly(video, 320, 160);
          if (!faceRunningRef.current || !mountedRef.current) return;
          if (facesOnly.length > 0) {
            // المرحلة 2: فقط عند وجود وجوه — استخراج البصمات الكاملة
            detections = await extractAllFaceDescriptors(video, 320, 160);
          }
        } else if (isDetectorReady()) {
          detections = await detectAllFacesOnly(video, 320, 160);
        } else {
          if (faceRunningRef.current && mountedRef.current) {
            rafRef.current = window.setTimeout(processFrame, 300);
          }
          return;
        }

        if (!faceRunningRef.current || !mountedRef.current) return;

        const now = Date.now();
        const tracked = recognitionReady ? (trackerRef.current?.update(
          detections.map((d: any) => ({ box: d.detection.box, descriptor: d.descriptor }))
        ) || []) : [];

        if (detections.length === 0) {
          frameCount.current = Math.min(frameCount.current + 1, 100);
        } else {
          frameCount.current = 0;
        }

        if (recognitionReady && detections.length > 0 && hasCache) {
          const descriptors = detections.map((d: any) => normalizeDescriptor(d.descriptor));
          const matches = await findBestMatchBatchFromCache(descriptors, 0.5);

          if (!faceRunningRef.current || !mountedRef.current) return;

          for (let fi = 0; fi < detections.length; fi++) {
            const det = detections[fi];
            const box = det.detection.box;
            const qScore = det.detection.score;
            if (qScore < 0.65 || box.width < 30 || box.height < 30) continue;

            const boxKey = `${Math.round(box.x / 40)}_${Math.round(box.y / 40)}`;

            const match = matches[fi];
            if (match) {
              const bestStudent = studentsWithFace.find(s => s.id === match.id);
              if (!bestStudent) {
                detectedFaces.set(boxKey, { box, status: 'unknown', confidence: 0 });
                continue;
              }

              const threshold = getCacheThreshold();
              const confidence = Math.round((1 - match.distance / threshold) * 100);
              // 🛑 رفض المطابقة إذا كانت الثقة منخفضة — يمنع الـ False Positives
              if (confidence < MIN_CONFIDENCE) {
                detectedFaces.set(boxKey, { box, status: 'unknown', confidence: 0 });
                continue;
              }
              const lastTime = lastRecognitionRef.current.get(bestStudent.id) || 0;
              const isDuplicate = now - lastTime < RECOGNITION_COOLDOWN;
              const isAlreadyMarked = recognizedIdsRef.current.has(bestStudent.id) || alreadyPresentRef.current.has(bestStudent.id);

              if (isAlreadyMarked || isDuplicate) {
                if (!logsRef.current.some(l => l.id === bestStudent.id)) {
                  addLog({
                    id: bestStudent.id, name: bestStudent.name, code: bestStudent.code,
                    group: bestStudent.group, status: 'already', confidence,
                    time: new Date().toLocaleTimeString('ar-EG'),
                  });
                }
                detectedFaces.set(boxKey, {
                  box, studentId: bestStudent.id, name: bestStudent.name,
                  status: 'already', confidence,
                });
                setMode('already_marked');
                setTimeout(() => { if (mountedRef.current) setMode('active'); }, 1200);
              } else {
                lastRecognitionRef.current.set(bestStudent.id, now);
                recognizedIdsRef.current.add(bestStudent.id);

                setMode('info');
                detectedFaces.set(boxKey, {
                  box, studentId: bestStudent.id, name: bestStudent.name,
                  status: 'recognized', confidence,
                });

                setTimeout(async () => {
                  if (!mountedRef.current) return;
                  setMode('marked');
                  try { await onMarkAttendance(bestStudent!); } catch {}
                  markPresent(bestStudent!.id);
                  playSuccess();
                  if (!logsRef.current.some(l => l.id === bestStudent!.id)) {
                    addLog({
                      id: bestStudent!.id, name: bestStudent!.name, code: bestStudent!.code,
                      group: bestStudent!.group, status: 'marked', confidence,
                      time: new Date().toLocaleTimeString('ar-EG'),
                    });
                  }
                  detectedFaces.set(boxKey, {
                    box, studentId: bestStudent!.id, name: bestStudent!.name,
                    status: 'marked', confidence,
                  });

                  if (onUpdateStudent && bestStudent!.faceDescriptor && shouldAutoImprove(bestStudent!.faceDescriptor as any)) {
                    const improved = autoImproveDescriptor(bestStudent!.faceDescriptor as any, det.descriptor, 'center', confidence / 100);
                    if (improved) onUpdateStudent(bestStudent!.id, { faceDescriptor: improved as any });
                  }

                  setTimeout(() => {
                    if (mountedRef.current) { detectedFaces.delete(boxKey); setMode('active'); }
                  }, 3000);
                }, 400);
              }
            } else {
              detectedFaces.set(boxKey, { box, status: 'unknown', confidence: 0 });
            }
          }
        } else if (recognitionReady && detections.length > 0 && !hasCache && studentsWithFace.length > 0) {
          for (const det of detections) {
            const box = det.detection.box;
            const qScore = det.detection.score;
            if (qScore < 0.65 || box.width < 30 || box.height < 30) continue;
            const track = tracked.find((t: any) => calculateIoU(t.box, box) > 0.3);
            let matchDesc = normalizeDescriptor(new Float32Array(det.descriptor));

            if (track) {
              const descs = trackDescriptors.get(track.id) || [];
              descs.push(det.descriptor);
              if (descs.length > 3) descs.shift();
              trackDescriptors.set(track.id, descs);
              if (descs.length >= 2) {
                const avg = new Float32Array(128);
                for (const d of descs) for (let i = 0; i < 128; i++) avg[i] += d[i];
                for (let i = 0; i < 128; i++) avg[i] /= descs.length;
                matchDesc = normalizeDescriptor(avg);
              }
            }

            const adaptiveThreshold = qScore < 0.85 ? 0.42 : qScore < 0.92 ? 0.46 : 0.50;
            let bestStudent: Student | null = null;
            let bestDist = Infinity;
            let bestConfidence = 0;

            for (const s of studentsWithFace) {
              if (!s.faceDescriptor) continue;
              const dist = compareFaces(matchDesc, s.faceDescriptor as any);
              if (dist < bestDist && dist < adaptiveThreshold) {
                bestDist = dist;
                bestStudent = s;
                bestConfidence = Math.round((1 - dist / adaptiveThreshold) * 100);
                if (bestConfidence >= 95) break;
              }
            }

            const boxKey = `${Math.round(box.x / 40)}_${Math.round(box.y / 40)}`;

            if (bestStudent) {
              // 🛑 رفض المطابقة إذا كانت الثقة منخفضة — يمنع الـ False Positives
              if (bestConfidence < MIN_CONFIDENCE) {
                detectedFaces.set(boxKey, { box, status: 'unknown', confidence: 0 });
                continue;
              }
              const lastTime = lastRecognitionRef.current.get(bestStudent.id) || 0;
              const isDuplicate = now - lastTime < RECOGNITION_COOLDOWN;
              const isAlreadyMarked = recognizedIdsRef.current.has(bestStudent.id) || alreadyPresentRef.current.has(bestStudent.id);

              if (isAlreadyMarked || isDuplicate) {
                if (!logsRef.current.some(l => l.id === bestStudent.id)) {
                  addLog({
                    id: bestStudent.id, name: bestStudent.name, code: bestStudent.code,
                    group: bestStudent.group, status: 'already', confidence: bestConfidence,
                    time: new Date().toLocaleTimeString('ar-EG'),
                  });
                }
                detectedFaces.set(boxKey, {
                  box, studentId: bestStudent.id, name: bestStudent.name,
                  status: 'already', confidence: bestConfidence,
                });
                setMode('already_marked');
                setTimeout(() => { if (mountedRef.current) setMode('active'); }, 1200);
              } else {
                lastRecognitionRef.current.set(bestStudent.id, now);
                recognizedIdsRef.current.add(bestStudent.id);
                setMode('info');
                detectedFaces.set(boxKey, {
                  box, studentId: bestStudent.id, name: bestStudent.name,
                  status: 'recognized', confidence: bestConfidence,
                });

                setTimeout(async () => {
                  if (!mountedRef.current) return;
                  setMode('marked');
                  try { await onMarkAttendance(bestStudent!); } catch {}
                  markPresent(bestStudent!.id);
                  playSuccess();
                  if (!logsRef.current.some(l => l.id === bestStudent!.id)) {
                    addLog({
                      id: bestStudent!.id, name: bestStudent!.name, code: bestStudent!.code,
                      group: bestStudent!.group, status: 'marked', confidence: bestConfidence,
                      time: new Date().toLocaleTimeString('ar-EG'),
                    });
                  }
                  detectedFaces.set(boxKey, {
                    box, studentId: bestStudent!.id, name: bestStudent!.name,
                    status: 'marked', confidence: bestConfidence,
                  });
                  if (onUpdateStudent && bestStudent!.faceDescriptor && shouldAutoImprove(bestStudent!.faceDescriptor as any)) {
                    const improved = autoImproveDescriptor(bestStudent!.faceDescriptor as any, det.descriptor, 'center', bestConfidence / 100);
                    if (improved) onUpdateStudent(bestStudent!.id, { faceDescriptor: improved as any });
                  }
                  setTimeout(() => {
                    if (mountedRef.current) { detectedFaces.delete(boxKey); setMode('active'); }
                  }, 3000);
                }, 400);
              }
            } else {
              detectedFaces.set(boxKey, { box, status: 'unknown', confidence: 0 });
            }
          }
        }

        for (const key of detectedFaces.keys()) {
          const face = detectedFaces.get(key)!;
          const stillExists = detections.some((d: any) => calculateIoU(d.detection.box, face.box) > 0.1);
          if (!stillExists && face.status !== 'marked') {
            detectedFaces.delete(key);
          }
        }

        drawBoxes(video, canvas, detectedFaces, facing, recognitionReady);
      } catch {}
      finally {
        processingRef.current = false;
      }

      // ⚡ تردد تكيفي: تسريع عند وجود وجوه، إبطاء عند الخلو الطويل
      if (detections.length > 0) {
        currentIntervalRef.current = 120;
        lastFaceTimeRef.current = performance.now();
      } else if (performance.now() - lastFaceTimeRef.current > 4000) {
        currentIntervalRef.current = 500;
      } else {
        currentIntervalRef.current = 250;
      }

      if (faceRunningRef.current && mountedRef.current && !hiddenRef.current) {
        rafRef.current = window.setTimeout(processFrame, currentIntervalRef.current);
      }
    };

    lastProcessedRef.current = 0;
    currentIntervalRef.current = 250;
    lastFaceTimeRef.current = performance.now();
    rafRef.current = window.setTimeout(processFrame, 0);
    return () => { if (rafRef.current) window.clearTimeout(rafRef.current); };
  }, [studentsWithFace, alreadyPresentIds, onMarkAttendance, onUpdateStudent]);

  const drawBoxes = (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    faces: Map<string, DetectedFaceBox>,
    camFacing: string,
    recognitionReady: boolean
  ) => {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(canvas.width - rect.width) > 1 || Math.abs(canvas.height - rect.height) > 1) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;

    // إحداثيات الكشف تعود بأبعاد إطار المعالجة (320 عرضاً) وليس بأبعاد الفيديو الأصلية
    const detW = 320;
    const detH = Math.max(1, Math.round((detW * vh) / vw));

    const scale = Math.max(canvas.width / detW, canvas.height / detH);
    const dispW = detW * scale;
    const dispH = detH * scale;
    const offX = (canvas.width - dispW) / 2;
    const offY = (canvas.height - dispH) / 2;
    const mirrorX = camFacing === 'user';

    if (!recognitionReady) {
      faces.forEach(face => {
        const box = face.box;
        const dx = mirrorX ? offX + dispW - (box.x + box.width) * scale : offX + box.x * scale;
        const dy = offY + box.y * scale;
        const dw = box.width * scale;
        const dh = box.height * scale;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dx, dy, dw, dh);
      });
      return;
    }

    faces.forEach(face => {
      const box = face.box;
      const dx = mirrorX ? offX + dispW - (box.x + box.width) * scale : offX + box.x * scale;
      const dy = offY + box.y * scale;
      const dw = box.width * scale;
      const dh = box.height * scale;

      let stroke: string;
      let bg: string;
      let label: string;
      let sublabel: string;

      switch (face.status) {
        case 'recognized':
          stroke = '#3b82f6';
          bg = 'rgba(59,130,246,0.85)';
          label = face.name || '';
          sublabel = `${face.confidence}% ⏳`;
          break;
        case 'marked':
          stroke = '#10b981';
          bg = 'rgba(16,185,129,0.85)';
          label = face.name || '';
          sublabel = '✅ تم';
          break;
        case 'already':
          stroke = '#f59e0b';
          bg = 'rgba(245,158,11,0.85)';
          label = face.name || '';
          sublabel = '⚠️ مسبقاً';
          break;
        default:
          stroke = '#ef4444';
          bg = 'rgba(239,68,68,0.75)';
          label = '';
          sublabel = 'غير معروف';
          break;
      }

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.strokeRect(dx, dy, dw, dh);

      const corner = Math.min(12, Math.max(6, dw * 0.08));
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(dx, dy + corner); ctx.lineTo(dx, dy); ctx.lineTo(dx + corner, dy);
      ctx.moveTo(dx + dw - corner, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + corner);
      ctx.moveTo(dx + dw, dy + dh - corner); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw - corner, dy + dh);
      ctx.moveTo(dx + corner, dy + dh); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx, dy + dh - corner);
      ctx.stroke();

      if (label) {
        ctx.font = `bold ${Math.max(11, Math.min(14, dw * 0.07))}px Arial`;
        const tw = ctx.measureText(label).width;
        const bw = tw + 14;
        const bx = dx + (dw - bw) / 2;
        const by = dy - 28;
        ctx.fillStyle = bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, 22, 5);
        else ctx.rect(bx, by, bw, 22);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + bw / 2, by + 11);
      }

      ctx.font = `bold ${Math.max(9, Math.min(12, dw * 0.06))}px Arial`;
      const tw2 = ctx.measureText(sublabel).width;
      const bw2 = tw2 + 12;
      const bx2 = dx + (dw - bw2) / 2;
      const by2 = dy + dh + 4;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, 20, 4);
      else ctx.rect(bx2, by2, bw2, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(sublabel, bx2 + bw2 / 2, by2 + 10);
    });
  };

  const handleClose = () => {
    mountedRef.current = false;
    stopFaceLoop();
    cleanup();
    clearDescriptorCache();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onClose();
  };

  const handleShowReg = () => {
    stopFaceLoop();
    cleanup();
    setShowReg(true);
  };

  const handleRegClose = () => {
    setShowReg(false);
    if (mountedRef.current) {
      if (studentsWithFace.length > 0) {
        buildDescriptorCache(studentsWithFace as any, 0.6);
      }
      setTimeout(() => initCamera(), 0);
    }
  };

  const modeConfig: Record<FaceMode, { icon: string; text: string; bg: string }> = {
    loading: { icon: '⏳', text: 'جاري التحميل...', bg: 'bg-gray-600' },
    active: { icon: '🔍', text: 'البحث عن وجوه...', bg: 'bg-emerald-500' },
    info: { icon: '👤', text: 'تم التعرف!', bg: 'bg-blue-500' },
    marked: { icon: '✅', text: 'تم تسجيل الحضور!', bg: 'bg-emerald-500' },
    already_marked: { icon: '⚠️', text: 'مسجل مسبقاً', bg: 'bg-amber-500' },
  };

  const counts = {
    marked: logs.filter(l => l.status === 'marked').length,
    already: logs.filter(l => l.status === 'already').length,
  };

  return createPortal(
    <div ref={kioskRef} dir="rtl"
      className={`fixed inset-0 z-[9999] text-white flex flex-col overscroll-none ${kiosk ? 'bg-black' : 'bg-black/70 backdrop-blur-sm'}`}>
      {!kiosk && (
      <div className="w-full bg-white text-gray-900 flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-base shrink-0">👤</div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-sm leading-tight">تسجيل الحضور ببصمة الوجه</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`px-2 py-0.5 rounded-full text-white text-[10px] font-bold flex items-center gap-1 ${modeConfig[mode].bg}`}>
                  <span>{modeConfig[mode].icon}</span>
                  <span className="truncate max-w-[110px]">{modeConfig[mode].text}</span>
                </span>
                {warmup < 2 && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${warmup === 0 ? 'bg-red-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
                    {warmup === 0 ? 'تحميل الموديلات...' : 'الإحماء جاري...'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={toggleKiosk}
              className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 flex items-center gap-1">
              <span>⛶</span>
              <span className="hidden sm:inline">كشك</span>
            </button>
            <button onClick={handleShowReg}
              className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 flex items-center gap-1">
              <span>📸</span>
              <span className="hidden sm:inline">بصمة</span>
            </button>
            <button onClick={handleClose}
              className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95">
              ✕
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm font-bold text-center">
            {error}
            <button onClick={initCamera} className="block mx-auto mt-2 bg-red-600 text-white px-4 py-1.5 rounded-lg text-xs">🔄 إعادة</button>
          </div>
        )}

        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto px-4 overscroll-contain"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          {!kiosk && (
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center">
              <div className="text-2xl font-extrabold text-emerald-600">{presentIds.size}</div>
              <div className="text-[10px] text-emerald-700 font-bold mt-0.5">✅ حاضر اليوم</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-center">
              <div className="text-2xl font-extrabold text-amber-600">{counts.already}</div>
              <div className="text-[10px] text-amber-700 font-bold mt-0.5">⚠️ مسجل مسبقاً</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3 text-center">
              <div className="text-2xl font-extrabold text-gray-600">{Math.max(0, studentsWithFace.length - presentIds.size)}</div>
              <div className="text-[10px] text-gray-500 font-bold mt-0.5">⏳ المتبقي</div>
            </div>
          </div>
          )}

          <div className={`${kiosk ? 'mt-0' : 'mt-4'}`}>
            <div className={`relative rounded-2xl overflow-hidden border border-gray-100 bg-black shadow-lg ${kiosk ? 'w-full aspect-[16/10]' : 'w-full max-w-md mx-auto aspect-[3/4]'}`}>
              <video ref={attachStream}
                autoPlay playsInline muted
                onLoadedMetadata={handleVideoReady}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${videoReady ? 'opacity-100' : 'invisible'}`}
                style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
              />

              {studentsWithFace.length === 0 && mode !== 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-black">
                  <div className="text-center px-4">
                    <div className="text-4xl mb-2">📸</div>
                    <p className="text-white font-bold text-sm">لا يوجد طلاب ببصمة وجه</p>
                    <p className="text-white/50 text-xs mt-1">سجل بصمات الوجوه أولاً</p>
                    <button onClick={handleShowReg} className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-xl text-xs font-bold">📸 إضافة بصمة الآن</button>
                  </div>
                </div>
              )}

              <canvas ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />

              {cameraReady && (
                <button onClick={toggleCamera}
                  className="absolute top-2.5 left-2.5 z-10 w-8 h-8 flex items-center justify-center bg-black/50 border border-white/20 text-white rounded-full active:scale-90 text-xs backdrop-blur-sm"
                  title="تبديل الكاميرا">
                  🔄
                </button>
              )}

              {(mode === 'loading' || !videoReady) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-center">
                    <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-white font-bold text-sm">جاري تجهيز الكاميرا...</p>
                  </div>
                </div>
              )}
            </div>

            {!kiosk && (
            <>
            <div className="flex items-center justify-center gap-2 mt-2.5">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className={`w-8 h-1.5 rounded-full transition-all duration-500 ${
                    warmup > i ? 'bg-emerald-500' : warmup === i && i === 0 ? 'bg-red-400 animate-pulse' : warmup === i ? 'bg-amber-400 animate-pulse' : 'bg-gray-200'
                  }`} />
                ))}
              </div>
              <span className="text-[10px] font-bold text-gray-400">
                {warmup === 2 ? 'النظام جاهز للتعرف' : warmup === 1 ? 'الإحماء جاري...' : 'تحميل موديلات التعرف...'}
              </span>
            </div>

            {cameraReady && (
              <div className="flex items-center justify-center gap-2 mt-2">
                <div className="flex items-center gap-1 bg-gray-100 rounded-xl px-2 py-1.5">
                  {ZOOM_STEPS.map(s => (
                    <button key={s} onClick={() => applyZoom(s)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition active:scale-90 ${
                        Math.abs(zoom - s) < 0.01 ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 shadow-sm'
                      }`}>
                      {s}x
                    </button>
                  ))}
                </div>
                {hasTorch && (
                  <button onClick={toggleTorch}
                    className={`w-8 h-8 flex items-center justify-center rounded-full active:scale-90 text-sm ${
                      torchOn ? 'bg-yellow-400 text-black' : 'bg-gray-100 text-gray-500'
                    }`}
                    title="فلاش">
                    {torchOn ? '💡' : '🔦'}
                  </button>
                )}
              </div>
            )}

            {cameraReady && mode === 'active' && studentsWithFace.length > 0 && (
              <p className="text-center text-[11px] text-gray-400 font-medium mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  أنظر إلى الكاميرا للتسجيل التلقائي
                </span>
              </p>
            )}
            </>
            )}
          </div>

          {!kiosk && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-extrabold text-sm">🎓 الطلاب ({roster.length})</h3>
              <span className="text-[10px] text-gray-400 font-bold">{presentIds.size} حاضر</span>
            </div>
            <div className="space-y-1.5 pb-2">
              {roster.map(student => {
                const present = presentIds.has(student.id);
                return (
                  <div key={student.id}
                    className={`flex items-center gap-3 p-2.5 rounded-2xl border transition-all duration-500 ${
                      present ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-100'
                    }`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0 ${avatarColor(student)}`}>
                      {student.name.trim().charAt(0) || '؟'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{student.name}</p>
                      <p className="text-[10px] text-gray-400">#{student.code}{student.group ? ` · ${student.group}` : ''}</p>
                    </div>
                    {present ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs font-extrabold shrink-0">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        حاضر
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs shrink-0">بانتظار...</span>
                    )}
                  </div>
                );
              })}
              {roster.length === 0 && studentsWithFace.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">لا يوجد طلاب ببصمة وجه في هذه المرحلة</div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
      )}

      {kiosk && (
      <div className="flex-1 relative min-h-0 overflow-hidden bg-black flex flex-col">
        <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 via-black/20 to-transparent"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-base shrink-0">👤</div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-sm leading-tight truncate">تسجيل الحضور</h1>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-white text-[10px] font-bold ${modeConfig[mode].bg}`}>
                {modeConfig[mode].icon} {modeConfig[mode].text}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="hidden sm:flex items-center gap-1.5 bg-white/10 border border-white/20 text-white px-3 py-1.5 rounded-xl text-xs font-bold">
              <span className="text-emerald-400">●</span> {presentIds.size} حاضر
            </span>
            {cameraReady && (
              <button onClick={toggleCamera}
                className="w-9 h-9 flex items-center justify-center bg-white/10 border border-white/20 text-white rounded-xl active:scale-90 text-sm"
                title="تبديل الكاميرا">🔄</button>
            )}
            <button onClick={toggleKiosk}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition active:scale-95">
              <span>⛶</span> خروج
            </button>
          </div>
        </header>

        {error && (
          <div className="absolute inset-x-4 z-30 bg-red-500/90 text-white p-3 rounded-xl text-sm font-bold text-center"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 5rem)' }}>
            {error}
            <button onClick={initCamera} className="block mx-auto mt-2 bg-white text-red-600 px-4 py-1.5 rounded-lg text-xs">🔄 إعادة</button>
          </div>
        )}

        <div className="flex-1 relative min-h-0 overflow-hidden">
          <video ref={attachStream}
            autoPlay playsInline muted
            onLoadedMetadata={handleVideoReady}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${videoReady ? 'opacity-100' : 'invisible'}`}
            style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
          />

          {studentsWithFace.length === 0 && mode !== 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-black">
              <div className="text-center px-4">
                <div className="text-4xl mb-2">📸</div>
                <p className="text-white font-bold text-sm">لا يوجد طلاب ببصمة وجه</p>
                <p className="text-white/50 text-xs mt-1">سجل بصمات الوجوه أولاً</p>
                <button onClick={handleShowReg} className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-xl text-xs font-bold">📸 إضافة بصمة الآن</button>
              </div>
            </div>
          )}

          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          {(mode === 'loading' || !videoReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="text-center">
                <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-white font-bold text-sm">جاري تجهيز الكاميرا...</p>
              </div>
            </div>
          )}

          {/* 🎯 تراكب: آخر المسجلين */}
          <div className="absolute inset-x-3 z-20 flex flex-col gap-1.5 items-start pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}>
            {recentMarked.map((l, i) => (
              <div key={`${l.id}-${l.time}`}
                className={`flex items-center gap-2 bg-black/75 text-white rounded-xl px-3 py-1.5 backdrop-blur-sm text-xs font-bold shadow-lg animate-fadeIn ${i === 0 ? 'ring-2 ring-emerald-400' : ''}`}>
                <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] shrink-0">✓</span>
                <span className="truncate">{l.name}</span>
                <span className="text-white/50 text-[10px] shrink-0">#{l.code}</span>
              </div>
            ))}
          </div>

          {/* 🎛️ أدوات الكاميرا أسفل الشاشة */}
          {cameraReady && (
            <div className="absolute inset-x-0 z-30 flex items-center justify-center gap-2"
              style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
              <div className="flex items-center gap-1 bg-black/60 border border-white/15 rounded-xl px-2 py-1.5 backdrop-blur-sm">
                {ZOOM_STEPS.map(s => (
                  <button key={s} onClick={() => applyZoom(s)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition active:scale-90 ${
                      Math.abs(zoom - s) < 0.01 ? 'bg-blue-500 text-white' : 'text-white/80 hover:bg-white/10'
                    }`}>
                    {s}x
                  </button>
                ))}
              </div>
              {hasTorch && (
                <button onClick={toggleTorch}
                  className={`w-9 h-9 flex items-center justify-center rounded-full active:scale-90 text-sm bg-black/60 border border-white/15 backdrop-blur-sm ${
                    torchOn ? 'text-yellow-400' : 'text-white/80'
                  }`}
                  title="فلاش">{torchOn ? '💡' : '🔦'}</button>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {showReg && onUpdateStudent && (
        <Suspense fallback={null}>
          <LazyFaceRegistration
            students={students}
            onUpdateStudent={onUpdateStudent}
            onClose={handleRegClose}
          />
        </Suspense>
      )}
    </div>,
    document.body
  );
};

export default FaceAttendance;
