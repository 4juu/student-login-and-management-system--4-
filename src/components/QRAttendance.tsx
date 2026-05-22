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
type ScanMode = 'qr' | 'face';
type CameraFacing = 'environment' | 'user';

interface ToastMessage {
  type: ToastType;
  title: string;
  text?: string;
  student?: Student;
}

const QR_REGION_ID = 'qr-reader-region';
const DUPLICATE_BLOCK_MS = 30_000;
const FACE_DUPLICATE_BLOCK_MS = 60_000;

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

/* ─── حجم صندوق QR المناسب ─── */
const getQrBox = (): { width: number; height: number } => {
  const min = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(180, Math.min(300, Math.floor(min * 0.6)));
  return { width: size, height: size };
};

/* ─── حساب التكبير الافتراضي ─── */
const getDefaultZoom = (facing: CameraFacing, mode: ScanMode, maxZoom: number): number => {
  // وضع الوجه = بدون تكبير
  if (mode === 'face') return Math.min(maxZoom, 1);
  // QR = تكبير 1.5x
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
  const containerRef = useRef<HTMLDivElement>(null);
  const faceIntervalRef = useRef<number | null>(null);
  const faceProcessingRef = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const qrCodeInputRef = useRef<HTMLInputElement>(null);

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

  /* Face Register Dialog */
  const [showFaceRegister, setShowFaceRegister] = useState(false);
  const [registerCode, setRegisterCode] = useState('');
  const [registerStep, setRegisterStep] = useState<'code' | 'capturing' | 'success'>('code');
  const [registerStudent, setRegisterStudent] = useState<Student | null>(null);
  const [registerMessage, setRegisterMessage] = useState('');
  const [captureProgress, setCaptureProgress] = useState(0); // 0-100

  /* ─── خريطة الطلاب ─── */
  const studentMap = useMemo(() => {
    const m = new Map<string, Student>();
    students.forEach(s => {
      if (s.qrCodeId) m.set(s.qrCodeId.trim(), s);
      if (s.universityId) m.set(s.universityId.trim(), s);
    });
    return m;
  }, [students]);

  /* ─── طلاب لديهم بصمة ─── */
  const studentsWithFace = useMemo(() => {
    return students.filter(s => s.faceDescriptor && s.faceDescriptor.length > 0);
  }, [students]);

  /* ─── Toast ─── */
  const showToast = useCallback((msg: ToastMessage, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(prev => (prev === msg ? null : prev)), ms);
  }, []);

  /* ─── معالجة طالب معروف (QR) ─── */
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

  /* ─── معالجة QR مقروء ─── */
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
        // focus بعد قليل
        setTimeout(() => qrCodeInputRef.current?.focus(), 200);
      }
    } finally {
      setTimeout(() => { processingRef.current = false; }, 300);
    }
  }, [studentMap, processKnown]);

  /* ─── إعدادات الكاميرا بعد التشغيل ─── */
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
            disableFlip: currentFacing === 'environment',
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
              disableFlip: currentFacing === 'environment',
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
        setErrorMsg('يرجى السماح باستخدام الكاميرا من إعدادات المتصفح');
      } else if (msg.includes('NotFound')) {
        setErrorMsg('لا توجد كاميرا في هذا الجهاز');
      } else if (msg.includes('NotReadable')) {
        setErrorMsg('الكاميرا مستخدمة من تطبيق آخر');
      } else {
        setErrorMsg('فشل تشغيل الكاميرا - حاول مرة أخرى');
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
    if (mode !== 'face' || faceModelsReady) return;

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

  /* ─── عند تفعيل وضع الوجه، حوّل للأمامية + ضبط التكبير ─── */
  useEffect(() => {
    if (!cameraReady) return;
    
    if (mode === 'face') {
      // إذا الكاميرا خلفية، حوّل للأمامية
      if (facing === 'environment') {
        setFacing('user');
        startCamera('user', 'face');
      } else {
        // اضبط التكبير لـ 1x
        if (canZoom && trackRef.current) {
          applyZoom(1);
        }
      }
    } else {
      // QR mode - اضبط التكبير 1.5x
      if (canZoom && trackRef.current) {
        applyZoom(1.5);
      }
    }
  }, [mode]); // eslint-disable-line

  /* ─── مسح الوجوه المستمر ─── */
  useEffect(() => {
    if (mode !== 'face' || !cameraReady || !faceModelsReady) {
      if (faceIntervalRef.current) {
        clearInterval(faceIntervalRef.current);
        faceIntervalRef.current = null;
      }
      return;
    }

    if (studentsWithFace.length === 0) return;

    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!video) return;

    faceIntervalRef.current = window.setInterval(async () => {
      if (faceProcessingRef.current || !video || video.readyState < 2) return;
      if (showFaceRegister) return;
      faceProcessingRef.current = true;

      try {
        const detections = await extractAllFaceDescriptors(video);
        if (detections.length === 0) return;

        for (const detection of detections) {
          const match = findBestMatch(detection.descriptor, studentsWithFace, 0.5);
          if (!match) continue;

          const student = match.item;
          const now = Date.now();

          const lastTime = lastScansRef.current[`face_${student.id}`] || 0;
          if (now - lastTime < FACE_DUPLICATE_BLOCK_MS) continue;

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
      } catch (e) {
        // تجاهل
      } finally {
        faceProcessingRef.current = false;
      }
    }, 500);

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

  /* ─── ربط QR بكود الطالب ─── */
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

  /* ─── التقاط بصمة الطالب (سريع جداً) ─── */
  const captureFaceForRegister = useCallback(async (student: Student) => {
    if (!onUpdateStudent) return;

    const video = document.querySelector(`#${QR_REGION_ID} video`) as HTMLVideoElement;
    if (!video || video.readyState < 2) {
      setRegisterMessage('❌ الكاميرا غير جاهزة');
      return;
    }

    setRegisterStep('capturing');
    setCaptureProgress(0);

    // ✨ شريط تقدم سريع
    let progress = 0;
    const progressInterval = window.setInterval(() => {
      progress = Math.min(progress + 12, 90);
      setCaptureProgress(progress);
    }, 40);

    try {
      await loadFaceModels();
      playCapture();

      // محاولات سريعة جداً
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
        setRegisterMessage('❌ لم يتم رؤية الوجه. تأكد من الإضاءة');
        playError();
        // أعد التركيز
        setTimeout(() => codeInputRef.current?.focus(), 100);
        return;
      }

      // ✅ نجاح - أكمل الشريط
      setCaptureProgress(100);

      onUpdateStudent(student.id, {
        faceDescriptor: descriptorToArray(descriptor),
        faceRegisteredAt: new Date().toISOString(),
      });

      playSuccess();
      setRegisterStep('success');

      // إغلاق سريع وإعادة تجهيز للطالب التالي
      setTimeout(() => {
        setRegisterCode('');
        setRegisterStudent(null);
        setRegisterMessage('');
        setCaptureProgress(0);
        setRegisterStep('code');
        // ✨ نبقي النافذة مفتوحة لتسجيل طلاب آخرين بسرعة
        setTimeout(() => codeInputRef.current?.focus(), 100);
      }, 1200);
    } catch (e) {
      clearInterval(progressInterval);
      console.error(e);
      setCaptureProgress(0);
      setRegisterStep('code');
      setRegisterMessage('❌ حدث خطأ. حاول مرة أخرى');
      playError();
    }
  }, [onUpdateStudent]);

  /* ─── معالجة إدخال الكود ─── */
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
      // إعادة تسجيل
      setRegisterMessage(`♻️ إعادة تسجيل ${student.name}`);
    } else {
      setRegisterMessage('');
    }

    setRegisterStudent(student);
    // ابدأ الالتقاط فوراً!
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

  const isFrontCamera = facing === 'user';

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col" dir="rtl" ref={containerRef}>

      {/* ═══ Header ═══ */}
      <header className="flex items-center justify-between px-3 py-2 bg-gray-900/90 border-b border-white/10"
              style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate">
            {mode === 'qr' ? '📷 ماسح QR' : '😊 بصمة الوجه'}
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
            className="bg-red-600 active:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold
                       active:scale-95 transition-transform"
          >
            ✕ إغلاق
          </button>
        </div>
      </header>

      {/* ═══ تبديل الوضع ═══ */}
      <div className="px-3 py-2 bg-gray-900/60 border-b border-white/5 flex gap-2">
        <button
          onClick={() => setMode('qr')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
            mode === 'qr'
              ? 'bg-emerald-600 text-white shadow-lg'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          🔳 مسح QR
        </button>
        <button
          onClick={() => setMode('face')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
            mode === 'face'
              ? 'bg-purple-600 text-white shadow-lg'
              : 'bg-white/10 text-gray-300'
          }`}
        >
          😊 بصمة الوجه
        </button>
      </div>

      {/* ═══ مؤشر تحميل موديل الوجه ═══ */}
      {mode === 'face' && faceLoading && (
        <div className="mx-3 mt-2 p-3 bg-purple-900/60 border border-purple-500/50 rounded-lg text-center">
          <div className="inline-block w-5 h-5 border-2 border-purple-300 border-t-transparent rounded-full animate-spin mb-1" />
          <p className="text-xs text-purple-200">جاري تحميل نظام التعرف على الوجه...</p>
        </div>
      )}

      {/* ═══ تنبيه وضع الوجه ═══ */}
      {mode === 'face' && faceModelsReady && cameraReady && studentsWithFace.length > 0 && (
        <div className="mx-3 mt-2 p-2 bg-purple-900/40 border border-purple-500/30 rounded-lg text-center">
          <p className="text-[11px] text-purple-200">
            👁️ النظام يراقب... مر قبال الكاميرا لتسجيل حضورك
          </p>
          <p className="text-[10px] text-purple-300 mt-0.5">
            {studentsWithFace.length} بصمة مسجلة
          </p>
        </div>
      )}

      {mode === 'face' && faceModelsReady && cameraReady && studentsWithFace.length === 0 && (
        <div className="mx-3 mt-2 p-3 bg-amber-900/40 border border-amber-500/40 rounded-lg text-center">
          <p className="text-xs text-amber-200 font-bold">
            ℹ️ لا توجد بصمات مسجلة
          </p>
          <p className="text-[10px] text-amber-300 mt-1">
            استخدم زر "➕ إضافة بصمة" لتسجيل أول طالب
          </p>
        </div>
      )}

      {/* ═══ خطأ ═══ */}
      {errorMsg && !cameraReady && (
        <div className="mx-3 mt-3 p-4 bg-red-900/60 border border-red-500/50 rounded-xl text-center">
          <p className="text-red-200 text-sm mb-2">{errorMsg}</p>
          <button
            onClick={() => startCamera(facing, mode)}
            className="bg-red-600 active:bg-red-700 px-4 py-2 rounded-lg text-xs font-bold
                       active:scale-95 transition-transform"
          >
            🔄 إعادة المحاولة
          </button>
        </div>
      )}

      {/* ═══ المحتوى ═══ */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* الكاميرا */}
        <div className="w-full max-w-lg mx-auto rounded-xl overflow-hidden border border-emerald-500/30 bg-gray-900 relative">
          <div
            id={QR_REGION_ID}
            className="w-full"
            style={{ minHeight: '280px' }}
          />

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

          {/* إطار وضع الوجه */}
          {cameraReady && mode === 'face' && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-48 h-64 border-4 border-purple-400/60 rounded-3xl shadow-[0_0_30px_rgba(168,85,247,0.3)]" />
            </div>
          )}

          {/* زر تبديل الكاميرا */}
          {cameraReady && (
            <button
              onClick={toggleCamera}
              className="absolute top-2 left-2 bg-black/60 hover:bg-black/80 active:scale-95 text-white p-2 rounded-full shadow-lg transition-all"
              title={isFrontCamera ? 'تبديل للكاميرا الخلفية' : 'تبديل للكاميرا الأمامية'}
            >
              <span className="text-xl">🔄</span>
            </button>
          )}

          {/* مؤشر الكاميرا */}
          {cameraReady && (
            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">
              {isFrontCamera ? '📱 أمامية' : '📷 خلفية'}
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

              {/* زر إضافة بصمة */}
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
                  <div className="flex gap-1">
                    <button
                      onClick={() => applyZoom(zoom - 0.5)}
                      className="w-6 h-6 bg-white/10 rounded text-xs font-bold active:scale-90"
                    >−</button>
                    <button
                      onClick={() => applyZoom(zoom + 0.5)}
                      className="w-6 h-6 bg-white/10 rounded text-xs font-bold active:scale-90"
                    >+</button>
                  </div>
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

        {/* آخر المسجلين */}
        {recentStudents.length > 0 && (
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

      {/* ═══ Toast من فوق ═══ */}
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
          {/* شريط تقدم سفلي */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 overflow-hidden rounded-b-2xl">
            <div className="h-full bg-white/60 animate-toast-progress" />
          </div>
        </div>
      )}

      {/* ═══ نافذة ربط QR (بالكود فقط) ═══ */}
      {pendingQrId && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔗</div>
              <h3 className="text-lg font-bold text-gray-800">ربط هوية جديدة</h3>
              <p className="text-xs text-gray-500 mt-1">أدخل كود الطالب لربطه بهذه الهوية</p>
            </div>

            <div className="bg-gray-100 rounded p-1.5 text-[10px] font-mono break-all mb-3 text-center" dir="ltr">
              {pendingQrId.slice(0, 30)}{pendingQrId.length > 30 ? '...' : ''}
            </div>

            {!onUpdateStudent && (
              <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-xs text-center">
                لا توجد صلاحية ربط
              </div>
            )}

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

      {/* ═══ نافذة تسجيل بصمة الوجه ═══ */}
      {showFaceRegister && (
        <div className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl">

            {/* الخطوة 1: إدخال الكود */}
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
                    💡 الالتقاط فوري وتلقائي بعد إدخال الكود
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

            {/* الخطوة 2: الالتقاط - مع عرض الكاميرا والشريط الدائري */}
            {registerStep === 'capturing' && registerStudent && (
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-800 mb-1">
                  {registerStudent.name}
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  {registerStudent.code} • {registerStudent.group || '-'}
                </p>

                {/* الكاميرا مع الشريط الدائري */}
                <div className="relative inline-block mb-3">
                  <FaceCameraPreview />
                  
                  {/* SVG Progress Ring */}
                  <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 200 200">
                    {/* الخلفية */}
                    <circle
                      cx="100"
                      cy="100"
                      r="95"
                      fill="none"
                      stroke="rgba(239, 68, 68, 0.2)"
                      strokeWidth="6"
                    />
                    {/* التقدم */}
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

            {/* الخطوة 3: نجاح */}
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
          from { 
            opacity: 0; 
            transform: translate(-50%, -100%); 
          }
          to { 
            opacity: 1; 
            transform: translate(-50%, 0); 
          }
        }
        .animate-toast-drop { 
          animation: toastDrop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); 
        }

        @keyframes toastIcon {
          0% { transform: scale(0.5) rotate(-20deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(10deg); }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        .animate-toast-icon {
          animation: toastIcon 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
        .animate-toast-progress {
          animation: toastProgress 2.2s linear;
        }

        @keyframes scanLine {
          0%, 100% { top: 8%; opacity: 0.4; }
          50%      { top: 88%; opacity: 1; }
        }
        .animate-scan-line {
          animation: scanLine 2s ease-in-out infinite;
          position: absolute;
        }

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
        #${QR_REGION_ID} img[alt="Info icon"],
        #${QR_REGION_ID} > div:last-child {
          display: none !important;
        }

        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 99px; }

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

/* ─── مكون معاينة الكاميرا داخل نافذة التسجيل ─── */
const FaceCameraPreview: React.FC = () => {
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

        // قص دائري
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
        ctx.clip();

        // ارسم الفيديو بشكل مربع وسطه
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const minDim = Math.min(vw, vh);
        const sx = (vw - minDim) / 2;
        const sy = (vh - minDim) / 2;

        // اقلب الصورة (mirror) للكاميرا الأمامية
        ctx.translate(size, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, size, size);
        ctx.restore();
      }
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, []);

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