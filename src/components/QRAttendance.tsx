import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AttendanceSession, Student } from '../types/student';
import {
  loadFaceModels,
  extractAllFaceDescriptors,
  extractFaceDescriptor,
  findBestMatch,
  descriptorToArray,
} from '../services/faceRecognition';

interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';
type ScanMode = 'qr' | 'face' | 'bulk';
type CameraFacing = 'environment' | 'user';

interface ToastMessage {
  type: ToastType;
  title: string;
  text?: string;
  student?: Student;
}

interface DetectedFaceBox {
  box: { x: number; y: number; width: number; height: number };
  student: Student | null;
  status: 'recognized' | 'already' | 'unknown' | 'analyzing';
  confidence: number;
  timestamp: number;
}

const QR_REGION_ID = 'qr-reader-region';
const DUPLICATE_BLOCK_MS = 30_000;
const FACE_DUPLICATE_BLOCK_MS = 60_000;
const BULK_FACE_BLOCK_MS = 120_000;
const BOX_FADE_MS = 2000;

/* ─── استخراج معرف QR ─── */
const extractQrCodeId = (text: string): string | null => {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {}
  try {
    const obj = JSON.parse(raw);
    const val = obj.qrCodeId || obj.qrId || obj.id || obj.studentId || obj.universityId || obj.code;
    if (val) return String(val).trim();
  } catch {}
  if (/^[A-Za-z0-9_-]{3,100}$/.test(raw)) return raw;
  return null;
};

/* ─── تأثيرات صوتية ─── */
const playSuccess = () => {
  try { navigator.vibrate?.([50, 30, 50]); } catch {}
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    g.gain.value = 0.06;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    setTimeout(() => ctx.close(), 200);
  } catch {}
};

const playBulkSuccess = () => {
  try { navigator.vibrate?.(40); } catch {}
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    g.gain.value = 0.04;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    setTimeout(() => ctx.close(), 150);
  } catch {}
};

const playCapture = () => {
  try { navigator.vibrate?.(30); } catch {}
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    g.gain.value = 0.04;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
    setTimeout(() => ctx.close(), 100);
  } catch {}
};

const playError = () => {
  try { navigator.vibrate?.([150]); } catch {}
};

/* ─── كشف الجهاز الضعيف ─── */
const isLowEndDevice = (): boolean => {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 2;
  return cores <= 4 || memory <= 3;
};

/* ─── حجم صندوق QR ─── */
const getQrBox = (): { width: number; height: number } => {
  const min = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(180, Math.min(300, Math.floor(min * 0.6)));
  return { width: size, height: size };
};

/* ─── التكبير الافتراضي ─── */
const getDefaultZoom = (facing: CameraFacing, mode: ScanMode, maxZoom: number): number => {
  if (mode === 'face' || mode === 'bulk') return Math.min(maxZoom, 1);
  return Math.min(maxZoom, 1.5);
};

export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students,
  activeSession,
  onMarkAttendance,
  onUpdateStudent,
  alreadyPresentIds,
  onClose,
}) => {
  /* ─── Refs ─── */
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const processingRef = useRef(false);
  const lastScansRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const faceIntervalRef = useRef<number | null>(null);
  const faceProcessingRef = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const qrCodeInputRef = useRef<HTMLInputElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectedFacesRef = useRef<Map<string, DetectedFaceBox>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  /* ─── State ─── */
  const [mode, setMode] = useState<ScanMode>('qr');
  const [facing, setFacing] = useState<CameraFacing>('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
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
  const [lowEnd] = useState(isLowEndDevice);
  const [faceModelsReady, setFaceModelsReady] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);

  /* Face Register */
  const [showFaceRegister, setShowFaceRegister] = useState(false);
  const [registerCode, setRegisterCode] = useState('');
  const [registerStep, setRegisterStep] = useState<'code' | 'capturing' | 'success'>('code');
  const [registerStudent, setRegisterStudent] = useState<Student | null>(null);
  const [registerMessage, setRegisterMessage] = useState('');
  const [captureProgress, setCaptureProgress] = useState(0);

  /* Bulk Mode State */
  const [bulkSessionStudents, setBulkSessionStudents] = useState<Student[]>([]);
  const [bulkShowSidebar, setBulkShowSidebar] = useState(true);
  const [, forceRender] = useState(0);

  /* ─── خريطة الطلاب ─── */
  const studentMap = useMemo(() => {
    const m = new Map<string, Student>();
    students.forEach(s => {
      if (s.qrCodeId) m.set(s.qrCodeId.trim(), s);
      if (s.universityId) m.set(s.universityId.trim(), s);
    });
    return m;
  }, [students]);

  const studentsWithFace = useMemo(() => {
    return students.filter(s => s.faceDescriptor && s.faceDescriptor.length > 0);
  }, [students]);

  const isFrontCamera = facing === 'user';
  const isBulkMode = mode === 'bulk';

  /* ─── Toast ─── */
  const showToast = useCallback((msg: ToastMessage, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(prev => (prev === msg ? null : prev)), ms);
  }, []);

  /* ─── معالجة طالب QR ─── */
  const processKnown = useCallback(async (student: Student, qrId: string) => {
    const now = Date.now();
    if (now - (lastScansRef.current[qrId] || 0) < DUPLICATE_BLOCK_MS) return;
    lastScansRef.current[qrId] = now;

    if (alreadyPresentIds.has(student.id)) {
      showToast({
        type: 'warning',
        title: 'مسجل مسبقاً',
        text: `${student.name} حاضر بالفعل`,
        student,
      }, 1500);
      return;
    }

    await onMarkAttendance(student);
    setScanCount(c => c + 1);
    setRecentStudents(prev => [student, ...prev.filter(s => s.id !== student.id)].slice(0, 5));
    playSuccess();
    showToast({
      type: 'success',
      title: `✅ ${student.name}`,
      text: student.group ? `الكروب: ${student.group}` : 'تم تسجيل الحضور',
      student,
    });
  }, [alreadyPresentIds, onMarkAttendance, showToast]);

  /* ─── QR decoded ─── */
  const onDecoded = useCallback(async (text: string) => {
    if (processingRef.current) return;
    const qrId = extractQrCodeId(text);
    if (!qrId) return;

    processingRef.current = true;
    try {
      const student = studentMap.get(qrId);
      if (student) {
        await processKnown(student, qrId);
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
      setTimeout(() => { processingRef.current = false; }, 300);
    }
  }, [studentMap, processKnown]);

  /* ─── إعدادات الكاميرا ─── */
  const configureCamera = useCallback(async (currentFacing: CameraFacing, currentMode: ScanMode) => {
    try {
      await new Promise(r => setTimeout(r, 500));
      const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
      if (!video?.srcObject) return;

      const stream = video.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      trackRef.current = track;

      const caps = track.getCapabilities?.() as any || {};

      if (caps.focusMode) {
        const modes = caps.focusMode as string[];
        if (modes.includes('continuous')) {
          try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }); } catch {}
        }
      }

      if (caps.exposureMode) {
        try { await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' } as any] }); } catch {}
      }

      if (caps.zoom) {
        const zMin = caps.zoom.min || 1;
        const zMax = caps.zoom.max || 1;
        setMinZoom(zMin);
        setMaxZoom(zMax);
        const hasZoom = zMax > zMin;
        setCanZoom(hasZoom);
        if (hasZoom) {
          const defaultZoom = getDefaultZoom(currentFacing, currentMode, zMax);
          try {
            await track.applyConstraints({ advanced: [{ zoom: defaultZoom } as any] });
            setZoom(defaultZoom);
          } catch {}
        }
      } else {
        setCanZoom(false);
      }

      if (caps.torch) {
        setHasTorch(true);
      } else {
        setHasTorch(false);
      }
    } catch (e) {
      console.warn('Camera config error:', e);
    }
  }, []);

  /* ─── تشغيل الكاميرا ─── */
  const startCamera = useCallback(async (currentFacing: CameraFacing, currentMode: ScanMode) => {
    if (startingRef.current || !mountedRef.current) return;
    startingRef.current = true;
    setErrorMsg('');
    setCameraReady(false);
    setHasTorch(false);
    setTorchOn(false);
    setCanZoom(false);

    try {
      if (scannerRef.current) {
        try {
          const state = scannerRef.current.getState();
          if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            await scannerRef.current.stop();
          }
          await scannerRef.current.clear();
        } catch {}
        scannerRef.current = null;
      }

      if (trackRef.current) {
        try { trackRef.current.stop(); } catch {}
        trackRef.current = null;
      }

      await new Promise(r => setTimeout(r, 250));

      if (!mountedRef.current) return;

      const qrBox = getQrBox();
      const fps = lowEnd ? 8 : 15;
      const aspectRatio = window.innerHeight > window.innerWidth ? 4 / 3 : 16 / 9;

      const scanner = new Html5Qrcode(QR_REGION_ID, { verbose: false });
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: currentFacing },
          {
            fps,
            qrbox: qrBox,
            aspectRatio,
            disableFlip: true,
            videoConstraints: {
              facingMode: currentFacing,
              width: { ideal: lowEnd ? 1280 : 1920 },
              height: { ideal: lowEnd ? 720 : 1080 },
              ...(lowEnd ? {} : { frameRate: { ideal: 30, max: 30 } }),
            } as any,
          },
          onDecoded,
          () => {}
        );
      } catch {
        try {
          if (scannerRef.current) {
            try { await scannerRef.current.clear(); } catch {}
          }
          const scanner2 = new Html5Qrcode(QR_REGION_ID, { verbose: false });
          scannerRef.current = scanner2;

          await scanner2.start(
            { facingMode: currentFacing },
            {
              fps: 5,
              qrbox: { width: 200, height: 200 },
              disableFlip: true,
            },
            onDecoded,
            () => {}
          );
        } catch {
          try {
            if (scannerRef.current) {
              try { await scannerRef.current.clear(); } catch {}
            }
            const scanner3 = new Html5Qrcode(QR_REGION_ID, { verbose: false });
            scannerRef.current = scanner3;

            const devices = await Html5Qrcode.getCameras();
            if (devices.length === 0) throw new Error('لا توجد كاميرا');

            let deviceId = devices[0].id;
            if (currentFacing === 'user' && devices.length > 1) {
              const front = devices.find(d => /front|user|selfie/i.test(d.label));
              if (front) deviceId = front.id;
            } else if (currentFacing === 'environment' && devices.length > 1) {
              const back = devices.find(d => /back|rear|environment/i.test(d.label));
              if (back) deviceId = back.id;
            }

            await scanner3.start(
              deviceId,
              { fps: 5, qrbox: { width: 180, height: 180 } },
              onDecoded,
              () => {}
            );
          } catch (finalErr: any) {
            throw finalErr;
          }
        }
      }

      if (mountedRef.current) {
        setCameraReady(true);
        await configureCamera(currentFacing, currentMode);
      }
    } catch (err: any) {
      console.error('Camera start failed:', err);
      const msg = err?.message || '';
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setErrorMsg('يرجى السماح باستخدام الكاميرا');
      } else if (msg.includes('NotFound')) {
        setErrorMsg('لا توجد كاميرا في هذا الجهاز');
      } else if (msg.includes('NotReadable')) {
        setErrorMsg('الكاميرا مستخدمة من تطبيق آخر');
      } else {
        setErrorMsg('فشل تشغيل الكاميرا');
      }
    } finally {
      startingRef.current = false;
    }
  }, [lowEnd, onDecoded, configureCamera]);

  /* ─── إيقاف الكاميرا ─── */
  const stopCamera = useCallback(async () => {
    try {
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      if (trackRef.current && hasTorch && torchOn) {
        try {
          await trackRef.current.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch {}
      }

      if (scannerRef.current) {
        try {
          const state = scannerRef.current.getState();
          if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            await scannerRef.current.stop();
          }
        } catch {}
        try {
          await scannerRef.current.clear();
        } catch {}
        scannerRef.current = null;
      }

      if (trackRef.current) {
        try { trackRef.current.stop(); } catch {}
        trackRef.current = null;
      }

      const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
      if (video?.srcObject) {
        const stream = video.srcObject as MediaStream;
        stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
        video.srcObject = null;
      }
    } catch (e) {
      console.warn('Stop camera error:', e);
    } finally {
      setCameraReady(false);
      setTorchOn(false);
    }
  }, [hasTorch, torchOn]);

  /* ─── تبديل الكاميرا ─── */
  const toggleCamera = useCallback(async () => {
    if (startingRef.current) return;
    const newFacing: CameraFacing = facing === 'environment' ? 'user' : 'environment';
    setFacing(newFacing);
    await startCamera(newFacing, mode);
  }, [facing, mode, startCamera]);

  /* ─── Zoom ─── */
  const applyZoom = useCallback(async (val: number) => {
    if (!trackRef.current || !canZoom) return;
    const clamped = Math.max(minZoom, Math.min(maxZoom, val));
    try {
      await trackRef.current.applyConstraints({ advanced: [{ zoom: clamped } as any] });
      setZoom(clamped);
    } catch {}
  }, [canZoom, minZoom, maxZoom]);

  /* ─── Torch ─── */
  const toggleTorch = useCallback(async () => {
    if (!trackRef.current || !hasTorch) return;
    const next = !torchOn;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch {}
  }, [hasTorch, torchOn]);

  /* ─── تحميل موديلات الوجه ─── */
  useEffect(() => {
    if ((mode !== 'face' && mode !== 'bulk') || faceModelsReady) return;

    setFaceLoading(true);
    loadFaceModels()
      .then(() => {
        if (mountedRef.current) {
          setFaceModelsReady(true);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          showToast({ type: 'error', title: '❌ فشل تحميل نظام التعرف' }, 3000);
        }
      })
      .finally(() => {
        if (mountedRef.current) setFaceLoading(false);
      });
  }, [mode, faceModelsReady, showToast]);

  /* ─── تغيير الوضع ─── */
  useEffect(() => {
    if (!cameraReady) return;

    detectedFacesRef.current.clear();

    if (mode === 'face' || mode === 'bulk') {
      const targetFacing: CameraFacing = mode === 'bulk' ? 'environment' : 'user';
      if (facing !== targetFacing) {
        setFacing(targetFacing);
        startCamera(targetFacing, mode);
      } else {
        if (canZoom && trackRef.current) applyZoom(1);
      }
    } else {
      if (canZoom && trackRef.current) applyZoom(1.5);
    }
  }, [mode]); // eslint-disable-line

  /* ─── رسم المربعات على الـ Canvas ─── */
  useEffect(() => {
    if (mode !== 'bulk' || !cameraReady) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const canvas = overlayCanvasRef.current;
    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!canvas || !video) return;

    const draw = () => {
      if (!canvas || !video || video.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const rect = video.getBoundingClientRect();
      const containerRect = canvas.parentElement?.getBoundingClientRect();
      if (!containerRect) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      canvas.width = rect.width;
      canvas.height = rect.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = Date.now();
      const videoWidth = video.videoWidth || 1280;
      const videoHeight = video.videoHeight || 720;
      const scaleX = canvas.width / videoWidth;
      const scaleY = canvas.height / videoHeight;
      const mirrorX = isFrontCamera;

      detectedFacesRef.current.forEach((face, key) => {
        const age = now - face.timestamp;
        if (age > BOX_FADE_MS) {
          detectedFacesRef.current.delete(key);
          return;
        }

        const opacity = Math.max(0.4, 1 - age / BOX_FADE_MS);

        let strokeColor = '#ef4444';
        let fillColor = 'rgba(239, 68, 68, 0.15)';
        let label = '❓ غير معروف';

        if (face.status === 'recognized') {
          strokeColor = '#10b981';
          fillColor = 'rgba(16, 185, 129, 0.2)';
          label = face.student?.name || '';
        } else if (face.status === 'already') {
          strokeColor = '#f59e0b';
          fillColor = 'rgba(245, 158, 11, 0.2)';
          label = `✓ ${face.student?.name || ''}`;
        } else if (face.status === 'analyzing') {
          strokeColor = '#3b82f6';
          fillColor = 'rgba(59, 130, 246, 0.2)';
          label = '🔍 جاري التحليل...';
        }

        // ✅ معالجة انعكاس المرآة
        const rawX = face.box.x * scaleX;
        const y = face.box.y * scaleY;
        const w = face.box.width * scaleX;
        const h = face.box.height * scaleY;
        const x = mirrorX ? (canvas.width - rawX - w) : rawX;

        // ملء خفيف
        ctx.fillStyle = fillColor.replace(/[\d.]+\)/, `${opacity * 0.2})`);
        ctx.fillRect(x, y, w, h);

        // إطار سميك
        ctx.strokeStyle = strokeColor;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, w, h);

        // زوايا
        const corner = Math.min(20, w / 4);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x, y + corner);
        ctx.lineTo(x, y);
        ctx.lineTo(x + corner, y);
        ctx.moveTo(x + w - corner, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + corner);
        ctx.moveTo(x + w, y + h - corner);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x + w - corner, y + h);
        ctx.moveTo(x + corner, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + h - corner);
        ctx.stroke();

        // اسم الطالب فوق المربع
        if (label) {
          ctx.globalAlpha = opacity;
          ctx.font = 'bold 14px Arial, sans-serif';
          const textMetrics = ctx.measureText(label);
          const textWidth = textMetrics.width + 16;
          const textHeight = 24;
          const textX = x + (w - textWidth) / 2;
          const textY = y - textHeight - 6;

          ctx.fillStyle = strokeColor;
          ctx.fillRect(textX, textY, textWidth, textHeight);

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, textX + textWidth / 2, textY + textHeight / 2);

          if (face.confidence > 0 && face.status === 'recognized') {
            ctx.font = 'bold 11px Arial, sans-serif';
            ctx.fillStyle = strokeColor;
            const confLabel = `${face.confidence}%`;
            const confMetrics = ctx.measureText(confLabel);
            const confW = confMetrics.width + 10;
            const confY = y + h + 4;

            ctx.fillRect(x + (w - confW) / 2, confY, confW, 18);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(confLabel, x + w / 2, confY + 9);
          }
        }
      });

      ctx.globalAlpha = 1;
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [mode, cameraReady, isFrontCamera]);

  /* ─── المسح المستمر للوجوه (فردي + جماعي) ─── */
  useEffect(() => {
    if ((mode !== 'face' && mode !== 'bulk') || !cameraReady || !faceModelsReady) {
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
      return;
    }

    if (studentsWithFace.length === 0) return;

    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!video) return;

    const isBulk = mode === 'bulk';
    const blockMs = isBulk ? BULK_FACE_BLOCK_MS : FACE_DUPLICATE_BLOCK_MS;
    const intervalMs = isBulk ? 300 : 500;

    faceIntervalRef.current = window.setInterval(async () => {
      if (faceProcessingRef.current || !video || video.readyState < 2) return;
      if (showFaceRegister) return;
      faceProcessingRef.current = true;

      try {
        const detections = await extractAllFaceDescriptors(video);

        if (isBulk) {
          if (detections.length === 0) return;

          for (const detection of detections) {
            const box = detection.detection.box;
            const boxKey = `${Math.round(box.x / 50)}_${Math.round(box.y / 50)}`;

            const match = findBestMatch(detection.descriptor, studentsWithFace, 0.5);
            const now = Date.now();

            if (match) {
              const student = match.item;
              const lastTime = lastScansRef.current[`bulk_${student.id}`] || 0;
              const isAlreadyPresent = alreadyPresentIds.has(student.id);
              const recentlyScanned = now - lastTime < blockMs;

              if (recentlyScanned || isAlreadyPresent) {
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
                  [student, ...prev.filter(s => s.id !== student.id)].slice(0, 5)
                );
                playBulkSuccess();
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

          forceRender(x => x + 1);
        } else {
          if (detections.length === 0) return;

          for (const detection of detections) {
            const match = findBestMatch(detection.descriptor, studentsWithFace, 0.5);
            if (!match) continue;

            const student = match.item;
            const now = Date.now();
            const lastTime = lastScansRef.current[`face_${student.id}`] || 0;
            if (now - lastTime < blockMs) continue;

            lastScansRef.current[`face_${student.id}`] = now;

            if (alreadyPresentIds.has(student.id)) {
              showToast({
                type: 'warning',
                title: '⚠️ مسجل مسبقاً',
                text: student.name,
                student,
              }, 2000);
              continue;
            }

            await onMarkAttendance(student);
            setScanCount(c => c + 1);
            setRecentStudents(prev =>
              [student, ...prev.filter(s => s.id !== student.id)].slice(0, 5)
            );
            playSuccess();

            showToast({
              type: 'success',
              title: `✅ ${student.name}`,
              text: `${student.group || ''} • دقة: ${match.confidence}%`,
              student,
            }, 2500);
          }
        }
      } catch (e) {
        // تجاهل
      } finally {
        faceProcessingRef.current = false;
      }
    }, intervalMs);

    return () => {
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
    };
  }, [mode, cameraReady, faceModelsReady, studentsWithFace, alreadyPresentIds, onMarkAttendance, showToast, showFaceRegister]);

  /* ─── Mount / Unmount ─── */
  useEffect(() => {
    mountedRef.current = true;
    startCamera(facing, mode);

    return () => {
      mountedRef.current = false;
      (async () => {
        try {
          if (faceIntervalRef.current) {
            clearInterval(faceIntervalRef.current);
            faceIntervalRef.current = null;
          }
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          if (scannerRef.current) {
            try {
              const state = scannerRef.current.getState();
              if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
                await scannerRef.current.stop();
              }
            } catch {}
            try { await scannerRef.current.clear(); } catch {}
            scannerRef.current = null;
          }
          if (trackRef.current) {
            try { trackRef.current.stop(); } catch {}
            trackRef.current = null;
          }
          const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
          if (video?.srcObject) {
            (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            video.srcObject = null;
          }
        } catch {}
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── إغلاق ─── */
  const handleClose = useCallback(async () => {
    await stopCamera();
    await new Promise(r => setTimeout(r, 100));
    onClose();
  }, [stopCamera, onClose]);

  /* ─── ربط QR ─── */
  const handleQrLinkByCode = useCallback(async (code: string) => {
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

    await processKnown(updated, qrId);
  }, [pendingQrId, onUpdateStudent, students, processKnown]);

  /* ─── فتح نافذة تسجيل بصمة ─── */
  const openFaceRegister = useCallback(async () => {
    if (mode !== 'face') setMode('face');
    if (facing !== 'user') {
      setFacing('user');
      await startCamera('user', 'face');
    }
    setRegisterCode('');
    setRegisterStep('code');
    setRegisterStudent(null);
    setRegisterMessage('');
    setCaptureProgress(0);
    setShowFaceRegister(true);
    setTimeout(() => codeInputRef.current?.focus(), 200);
  }, [mode, facing, startCamera]);

  /* ─── التقاط بصمة ─── */
  const captureFaceForRegister = useCallback(async (student: Student) => {
    if (!onUpdateStudent) return;

    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!video || video.readyState < 2) {
      setRegisterMessage('❌ الكاميرا غير جاهزة');
      return;
    }

    setRegisterStep('capturing');
    setCaptureProgress(0);

    let progress = 0;
    const progressInterval = window.setInterval(() => {
      progress = Math.min(progress + 12, 90);
      setCaptureProgress(progress);
    }, 40);

    try {
      await loadFaceModels();
      playCapture();

      let descriptor = null;
      for (let i = 0; i < 4; i++) {
        descriptor = await extractFaceDescriptor(video);
        if (descriptor) break;
        await new Promise(r => setTimeout(r, 120));
      }

      clearInterval(progressInterval);

      if (!descriptor) {
        setCaptureProgress(0);
        setRegisterStep('code');
        setRegisterMessage('❌ لم يتم رؤية الوجه');
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
        setRegisterCode('');
        setRegisterStudent(null);
        setRegisterMessage('');
        setCaptureProgress(0);
        setRegisterStep('code');
        setTimeout(() => codeInputRef.current?.focus(), 100);
      }, 1200);
    } catch (e) {
      clearInterval(progressInterval);
      setCaptureProgress(0);
      setRegisterStep('code');
      setRegisterMessage('❌ حدث خطأ');
      playError();
    }
  }, [onUpdateStudent]);

  /* ─── إدخال الكود ─── */
  const handleCodeSubmit = useCallback(async (code: string) => {
    if (code.length !== 4) return;

    const student = students.find(s => s.code === code);
    if (!student) {
      setRegisterMessage('❌ لا يوجد طالب بهذا الكود');
      playError();
      setRegisterCode('');
      return;
    }

    if (student.faceDescriptor && student.faceDescriptor.length > 0) {
      setRegisterMessage(`♻️ إعادة تسجيل ${student.name}`);
    } else {
      setRegisterMessage('');
    }

    setRegisterStudent(student);
    captureFaceForRegister(student);
  }, [students, captureFaceForRegister]);

  /* ─── ألوان Toast ─── */
  const toastBg: Record<ToastType, string> = {
    success: 'bg-gradient-to-r from-emerald-500 to-green-600',
    error: 'bg-gradient-to-r from-red-500 to-rose-600',
    info: 'bg-gradient-to-r from-blue-500 to-cyan-600',
    warning: 'bg-gradient-to-r from-amber-500 to-orange-600',
  };
  const toastIcon: Record<ToastType, string> = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col" dir="rtl">

      {/* ═══ Header ═══ */}
      <header className="flex items-center justify-between px-3 py-2 bg-gray-900/90 border-b border-white/10"
              style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate">
            {mode === 'qr' && '📷 ماسح QR'}
            {mode === 'face' && '😊 بصمة الوجه'}
            {mode === 'bulk' && '🎯 المسح الجماعي'}
          </h2>
          <p className="text-[10px] text-gray-400 truncate">
            {activeSession ? activeSession.name : 'لا يوجد سجل نشط'}
            {lowEnd && ' • وضع موفر الطاقة'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {cameraReady && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <button
            onClick={handleClose}
            className="bg-red-600 active:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95 transition-transform"
          >
            ✕ إغلاق
          </button>
        </div>
      </header>

      {/* ═══ تبديل الوضع ═══ */}
      <div className="px-3 py-2 bg-gray-900/60 border-b border-white/5 flex gap-1.5">
        <button
          onClick={() => setMode('qr')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
            mode === 'qr'
              ? 'bg-emerald-600 text-white shadow-lg'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          🔳 QR
        </button>
        <button
          onClick={() => setMode('face')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
            mode === 'face'
              ? 'bg-purple-600 text-white shadow-lg'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          😊 بصمة
        </button>
        <button
          onClick={() => setMode('bulk')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 relative ${
            mode === 'bulk'
              ? 'bg-gradient-to-r from-orange-600 to-red-600 text-white shadow-lg'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          🎯 جماعي
          {mode !== 'bulk' && (
            <span className="absolute -top-1 -right-1 bg-yellow-400 text-yellow-900 text-[8px] px-1 py-0.5 rounded-full font-bold">
              جديد
            </span>
          )}
        </button>
      </div>

      {/* ═══ مؤشر تحميل ═══ */}
      {(mode === 'face' || mode === 'bulk') && faceLoading && (
        <div className="mx-3 mt-2 p-3 bg-purple-900/60 border border-purple-500/50 rounded-lg text-center">
          <div className="inline-block w-5 h-5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin mb-1" />
          <p className="text-xs text-purple-200">جاري تحميل نظام التعرف...</p>
        </div>
      )}

      {/* ═══ تنبيه وضع الوجه ═══ */}
      {mode === 'face' && faceModelsReady && cameraReady && studentsWithFace.length > 0 && (
        <div className="mx-3 mt-2 p-2 bg-purple-900/40 border border-purple-500/30 rounded-lg text-center">
          <p className="text-[11px] text-purple-200">
            👁️ النظام يراقب... مر قبال الكاميرا
          </p>
          <p className="text-[10px] text-purple-300 mt-0.5">
            {studentsWithFace.length} بصمة مسجلة
          </p>
        </div>
      )}

      {/* ═══ تنبيه الوضع الجماعي ═══ */}
      {mode === 'bulk' && faceModelsReady && cameraReady && studentsWithFace.length > 0 && (
        <div className="mx-3 mt-2 p-2 bg-gradient-to-r from-orange-900/50 to-red-900/50 border border-orange-500/40 rounded-lg">
          <div className="flex items-center justify-between gap-2">
            <div className="text-center flex-1">
              <p className="text-[11px] text-orange-200 font-bold">
                🎯 امش بالكاميرا على الطلاب - التعرف تلقائي
              </p>
              <p className="text-[10px] text-orange-300 mt-0.5">
                🟢 معروف • 🟡 مسجّل • 🔴 غير معروف
              </p>
            </div>
            <button
              onClick={() => setBulkShowSidebar(s => !s)}
              className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[10px] font-bold"
            >
              {bulkShowSidebar ? '◀ إخفاء' : '▶ قائمة'}
            </button>
          </div>
        </div>
      )}

      {(mode === 'face' || mode === 'bulk') && faceModelsReady && cameraReady && studentsWithFace.length === 0 && (
        <div className="mx-3 mt-2 p-3 bg-amber-900/40 border border-amber-500/40 rounded-lg text-center">
          <p className="text-xs text-amber-200 font-bold">
            ℹ️ لا توجد بصمات مسجلة
          </p>
          <p className="text-[10px] text-amber-300 mt-1">
            سجّل بصمات الطلاب من وضع "😊 بصمة" أولاً
          </p>
        </div>
      )}

      {/* ═══ خطأ ═══ */}
      {errorMsg && !cameraReady && (
        <div className="mx-3 mt-3 p-4 bg-red-900/60 border border-red-500/50 rounded-xl text-center">
          <p className="text-red-200 text-sm mb-2">{errorMsg}</p>
          <button
            onClick={() => startCamera(facing, mode)}
            className="bg-red-600 active:bg-red-700 px-4 py-2 rounded-lg text-xs font-bold active:scale-95 transition-transform"
          >
            🔄 إعادة المحاولة
          </button>
        </div>
      )}

      {/* ═══ المحتوى ═══ */}
      <div className={`flex-1 overflow-hidden flex ${isBulkMode && bulkShowSidebar ? 'flex-col lg:flex-row' : 'flex-col'}`}>

        {/* القسم الرئيسي - الكاميرا */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">

          {/* الكاميرا */}
          <div className={`w-full mx-auto rounded-xl overflow-hidden border bg-gray-900 relative ${
            isBulkMode ? 'max-w-3xl border-orange-500/40' : 'max-w-lg border-emerald-500/30'
          }`}>
            {/* ✅ إضافة class انعكاس المرآة للكاميرا الأمامية */}
            <div
              id={QR_REGION_ID}
              className={`w-full ${isFrontCamera ? 'front-camera' : ''}`}
              style={{ minHeight: isBulkMode ? '400px' : '280px' }}
            />

            {/* Canvas للمربعات في الوضع الجماعي */}
            {isBulkMode && cameraReady && (
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 pointer-events-none w-full h-full"
              />
            )}

            {/* إطار QR */}
            {cameraReady && mode === 'qr' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative" style={{ width: getQrBox().width, height: getQrBox().height }}>
                  <div className="absolute top-0 right-0 w-10 h-10 border-t-2 border-r-2 border-emerald-400 rounded-tr-lg" />
                  <div className="absolute top-0 left-0 w-10 h-10 border-t-2 border-l-2 border-emerald-400 rounded-tl-lg" />
                  <div className="absolute bottom-0 right-0 w-10 h-10 border-b-2 border-r-2 border-emerald-400 rounded-br-lg" />
                  <div className="absolute bottom-0 left-0 w-10 h-10 border-b-2 border-l-2 border-emerald-400 rounded-bl-lg" />
                  <div className="absolute inset-x-3 h-px bg-emerald-400/80 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-scan-line" />
                </div>
              </div>
            )}

            {/* إطار الوجه الفردي */}
            {cameraReady && mode === 'face' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-48 h-64 border-4 border-purple-400/60 rounded-3xl shadow-[0_0_30px_rgba(168,85,247,0.3)]" />
              </div>
            )}

            {/* زر تبديل الكاميرا */}
            {cameraReady && (
              <button
                onClick={toggleCamera}
                className="absolute top-2 left-2 bg-black/60 hover:bg-black/80 active:scale-95 text-white p-2 rounded-full shadow-lg transition-all z-10"
              >
                <span className="text-xl">🔄</span>
              </button>
            )}

            {/* مؤشر الكاميرا */}
            {cameraReady && (
              <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full z-10">
                {isFrontCamera ? '📱 أمامية' : '📷 خلفية'}
              </div>
            )}

            {/* عداد كبير في الوضع الجماعي */}
            {isBulkMode && cameraReady && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-600 to-red-600 px-4 py-2 rounded-full shadow-xl z-10">
                <div className="flex items-center gap-2 text-white">
                  <span className="text-2xl">📊</span>
                  <div>
                    <div className="text-2xl font-bold leading-none">{bulkSessionStudents.length}</div>
                    <div className="text-[9px] opacity-90">طالب مسجّل</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* أدوات الكاميرا */}
          {cameraReady && (
            <div className="w-full max-w-lg mx-auto space-y-2">

              <div className="flex gap-1.5 flex-wrap">
                {canZoom && (
                  <>
                    {[1, 1.5, 2, 2.5, 3].filter(v => v <= maxZoom).map(v => (
                      <button
                        key={v}
                        onClick={() => applyZoom(v)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                          Math.abs(zoom - v) < 0.15
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white/10 text-gray-300'
                        }`}
                      >
                        {v}x
                      </button>
                    ))}
                  </>
                )}

                {hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                      torchOn
                        ? 'bg-yellow-500 text-black'
                        : 'bg-white/10 text-gray-300'
                    }`}
                  >
                    {torchOn ? '💡 إطفاء' : '🔦 فلاش'}
                  </button>
                )}

                {mode === 'face' && onUpdateStudent && (
                  <button
                    onClick={openFaceRegister}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md mr-auto"
                  >
                    ➕ إضافة بصمة
                  </button>
                )}
              </div>

              {canZoom && (
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-emerald-300 font-bold">🔍 {zoom.toFixed(1)}x</span>
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

          {/* إحصائيات */}
          {!isBulkMode && (
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg mx-auto">
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-2xl font-bold text-emerald-400">{scanCount}</div>
                <div className="text-[10px] text-gray-400">تم تسجيلهم</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-lg font-bold">{cameraReady ? '🟢' : '🔴'}</div>
                <div className="text-[10px] text-gray-400">
                  {cameraReady ? 'الكاميرا تعمل' : 'متوقفة'}
                </div>
              </div>
            </div>
          )}

          {/* آخر المسجلين */}
          {!isBulkMode && recentStudents.length > 0 && (
            <div className="w-full max-w-lg mx-auto bg-white/5 rounded-lg p-2.5">
              <p className="text-[11px] font-bold mb-1.5 text-emerald-300">آخر المسجلين:</p>
              <div className="space-y-1">
                {recentStudents.map(s => (
                  <div key={s.id} className="flex justify-between items-center bg-black/30 rounded px-2.5 py-1.5">
                    <span className="text-xs truncate">{s.name}</span>
                    <span className="text-[10px] bg-emerald-600/80 px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {s.group || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* شريط جانبي للوضع الجماعي */}
        {isBulkMode && bulkShowSidebar && (
          <div className="lg:w-80 bg-gray-900/95 border-t lg:border-t-0 lg:border-r border-white/10 flex flex-col max-h-[40vh] lg:max-h-none">

            <div className="p-3 border-b border-white/10 bg-gradient-to-r from-orange-900/50 to-red-900/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-orange-200 flex items-center gap-2">
                  📋 سجل الجلسة
                </h3>
                <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  {bulkSessionStudents.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-white/10 rounded p-1.5">
                  <div className="text-lg font-bold text-emerald-400">{bulkSessionStudents.length}</div>
                  <div className="text-[9px] text-gray-300">مسجّل</div>
                </div>
                <div className="bg-white/10 rounded p-1.5">
                  <div className="text-lg font-bold text-orange-400">
                    {students.length - bulkSessionStudents.length}
                  </div>
                  <div className="text-[9px] text-gray-300">متبقي</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {bulkSessionStudents.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs">
                  <div className="text-3xl mb-2">👁️</div>
                  <p>ابدأ بتوجيه الكاميرا على الطلاب...</p>
                </div>
              ) : (
                bulkSessionStudents.map((s, idx) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-2 animate-slide-in"
                  >
                    <div className="bg-emerald-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate text-emerald-200">{s.name}</div>
                      <div className="text-[9px] text-emerald-400/70">
                        {s.code} • {s.group || '-'}
                      </div>
                    </div>
                    <span className="text-emerald-400 text-sm">✓</span>
                  </div>
                ))
              )}
            </div>

            <div className="p-2 border-t border-white/10 bg-black/40">
              <div className="text-[10px] text-gray-400 text-center">
                📊 إجمالي الطلاب: {students.length} • مع بصمة: {studentsWithFace.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Toast ═══ */}
      {toast && (
        <div className={`fixed top-0 left-1/2 -translate-x-1/2 w-[92%] max-w-md z-[10001]
                         ${toastBg[toast.type]} rounded-b-2xl px-5 py-4 shadow-2xl animate-toast-drop`}
             style={{ marginTop: 'env(safe-area-inset-top)' }}>
          <div className="flex items-center gap-3">
            <span className="text-3xl flex-shrink-0 animate-toast-icon">{toastIcon[toast.type]}</span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-base truncate">{toast.title}</p>
              {toast.text && <p className="text-xs opacity-95 truncate mt-0.5">{toast.text}</p>}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 overflow-hidden rounded-b-2xl">
            <div className="h-full bg-white/60 animate-toast-progress" />
          </div>
        </div>
      )}

      {/* ═══ نافذة ربط QR ═══ */}
      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔗</div>
              <h3 className="text-lg font-bold text-gray-800">ربط هوية جديدة</h3>
              <p className="text-xs text-gray-500 mt-1">أدخل كود الطالب لربطه</p>
            </div>

            <div className="bg-gray-100 rounded p-1.5 text-[10px] font-mono break-all mb-3 text-center" dir="ltr">
              {pendingQrId.slice(0, 30)}{pendingQrId.length > 30 ? '...' : ''}
            </div>

            <input
              ref={qrCodeInputRef}
              type="text"
              value={qrLinkCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setQrLinkCode(val);
                setQrLinkMessage('');
                if (val.length === 4) {
                  setTimeout(() => handleQrLinkByCode(val), 150);
                }
              }}
              placeholder="0000"
              disabled={!onUpdateStudent}
              className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-emerald-300 rounded-xl outline-none focus:border-emerald-500 disabled:bg-gray-100"
              style={{ fontFamily: 'Arial, sans-serif' }}
              maxLength={4}
              inputMode="numeric"
              autoFocus
            />

            {qrLinkMessage && (
              <div className={`mt-3 p-2 rounded text-center text-xs font-medium ${
                qrLinkMessage.includes('⚠️')
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
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
                className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition active:scale-95"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleQrLinkByCode(qrLinkCode)}
                disabled={qrLinkCode.length !== 4 || !onUpdateStudent}
                className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-40 text-white font-bold rounded-lg transition shadow-md active:scale-95"
              >
                🔗 ربط
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ نافذة تسجيل بصمة ═══ */}
      {showFaceRegister && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">

            {registerStep === 'code' && (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">📸</div>
                  <h3 className="text-lg font-bold text-gray-800">إضافة بصمة وجه</h3>
                  <p className="text-xs text-gray-500 mt-1">أدخل كود الطالب (4 أرقام)</p>
                </div>

                <input
                  ref={codeInputRef}
                  type="text"
                  value={registerCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setRegisterCode(val);
                    if (registerMessage) setRegisterMessage('');
                    if (val.length === 4) {
                      setTimeout(() => handleCodeSubmit(val), 100);
                    }
                  }}
                  placeholder="0000"
                  className="w-full text-center text-3xl font-bold tracking-[1em] py-3 border-2 border-purple-300 rounded-xl outline-none focus:border-purple-500"
                  style={{ fontFamily: 'Arial, sans-serif' }}
                  maxLength={4}
                  inputMode="numeric"
                  autoFocus
                />

                {registerMessage && (
                  <div className={`mt-3 p-2 rounded text-center text-xs font-medium ${
                    registerMessage.includes('♻️')
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : registerMessage.includes('⚠️')
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {registerMessage}
                  </div>
                )}

                <div className="mt-4 p-2 bg-purple-50 border border-purple-200 rounded text-center">
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
                  className="w-full mt-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition active:scale-95 text-sm"
                >
                  إغلاق
                </button>
              </>
            )}

            {registerStep === 'capturing' && registerStudent && (
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-800 mb-1">
                  {registerStudent.name}
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  {registerStudent.code} • {registerStudent.group || '-'}
                </p>

                <div className="relative inline-block mb-3">
                  <FaceCameraPreview isFrontCamera={isFrontCamera} />
                  <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="95" fill="none" stroke="rgba(239, 68, 68, 0.2)" strokeWidth="6" />
                    <circle
                      cx="100"
                      cy="100"
                      r="95"
                      fill="none"
                      stroke={captureProgress >= 100 ? '#10b981' : '#ef4444'}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 95}`}
                      strokeDashoffset={`${2 * Math.PI * 95 * (1 - captureProgress / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s ease' }}
                    />
                  </svg>
                </div>

                <p className={`font-bold text-sm ${captureProgress >= 100 ? 'text-green-600' : 'text-red-600'}`}>
                  {captureProgress >= 100 ? '✅ تم!' : '📸 جاري الالتقاط...'}
                </p>
              </div>
            )}

            {registerStep === 'success' && registerStudent && (
              <div className="text-center py-4">
                <div className="text-6xl mb-3 animate-bounce">🎉</div>
                <h3 className="text-xl font-bold text-green-700 mb-1">تم بنجاح!</h3>
                <p className="text-gray-700 font-bold">{registerStudent.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {registerStudent.code} • {registerStudent.group || '-'}
                </p>
                <p className="text-xs text-purple-600 mt-3">
                  ✨ جاهز للطالب التالي...
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ CSS ═══ */}
      <style>{`
        @keyframes toastDrop {
          from { opacity: 0; transform: translate(-50%, -100%); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-toast-drop { animation: toastDrop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }

        @keyframes toastIcon {
          0% { transform: scale(0.5) rotate(-20deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(10deg); }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        .animate-toast-icon { animation: toastIcon 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }

        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
        .animate-toast-progress { animation: toastProgress 2.2s linear; }

        @keyframes scanLine {
          0%, 100% { top: 8%; opacity: 0.4; }
          50% { top: 88%; opacity: 1; }
        }
        .animate-scan-line {
          animation: scanLine 2s ease-in-out infinite;
          position: absolute;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-in { animation: slideIn 0.3s ease-out; }

        #${QR_REGION_ID} {
          border-radius: 0.75rem;
          overflow: hidden;
        }
        #${QR_REGION_ID} video {
          width: 100% !important;
          height: auto !important;
          min-height: 280px !important;
          object-fit: cover !important;
        }

        /* ✅ انعكاس المرآة للكاميرا الأمامية */
        #${QR_REGION_ID}.front-camera video {
          transform: scaleX(-1) !important;
        }

        #${QR_REGION_ID} img[alt="Info icon"],
        #${QR_REGION_ID} > div:last-child {
          display: none !important;
        }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 99px; }

        input[type="range"] {
          -webkit-appearance: none;
          background: rgba(255,255,255,0.08);
          border-radius: 99px;
          height: 4px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #10b981;
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

/* ─── مكون معاينة الكاميرا ─── */
interface FaceCameraPreviewProps {
  isFrontCamera: boolean;
}

const FaceCameraPreview: React.FC<FaceCameraPreviewProps> = ({ isFrontCamera }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const draw = () => {
      if (video.readyState >= 2) {
        const size = 200;
        canvas.width = size;
        canvas.height = size;

        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
        ctx.clip();

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const minDim = Math.min(vw, vh);
        const sx = (vw - minDim) / 2;
        const sy = (vh - minDim) / 2;

        // ✅ انعكاس المرآة فقط للكاميرا الأمامية
        if (isFrontCamera) {
          ctx.translate(size, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, size, size);
        ctx.restore();
      }
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [isFrontCamera]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={200}
      className="w-48 h-48 rounded-full bg-gray-900"
    />
  );
};

export default QRAttendance;