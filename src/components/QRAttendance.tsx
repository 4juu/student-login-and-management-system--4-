// src/components/QRAttendance.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AttendanceSession, Student } from '../types/student';
import {
  loadFaceModels,
  extractAllFaceDescriptorsHybrid,
  extractAllFaceDescriptors,
  extractFaceDescriptor,
  findBestMatch,
  descriptorToArray,
  areModelsLoaded,
  resetModels,
} from '../services/faceRecognition';

/* ══════════════════════════════════════════════════════════
   Types
══════════════════════════════════════════════════════════ */
interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ToastType      = 'success' | 'error' | 'info' | 'warning';
type ScanMode       = 'qr' | 'bulk';
type CameraFacing   = 'environment' | 'user';
type BulkSensitivity = 'normal' | 'far' | 'extreme';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  text?: string;
}

interface DetectedFaceBox {
  box: { x: number; y: number; width: number; height: number };
  student: Student | null;
  status: 'recognized' | 'already' | 'unknown' | 'analyzing';
  confidence: number;
  timestamp: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════ */
const QR_REGION_ID      = 'qr-reader-region-v2';
const DUPLICATE_BLOCK_MS = 30_000;
const BULK_FACE_BLOCK_MS = 120_000;
const BOX_FADE_MS        = 3000;
const CONFIDENCE_THRESHOLD = 0.42;

/* ══════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════ */
const extractQrCodeId = (text: string): string | null => {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    const id  = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {}
  try {
    const obj = JSON.parse(raw);
    const val = obj.qrCodeId || obj.qrId || obj.id ||
                obj.studentId || obj.universityId || obj.code;
    if (val) return String(val).trim();
  } catch {}
  if (/^[A-Za-z0-9_-]{3,100}$/.test(raw)) return raw;
  return null;
};

const isLowEndDevice = (): boolean => {
  const cores  = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  return cores <= 4 || memory <= 3;
};

const getQrBox = () => {
  const min  = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(180, Math.min(300, Math.floor(min * 0.6)));
  return { width: size, height: size };
};

/* ─── Audio ─── */
const beep = (freq: number, dur: number, vol = 0.06) => {
  try {
    const AC  = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type            = 'sine';
    osc.frequency.value = freq;
    g.gain.value        = vol;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur / 1000);
    setTimeout(() => ctx.close(), dur + 100);
  } catch {}
};

const playSuccess      = () => { navigator.vibrate?.([50, 30, 50]); beep(880, 100); };
const playBulkSuccess  = () => { navigator.vibrate?.(40);            beep(1000, 80, 0.04); };
const playCapture      = () => { navigator.vibrate?.(30);            beep(1200, 50, 0.04); };
const playError        = () => { navigator.vibrate?.([150]);         beep(200, 200, 0.05); };

/* ─── Canvas Drawing ─── */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ══════════════════════════════════════════════════════════
   Main Component
══════════════════════════════════════════════════════════ */
export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students,
  activeSession,
  onMarkAttendance,
  onUpdateStudent,
  alreadyPresentIds,
  onClose,
}) => {
  /* ─── Refs ─── */
  const scannerRef         = useRef<Html5Qrcode | null>(null);
  const trackRef           = useRef<MediaStreamTrack | null>(null);
  const processingRef      = useRef(false);
  const lastScansRef       = useRef<Record<string, number>>({});
  const mountedRef         = useRef(true);
  const startingRef        = useRef(false);
  const faceLoopRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceProcessingRef  = useRef(false);
  const faceStuckCountRef  = useRef(0);   // ← عداد إذا عالق
  const codeInputRef       = useRef<HTMLInputElement>(null);
  const qrCodeInputRef     = useRef<HTMLInputElement>(null);
  const overlayCanvasRef   = useRef<HTMLCanvasElement>(null);
  const detectedFacesRef   = useRef<Map<string, DetectedFaceBox>>(new Map());
  const animationFrameRef  = useRef<number | null>(null);
  const lastRestartRef     = useRef(0);
  const restartCountRef    = useRef(0);
  const toastCounterRef    = useRef(0);
  const watchdogTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameTimeRef   = useRef(Date.now());

  /* ─── State ─── */
  const [mode,            setMode]            = useState<ScanMode>('qr');
  const [facing,          setFacing]          = useState<CameraFacing>('environment');
  const [cameraReady,     setCameraReady]     = useState(false);
  const [toasts,          setToasts]          = useState<ToastMessage[]>([]);
  const [scanCount,       setScanCount]       = useState(0);
  const [recentStudents,  setRecentStudents]  = useState<Student[]>([]);
  const [pendingQrId,     setPendingQrId]     = useState<string | null>(null);
  const [qrLinkCode,      setQrLinkCode]      = useState('');
  const [qrLinkMessage,   setQrLinkMessage]   = useState('');
  const [zoom,            setZoom]            = useState(1);
  const [maxZoom,         setMaxZoom]         = useState(1);
  const [minZoom,         setMinZoom]         = useState(1);
  const [canZoom,         setCanZoom]         = useState(false);
  const [hasTorch,        setHasTorch]        = useState(false);
  const [torchOn,         setTorchOn]         = useState(false);
  const [errorMsg,        setErrorMsg]        = useState('');
  const [lowEnd]                              = useState(isLowEndDevice);
  const [faceModelsReady, setFaceModelsReady] = useState(areModelsLoaded);
  const [faceLoading,     setFaceLoading]     = useState(false);
  const [cameraStatus,    setCameraStatus]    = useState<
    'starting' | 'ready' | 'error' | 'restarting'
  >('starting');

  /* Face Register */
  const [showFaceRegister, setShowFaceRegister] = useState(false);
  const [registerCode,     setRegisterCode]     = useState('');
  const [registerStep,     setRegisterStep]     = useState<
    'code' | 'capturing' | 'success'
  >('code');
  const [registerStudent,  setRegisterStudent]  = useState<Student | null>(null);
  const [registerMessage,  setRegisterMessage]  = useState('');
  const [captureProgress,  setCaptureProgress]  = useState(0);

  /* Bulk */
  const [bulkSessionStudents, setBulkSessionStudents] = useState<Student[]>([]);
  const [bulkShowSidebar,     setBulkShowSidebar]     = useState(true);
  const [bulkSensitivity,     setBulkSensitivity]     = useState<BulkSensitivity>('far');
  const [bulkDetectedCount,   setBulkDetectedCount]   = useState(0);

  /* ─── Maps ─── */
  const studentMap = useMemo(() => {
    const m = new Map<string, Student>();
    students.forEach(s => {
      if (s.qrCodeId)      m.set(s.qrCodeId.trim(),      s);
      if (s.universityId)  m.set(s.universityId.trim(),  s);
    });
    return m;
  }, [students]);

  const studentsWithFace = useMemo(
    () => students.filter(s => s.faceDescriptor && s.faceDescriptor.length > 0),
    [students]
  );

  /* ─── Toast ─── */
  const showToast = useCallback(
    (msg: Omit<ToastMessage, 'id'>, ms = 2500) => {
      const id   = ++toastCounterRef.current;
      const full = { ...msg, id };
      setToasts(prev => [full, ...prev].slice(0, 3));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ms);
    },
    []
  );

  /* ══════════════════════════════════════════════════════
     إيقاف كل شيء
  ══════════════════════════════════════════════════════ */
  const hardStopCamera = useCallback(async () => {
    /* 1. watchdog */
    if (watchdogTimerRef.current) {
      clearInterval(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }

    /* 2. face loop */
    if (faceLoopRef.current) {
      clearTimeout(faceLoopRef.current);
      faceLoopRef.current = null;
    }
    // أعط وقتاً لأي معالجة جارية لتنتهي
    if (faceProcessingRef.current) {
      await new Promise(r => setTimeout(r, 600));
    }
    faceProcessingRef.current = false;
    faceStuckCountRef.current = 0;

    /* 3. animation frame */
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    /* 4. torch off */
    if (trackRef.current && torchOn) {
      try {
        await trackRef.current.applyConstraints({
          advanced: [{ torch: false } as any],
        });
      } catch {}
    }

    /* 5. Html5Qrcode */
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (
          state === Html5QrcodeScannerState.SCANNING ||
          state === Html5QrcodeScannerState.PAUSED
        ) {
          await scannerRef.current.stop();
        }
      } catch {}
      try { await scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    /* 6. track مباشر */
    if (trackRef.current) {
      try { trackRef.current.stop(); } catch {}
      trackRef.current = null;
    }

    /* 7. كل tracks في الـ video */
    const video = document.querySelector(
      `#${QR_REGION_ID} video`
    ) as HTMLVideoElement | null;
    if (video?.srcObject) {
      try {
        (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        video.srcObject = null;
      } catch {}
    }

    /* 8. مسح DOM */
    const region = document.getElementById(QR_REGION_ID);
    if (region) region.innerHTML = '';
  }, [torchOn]);

  /* ══════════════════════════════════════════════════════
     Watchdog - يراقب الفيديو ويُعيد التشغيل إذا علق
  ══════════════════════════════════════════════════════ */
  const startWatchdog = useCallback((currentFacing: CameraFacing) => {
    if (watchdogTimerRef.current) clearInterval(watchdogTimerRef.current);

    lastFrameTimeRef.current = Date.now();

    watchdogTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;

      const video = document.querySelector(
        `#${QR_REGION_ID} video`
      ) as HTMLVideoElement | null;

      const elapsed  = Date.now() - lastFrameTimeRef.current;
      const isStuck  = !video ||
                       video.readyState < 2 ||
                       video.paused ||
                       video.ended ||
                       elapsed > 8000;

      if (isStuck) {
        const now = Date.now();
        if (now - lastRestartRef.current < 6000) return;
        lastRestartRef.current = now;
        restartCountRef.current++;
        console.warn(`🔄 Watchdog: إعادة تشغيل #${restartCountRef.current}`);
        setCameraStatus('restarting');
        // استدع startCamera بعد تأخير صغير
        setTimeout(() => {
          if (mountedRef.current) startCamera(currentFacing);
        }, 500);
      }
    }, 5000);
  }, []); // eslint-disable-line

  /* ══════════════════════════════════════════════════════
     إعداد الكاميرا بعد التشغيل
  ══════════════════════════════════════════════════════ */
  const configureCamera = useCallback(
    async (currentFacing: CameraFacing) => {
      try {
        await new Promise(r => setTimeout(r, 500));
        const video = document.querySelector(
          `#${QR_REGION_ID} video`
        ) as HTMLVideoElement | null;
        if (!video?.srcObject) return;

        const stream = video.srcObject as MediaStream;
        const track  = stream.getVideoTracks()[0];
        if (!track) return;
        trackRef.current = track;

        const caps = (track.getCapabilities?.() || {}) as any;

        // Focus / Exposure / WhiteBalance
        for (const [cap, val] of [
          ['focusMode',       'continuous'],
          ['exposureMode',    'continuous'],
          ['whiteBalanceMode','continuous'],
        ] as const) {
          if (caps[cap]?.includes?.(val)) {
            try {
              await track.applyConstraints({ advanced: [{ [cap]: val } as any] });
            } catch {}
          }
        }

        // Zoom
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          setMinZoom(caps.zoom.min);
          setMaxZoom(caps.zoom.max);
          setCanZoom(true);
          try {
            await track.applyConstraints({
              advanced: [{ zoom: caps.zoom.min } as any],
            });
            setZoom(caps.zoom.min);
          } catch {}
        } else {
          setCanZoom(false);
          setMinZoom(1);
          setMaxZoom(1);
        }

        setHasTorch(!!caps.torch);

        // تغذية الـ watchdog من requestAnimationFrame
        const feedWatchdog = () => {
          if (!mountedRef.current) return;
          const v = document.querySelector(
            `#${QR_REGION_ID} video`
          ) as HTMLVideoElement | null;
          if (v && v.readyState >= 2 && !v.paused) {
            lastFrameTimeRef.current = Date.now();
          }
          requestAnimationFrame(feedWatchdog);
        };
        requestAnimationFrame(feedWatchdog);

        // شغّل الـ watchdog
        startWatchdog(currentFacing);
      } catch (e) {
        console.warn('configureCamera error:', e);
      }
    },
    [startWatchdog]
  );

  /* ══════════════════════════════════════════════════════
     تشغيل الكاميرا
  ══════════════════════════════════════════════════════ */
  const startCamera = useCallback(
    async (currentFacing: CameraFacing) => {
      if (!mountedRef.current) return;
      if (startingRef.current)  return;
      startingRef.current = true;

      setCameraStatus('starting');
      setErrorMsg('');
      setCameraReady(false);
      setHasTorch(false);
      setTorchOn(false);
      setCanZoom(false);

      try {
        await hardStopCamera();

        // انتظر DOM يتفرّغ
        await new Promise(r => setTimeout(r, 500));
        if (!mountedRef.current) return;

        // تأكد أن القسم فارغ
        const region = document.getElementById(QR_REGION_ID);
        if (region) region.innerHTML = '';

        const qrBox = getQrBox();
        const fps   = lowEnd ? 10 : 30;

        const tryStart = async (
          constraints: any,
          scannerFps: number,
          box: any
        ): Promise<Html5Qrcode> => {
          const s = new Html5Qrcode(QR_REGION_ID, { verbose: false });
          await s.start(
            { facingMode: currentFacing },
            {
              fps: scannerFps,
              qrbox: box,
              aspectRatio:
                window.innerHeight > window.innerWidth ? 4 / 3 : 16 / 9,
              disableFlip: true,
              videoConstraints: constraints,
            },
            onDecoded,
            () => {}
          );
          return s;
        };

        const attempts = [
          {
            constraints: {
              facingMode: currentFacing,
              width:  { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 60, min: 30 },
            },
            fps,
            box: qrBox,
          },
          {
            constraints: {
              facingMode: currentFacing,
              width:  { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
            fps: Math.min(fps, 20),
            box: qrBox,
          },
          {
            constraints: { facingMode: currentFacing },
            fps: 10,
            box: { width: 200, height: 200 },
          },
        ];

        let scanner: Html5Qrcode | null = null;

        for (const attempt of attempts) {
          try {
            scanner = await tryStart(
              attempt.constraints,
              attempt.fps,
              attempt.box
            );
            break;
          } catch (e) {
            console.warn('محاولة فاشلة:', e);
            if (scannerRef.current) {
              try { await scannerRef.current.clear(); } catch {}
              scannerRef.current = null;
            }
            const reg = document.getElementById(QR_REGION_ID);
            if (reg) reg.innerHTML = '';
            await new Promise(r => setTimeout(r, 400));
          }
        }

        if (!scanner) throw new Error('كل المحاولات فشلت');

        scannerRef.current = scanner;

        if (!mountedRef.current) {
          try { await scanner.stop(); } catch {}
          return;
        }

        setCameraReady(true);
        setCameraStatus('ready');

        // إعداد الكاميرا (zoom / torch / watchdog)
        await configureCamera(currentFacing);

      } catch (err: any) {
        console.error('❌ startCamera failed:', err);
        if (!mountedRef.current) return;

        setCameraStatus('error');
        const msg = err?.message || '';

        if (msg.includes('NotAllowed') || msg.includes('Permission')) {
          setErrorMsg('يرجى السماح باستخدام الكاميرا من إعدادات المتصفح');
        } else if (msg.includes('NotFound')) {
          setErrorMsg('لا توجد كاميرا متاحة');
        } else if (msg.includes('NotReadable') || msg.includes('TrackStartError')) {
          setErrorMsg('الكاميرا مستخدمة من تطبيق آخر');
        } else {
          setErrorMsg(`فشل تشغيل الكاميرا: ${msg.slice(0, 60)}`);
        }

        // إعادة محاولة تلقائية بعد 4 ثواني
        setTimeout(() => {
          if (mountedRef.current) startCamera(currentFacing);
        }, 4000);

      } finally {
        startingRef.current = false;
      }
    },
    [lowEnd, hardStopCamera, configureCamera] // eslint-disable-line
  );

  /* ─── QR Decode ─── */
  const onDecoded = useCallback(
    async (text: string) => {
      if (processingRef.current) return;
      const qrId = extractQrCodeId(text);
      if (!qrId) return;

      processingRef.current = true;
      try {
        const student = studentMap.get(qrId);
        if (student) {
          const now = Date.now();
          if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
          lastScansRef.current[qrId] = now;

          if (alreadyPresentIds.has(student.id)) {
            showToast(
              { type: 'warning', title: '⚠️ مسجل مسبقاً', text: student.name },
              1500
            );
            return;
          }

          await onMarkAttendance(student);
          setScanCount(c => c + 1);
          setRecentStudents(prev =>
            [student, ...prev.filter(s => s.id !== student.id)].slice(0, 8)
          );
          playSuccess();
          showToast({
            type: 'success',
            title: `✅ ${student.name}`,
            text: student.group ? `الكروب: ${student.group}` : 'تم تسجيل الحضور',
          });
        } else {
          const now = Date.now();
          if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
          lastScansRef.current[qrId] = now;
          setPendingQrId(qrId);
          setQrLinkCode('');
          setQrLinkMessage('');
          playError();
          setTimeout(() => qrCodeInputRef.current?.focus(), 200);
        }
      } finally {
        setTimeout(() => { processingRef.current = false; }, 400);
      }
    },
    [studentMap, alreadyPresentIds, onMarkAttendance, showToast]
  );

  /* ─── Zoom ─── */
  const applyZoom = useCallback(
    async (val: number) => {
      if (!trackRef.current || !canZoom) return;
      const clamped = Math.max(minZoom, Math.min(maxZoom, val));
      try {
        await trackRef.current.applyConstraints({
          advanced: [{ zoom: clamped } as any],
        });
        setZoom(clamped);
      } catch {}
    },
    [canZoom, minZoom, maxZoom]
  );

  /* ─── Torch ─── */
  const toggleTorch = useCallback(async () => {
    if (!trackRef.current || !hasTorch) return;
    const next = !torchOn;
    try {
      await trackRef.current.applyConstraints({
        advanced: [{ torch: next } as any],
      });
      setTorchOn(next);
    } catch {}
  }, [hasTorch, torchOn]);

  /* ─── تغيير الوجهة ─── */
  const toggleCamera = useCallback(async () => {
    if (startingRef.current) return;
    const newFacing: CameraFacing =
      facing === 'environment' ? 'user' : 'environment';
    setFacing(newFacing);
    await startCamera(newFacing);
  }, [facing, startCamera]);

  /* ══════════════════════════════════════════════════════
     تحميل موديلات الوجه - مع إعادة المحاولة التلقائية
  ══════════════════════════════════════════════════════ */
  useEffect(() => {
    if (mode !== 'bulk' || faceModelsReady) return;

    let cancelled = false;

    const load = async (attempt = 0): Promise<void> => {
      if (cancelled || !mountedRef.current) return;

      setFaceLoading(true);
      try {
        await loadFaceModels();
        if (!cancelled && mountedRef.current) {
          setFaceModelsReady(true);
          setFaceLoading(false);
        }
      } catch {
        if (cancelled || !mountedRef.current) return;
        setFaceLoading(false);

        if (attempt < 4) {
          showToast(
            { type: 'warning', title: `⚠️ إعادة تحميل... (${attempt + 1})` },
            2000
          );
          resetModels();
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          return load(attempt + 1);
        }

        showToast({ type: 'error', title: '❌ فشل تحميل نظام التعرف' }, 4000);
      }
    };

    load();

    return () => { cancelled = true; };
  }, [mode, faceModelsReady, showToast]);

  /* ══════════════════════════════════════════════════════
     Canvas Overlay
  ══════════════════════════════════════════════════════ */
  useEffect(() => {
    if (mode !== 'bulk' || !cameraReady) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const canvas = overlayCanvasRef.current;
    const video  = document.querySelector(
      `#${QR_REGION_ID} video`
    ) as HTMLVideoElement | null;
    if (!canvas || !video) return;

    const isFront = facing === 'user';

    const draw = () => {
      if (!mountedRef.current) return;

      if (!canvas || !video || video.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // ضبط حجم الـ canvas ليطابق الفيديو المعروض
      const rect = video.getBoundingClientRect();
      if (
        Math.abs(canvas.width  - rect.width)  > 1 ||
        Math.abs(canvas.height - rect.height) > 1
      ) {
        canvas.width  = rect.width;
        canvas.height = rect.height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { animationFrameRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now         = Date.now();
      const videoWidth  = video.videoWidth  || 1280;
      const videoHeight = video.videoHeight || 720;
      const scaleX = canvas.width  / videoWidth;
      const scaleY = canvas.height / videoHeight;

      let visibleCount = 0;

      detectedFacesRef.current.forEach((face, key) => {
        const age = now - face.timestamp;
        if (age > BOX_FADE_MS) {
          detectedFacesRef.current.delete(key);
          return;
        }

        visibleCount++;
        const opacity = age < 200
          ? age / 200
          : Math.max(0.4, 1 - (age - 200) / BOX_FADE_MS);

        let strokeColor = '#ef4444';
        let bgColor     = 'rgba(239,68,68,0.85)';
        let label       = '❓ غير معروف';

        if (face.status === 'recognized') {
          strokeColor = '#10b981';
          bgColor     = 'rgba(16,185,129,0.9)';
          label       = face.student?.name || '';
        } else if (face.status === 'already') {
          strokeColor = '#f59e0b';
          bgColor     = 'rgba(245,158,11,0.9)';
          label       = `✓ ${face.student?.name || ''}`;
        } else if (face.status === 'analyzing') {
          strokeColor = '#3b82f6';
          bgColor     = 'rgba(59,130,246,0.9)';
          label       = '🔍 ...';
        }

        let displayX = face.box.x * scaleX;
        const displayY = face.box.y * scaleY;
        const displayW = face.box.width  * scaleX;
        const displayH = face.box.height * scaleY;

        if (isFront) displayX = canvas.width - displayX - displayW;

        ctx.globalAlpha = opacity;

        // توهج + مربع
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur  = 18;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth   = 2.5;
        ctx.strokeRect(displayX, displayY, displayW, displayH);
        ctx.shadowBlur  = 0;

        // زوايا مميزة
        const cLen = Math.max(12, Math.min(25, displayW * 0.2));
        ctx.lineWidth   = 4;
        ctx.lineCap     = 'round';
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        ctx.moveTo(displayX,            displayY + cLen);
        ctx.lineTo(displayX,            displayY);
        ctx.lineTo(displayX + cLen,     displayY);
        ctx.moveTo(displayX + displayW - cLen, displayY);
        ctx.lineTo(displayX + displayW,        displayY);
        ctx.lineTo(displayX + displayW,        displayY + cLen);
        ctx.moveTo(displayX + displayW,        displayY + displayH - cLen);
        ctx.lineTo(displayX + displayW,        displayY + displayH);
        ctx.lineTo(displayX + displayW - cLen, displayY + displayH);
        ctx.moveTo(displayX + cLen,     displayY + displayH);
        ctx.lineTo(displayX,            displayY + displayH);
        ctx.lineTo(displayX,            displayY + displayH - cLen);
        ctx.stroke();

        // اسم فوق الرأس
        if (label && face.status !== 'unknown') {
          const fontSize = Math.max(11, Math.min(16, displayW / 7));
          ctx.font       = `bold ${fontSize}px 'Arial', sans-serif`;
          const metrics  = ctx.measureText(label);
          const pad = 7;
          const bw  = metrics.width + pad * 2;
          const bh  = fontSize + pad;
          const bx  = displayX + (displayW - bw) / 2;
          const by  = displayY - bh - 6;

          ctx.shadowColor   = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur    = 8;
          ctx.shadowOffsetY = 2;
          ctx.fillStyle     = bgColor;
          drawRoundedRect(ctx, bx, by, bw, bh, 6);
          ctx.fill();
          ctx.shadowBlur    = 0;
          ctx.shadowOffsetY = 0;

          ctx.fillStyle     = '#ffffff';
          ctx.textAlign     = 'center';
          ctx.textBaseline  = 'middle';
          ctx.fillText(label, bx + bw / 2, by + bh / 2);

          // نسبة الدقة أسفل المربع
          if (face.confidence > 0 && face.status === 'recognized') {
            const confLabel = `${face.confidence}%`;
            const confFont  = Math.max(9, fontSize - 3);
            ctx.font        = `bold ${confFont}px Arial`;
            const cw  = ctx.measureText(confLabel).width + 10;
            const ch  = confFont + 5;
            const cx2 = displayX + (displayW - cw) / 2;
            const cy2 = displayY + displayH + 4;

            ctx.fillStyle = bgColor;
            drawRoundedRect(ctx, cx2, cy2, cw, ch, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(confLabel, cx2 + cw / 2, cy2 + ch / 2);
          }
        }

        ctx.globalAlpha = 1;
      });

      setBulkDetectedCount(visibleCount);
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [mode, cameraReady, facing]);

  /* ══════════════════════════════════════════════════════
     Face Recognition Loop
     - يستخدم setTimeout متسلسل بدل setInterval
     - يكتشف إذا faceProcessingRef علق ويُعيد ضبطه
  ══════════════════════════════════════════════════════ */
  const faceLoopRunningRef = useRef(false);

  const stopFaceLoop = useCallback(() => {
    faceLoopRunningRef.current = false;
    if (faceLoopRef.current) {
      clearTimeout(faceLoopRef.current);
      faceLoopRef.current = null;
    }
  }, []);

  const startFaceLoop = useCallback(
    (
      sensitivity: BulkSensitivity,
      currentFacing: CameraFacing,
      faces: Student[]
    ) => {
      stopFaceLoop();
      faceLoopRunningRef.current = true;

      const intervalMs =
        sensitivity === 'extreme' ? 250 :
        sensitivity === 'far'     ? 400 : 500;

      // مهلة أقصى لكل معالجة (ثانيتان)
      const MAX_PROCESSING_MS = 2000;
      let processingStartedAt = 0;

      const loop = async () => {
        if (!faceLoopRunningRef.current || !mountedRef.current) return;

        // كشف إذا faceProcessingRef علق
        if (faceProcessingRef.current) {
          const elapsed = Date.now() - processingStartedAt;
          if (elapsed > MAX_PROCESSING_MS) {
            console.warn('⚠️ Face processing stuck – resetting');
            faceProcessingRef.current  = false;
            faceStuckCountRef.current += 1;

            // إذا علق 3 مرات متتالية، أعد تشغيل الكاميرا
            if (faceStuckCountRef.current >= 3) {
              faceStuckCountRef.current = 0;
              const now = Date.now();
              if (now - lastRestartRef.current > 5000) {
                lastRestartRef.current = now;
                setCameraStatus('restarting');
                setTimeout(() => {
                  if (mountedRef.current) startCamera(currentFacing);
                }, 500);
                return;
              }
            }
          } else {
            // لسا في المهلة - انتظر
            faceLoopRef.current = setTimeout(loop, 200) as any;
            return;
          }
        }

        if (showFaceRegister) {
          faceLoopRef.current = setTimeout(loop, 500) as any;
          return;
        }

        const video = document.querySelector(
          `#${QR_REGION_ID} video`
        ) as HTMLVideoElement | null;

        if (!video || video.readyState < 2 || video.paused || video.ended) {
          faceLoopRef.current = setTimeout(loop, 600) as any;
          return;
        }

        // بدء المعالجة
        faceProcessingRef.current = true;
        processingStartedAt       = Date.now();
        faceStuckCountRef.current = 0;

        try {
          const detections =
            sensitivity === 'normal'
              ? await extractAllFaceDescriptors(video)
              : await extractAllFaceDescriptorsHybrid(video);

          if (!mountedRef.current) return;

          // تحديث watchdog
          lastFrameTimeRef.current = Date.now();

          for (const detection of detections) {
            if (!faceLoopRunningRef.current) break;

            const box    = detection.detection.box;
            const bx     = Math.round(box.x     / 40);
            const by     = Math.round(box.y     / 40);
            const bw     = Math.round(box.width / 40);
            const boxKey = `${bx}_${by}_${bw}`;

            const match = findBestMatch(
              detection.descriptor,
              faces,
              CONFIDENCE_THRESHOLD
            );
            const now = Date.now();

            if (match) {
              const student       = match.item;
              const alreadyPresent = alreadyPresentIds.has(student.id);
              const recentlyScanned =
                now - (lastScansRef.current[`bulk_${student.id}`] || 0) <
                BULK_FACE_BLOCK_MS;

              if (alreadyPresent || recentlyScanned) {
                detectedFacesRef.current.set(boxKey, {
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                  student,
                  status: 'already',
                  confidence: match.confidence,
                  timestamp: now,
                });
              } else {
                lastScansRef.current[`bulk_${student.id}`] = now;
                detectedFacesRef.current.set(boxKey, {
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                  student,
                  status: 'recognized',
                  confidence: match.confidence,
                  timestamp: now,
                });

                await onMarkAttendance(student);
                setScanCount(c => c + 1);
                setBulkSessionStudents(prev =>
                  [student, ...prev.filter(s => s.id !== student.id)]
                );
                setRecentStudents(prev =>
                  [student, ...prev.filter(s => s.id !== student.id)].slice(0, 8)
                );
                playBulkSuccess();
                showToast({
                  type: 'success',
                  title: `✅ ${student.name}`,
                  text: `${student.group || ''} • ${match.confidence}%`,
                }, 2000);
              }
            } else {
              detectedFacesRef.current.set(boxKey, {
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                student: null,
                status: 'unknown',
                confidence: 0,
                timestamp: now,
              });
            }
          }
        } catch (e) {
          console.warn('Face loop error:', e);
        } finally {
          faceProcessingRef.current = false;
        }

        if (faceLoopRunningRef.current && mountedRef.current) {
          faceLoopRef.current = setTimeout(loop, intervalMs) as any;
        }
      };

      // ابدأ بعد تأخير صغير لضمان جاهزية الكاميرا
      faceLoopRef.current = setTimeout(loop, 800) as any;
    },
    [
      stopFaceLoop,
      alreadyPresentIds,
      onMarkAttendance,
      showToast,
      showFaceRegister,
    ] // eslint-disable-line
  );

  /* ─── تفعيل/إلغاء face loop ─── */
  useEffect(() => {
    if (
      mode === 'bulk' &&
      cameraReady &&
      faceModelsReady &&
      studentsWithFace.length > 0
    ) {
      startFaceLoop(bulkSensitivity, facing, studentsWithFace);
    } else {
      stopFaceLoop();
    }

    return () => stopFaceLoop();
  }, [
    mode,
    cameraReady,
    faceModelsReady,
    studentsWithFace,
    bulkSensitivity,
    facing,
    startFaceLoop,
    stopFaceLoop,
  ]);

  /* ══════════════════════════════════════════════════════
     Mount / Unmount
  ══════════════════════════════════════════════════════ */
  useEffect(() => {
    mountedRef.current = true;

    // تأخير صغير لضمان جاهزية الـ DOM
    const t = setTimeout(() => {
      if (mountedRef.current) startCamera(facing);
    }, 300);

    return () => {
      mountedRef.current = false;
      clearTimeout(t);
      stopFaceLoop();
      hardStopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── تغيير الوضع ─── */
  useEffect(() => {
    detectedFacesRef.current.clear();
    if (mode === 'bulk' && facing !== 'environment') {
      setFacing('environment');
      startCamera('environment');
    }
  }, [mode]); // eslint-disable-line

  /* ─── إغلاق ─── */
  const handleClose = useCallback(async () => {
    mountedRef.current = false;
    stopFaceLoop();
    await hardStopCamera();
    await new Promise(r => setTimeout(r, 200));
    onClose();
  }, [hardStopCamera, stopFaceLoop, onClose]);

  /* ══════════════════════════════════════════════════════
     QR Link
  ══════════════════════════════════════════════════════ */
  const handleQrLinkByCode = useCallback(
    async (code: string) => {
      if (!pendingQrId || !onUpdateStudent) return;
      if (code.length !== 4) {
        setQrLinkMessage('❌ الكود يجب أن يكون 4 أرقام');
        return;
      }
      const student = students.find(s => s.code === code);
      if (!student) {
        setQrLinkMessage('❌ لا يوجد طالب بهذا الكود');
        playError();
        return;
      }
      if (student.qrCodeId) {
        setQrLinkMessage(`⚠️ ${student.name} لديه QR مربوط بالفعل`);
        playError();
        return;
      }

      const updated = { ...student, qrCodeId: pendingQrId };
      onUpdateStudent(student.id, { qrCodeId: pendingQrId });

      const qrId = pendingQrId;
      setPendingQrId(null);
      setQrLinkCode('');
      setQrLinkMessage('');

      const now = Date.now();
      lastScansRef.current[qrId] = now;

      if (!alreadyPresentIds.has(student.id)) {
        await onMarkAttendance(updated);
        setScanCount(c => c + 1);
        setRecentStudents(prev =>
          [updated, ...prev.filter(s => s.id !== updated.id)].slice(0, 8)
        );
        playSuccess();
        showToast({
          type: 'success',
          title: `✅ ${updated.name}`,
          text: 'تم الربط والتسجيل',
        });
      }
    },
    [pendingQrId, onUpdateStudent, students, alreadyPresentIds, onMarkAttendance, showToast]
  );

  /* ══════════════════════════════════════════════════════
     Face Register
  ══════════════════════════════════════════════════════ */
  const openFaceRegister = useCallback(async () => {
    if (facing !== 'user') {
      setFacing('user');
      await startCamera('user');
    }
    setRegisterCode('');
    setRegisterStep('code');
    setRegisterStudent(null);
    setRegisterMessage('');
    setCaptureProgress(0);
    setShowFaceRegister(true);
    setTimeout(() => codeInputRef.current?.focus(), 300);
  }, [facing, startCamera]);

  const captureFaceForRegister = useCallback(
    async (student: Student) => {
      if (!onUpdateStudent) return;

      const getVideo = () =>
        document.querySelector(
          `#${QR_REGION_ID} video`
        ) as HTMLVideoElement | null;

      const video = getVideo();
      if (!video || video.readyState < 2) {
        setRegisterMessage('❌ الكاميرا غير جاهزة، انتظر...');
        setTimeout(() => {
          const v2 = getVideo();
          if (v2 && v2.readyState >= 2) {
            captureFaceForRegister(student);
          } else {
            setRegisterStep('code');
            setRegisterMessage('❌ الكاميرا لم تستجب');
          }
        }, 1500);
        return;
      }

      setRegisterStep('capturing');
      setCaptureProgress(0);

      let prog = 0;
      const pi = window.setInterval(() => {
        prog = Math.min(prog + 10, 88);
        setCaptureProgress(prog);
      }, 50);

      try {
        playCapture();

        let descriptor: Float32Array | null = null;
        for (let i = 0; i < 5; i++) {
          const v = getVideo();
          if (v && v.readyState >= 2) {
            descriptor = await extractFaceDescriptor(v);
            if (descriptor) break;
          }
          await new Promise(r => setTimeout(r, 300));
        }

        clearInterval(pi);

        if (!descriptor) {
          setCaptureProgress(0);
          setRegisterStep('code');
          setRegisterMessage('❌ لم يُرَ الوجه - ابتعد قليلاً وكن أمام الكاميرا');
          playError();
          setTimeout(() => codeInputRef.current?.focus(), 100);
          return;
        }

        setCaptureProgress(100);

        onUpdateStudent(student.id, {
          faceDescriptor: descriptorToArray(descriptor),
          faceRegisteredAt: new Date().toISOString(),
        });

        playSuccess();
        setRegisterStep('success');

        setTimeout(() => {
          if (!mountedRef.current) return;
          setRegisterCode('');
          setRegisterStudent(null);
          setRegisterMessage('');
          setCaptureProgress(0);
          setRegisterStep('code');
          setTimeout(() => codeInputRef.current?.focus(), 100);
        }, 1500);
      } catch {
        clearInterval(pi);
        setCaptureProgress(0);
        setRegisterStep('code');
        setRegisterMessage('❌ حدث خطأ - حاول مجدداً');
        playError();
      }
    },
    [onUpdateStudent]
  );

  const handleCodeSubmit = useCallback(
    async (code: string) => {
      if (code.length !== 4) return;
      const student = students.find(s => s.code === code);
      if (!student) {
        setRegisterMessage('❌ لا يوجد طالب بهذا الكود');
        playError();
        setRegisterCode('');
        setTimeout(() => codeInputRef.current?.focus(), 100);
        return;
      }
      setRegisterStudent(student);
      setRegisterMessage(
        student.faceDescriptor?.length
          ? `♻️ تحديث بصمة: ${student.name}`
          : ''
      );
      await captureFaceForRegister(student);
    },
    [students, captureFaceForRegister]
  );

  /* ══════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════ */
  const isBulkMode       = mode === 'bulk';
  const isFrontCamera    = facing === 'user';
  const shouldMirrorVideo = isFrontCamera;

  const toastBg: Record<ToastType, string> = {
    success: 'from-emerald-500 to-green-600',
    error:   'from-red-500 to-rose-600',
    info:    'from-blue-500 to-cyan-600',
    warning: 'from-amber-500 to-orange-500',
  };
  const toastIcon: Record<ToastType, string> = {
    success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️',
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black text-white flex flex-col"
      dir="rtl"
    >
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-white/10"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate flex items-center gap-1.5">
            {mode === 'qr' ? '🔳 ماسح QR' : '🎯 المسح الجماعي'}
            {cameraStatus === 'restarting' && (
              <span className="text-[9px] bg-yellow-600 px-1.5 py-0.5 rounded-full animate-pulse">
                إعادة تشغيل...
              </span>
            )}
          </h2>
          <p className="text-[10px] text-gray-400 truncate">
            {activeSession ? activeSession.name : 'لا يوجد سجل نشط'}
            {lowEnd && ' • وضع موفر'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded-full ${
              cameraStatus === 'ready'
                ? 'bg-emerald-900/60 text-emerald-300'
                : cameraStatus === 'restarting'
                ? 'bg-yellow-900/60 text-yellow-300'
                : cameraStatus === 'error'
                ? 'bg-red-900/60 text-red-300'
                : 'bg-gray-800 text-gray-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                cameraStatus === 'ready'
                  ? 'bg-emerald-400 animate-pulse'
                  : cameraStatus === 'restarting'
                  ? 'bg-yellow-400 animate-spin'
                  : cameraStatus === 'error'
                  ? 'bg-red-400'
                  : 'bg-gray-400'
              }`}
            />
            {cameraStatus === 'ready'      ? 'مباشر' :
             cameraStatus === 'restarting' ? 'يُعاد' :
             cameraStatus === 'error'      ? 'خطأ'   : 'تهيؤ'}
          </div>

          <button
            onClick={handleClose}
            className="bg-red-600 active:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
          >
            ✕ إغلاق
          </button>
        </div>
      </header>

      {/* ── Mode Tabs ── */}
      <div className="px-3 py-2 bg-gray-900/70 border-b border-white/5 flex gap-1.5">
        {(['qr', 'bulk'] as ScanMode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
              mode === m
                ? m === 'qr'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40'
                  : 'bg-gradient-to-r from-orange-600 to-red-600 text-white shadow-lg'
                : 'bg-white/8 text-gray-300 hover:bg-white/12'
            }`}
          >
            {m === 'qr' ? '🔳 QR' : '🎯 جماعي'}
          </button>
        ))}
      </div>

      {/* ── تحميل الموديلات ── */}
      {mode === 'bulk' && faceLoading && (
        <div className="mx-3 mt-2 p-3 bg-purple-900/50 border border-purple-500/40 rounded-lg flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-purple-200">
              جاري تحميل نظام التعرف على الوجوه...
            </p>
            <p className="text-[10px] text-purple-400">
              قد يستغرق بضع ثوان في المرة الأولى
            </p>
          </div>
        </div>
      )}

      {/* ── تنبيه الوضع الجماعي ── */}
      {mode === 'bulk' && faceModelsReady && cameraReady && (
        <div className="mx-3 mt-2 p-2 bg-gradient-to-r from-orange-900/50 to-red-900/50 border border-orange-500/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] text-orange-200 font-bold">
                🎯 {studentsWithFace.length} بصمة • يُكتشف {bulkDetectedCount} الآن
              </p>
              <p className="text-[10px] text-orange-300">
                🟢 معروف &nbsp;•&nbsp; 🟡 مسجّل &nbsp;•&nbsp; 🔴 غير معروف
              </p>
            </div>
            <button
              onClick={() => setBulkShowSidebar(s => !s)}
              className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[10px] font-bold"
            >
              {bulkShowSidebar ? '◀' : '▶'} قائمة
            </button>
          </div>

          <div className="flex gap-1 text-[10px]">
            {(['normal', 'far', 'extreme'] as BulkSensitivity[]).map(s => (
              <button
                key={s}
                onClick={() => setBulkSensitivity(s)}
                className={`flex-1 py-1.5 rounded font-bold transition ${
                  bulkSensitivity === s
                    ? s === 'normal'
                      ? 'bg-blue-600 text-white'
                      : s === 'far'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                    : 'bg-white/10 text-gray-300'
                }`}
              >
                {s === 'normal' ? '⚡ قريب' : s === 'far' ? '🎯 متوازن' : '🔍 بعيد'}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'bulk' &&
        faceModelsReady &&
        cameraReady &&
        studentsWithFace.length === 0 && (
          <div className="mx-3 mt-2 p-3 bg-amber-900/40 border border-amber-500/30 rounded-lg text-center">
            <p className="text-xs text-amber-200 font-bold">⚠️ لا توجد بصمات مسجلة</p>
            <p className="text-[10px] text-amber-300 mt-1">
              أضف بصمات من زر "➕ إضافة بصمة"
            </p>
          </div>
        )}

      {/* ── خطأ ── */}
      {errorMsg && (
        <div className="mx-3 mt-2 p-3 bg-red-900/60 border border-red-500/40 rounded-xl text-center">
          <p className="text-red-200 text-xs mb-2">{errorMsg}</p>
          <button
            onClick={() => startCamera(facing)}
            className="bg-red-600 active:bg-red-700 px-4 py-2 rounded-lg text-xs font-bold"
          >
            🔄 إعادة المحاولة
          </button>
        </div>
      )}

      {/* ── المحتوى ── */}
      <div
        className={`flex-1 overflow-hidden flex ${
          isBulkMode && bulkShowSidebar
            ? 'flex-col lg:flex-row'
            : 'flex-col'
        }`}
      >
        <div className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* ── منطقة الكاميرا ── */}
          <div
            className={`w-full mx-auto rounded-xl overflow-hidden border bg-gray-900 relative ${
              isBulkMode
                ? 'max-w-3xl border-orange-500/30'
                : 'max-w-lg border-emerald-500/20'
            }`}
          >
            <div
              id={QR_REGION_ID}
              className={`w-full ${shouldMirrorVideo ? 'mirror-video' : ''}`}
              style={{ minHeight: isBulkMode ? '380px' : '260px' }}
            />

            {/* Canvas overlay */}
            {isBulkMode && cameraReady && (
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{ width: '100%', height: '100%' }}
              />
            )}

            {/* QR Frame */}
            {cameraReady && mode === 'qr' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div
                  className="relative"
                  style={{ width: getQrBox().width, height: getQrBox().height }}
                >
                  {[
                    'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                    'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                    'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                  ].map((cls, i) => (
                    <div
                      key={i}
                      className={`absolute w-8 h-8 border-emerald-400 ${cls}`}
                    />
                  ))}
                  <div className="absolute inset-x-2 h-px bg-emerald-400/80 animate-scan-line" />
                </div>
              </div>
            )}

            {/* أزرار */}
            {cameraReady && (
              <button
                onClick={toggleCamera}
                className="absolute top-2 left-2 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full z-10 active:scale-95"
              >
                🔄
              </button>
            )}
            {cameraReady && (
              <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full z-10">
                {isFrontCamera ? '📱 أمامية' : '📷 خلفية'}
                {isBulkMode && ' • 1080p'}
              </div>
            )}

            {/* عداد جماعي */}
            {isBulkMode && cameraReady && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-600 to-red-600 px-4 py-2 rounded-full shadow-xl z-10">
                <div className="flex items-center gap-2 text-white">
                  <span className="text-xl">📊</span>
                  <div className="text-center">
                    <div className="text-xl font-bold leading-none">
                      {bulkSessionStudents.length}
                    </div>
                    <div className="text-[9px] opacity-90">مسجّل</div>
                  </div>
                </div>
              </div>
            )}

            {/* زر إضافة بصمة (داخل الكاميرا) */}
            {isBulkMode && cameraReady && onUpdateStudent && (
              <button
                onClick={openFaceRegister}
                className="absolute top-2 left-12 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg z-10 shadow-lg active:scale-95"
              >
                ➕ بصمة
              </button>
            )}
          </div>

          {/* ── أدوات الكاميرا ── */}
          {cameraReady && (
            <div className="w-full max-w-lg mx-auto space-y-2">
              <div className="flex gap-1.5 flex-wrap items-center">
                {canZoom &&
                  [1, 1.5, 2, 2.5, 3]
                    .filter(v => v <= maxZoom)
                    .map(v => (
                      <button
                        key={v}
                        onClick={() => applyZoom(v)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 ${
                          Math.abs(zoom - v) < 0.15
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-gray-300'
                        }`}
                      >
                        {v}x
                      </button>
                    ))}

                {hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 ${
                      torchOn
                        ? 'bg-yellow-500 text-black'
                        : 'bg-white/10 text-gray-300'
                    }`}
                  >
                    {torchOn ? '💡 إطفاء' : '🔦 فلاش'}
                  </button>
                )}

                {mode === 'qr' && onUpdateStudent && (
                  <button
                    onClick={openFaceRegister}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md mr-auto"
                  >
                    ➕ إضافة بصمة
                  </button>
                )}
              </div>

              {canZoom && (
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-emerald-300 font-bold">
                      🔍 {zoom.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={minZoom}
                    max={maxZoom}
                    step={0.1}
                    value={zoom}
                    onChange={e => applyZoom(parseFloat(e.target.value))}
                    className="w-full h-1.5 accent-emerald-400 cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── إحصائيات QR ── */}
          {!isBulkMode && (
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg mx-auto">
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {scanCount}
                </div>
                <div className="text-[10px] text-gray-400">تم تسجيلهم</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-lg font-bold">
                  {cameraStatus === 'ready'      ? '🟢' :
                   cameraStatus === 'restarting' ? '🟡' : '🔴'}
                </div>
                <div className="text-[10px] text-gray-400">
                  {cameraStatus === 'ready'      ? 'تعمل' :
                   cameraStatus === 'restarting' ? 'تُعاد' : 'خطأ'}
                </div>
              </div>
            </div>
          )}

          {/* ── آخر المسجلين ── */}
          {!isBulkMode && recentStudents.length > 0 && (
            <div className="w-full max-w-lg mx-auto bg-white/5 rounded-lg p-2.5">
              <p className="text-[11px] font-bold mb-1.5 text-emerald-300">
                آخر المسجلين:
              </p>
              <div className="space-y-1">
                {recentStudents.map(s => (
                  <div
                    key={s.id}
                    className="flex justify-between items-center bg-black/30 rounded px-2.5 py-1.5"
                  >
                    <span className="text-xs font-medium truncate">{s.name}</span>
                    <span className="text-[10px] bg-emerald-700/80 px-1.5 py-0.5 rounded-full flex-shrink-0 mr-2">
                      {s.group || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── شريط جانبي جماعي ── */}
        {isBulkMode && bulkShowSidebar && (
          <div className="lg:w-80 bg-gray-900/98 border-t lg:border-t-0 lg:border-r border-white/10 flex flex-col max-h-[45vh] lg:max-h-none">
            <div className="p-3 border-b border-white/10 bg-gradient-to-r from-orange-900/40 to-red-900/40">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-orange-200">
                  📋 سجل الجلسة
                </h3>
                <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  {bulkSessionStudents.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {[
                  { val: bulkSessionStudents.length, color: 'emerald', label: 'مسجّل' },
                  { val: bulkDetectedCount,           color: 'blue',    label: 'مكتشف' },
                  {
                    val: Math.max(
                      0,
                      studentsWithFace.length - bulkSessionStudents.length
                    ),
                    color: 'orange',
                    label: 'متبقٍ',
                  },
                ].map(({ val, color, label }) => (
                  <div key={label} className="bg-white/8 rounded p-1.5">
                    <div className={`text-base font-bold text-${color}-400`}>
                      {val}
                    </div>
                    <div className="text-[9px] text-gray-300">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {bulkSessionStudents.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs">
                  <div className="text-3xl mb-2">👁️</div>
                  <p>وجّه الكاميرا نحو الطلاب...</p>
                  <p className="mt-1 text-[10px]">النظام يعمل تلقائياً</p>
                </div>
              ) : (
                bulkSessionStudents.map((s, idx) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 bg-emerald-900/25 border border-emerald-600/25 rounded-lg px-2.5 py-2"
                  >
                    <div className="bg-emerald-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-emerald-100 truncate">
                        {s.name}
                      </div>
                      <div className="text-[9px] text-emerald-400/70">
                        {s.code} {s.group ? `• ${s.group}` : ''}
                      </div>
                    </div>
                    <span className="text-emerald-400 text-sm flex-shrink-0">✓</span>
                  </div>
                ))
              )}
            </div>

            <div className="p-2 border-t border-white/10 bg-black/30 text-center">
              <p className="text-[9px] text-gray-500">
                إجمالي: {students.length} • بصمات: {studentsWithFace.length}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ══ Toasts ══ */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 z-[10001] flex flex-col gap-2 w-[92%] max-w-md pointer-events-none"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`bg-gradient-to-r ${toastBg[toast.type]} rounded-xl px-4 py-3 shadow-2xl animate-toast-drop`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl flex-shrink-0">{toastIcon[toast.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{toast.title}</p>
                {toast.text && (
                  <p className="text-xs opacity-90 truncate">{toast.text}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ══ QR Link Modal ══ */}
      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔗</div>
              <h3 className="text-lg font-bold">ربط هوية جديدة</h3>
              <p className="text-xs text-gray-500 mt-1">
                أدخل كود الطالب المكون من 4 أرقام
              </p>
            </div>

            <div
              className="bg-gray-100 rounded p-1.5 text-[10px] font-mono break-all mb-3 text-center"
              dir="ltr"
            >
              {pendingQrId.slice(0, 32)}
              {pendingQrId.length > 32 ? '...' : ''}
            </div>

            <input
              ref={qrCodeInputRef}
              type="text"
              value={qrLinkCode}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setQrLinkCode(val);
                setQrLinkMessage('');
                if (val.length === 4)
                  setTimeout(() => handleQrLinkByCode(val), 150);
              }}
              placeholder="0000"
              disabled={!onUpdateStudent}
              className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-emerald-300 rounded-xl outline-none focus:border-emerald-500"
              maxLength={4}
              inputMode="numeric"
              autoFocus
            />

            {qrLinkMessage && (
              <div
                className={`mt-3 p-2 rounded text-center text-xs font-medium ${
                  qrLinkMessage.includes('⚠️')
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {qrLinkMessage}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                onClick={() => {
                  setPendingQrId(null);
                  setQrLinkCode('');
                  setQrLinkMessage('');
                }}
                className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleQrLinkByCode(qrLinkCode)}
                disabled={qrLinkCode.length !== 4 || !onUpdateStudent}
                className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95 shadow-md"
              >
                🔗 ربط
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Face Register Modal ══ */}
      {showFaceRegister && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">

            {registerStep === 'code' && (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">📸</div>
                  <h3 className="text-lg font-bold">إضافة / تحديث بصمة</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    أدخل كود الطالب (4 أرقام)
                  </p>
                </div>

                <input
                  ref={codeInputRef}
                  type="text"
                  value={registerCode}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setRegisterCode(val);
                    if (registerMessage) setRegisterMessage('');
                    if (val.length === 4)
                      setTimeout(() => handleCodeSubmit(val), 100);
                  }}
                  placeholder="0000"
                  className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-purple-300 rounded-xl outline-none focus:border-purple-500"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                />

                {registerMessage && (
                  <div
                    className={`mt-3 p-2 rounded text-center text-xs font-medium ${
                      registerMessage.includes('♻️')
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {registerMessage}
                  </div>
                )}

                <div className="mt-3 p-2 bg-purple-50 border border-purple-100 rounded text-center">
                  <p className="text-[10px] text-purple-700">
                    💡 الالتقاط فوري بعد إدخال الكود
                  </p>
                </div>

                <button
                  onClick={() => {
                    setShowFaceRegister(false);
                    setRegisterCode('');
                    setRegisterMessage('');
                  }}
                  className="w-full mt-3 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm"
                >
                  إغلاق
                </button>
              </>
            )}

            {registerStep === 'capturing' && registerStudent && (
              <div className="text-center">
                <h3 className="text-lg font-bold mb-1">
                  {registerStudent.name}
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  {registerStudent.code} • {registerStudent.group || '-'}
                </p>

                <div className="relative inline-block mb-4">
                  <FaceCameraPreview mirror={isFrontCamera} />
                  <svg
                    className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
                    viewBox="0 0 200 200"
                  >
                    <circle
                      cx="100" cy="100" r="93"
                      fill="none"
                      stroke="rgba(139,92,246,0.15)"
                      strokeWidth="7"
                    />
                    <circle
                      cx="100" cy="100" r="93"
                      fill="none"
                      stroke={captureProgress >= 100 ? '#10b981' : '#8b5cf6'}
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 93}`}
                      strokeDashoffset={`${
                        2 * Math.PI * 93 * (1 - captureProgress / 100)
                      }`}
                      style={{
                        transition: 'stroke-dashoffset 0.08s linear, stroke 0.3s',
                      }}
                    />
                  </svg>
                </div>

                <p
                  className={`font-bold text-sm ${
                    captureProgress >= 100 ? 'text-green-600' : 'text-purple-700'
                  }`}
                >
                  {captureProgress >= 100
                    ? '✅ تم الالتقاط!'
                    : '📸 جارٍ التقاط الوجه...'}
                </p>
                <p className="text-xs text-gray-400 mt-1">انظر مباشرة للكاميرا</p>
              </div>
            )}

            {registerStep === 'success' && registerStudent && (
              <div className="text-center py-6">
                <div className="text-6xl mb-3 animate-bounce">🎉</div>
                <h3 className="text-xl font-bold text-green-700 mb-1">تم بنجاح!</h3>
                <p className="text-gray-800 font-bold text-lg">
                  {registerStudent.name}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {registerStudent.code} • {registerStudent.group || '-'}
                </p>
                <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs text-green-700 font-medium">
                    ✨ البصمة محفوظة • جاهز للطالب التالي...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ CSS ══ */}
      <style>{`
        @keyframes toastDrop {
          from { opacity: 0; transform: translateY(-24px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0)     scale(1);    }
        }
        .animate-toast-drop {
          animation: toastDrop 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }

        @keyframes scanLine {
          0%,100% { top: 8%;  opacity: 0.5; }
          50%      { top: 88%; opacity: 1;   }
        }
        .animate-scan-line {
          animation: scanLine 1.8s ease-in-out infinite;
          position: absolute;
        }

        .mirror-video video {
          transform: scaleX(-1) !important;
        }

        #${QR_REGION_ID} {
          border-radius: 0.75rem;
          overflow: hidden;
          background: #111;
        }
        #${QR_REGION_ID} video {
          width: 100% !important;
          height: auto !important;
          min-height: 260px !important;
          object-fit: cover !important;
          display: block !important;
        }
        #${QR_REGION_ID} img[alt="Info icon"],
        #${QR_REGION_ID} button,
        #${QR_REGION_ID} > div:last-child:not(:first-child) {
          display: none !important;
        }

        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.15);
          border-radius: 99px;
        }

        input[type="range"] {
          -webkit-appearance: none;
          background: rgba(255,255,255,0.1);
          border-radius: 99px;
          height: 4px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(16,185,129,0.5);
        }
      `}</style>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   FaceCameraPreview
══════════════════════════════════════════════════════════ */
const FaceCameraPreview: React.FC<{ mirror?: boolean }> = ({ mirror = true }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let active = true;

    const draw = () => {
      if (!active) return;

      const video = document.querySelector(
        `#${QR_REGION_ID} video`
      ) as HTMLVideoElement | null;

      if (video && video.readyState >= 2) {
        const size   = 200;
        canvas.width  = size;
        canvas.height = size;

        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
        ctx.clip();

        const vw     = video.videoWidth;
        const vh     = video.videoHeight;
        const minDim = Math.min(vw, vh);
        const sx     = (vw - minDim) / 2;
        const sy     = (vh - minDim) / 2;

        if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
        ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, size, size);
        ctx.restore();
      } else {
        canvas.width  = 200;
        canvas.height = 200;
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(100, 100, 96, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle   = '#6b7280';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.font        = '40px Arial';
        ctx.fillText('📷', 100, 100);
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      active = false;
      if (animId) cancelAnimationFrame(animId);
    };
  }, [mirror]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={200}
      className="w-48 h-48 rounded-full bg-gray-900 shadow-xl"
    />
  );
};

export default QRAttendance;