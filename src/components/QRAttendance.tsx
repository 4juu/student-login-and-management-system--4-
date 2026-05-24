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
  extractFaceDescriptorRich,
  averageDescriptors,
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

type ToastType = 'success' | 'error' | 'info' | 'warning';
type ScanMode = 'qr' | 'bulk';
type CameraFacing = 'environment' | 'user';
type BulkSensitivity = 'far' | 'extreme';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  text?: string;
}

interface DetectedFaceBox {
  box: { x: number; y: number; width: number; height: number };
  student: Student | null;
  status: 'recognized' | 'already' | 'unknown';
  confidence: number;
  timestamp: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
══════════════════════════════════════════════════════════ */
const QR_REGION_ID = 'qr-reader-v3';
const DUPLICATE_BLOCK_MS = 30_000;
const BULK_FACE_BLOCK_MS = 120_000;
const BOX_FADE_MS = 4000;
const CONFIDENCE_THRESHOLD = 0.44;
const CAPTURE_DURATION_MS = 2500;
const CAPTURE_FRAMES = 8;

/* ══════════════════════════════════════════════════════════
   Device capability
══════════════════════════════════════════════════════════ */
interface DeviceTier {
  tier: 'low' | 'mid' | 'high';
  cores: number;
  memory: number;
  fps: number;
  maxFaces: number;
  intervalMs: number;
  useHybrid: boolean;
  isMobile: boolean;
}

const detectDeviceTier = (): DeviceTier => {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  const screenW = window.innerWidth;

  if (cores >= 8 && memory >= 6)
    return { tier: 'high', cores, memory, fps: 30, maxFaces: 8, intervalMs: 300, useHybrid: true, isMobile };
  if (cores >= 4 && memory >= 3)
    return { tier: 'mid', cores, memory, fps: 20, maxFaces: 5, intervalMs: 450, useHybrid: false, isMobile };
  return {
    tier: 'low', cores, memory,
    fps: isMobile ? 8 : 10,
    maxFaces: isMobile ? 2 : 3,
    intervalMs: isMobile ? 900 : 700,
    useHybrid: false, isMobile,
  };
};

/* ══════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════ */
const extractQrCodeId = (text: string): string | null => {
  const raw = text.trim();
  try {
    const u = new URL(raw);
    const id = u.searchParams.get('id');
    if (id) return id.trim();
  } catch {}
  try {
    const o = JSON.parse(raw);
    const v = o.qrCodeId || o.qrId || o.id || o.studentId || o.universityId || o.code;
    if (v) return String(v).trim();
  } catch {}
  if (/^[A-Za-z0-9_-]{3,100}$/.test(raw)) return raw;
  return null;
};

const getQrBox = () => {
  const min = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(150, Math.min(280, Math.floor(min * 0.55)));
  return { width: size, height: size };
};

/* ─── Audio ─── */
const beep = (freq: number, dur: number, vol = 0.05) => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = vol;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur / 1000);
    setTimeout(() => ctx.close(), dur + 100);
  } catch {}
};
const playSuccess = () => { navigator.vibrate?.([50, 30, 50]); beep(880, 100); };
const playBulkSuccess = () => { navigator.vibrate?.(40); beep(1000, 80, 0.04); };
const playCapture = () => { navigator.vibrate?.(30); beep(1200, 50, 0.04); };
const playError = () => { navigator.vibrate?.([150]); beep(200, 200, 0.05); };

/* ─── Canvas helpers ─── */
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
  const device = useMemo(detectDeviceTier, []);

  /* ─── Refs ─── */
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const processingRef = useRef(false);
  const lastScansRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const faceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faceRunningRef = useRef(false);
  const faceBlockedUntil = useRef(0);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectedFacesRef = useRef<Map<string, DetectedFaceBox>>(new Map());
  const animFrameRef = useRef<number | null>(null);
  const lastRestartRef = useRef(0);
  const toastCounterRef = useRef(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const qrCodeInputRef = useRef<HTMLInputElement | null>(null);

  /* ─── State ─── */
  const [mode, setMode] = useState<ScanMode>('qr');
  const [facing, setFacing] = useState<CameraFacing>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const [recentStudents, setRecentStudents] = useState<Student[]>([]);
  const [pendingQrId, setPendingQrId] = useState<string | null>(null);
  const [qrLinkCode, setQrLinkCode] = useState('');
  const [qrLinkMessage, setQrLinkMessage] = useState('');
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [canZoom, setCanZoom] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [faceModelsReady, setFaceModelsReady] = useState(areModelsLoaded);
  const [faceLoading, setFaceLoading] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'error' | 'restarting'>('starting');
  const [bulkStudents, setBulkStudents] = useState<Student[]>([]);
  const [bulkDetected, setBulkDetected] = useState(0);
  const [bulkSidebar, setBulkSidebar] = useState(false);
  const [sensitivity, setSensitivity] = useState<BulkSensitivity>('far');

  /* Face Register */
  const [showRegister, setShowRegister] = useState(false);
  const [regCode, setRegCode] = useState('');
  const [regStep, setRegStep] = useState<'code' | 'capturing' | 'success'>('code');
  const [regStudent, setRegStudent] = useState<Student | null>(null);
  const [regMessage, setRegMessage] = useState('');
  const [regProgress, setRegProgress] = useState(0);

  /* تحذير البصمة المكررة */
  const [showDuplicateAlert, setShowDuplicateAlert] = useState(false);
  const [dupStudent, setDupStudent] = useState<Student | null>(null);

  /* فلتر المجموعات */
  const [filterGroup, setFilterGroup] = useState<string>('all');

  /* بحث في الشريط الجانبي */
  const [sidebarSearch, setSidebarSearch] = useState('');

  /* ─── Derived ─── */
  const studentMap = useMemo(() => {
    const m = new Map<string, Student>();
    students.forEach((s) => {
      if (s.qrCodeId) m.set(s.qrCodeId.trim(), s);
      if (s.universityId) m.set(s.universityId.trim(), s);
    });
    return m;
  }, [students]);

  const studentsWithFace = useMemo(
    () => students.filter((s) => s.faceDescriptor && s.faceDescriptor.length > 0),
    [students]
  );

  const groups = useMemo(
    () => Array.from(new Set(students.map((s) => s.group).filter(Boolean))) as string[],
    [students]
  );

  const filteredFaces = useMemo(
    () =>
      filterGroup === 'all'
        ? studentsWithFace
        : studentsWithFace.filter((s) => s.group === filterGroup),
    [studentsWithFace, filterGroup]
  );

  const filteredBulkStudents = useMemo(
    () =>
      sidebarSearch.trim()
        ? bulkStudents.filter(
            (s) =>
              s.name.includes(sidebarSearch) ||
              s.code?.includes(sidebarSearch) ||
              s.group?.includes(sidebarSearch)
          )
        : bulkStudents,
    [bulkStudents, sidebarSearch]
  );

  /* ─── Toast ─── */
  const showToast = useCallback((msg: Omit<ToastMessage, 'id'>, ms = 2500) => {
    const id = ++toastCounterRef.current;
    setToasts((prev) => [{ ...msg, id }, ...prev].slice(0, 4));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }, []);

  /* ══════════════════════════════════════════════════════
     إيقاف كل شيء
  ══════════════════════════════════════════════════════ */
  const hardStop = useCallback(async () => {
    faceRunningRef.current = false;
    if (faceTimerRef.current) { clearTimeout(faceTimerRef.current); faceTimerRef.current = null; }
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }

    if (trackRef.current && torchOn) {
      try { await trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] }); } catch {}
    }

    if (scannerRef.current) {
      try {
        const st = scannerRef.current.getState();
        if (st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED)
          await scannerRef.current.stop();
      } catch {}
      try { await scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }

    if (trackRef.current) { try { trackRef.current.stop(); } catch {} trackRef.current = null; }

    const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
    if (vid?.srcObject) {
      try { (vid.srcObject as MediaStream).getTracks().forEach((t) => t.stop()); vid.srcObject = null; } catch {}
    }

    const reg = document.getElementById(QR_REGION_ID);
    if (reg) reg.innerHTML = '';
  }, [torchOn]);

  /* ══════════════════════════════════════════════════════
     تشغيل الكاميرا
  ══════════════════════════════════════════════════════ */
  const startCamera = useCallback(
    async (cf: CameraFacing) => {
      if (!mountedRef.current || startingRef.current) return;
      startingRef.current = true;
      setCameraStatus('starting');
      setErrorMsg('');
      setCameraReady(false);

      try {
        await hardStop();
        await new Promise((r) => setTimeout(r, 400));
        if (!mountedRef.current) return;

        const region = document.getElementById(QR_REGION_ID);
        if (region) region.innerHTML = '';

        const qrBox = getQrBox();
        const fps = device.fps;

        const attempts = [
          {
            constraints: {
              facingMode: cf,
              width: { ideal: device.isMobile ? 1280 : 1920, min: 640 },
              height: { ideal: device.isMobile ? 720 : 1080, min: 480 },
              frameRate: { ideal: device.isMobile ? 30 : 60, min: 15 },
            },
            fps,
            box: qrBox,
          },
          {
            constraints: { facingMode: cf, width: { ideal: 1280 }, height: { ideal: 720 } },
            fps: Math.min(fps, 20),
            box: qrBox,
          },
          { constraints: { facingMode: cf }, fps: 10, box: { width: 200, height: 200 } },
        ];

        let scanner: Html5Qrcode | null = null;
        for (const att of attempts) {
          try {
            const s = new Html5Qrcode(QR_REGION_ID, { verbose: false });
            await s.start(
              { facingMode: cf },
              {
                fps: att.fps,
                qrbox: att.box,
                aspectRatio: window.innerHeight > window.innerWidth ? 4 / 3 : 16 / 9,
                disableFlip: true,
                videoConstraints: att.constraints,
              },
              onDecoded,
              () => {}
            );
            scanner = s;
            break;
          } catch (e) {
            console.warn('camera attempt failed:', e);
            const r2 = document.getElementById(QR_REGION_ID);
            if (r2) r2.innerHTML = '';
            await new Promise((r) => setTimeout(r, 350));
          }
        }

        if (!scanner || !mountedRef.current) {
          if (scanner) { try { await scanner.stop(); } catch {} }
          throw new Error('كل المحاولات فشلت');
        }

        scannerRef.current = scanner;

        await new Promise((r) => setTimeout(r, 500));
        const vid = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
        if (vid?.srcObject) {
          const track = (vid.srcObject as MediaStream).getVideoTracks()[0];
          if (track) {
            trackRef.current = track;
            const caps = (track.getCapabilities?.() || {}) as any;

            for (const [cap, val] of [
              ['focusMode', 'continuous'],
              ['exposureMode', 'continuous'],
              ['whiteBalanceMode', 'continuous'],
            ] as const) {
              if (caps[cap]?.includes?.(val))
                try { await track.applyConstraints({ advanced: [{ [cap]: val } as any] }); } catch {}
            }

            if (caps.zoom && caps.zoom.max > caps.zoom.min) {
              setMinZoom(caps.zoom.min);
              setMaxZoom(caps.zoom.max);
              setCanZoom(true);
              try {
                await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as any] });
                setZoom(caps.zoom.min);
              } catch {}
            } else {
              setCanZoom(false);
              setMinZoom(1);
              setMaxZoom(1);
            }

            setHasTorch(!!caps.torch);
          }
        }

        if (mountedRef.current) {
          setCameraReady(true);
          setCameraStatus('ready');
        }
      } catch (err: any) {
        if (!mountedRef.current) return;
        setCameraStatus('error');
        const msg = err?.message || '';
        if (msg.includes('NotAllowed') || msg.includes('Permission'))
          setErrorMsg('يرجى السماح باستخدام الكاميرا');
        else if (msg.includes('NotFound'))
          setErrorMsg('لا توجد كاميرا متاحة');
        else if (msg.includes('NotReadable') || msg.includes('TrackStartError'))
          setErrorMsg('الكاميرا مستخدمة من تطبيق آخر');
        else setErrorMsg(`فشل تشغيل الكاميرا: ${msg.slice(0, 60)}`);

        setTimeout(() => {
          if (mountedRef.current) startCamera(cf);
        }, 4000);
      } finally {
        startingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, hardStop]
  );

  /* ─── QR decode ─── */
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
            showToast({ type: 'warning', title: '⚠️ مسجل مسبقاً', text: student.name }, 1500);
            return;
          }
          await onMarkAttendance(student);
          setScanCount((c) => c + 1);
          setRecentStudents((prev) => [student, ...prev.filter((s) => s.id !== student.id)].slice(0, 8));
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

  /* ─── Zoom / Torch ─── */
  const applyZoom = useCallback(
    async (val: number) => {
      if (!trackRef.current || !canZoom) return;
      const c = Math.max(minZoom, Math.min(maxZoom, val));
      try { await trackRef.current.applyConstraints({ advanced: [{ zoom: c } as any] }); setZoom(c); } catch {}
    },
    [canZoom, minZoom, maxZoom]
  );

  const toggleTorch = useCallback(async () => {
    if (!trackRef.current || !hasTorch) return;
    const next = !torchOn;
    try { await trackRef.current.applyConstraints({ advanced: [{ torch: next } as any] }); setTorchOn(next); } catch {}
  }, [hasTorch, torchOn]);

  const toggleCamera = useCallback(async () => {
    if (startingRef.current) return;
    const nf: CameraFacing = facing === 'environment' ? 'user' : 'environment';
    setFacing(nf);
    await startCamera(nf);
  }, [facing, startCamera]);

  /* ══════════════════════════════════════════════════════
     تحميل الموديلات
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
        if (attempt < 5) {
          resetModels();
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          return load(attempt + 1);
        }
        showToast({ type: 'error', title: '❌ فشل تحميل نظام التعرف' }, 5000);
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
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
      return;
    }

    const canvas = overlayCanvasRef.current;
    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
    if (!canvas || !video) return;

    const isFrontCam = facing === 'user';

    const draw = () => {
      if (!mountedRef.current) return;
      if (!canvas || !video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const rect = video.getBoundingClientRect();
      if (Math.abs(canvas.width - rect.width) > 1 || Math.abs(canvas.height - rect.height) > 1) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) { animFrameRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = Date.now();
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const sx = canvas.width / vw;
      const sy = canvas.height / vh;
      let visible = 0;

      detectedFacesRef.current.forEach((face, key) => {
        const age = now - face.timestamp;
        if (age > BOX_FADE_MS) { detectedFacesRef.current.delete(key); return; }
        visible++;

        const opacity = age < 200 ? age / 200 : Math.max(0.35, 1 - (age - 200) / BOX_FADE_MS);

        let stroke = '#ef4444', bg = 'rgba(239,68,68,0.85)', label = '❓ مجهول';
        if (face.status === 'recognized') {
          stroke = '#10b981'; bg = 'rgba(16,185,129,0.92)'; label = face.student?.name || '';
        } else if (face.status === 'already') {
          stroke = '#f59e0b'; bg = 'rgba(245,158,11,0.92)'; label = `✓ ${face.student?.name || ''}`;
        }

        let dx = face.box.x * sx;
        const dy = face.box.y * sy, dw = face.box.width * sx, dh = face.box.height * sy;
        if (isFrontCam) dx = canvas.width - dx - dw;

        ctx.globalAlpha = opacity;
        ctx.shadowColor = stroke;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.shadowBlur = 0;

        const cl = Math.max(12, Math.min(24, dw * 0.2));
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.moveTo(dx, dy + cl); ctx.lineTo(dx, dy); ctx.lineTo(dx + cl, dy);
        ctx.moveTo(dx + dw - cl, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + cl);
        ctx.moveTo(dx + dw, dy + dh - cl); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw - cl, dy + dh);
        ctx.moveTo(dx + cl, dy + dh); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx, dy + dh - cl);
        ctx.stroke();

        if (label && face.status !== 'unknown') {
          const fs = Math.max(10, Math.min(15, dw / 8));
          ctx.font = `bold ${fs}px Arial,sans-serif`;
          const tw = ctx.measureText(label).width, pad = 6, bw = tw + pad * 2, bh = fs + pad;
          const bx = dx + (dw - bw) / 2, by = dy - bh - 5;

          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 2;
          ctx.fillStyle = bg;
          drawRoundedRect(ctx, bx, by, bw, bh, 5);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;

          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, bx + bw / 2, by + bh / 2);

          if (face.confidence > 0 && face.status === 'recognized') {
            const cl2 = `${face.confidence}%`, cf = Math.max(9, fs - 3);
            ctx.font = `bold ${cf}px Arial`;
            const cw = ctx.measureText(cl2).width + 8, ch = cf + 4;
            const cx2 = dx + (dw - cw) / 2, cy2 = dy + dh + 3;
            ctx.fillStyle = bg;
            drawRoundedRect(ctx, cx2, cy2, cw, ch, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(cl2, cx2 + cw / 2, cy2 + ch / 2);
          }
        }
        ctx.globalAlpha = 1;
      });

      setBulkDetected(visible);
      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    };
  }, [mode, cameraReady, facing]);

  /* ══════════════════════════════════════════════════════
     Face Recognition Loop
  ══════════════════════════════════════════════════════ */
  const stopFaceLoop = useCallback(() => {
    faceRunningRef.current = false;
    if (faceTimerRef.current) { clearTimeout(faceTimerRef.current); faceTimerRef.current = null; }
  }, []);

  const startFaceLoop = useCallback(
    (sens: BulkSensitivity, cf: CameraFacing, faces: Student[]) => {
      stopFaceLoop();
      faceRunningRef.current = true;

      const intervalMs = sens === 'extreme' ? device.intervalMs * 0.6 : device.intervalMs;
      const FRAME_TIMEOUT = 3000;

      const loop = async () => {
        if (!faceRunningRef.current || !mountedRef.current) return;

        if (document.hidden) {
          faceTimerRef.current = setTimeout(loop, 500) as any;
          return;
        }
        if (showRegister) {
          faceTimerRef.current = setTimeout(loop, 400) as any;
          return;
        }

        const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
        if (!video || video.readyState < 2 || video.paused || video.ended) {
          const now = Date.now();
          if (now - lastRestartRef.current > 6000 && mountedRef.current) {
            lastRestartRef.current = now;
            setCameraStatus('restarting');
            setTimeout(() => { if (mountedRef.current) startCamera(cf); }, 300);
          }
          faceTimerRef.current = setTimeout(loop, 600) as any;
          return;
        }

        faceBlockedUntil.current = Date.now() + FRAME_TIMEOUT;

        try {
          const useH = sens === 'extreme' ? true : device.useHybrid;

          const detections = (await Promise.race([
            useH
              ? extractAllFaceDescriptorsHybrid(video)
              : extractAllFaceDescriptors(video),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('timeout')), FRAME_TIMEOUT - 200)
            ),
          ])) as Awaited<ReturnType<typeof extractAllFaceDescriptorsHybrid>>;

          if (!faceRunningRef.current || !mountedRef.current) return;

          const limited = detections.slice(0, device.maxFaces);

          for (const det of limited) {
            if (!faceRunningRef.current) break;
            const box = det.detection.box;
            const boxKey = `${Math.round(box.x / 35)}_${Math.round(box.y / 35)}_${Math.round(box.width / 35)}`;
            const now = Date.now();
            const match = findBestMatch(det.descriptor, faces, CONFIDENCE_THRESHOLD);

            if (match) {
              const s = match.item;
              const alrPresent = alreadyPresentIds.has(s.id);
              const recentlySeen = now - (lastScansRef.current[`bulk_${s.id}`] || 0) < BULK_FACE_BLOCK_MS;

              if (alrPresent || recentlySeen) {
                detectedFacesRef.current.set(boxKey, {
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                  student: s, status: 'already', confidence: match.confidence, timestamp: now,
                });
              } else {
                lastScansRef.current[`bulk_${s.id}`] = now;
                detectedFacesRef.current.set(boxKey, {
                  box: { x: box.x, y: box.y, width: box.width, height: box.height },
                  student: s, status: 'recognized', confidence: match.confidence, timestamp: now,
                });
                await onMarkAttendance(s);
                setScanCount((c) => c + 1);
                setBulkStudents((prev) => [s, ...prev.filter((x) => x.id !== s.id)]);
                setRecentStudents((prev) => [s, ...prev.filter((x) => x.id !== s.id)].slice(0, 8));
                playBulkSuccess();
                showToast(
                  { type: 'success', title: `✅ ${s.name}`, text: `${s.group || ''} • ${match.confidence}%` },
                  2000
                );
              }
            } else {
              detectedFacesRef.current.set(boxKey, {
                box: { x: box.x, y: box.y, width: box.width, height: box.height },
                student: null, status: 'unknown', confidence: 0, timestamp: now,
              });
            }
          }
        } catch (e: any) {
          if (e?.message !== 'timeout') console.warn('face loop:', e);
        } finally {
          faceBlockedUntil.current = 0;
        }

        if (faceRunningRef.current && mountedRef.current) {
          faceTimerRef.current = setTimeout(loop, intervalMs) as any;
        }
      };

      faceTimerRef.current = setTimeout(loop, 600) as any;
    },
    [device, stopFaceLoop, alreadyPresentIds, onMarkAttendance, showToast, showRegister] // eslint-disable-line
  );

  /* ─── تفعيل / إيقاف ─── */
  useEffect(() => {
    if (mode === 'bulk' && cameraReady && faceModelsReady && filteredFaces.length > 0)
      startFaceLoop(sensitivity, facing, filteredFaces);
    else stopFaceLoop();
    return () => stopFaceLoop();
  }, [mode, cameraReady, faceModelsReady, filteredFaces, sensitivity, facing, startFaceLoop, stopFaceLoop]);

  /* ─── استمرارية ─── */
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (mode === 'bulk' && cameraReady && faceModelsReady && filteredFaces.length > 0 && !faceRunningRef.current)
        startFaceLoop(sensitivity, facing, filteredFaces);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [mode, cameraReady, faceModelsReady, filteredFaces, sensitivity, facing, startFaceLoop]);

  /* ══════════════════════════════════════════════════════
     Mount / Unmount
  ══════════════════════════════════════════════════════ */
  useEffect(() => {
    mountedRef.current = true;

    // منع zoom في الموبايل
    const meta = document.querySelector('meta[name="viewport"]');
    const origContent = meta?.getAttribute('content') || '';
    if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');

    const t = setTimeout(() => { if (mountedRef.current) startCamera('environment'); }, 250);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
      stopFaceLoop();
      hardStop();
      if (meta && origContent) meta.setAttribute('content', origContent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    detectedFacesRef.current.clear();
    if (mode === 'bulk' && facing !== 'environment') {
      setFacing('environment');
      startCamera('environment');
    }
  }, [mode]); // eslint-disable-line

  const handleClose = useCallback(async () => {
    mountedRef.current = false;
    stopFaceLoop();
    await hardStop();
    await new Promise((r) => setTimeout(r, 150));
    onClose();
  }, [hardStop, stopFaceLoop, onClose]);

  /* ══════════════════════════════════════════════════════
     QR Link
  ══════════════════════════════════════════════════════ */
  const handleQrLinkByCode = useCallback(
    async (code: string) => {
      if (!pendingQrId || !onUpdateStudent) return;
      if (code.length !== 4) { setQrLinkMessage('❌ الكود 4 أرقام'); return; }
      const student = students.find((s) => s.code === code);
      if (!student) { setQrLinkMessage('❌ لا يوجد طالب'); playError(); return; }
      if (student.qrCodeId) { setQrLinkMessage(`⚠️ ${student.name} لديه QR`); playError(); return; }

      const updated = { ...student, qrCodeId: pendingQrId };
      onUpdateStudent(student.id, { qrCodeId: pendingQrId });
      const qrId = pendingQrId;
      setPendingQrId(null);
      setQrLinkCode('');
      setQrLinkMessage('');
      lastScansRef.current[qrId] = Date.now();

      if (!alreadyPresentIds.has(student.id)) {
        await onMarkAttendance(updated);
        setScanCount((c) => c + 1);
        setRecentStudents((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)].slice(0, 8));
        playSuccess();
        showToast({ type: 'success', title: `✅ ${updated.name}`, text: 'تم الربط والتسجيل' });
      }
    },
    [pendingQrId, onUpdateStudent, students, alreadyPresentIds, onMarkAttendance, showToast]
  );

  /* ══════════════════════════════════════════════════════
     Face Register
  ══════════════════════════════════════════════════════ */
  const openRegister = useCallback(async () => {
    if (facing !== 'user') { setFacing('user'); await startCamera('user'); }
    setRegCode(''); setRegStep('code'); setRegStudent(null); setRegMessage(''); setRegProgress(0);
    setShowRegister(true);
    setTimeout(() => codeInputRef.current?.focus(), 300);
  }, [facing, startCamera]);

  const captureFace = useCallback(
    async (student: Student) => {
      if (!onUpdateStudent) return;

      if (student.faceDescriptor && student.faceDescriptor.length > 0) {
        setDupStudent(student);
        setShowDuplicateAlert(true);
        playError();
        setRegStep('code');
        setRegCode('');
        return;
      }

      const getVid = () =>
        document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;

      const vid = getVid();
      if (!vid || vid.readyState < 2) {
        setRegMessage('❌ الكاميرا غير جاهزة...');
        setTimeout(() => {
          const v2 = getVid();
          if (v2 && v2.readyState >= 2) captureFace(student);
          else { setRegStep('code'); setRegMessage('❌ الكاميرا لم تستجب'); }
        }, 1500);
        return;
      }

      setRegStep('capturing');
      setRegProgress(0);

      try {
        playCapture();

        const descriptors: Float32Array[] = [];
        const startTime = Date.now();
        const interval = Math.floor(CAPTURE_DURATION_MS / CAPTURE_FRAMES);

        for (let i = 0; i < CAPTURE_FRAMES; i++) {
          if (!mountedRef.current) return;

          const progress = Math.round(((i + 1) / CAPTURE_FRAMES) * 90);
          setRegProgress(progress);

          const v = getVid();
          if (v && v.readyState >= 2) {
            try {
              const desc = await extractFaceDescriptorRich(v);
              if (desc) descriptors.push(desc);
            } catch {}
          }

          const elapsed = Date.now() - startTime;
          const expected = (i + 1) * interval;
          const wait = Math.max(0, expected - elapsed);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }

        if (!mountedRef.current) return;

        if (descriptors.length === 0) {
          setRegProgress(0);
          setRegStep('code');
          setRegMessage('❌ لم يُرَ الوجه - ابتعد قليلاً وانظر للكاميرا');
          playError();
          setTimeout(() => codeInputRef.current?.focus(), 100);
          return;
        }

        const avgDescriptor = averageDescriptors(descriptors);
        setRegProgress(100);

        onUpdateStudent(student.id, {
          faceDescriptor: descriptorToArray(avgDescriptor),
          faceRegisteredAt: new Date().toISOString(),
        });

        playSuccess();
        setRegStep('success');

        setTimeout(() => {
          if (!mountedRef.current) return;
          setRegCode('');
          setRegStudent(null);
          setRegMessage('');
          setRegProgress(0);
          setRegStep('code');
          setTimeout(() => codeInputRef.current?.focus(), 100);
        }, 1800);
      } catch {
        setRegProgress(0);
        setRegStep('code');
        setRegMessage('❌ حدث خطأ - حاول مجدداً');
        playError();
      }
    },
    [onUpdateStudent] // eslint-disable-line
  );

  const handleCodeSubmit = useCallback(
    async (code: string) => {
      if (code.length !== 4) return;
      const student = students.find((s) => s.code === code);
      if (!student) {
        setRegMessage('❌ لا يوجد طالب بهذا الكود');
        playError();
        setRegCode('');
        setTimeout(() => codeInputRef.current?.focus(), 100);
        return;
      }

      if (student.faceDescriptor && student.faceDescriptor.length > 0) {
        setDupStudent(student);
        setShowDuplicateAlert(true);
        playError();
        setRegCode('');
        return;
      }

      setRegStudent(student);
      await captureFace(student);
    },
    [students, captureFace]
  );

  /* ══════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════ */
  const isBulk = mode === 'bulk';
  const isFront = facing === 'user';
  const doMirror = isFront;
  const isSmall = window.innerWidth < 640;

  const toastBg: Record<ToastType, string> = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-rose-600',
    info: 'from-blue-500 to-cyan-600',
    warning: 'from-amber-500 to-orange-500',
  };
  const toastIcon: Record<ToastType, string> = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col overflow-hidden" dir="rtl">
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 bg-gray-900/95 border-b border-white/10 flex-shrink-0"
        style={{ paddingTop: 'max(0.25rem,env(safe-area-inset-top))' }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-xs sm:text-sm font-bold flex items-center gap-1 truncate">
            {isBulk ? '🎯 جماعي' : '🔳 QR'}
            {cameraStatus === 'restarting' && (
              <span className="text-[8px] sm:text-[9px] bg-yellow-600 px-1 py-0.5 rounded-full animate-pulse">
                إعادة...
              </span>
            )}
          </h2>
          <p className="text-[9px] sm:text-[10px] text-gray-400 truncate">
            {activeSession ? activeSession.name : 'لا يوجد سجل'}
            {' • '}
            {device.tier === 'high' ? '🚀' : device.tier === 'mid' ? '⚡' : '🔋'}
            {device.isMobile ? ' 📱' : ' 💻'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div
            className={`flex items-center gap-1 text-[8px] sm:text-[9px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full ${
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
            {cameraStatus === 'ready' ? 'مباشر' : cameraStatus === 'restarting' ? 'يُعاد' : cameraStatus === 'error' ? 'خطأ' : 'تهيؤ'}
          </div>
          <button
            onClick={handleClose}
            className="bg-red-600 active:bg-red-700 text-white px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold active:scale-95"
          >
            ✕
          </button>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="px-2 sm:px-3 py-1.5 sm:py-2 bg-gray-900/70 border-b border-white/5 flex gap-1 sm:gap-1.5 flex-shrink-0">
        {(['qr', 'bulk'] as ScanMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 sm:py-2.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all active:scale-95 ${
              mode === m
                ? m === 'qr'
                  ? 'bg-emerald-600 text-white shadow-lg'
                  : 'bg-gradient-to-r from-orange-600 to-red-600 text-white shadow-lg'
                : 'bg-white/8 text-gray-300'
            }`}
          >
            {m === 'qr' ? '🔳 QR' : '🎯 جماعي'}
          </button>
        ))}
      </div>

      {/* ── تحميل الموديلات ── */}
      {isBulk && faceLoading && (
        <div className="mx-2 sm:mx-3 mt-1.5 sm:mt-2 p-2 sm:p-3 bg-purple-900/50 border border-purple-500/40 rounded-lg flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="text-[10px] sm:text-xs font-bold text-purple-200">جاري تحميل نظام التعرف...</p>
            <p className="text-[9px] sm:text-[10px] text-purple-400">قد يستغرق بضع ثوان</p>
          </div>
        </div>
      )}

      {/* ── شريط الوضع الجماعي + فلتر المجموعات ── */}
      {isBulk && faceModelsReady && cameraReady && (
        <div className="mx-2 sm:mx-3 mt-1.5 sm:mt-2 space-y-1.5 flex-shrink-0">
          {/* معلومات */}
          <div className="p-2 bg-gradient-to-r from-orange-900/50 to-red-900/50 border border-orange-500/30 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] sm:text-[11px] text-orange-200 font-bold">
                  🎯 {filteredFaces.length} بصمة
                  {filterGroup !== 'all' && ` (${filterGroup})`}
                  {' • '}{bulkDetected} مكتشف
                </p>
                <p className="text-[9px] sm:text-[10px] text-orange-300">
                  🟢 معروف • 🟡 مسجّل • 🔴 مجهول
                </p>
              </div>
              <button
                onClick={() => setBulkSidebar((s) => !s)}
                className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[9px] sm:text-[10px] font-bold"
              >
                {bulkSidebar ? '◀' : '▶'} قائمة
              </button>
            </div>

            {/* حساسية */}
            <div className="flex gap-1 sm:gap-1.5 text-[9px] sm:text-[10px]">
              <button
                onClick={() => setSensitivity('far')}
                className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold transition active:scale-95 ${
                  sensitivity === 'far' ? 'bg-emerald-600 text-white shadow-md' : 'bg-white/10 text-gray-300'
                }`}
              >
                🎯 متوازن
              </button>
              <button
                onClick={() => setSensitivity('extreme')}
                className={`flex-1 py-1.5 sm:py-2 rounded-lg font-bold transition active:scale-95 ${
                  sensitivity === 'extreme' ? 'bg-red-600 text-white shadow-md' : 'bg-white/10 text-gray-300'
                }`}
              >
                🔍 بعيد
              </button>
            </div>
          </div>

          {/* ── فلتر المجموعات ── */}
          {groups.length > 0 && (
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
              <button
                onClick={() => setFilterGroup('all')}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-bold whitespace-nowrap flex-shrink-0 transition active:scale-95 ${
                  filterGroup === 'all'
                    ? 'bg-white text-black shadow-md'
                    : 'bg-white/10 text-gray-300'
                }`}
              >
                الكل ({studentsWithFace.length})
              </button>
              {groups.map((g) => {
                const count = studentsWithFace.filter((s) => s.group === g).length;
                if (count === 0) return null;
                return (
                  <button
                    key={g}
                    onClick={() => setFilterGroup(g)}
                    className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] font-bold whitespace-nowrap flex-shrink-0 transition active:scale-95 ${
                      filterGroup === g
                        ? 'bg-orange-500 text-white shadow-md'
                        : 'bg-white/10 text-gray-300'
                    }`}
                  >
                    {g} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isBulk && faceModelsReady && cameraReady && filteredFaces.length === 0 && (
        <div className="mx-2 sm:mx-3 mt-1.5 p-2 sm:p-3 bg-amber-900/40 border border-amber-500/30 rounded-lg text-center flex-shrink-0">
          <p className="text-[10px] sm:text-xs text-amber-200 font-bold">
            {filterGroup !== 'all'
              ? `⚠️ لا توجد بصمات في "${filterGroup}"`
              : '⚠️ لا توجد بصمات مسجلة'}
          </p>
          <p className="text-[9px] sm:text-[10px] text-amber-300 mt-1">
            {filterGroup !== 'all'
              ? 'جرّب اختيار "الكل" أو مجموعة أخرى'
              : 'أضف بصمات من زر "➕ إضافة بصمة"'}
          </p>
        </div>
      )}

      {/* ── خطأ ── */}
      {errorMsg && (
        <div className="mx-2 sm:mx-3 mt-1.5 p-2 sm:p-3 bg-red-900/60 border border-red-500/40 rounded-xl text-center flex-shrink-0">
          <p className="text-red-200 text-[10px] sm:text-xs mb-2">{errorMsg}</p>
          <button
            onClick={() => startCamera(facing)}
            className="bg-red-600 active:bg-red-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-xs font-bold"
          >
            🔄 إعادة
          </button>
        </div>
      )}

      {/* ── المحتوى الرئيسي ── */}
      <div
        className={`flex-1 overflow-hidden flex ${
          isBulk && bulkSidebar ? 'flex-col lg:flex-row' : 'flex-col'
        }`}
      >
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2 sm:space-y-3">
          {/* ── الكاميرا ── */}
          <div
            className={`w-full mx-auto rounded-xl overflow-hidden border bg-gray-900 relative ${
              isBulk
                ? 'max-w-full sm:max-w-3xl border-orange-500/30'
                : 'max-w-full sm:max-w-lg border-emerald-500/20'
            }`}
          >
            <div
              id={QR_REGION_ID}
              className={`w-full ${doMirror ? 'mirror-video' : ''}`}
              style={{
                minHeight: isBulk
                  ? isSmall ? '50vh' : '380px'
                  : isSmall ? '45vh' : '260px',
              }}
            />

            {isBulk && cameraReady && (
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{ width: '100%', height: '100%' }}
              />
            )}

            {cameraReady && !isBulk && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative" style={{ width: getQrBox().width, height: getQrBox().height }}>
                  {[
                    'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                    'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                    'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                  ].map((c, i) => (
                    <div key={i} className={`absolute w-6 sm:w-8 h-6 sm:h-8 border-emerald-400 ${c}`} />
                  ))}
                  <div className="absolute inset-x-2 h-px bg-emerald-400/80 animate-scan-line" />
                </div>
              </div>
            )}

            {/* أزرار فوق الكاميرا */}
            {cameraReady && (
              <button
                onClick={toggleCamera}
                className="absolute top-1.5 sm:top-2 left-1.5 sm:left-2 bg-black/60 hover:bg-black/80 text-white p-1.5 sm:p-2 rounded-full z-10 active:scale-95 text-sm"
              >
                🔄
              </button>
            )}
            {cameraReady && (
              <div className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 bg-black/60 text-white text-[8px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full z-10">
                {isFront ? '📱' : '📷'}
                {isBulk && ' HD'}
              </div>
            )}

            {isBulk && cameraReady && (
              <div className="absolute bottom-1.5 sm:bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-600 to-red-600 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow-xl z-10">
                <div className="flex items-center gap-1.5 sm:gap-2 text-white">
                  <span className="text-base sm:text-xl">📊</span>
                  <div className="text-center">
                    <div className="text-base sm:text-xl font-bold leading-none">{bulkStudents.length}</div>
                    <div className="text-[7px] sm:text-[9px] opacity-90">مسجّل</div>
                  </div>
                </div>
              </div>
            )}

            {isBulk && cameraReady && onUpdateStudent && (
              <button
                onClick={openRegister}
                className="absolute top-1.5 sm:top-2 left-10 sm:left-12 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-[8px] sm:text-[10px] font-bold px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg z-10 shadow-lg active:scale-95"
              >
                ➕ بصمة
              </button>
            )}
          </div>

          {/* ── أدوات ── */}
          {cameraReady && (
            <div className="w-full max-w-full sm:max-w-lg mx-auto space-y-1.5 sm:space-y-2">
              <div className="flex gap-1 sm:gap-1.5 flex-wrap items-center">
                {canZoom &&
                  [1, 1.5, 2, 2.5, 3]
                    .filter((v) => v <= maxZoom)
                    .map((v) => (
                      <button
                        key={v}
                        onClick={() => applyZoom(v)}
                        className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold active:scale-95 ${
                          Math.abs(zoom - v) < 0.15 ? 'bg-emerald-600 text-white' : 'bg-white/10 text-gray-300'
                        }`}
                      >
                        {v}x
                      </button>
                    ))}
                {hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold active:scale-95 ${
                      torchOn ? 'bg-yellow-500 text-black' : 'bg-white/10 text-gray-300'
                    }`}
                  >
                    {torchOn ? '💡' : '🔦'}
                  </button>
                )}
                {!isBulk && onUpdateStudent && (
                  <button
                    onClick={openRegister}
                    className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold active:scale-95 bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md mr-auto"
                  >
                    ➕ بصمة
                  </button>
                )}
              </div>
              {canZoom && (
                <div className="bg-white/5 rounded-lg p-1.5 sm:p-2">
                  <p className="text-[9px] sm:text-[10px] text-emerald-300 font-bold mb-1">
                    🔍 {zoom.toFixed(1)}x
                  </p>
                  <input
                    type="range"
                    min={minZoom}
                    max={maxZoom}
                    step={0.1}
                    value={zoom}
                    onChange={(e) => applyZoom(parseFloat(e.target.value))}
                    className="w-full h-1.5 accent-emerald-400 cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── إحصائيات QR ── */}
          {!isBulk && (
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 w-full max-w-full sm:max-w-lg mx-auto">
              <div className="bg-white/5 rounded-lg p-2 sm:p-2.5 text-center">
                <div className="text-xl sm:text-2xl font-bold text-emerald-400">{scanCount}</div>
                <div className="text-[9px] sm:text-[10px] text-gray-400">تم تسجيلهم</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2 sm:p-2.5 text-center">
                <div className="text-base sm:text-lg font-bold">
                  {cameraStatus === 'ready' ? '🟢' : cameraStatus === 'restarting' ? '🟡' : '🔴'}
                </div>
                <div className="text-[9px] sm:text-[10px] text-gray-400">
                  {cameraStatus === 'ready' ? 'تعمل' : cameraStatus === 'restarting' ? 'تُعاد' : 'خطأ'}
                </div>
              </div>
            </div>
          )}

          {/* ── آخر المسجلين ── */}
          {!isBulk && recentStudents.length > 0 && (
            <div className="w-full max-w-full sm:max-w-lg mx-auto bg-white/5 rounded-lg p-2 sm:p-2.5">
              <p className="text-[10px] sm:text-[11px] font-bold mb-1 sm:mb-1.5 text-emerald-300">
                آخر المسجلين:
              </p>
              <div className="space-y-1">
                {recentStudents.map((s) => (
                  <div
                    key={s.id}
                    className="flex justify-between items-center bg-black/30 rounded px-2 sm:px-2.5 py-1 sm:py-1.5"
                  >
                    <span className="text-[10px] sm:text-xs font-medium truncate">{s.name}</span>
                    <span className="text-[8px] sm:text-[10px] bg-emerald-700/80 px-1.5 py-0.5 rounded-full flex-shrink-0 mr-1.5 sm:mr-2">
                      {s.group || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── شريط جانبي ── */}
        {isBulk && bulkSidebar && (
          <div className="lg:w-80 bg-gray-900/98 border-t lg:border-t-0 lg:border-r border-white/10 flex flex-col max-h-[40vh] sm:max-h-[45vh] lg:max-h-none">
            <div className="p-2 sm:p-3 border-b border-white/10 bg-gradient-to-r from-orange-900/40 to-red-900/40">
              <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                <h3 className="text-xs sm:text-sm font-bold text-orange-200">📋 سجل الجلسة</h3>
                <span className="bg-orange-600 text-white text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-bold">
                  {bulkStudents.length}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 sm:gap-1.5 text-center">
                {[
                  { val: bulkStudents.length, c: 'emerald', l: 'مسجّل' },
                  { val: bulkDetected, c: 'blue', l: 'مكتشف' },
                  { val: Math.max(0, filteredFaces.length - bulkStudents.length), c: 'orange', l: 'متبقٍ' },
                ].map(({ val, c, l }) => (
                  <div key={l} className="bg-white/8 rounded p-1 sm:p-1.5">
                    <div className={`text-sm sm:text-base font-bold text-${c}-400`}>{val}</div>
                    <div className="text-[8px] sm:text-[9px] text-gray-300">{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* بحث في القائمة */}
            <div className="p-1.5 sm:p-2 border-b border-white/5">
              <input
                type="text"
                placeholder="🔍 ابحث بالاسم أو الكود..."
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="w-full bg-white/10 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-white placeholder-gray-500 outline-none focus:bg-white/15"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 sm:p-2 space-y-1">
              {filteredBulkStudents.length === 0 ? (
                <div className="text-center py-6 sm:py-8 text-gray-500 text-[10px] sm:text-xs">
                  <div className="text-2xl sm:text-3xl mb-2">👁️</div>
                  <p>{sidebarSearch ? 'لا نتائج' : 'وجّه الكاميرا نحو الطلاب...'}</p>
                </div>
              ) : (
                filteredBulkStudents.map((s, idx) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-1.5 sm:gap-2 bg-emerald-900/25 border border-emerald-600/25 rounded-lg px-2 sm:px-2.5 py-1.5 sm:py-2"
                  >
                    <div className="bg-emerald-600 text-white w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[8px] sm:text-[10px] font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] sm:text-xs font-bold text-emerald-100 truncate">{s.name}</div>
                      <div className="text-[8px] sm:text-[9px] text-emerald-400/70">
                        {s.code}
                        {s.group ? ` • ${s.group}` : ''}
                      </div>
                    </div>
                    <span className="text-emerald-400 text-xs sm:text-sm">✓</span>
                  </div>
                ))
              )}
            </div>
            <div className="p-1.5 sm:p-2 border-t border-white/10 bg-black/30 text-center">
              <p className="text-[8px] sm:text-[9px] text-gray-500">
                إجمالي: {students.length} • بصمات: {filteredFaces.length} • حد: {device.maxFaces}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ══ Toasts ══ */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 z-[10001] flex flex-col gap-1.5 sm:gap-2 w-[94%] sm:w-[92%] max-w-md pointer-events-none"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {toasts.map((t) => (
          <div key={t.id} className={`bg-gradient-to-r ${toastBg[t.type]} rounded-xl px-3 sm:px-4 py-2 sm:py-3 shadow-2xl animate-toast-drop`}>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-xl sm:text-2xl flex-shrink-0">{toastIcon[t.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-xs sm:text-sm truncate">{t.title}</p>
                {t.text && <p className="text-[10px] sm:text-xs opacity-90 truncate">{t.text}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ══ QR Link Modal ══ */}
      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-4 sm:p-5 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-3 sm:mb-4">
              <div className="text-3xl sm:text-4xl mb-2">🔗</div>
              <h3 className="text-base sm:text-lg font-bold">ربط هوية جديدة</h3>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-1">أدخل كود الطالب (4 أرقام)</p>
            </div>
            <div className="bg-gray-100 rounded p-1.5 text-[9px] sm:text-[10px] font-mono break-all mb-3 text-center" dir="ltr">
              {pendingQrId.slice(0, 32)}
              {pendingQrId.length > 32 ? '...' : ''}
            </div>
            <input
              ref={qrCodeInputRef}
              type="text"
              value={qrLinkCode}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setQrLinkCode(v);
                setQrLinkMessage('');
                if (v.length === 4) setTimeout(() => handleQrLinkByCode(v), 150);
              }}
              placeholder="0000"
              disabled={!onUpdateStudent}
              className="w-full text-center text-2xl sm:text-3xl font-bold tracking-[0.8em] sm:tracking-[1em] py-2.5 sm:py-3 border-2 border-emerald-300 rounded-xl outline-none focus:border-emerald-500"
              maxLength={4}
              inputMode="numeric"
              autoFocus
            />
            {qrLinkMessage && (
              <div
                className={`mt-2 sm:mt-3 p-2 rounded text-center text-[10px] sm:text-xs font-medium ${
                  qrLinkMessage.includes('⚠️')
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {qrLinkMessage}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3 sm:mt-4">
              <button
                onClick={() => { setPendingQrId(null); setQrLinkCode(''); setQrLinkMessage(''); }}
                className="py-2.5 sm:py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-xs sm:text-sm"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleQrLinkByCode(qrLinkCode)}
                disabled={qrLinkCode.length !== 4 || !onUpdateStudent}
                className="py-2.5 sm:py-3 bg-gradient-to-r from-emerald-600 to-teal-600 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95 shadow-md text-xs sm:text-sm"
              >
                🔗 ربط
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Face Register Modal ══ */}
      {showRegister && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-4 sm:p-5 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
            {regStep === 'code' && (
              <>
                <div className="text-center mb-3 sm:mb-4">
                  <div className="text-3xl sm:text-4xl mb-2">📸</div>
                  <h3 className="text-base sm:text-lg font-bold">إضافة بصمة وجه</h3>
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-1">أدخل كود الطالب (4 أرقام)</p>
                </div>
                <input
                  ref={codeInputRef}
                  type="text"
                  value={regCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setRegCode(v);
                    if (regMessage) setRegMessage('');
                    if (v.length === 4) setTimeout(() => handleCodeSubmit(v), 100);
                  }}
                  placeholder="0000"
                  className="w-full text-center text-2xl sm:text-3xl font-bold tracking-[0.8em] sm:tracking-[1em] py-2.5 sm:py-3 border-2 border-purple-300 rounded-xl outline-none focus:border-purple-500"
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                />
                {regMessage && (
                  <div
                    className={`mt-2 sm:mt-3 p-2 rounded text-center text-[10px] sm:text-xs font-medium ${
                      regMessage.includes('♻️')
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}
                  >
                    {regMessage}
                  </div>
                )}
                <div className="mt-2 sm:mt-3 p-2 bg-purple-50 border border-purple-100 rounded text-center">
                  <p className="text-[9px] sm:text-[10px] text-purple-700">
                    💡 الالتقاط يستغرق {CAPTURE_DURATION_MS / 1000} ثوانٍ لدقة أعلى
                  </p>
                </div>
                <button
                  onClick={() => { setShowRegister(false); setRegCode(''); setRegMessage(''); }}
                  className="w-full mt-2 sm:mt-3 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-xs sm:text-sm"
                >
                  إغلاق
                </button>
              </>
            )}

            {regStep === 'capturing' && regStudent && (
              <div className="text-center">
                <h3 className="text-base sm:text-lg font-bold mb-1">{regStudent.name}</h3>
                <p className="text-[10px] sm:text-xs text-gray-500 mb-1">
                  {regStudent.code} • {regStudent.group || '-'}
                </p>
                <div className="flex items-center justify-center gap-1.5 mb-2 sm:mb-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  <span className="text-[10px] sm:text-[11px] text-purple-600 font-bold">
                    ابقَ ثابتاً • {CAPTURE_DURATION_MS / 1000} ثوانٍ
                  </span>
                </div>
                <div className="relative inline-block mb-3 sm:mb-4">
                  <FaceCameraPreview mirror={isFront} />
                  <svg
                    className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
                    viewBox="0 0 200 200"
                  >
                    <circle cx="100" cy="100" r="93" fill="none" stroke="rgba(139,92,246,0.15)" strokeWidth="7" />
                    <circle
                      cx="100" cy="100" r="93" fill="none"
                      stroke={regProgress >= 100 ? '#10b981' : '#8b5cf6'}
                      strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 93}`}
                      strokeDashoffset={`${2 * Math.PI * 93 * (1 - regProgress / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.15s linear, stroke 0.3s' }}
                    />
                  </svg>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {regProgress}%
                  </div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-[10px] sm:text-[11px] text-purple-700 space-y-0.5 text-right">
                  <p>👁️ انظر مباشرة للكاميرا</p>
                  <p>🔄 حرّك رأسك ببطء</p>
                  <p>📐 أظهر الوجه كاملاً</p>
                </div>
                <p
                  className={`font-bold text-xs sm:text-sm mt-2 sm:mt-3 ${
                    regProgress >= 100 ? 'text-green-600' : 'text-purple-700'
                  }`}
                >
                  {regProgress >= 100 ? '✅ تم!' : '📸 جارٍ التقاط محيط الوجه...'}
                </p>
              </div>
            )}

            {regStep === 'success' && regStudent && (
              <div className="text-center py-4 sm:py-6">
                <div className="text-5xl sm:text-6xl mb-3 animate-bounce">🎉</div>
                <h3 className="text-lg sm:text-xl font-bold text-green-700 mb-1">تم بنجاح!</h3>
                <p className="text-gray-800 font-bold text-base sm:text-lg">{regStudent.name}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 mt-1">
                  {regStudent.code} • {regStudent.group || '-'}
                </p>
                <div className="mt-3 sm:mt-4 bg-green-50 border border-green-200 rounded-lg p-2 sm:p-3">
                  <p className="text-[10px] sm:text-xs text-green-700 font-medium">
                    ✨ البصمة محفوظة • جاهز للطالب التالي...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ ⚠️ نافذة تحذير: الطالب لديه بصمة بالفعل ══ */}
      {showDuplicateAlert && dupStudent && (
        <div
          className="fixed inset-0 z-[10002] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
          onClick={() => setShowDuplicateAlert(false)}
        >
          <div
            className="bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl p-5 sm:p-6 w-full max-w-xs shadow-2xl animate-scaleIn relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-5xl sm:text-6xl text-center mb-3 animate-bounce">⚠️</div>
            <h3 className="text-base sm:text-lg font-black text-white text-center mb-1">
              الطالب لديه بصمة بالفعل!
            </h3>
            <div className="bg-white/15 rounded-xl p-3 my-3 text-center">
              <p className="text-white font-bold text-sm sm:text-base">{dupStudent.name}</p>
              <p className="text-white/70 text-[10px] sm:text-xs mt-0.5">
                {dupStudent.code} • {dupStudent.group || '-'}
              </p>
              {dupStudent.faceRegisteredAt && (
                <p className="text-white/50 text-[9px] sm:text-[10px] mt-1">
                  📅 تسجيل: {new Date(dupStudent.faceRegisteredAt).toLocaleDateString('ar-EG')}
                </p>
              )}
            </div>
            <p className="text-white/80 text-[10px] sm:text-[11px] text-center mb-3 sm:mb-4">
              💡 إذا أردت تحديث البصمة، اضغط "تحديث رغم ذلك"
            </p>
            <button
              onClick={() => {
                setShowDuplicateAlert(false);
                setDupStudent(null);
                setRegStep('code');
                setRegCode('');
                setRegStudent(null);
                setTimeout(() => codeInputRef.current?.focus(), 200);
              }}
              className="w-full py-2.5 sm:py-3 bg-white/20 hover:bg-white/30 text-white font-bold rounded-xl active:scale-95 transition text-xs sm:text-sm"
            >
              ✕ فهمت - العودة
            </button>
            {onUpdateStudent && (
              <button
                onClick={() => {
                  const stu = dupStudent;
                  setShowDuplicateAlert(false);
                  setDupStudent(null);
                  setRegStudent(stu);
                  setRegStep('capturing');
                  captureFace({ ...stu, faceDescriptor: undefined } as Student);
                }}
                className="w-full py-2 mt-2 bg-yellow-500/80 hover:bg-yellow-400 text-black font-bold rounded-xl active:scale-95 transition text-[10px] sm:text-xs"
              >
                🔄 تحديث البصمة رغم ذلك
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ CSS ══ */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.8) translateY(20px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fadeIn  { animation: fadeIn 0.25s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.35s cubic-bezier(0.34,1.56,0.64,1); }

        @keyframes toastDrop {
          from { opacity:0; transform:translateY(-24px) scale(0.95); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        .animate-toast-drop { animation: toastDrop 0.35s cubic-bezier(0.34,1.56,0.64,1); }

        @keyframes scanLine {
          0%,100% { top:8%;  opacity:0.5; }
          50%      { top:88%; opacity:1;   }
        }
        .animate-scan-line { animation:scanLine 1.8s ease-in-out infinite; position:absolute; }

        .mirror-video video { transform: scaleX(-1) !important; }

        .scrollbar-hide::-webkit-scrollbar { display:none; }
        .scrollbar-hide { -ms-overflow-style:none; scrollbar-width:none; }

        #${QR_REGION_ID} { border-radius:0.75rem; overflow:hidden; background:#111; }
        #${QR_REGION_ID} video {
          width:100% !important; height:auto !important;
          min-height:200px !important; object-fit:cover !important; display:block !important;
        }
        #${QR_REGION_ID} img[alt="Info icon"],
        #${QR_REGION_ID} button,
        #${QR_REGION_ID} > div:last-child:not(:first-child) { display:none !important; }

        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); border-radius:99px; }

        input[type="range"] {
          -webkit-appearance:none; background:rgba(255,255,255,0.1);
          border-radius:99px; height:4px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
          background:#10b981; cursor:pointer; box-shadow:0 0 6px rgba(16,185,129,0.5);
        }

        @media (max-width: 639px) {
          #${QR_REGION_ID} video {
            min-height: 180px !important;
          }
          input[type="range"]::-webkit-slider-thumb {
            width: 20px; height: 20px;
          }
        }

        @media (max-height: 600px) {
          #${QR_REGION_ID} video {
            min-height: 150px !important;
          }
        }
      `}</style>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   FaceCameraPreview
══════════════════════════════════════════════════════════ */
const FaceCameraPreview: React.FC<{ mirror?: boolean }> = ({ mirror = true }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animId: number;
    let active = true;

    const draw = () => {
      if (!active) return;
      const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement | null;
      if (video && video.readyState >= 2) {
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
        ctx.clip();
        const vw = video.videoWidth,
          vh = video.videoHeight,
          md = Math.min(vw, vh);
        const sx = (vw - md) / 2,
          sy = (vh - md) / 2;
        if (mirror) {
          ctx.translate(size, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, md, md, 0, 0, size, size);
        ctx.restore();
      } else {
        canvas.width = 200;
        canvas.height = 200;
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(100, 100, 96, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '40px Arial';
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
      className="w-40 h-40 sm:w-48 sm:h-48 rounded-full bg-gray-900 shadow-xl"
    />
  );
};

export default QRAttendance;