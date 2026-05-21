import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { AttendanceSession, Student } from '../types/student';

interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';
interface ToastMessage {
  type: ToastType;
  title: string;
  text?: string;
  student?: Student;
}

// ============================================================
// ⚡ وضع الأداء - يتحكم في الحرارة
// ============================================================
type PerformanceMode = 'eco' | 'balanced' | 'performance';

const PERFORMANCE_CONFIG: Record<PerformanceMode, {
  fps: number;
  refocusInterval: number;
  label: string;
  icon: string;
  desc: string;
  targetWidth: number;
  targetHeight: number;
}> = {
  eco: {
    fps: 10,
    refocusInterval: 8000,
    label: 'موفر',
    icon: '🌿',
    desc: 'أقل حرارة',
    targetWidth: 1280,
    targetHeight: 720,
  },
  balanced: {
    fps: 15,
    refocusInterval: 5000,
    label: 'متوازن',
    icon: '⚖️',
    desc: 'حرارة معتدلة',
    targetWidth: 1920,
    targetHeight: 1080,
  },
  performance: {
    fps: 25,
    refocusInterval: 2000,
    label: 'أداء',
    icon: '🚀',
    desc: 'حرارة أعلى',
    targetWidth: 2560,
    targetHeight: 1440,
  },
};

const QR_REGION_ID = 'qr-reader-fast-attendance';
const DUPLICATE_BLOCK_MS = 60_000;

const extractQrCodeId = (decodedText: string): string | null => {
  const raw = decodedText.trim();
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {}
  try {
    const obj = JSON.parse(raw);
    const possible = obj.qrCodeId || obj.qrId || obj.id ||
                     obj.studentId || obj.universityId || obj.code;
    if (possible) return String(possible).trim();
  } catch {}
  if (/^[A-Za-z0-9_-]{5,100}$/.test(raw)) return raw;
  return null;
};

const playSuccessFeedback = () => {
  try { navigator.vibrate?.([80, 40, 80]); } catch {}
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {}
};

const playErrorFeedback = () => {
  try { navigator.vibrate?.([200]); } catch {}
};

// ============================================================
// 🎯 دقة مناسبة حسب الوضع (بدون اختبار كل دقة = أسرع وأبرد)
// ============================================================
const getResolutionForMode = (mode: PerformanceMode) => {
  const config = PERFORMANCE_CONFIG[mode];
  return {
    width: { ideal: config.targetWidth, min: 640 },
    height: { ideal: config.targetHeight, min: 480 },
  };
};

const selectBestCamera = async (): Promise<MediaDeviceInfo | null> => {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    if (cameras.length === 0) return null;
    const backCameras = cameras.filter(c =>
      /back|rear|environment|wide/i.test(c.label)
    );
    if (backCameras.length === 0) return cameras[0];
    const mainCamera = backCameras.find(c => {
      const label = c.label.toLowerCase();
      return !label.includes('ultra') &&
             !label.includes('telephoto') &&
             !label.includes('tele');
    });
    return mainCamera || backCameras[0];
  } catch {
    return null;
  }
};

const getOptimalQrBox = (): { width: number; height: number } => {
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(200, Math.min(350, Math.floor(minDim * 0.65)));
  return { width: size, height: size };
};

const getOptimalCameraHeight = (): number => {
  return Math.max(280, Math.min(460, Math.floor(window.innerHeight * 0.48)));
};

export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students,
  activeSession,
  onMarkAttendance,
  onUpdateStudent,
  alreadyPresentIds,
  onClose,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);
  const lastScanRef = useRef<Record<string, number>>({});
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const refocusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);

  const [perfMode, setPerfMode] = useState<PerformanceMode>('balanced');
  const [cameraStarted, setCameraStarted] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [lastStudents, setLastStudents] = useState<Student[]>([]);
  const [pendingQrCodeId, setPendingQrCodeId] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [zoom, setZoom] = useState(2);
  const [maxZoom, setMaxZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [zoomStep, setZoomStep] = useState(0.1);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [supportsZoom, setSupportsZoom] = useState(false);
  const [cameraLabel, setCameraLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraHeight, setCameraHeight] = useState(getOptimalCameraHeight());
  const [resolution, setResolution] = useState('');
  const [focusStatus, setFocusStatus] = useState<'focusing' | 'locked' | 'idle'>('idle');
  const [distanceMode, setDistanceMode] = useState<'near' | 'medium' | 'far'>('medium');

  const studentsByQr = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => {
      if (s.qrCodeId) map.set(s.qrCodeId.trim(), s);
      if (s.universityId) map.set(s.universityId.trim(), s);
    });
    return map;
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students
      .filter((s) => {
        if (s.qrCodeId) return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          (s.group || '').toLowerCase().includes(q) ||
          (s.universityId || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 30);
  }, [students, studentSearch]);

  const showToast = useCallback((message: ToastMessage, timeout = 2200) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((cur) => (cur === message ? null : cur));
    }, timeout);
  }, []);

  const handleKnownStudent = useCallback(async (student: Student, qrCodeId: string) => {
    const now = Date.now();
    const lastTime = lastScanRef.current[qrCodeId] || 0;
    if (now - lastTime < DUPLICATE_BLOCK_MS) return;
    lastScanRef.current[qrCodeId] = now;
    if (alreadyPresentIds.has(student.id)) {
      showToast({
        type: 'warning',
        title: 'مسجل مسبقاً',
        text: `${student.name} مسجل حضور مسبقاً بهذا السجل`,
        student,
      }, 1800);
      return;
    }
    await onMarkAttendance(student);
    setScanCount((p) => p + 1);
    setLastStudents((p) =>
      [student, ...p.filter((s) => s.id !== student.id)].slice(0, 5)
    );
    playSuccessFeedback();
    showToast({
      type: 'success',
      title: `تم تسجيل ${student.name}`,
      text: student.group ? `الكروب: ${student.group}` : 'تم تسجيل الحضور بنجاح',
      student,
    });
  }, [alreadyPresentIds, onMarkAttendance, showToast]);

  const handleDecoded = useCallback(async (decodedText: string) => {
    if (isProcessingRef.current || isPausedRef.current) return;
    const qrCodeId = extractQrCodeId(decodedText);
    if (!qrCodeId) {
      playErrorFeedback();
      showToast({ type: 'error', title: 'QR غير صالح', text: 'لم يتم التعرف على رمز الهوية' });
      return;
    }
    isProcessingRef.current = true;
    try {
      const student = studentsByQr.get(qrCodeId);
      if (student) {
        await handleKnownStudent(student, qrCodeId);
      } else {
        const now = Date.now();
        if (now - (lastScanRef.current[qrCodeId] || 0) < DUPLICATE_BLOCK_MS) return;
        lastScanRef.current[qrCodeId] = now;
        setPendingQrCodeId(qrCodeId);
        playErrorFeedback();
        showToast({
          type: 'info',
          title: 'هوية غير مربوطة',
          text: 'اختر الطالب مرة واحدة فقط لربط الهوية',
        }, 3000);
      }
    } finally {
      window.setTimeout(() => { isProcessingRef.current = false; }, 350);
    }
  }, [studentsByQr, handleKnownStudent, showToast]);

  // ============================================================
  // 🎯 فوكس - بدون تغيير في المنطق
  // ============================================================
  const triggerRefocus = useCallback(async () => {
    const track = videoTrackRef.current;
    if (!track || isPausedRef.current) return;
    try {
      const capabilities = track.getCapabilities?.() as any;
      if (!capabilities?.focusMode) return;
      setFocusStatus('focusing');
      if (capabilities.focusMode.includes('manual')) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] as any });
          await new Promise(r => setTimeout(r, 100));
        } catch {}
      }
      if (capabilities.focusMode.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any });
      } else if (capabilities.focusMode.includes('auto')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'auto' }] as any });
      }
      if (capabilities.focusDistance) {
        const { min, max } = capabilities.focusDistance;
        const ratio = distanceMode === 'near' ? 0.2 : distanceMode === 'far' ? 0.8 : 0.5;
        const targetDistance = min + (max - min) * ratio;
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'manual', focusDistance: targetDistance }] as any,
          });
          await new Promise(r => setTimeout(r, 200));
          if (capabilities.focusMode.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any });
          }
        } catch {}
      }
      setTimeout(() => setFocusStatus('locked'), 500);
      setTimeout(() => setFocusStatus('idle'), 1500);
    } catch {
      setFocusStatus('idle');
    }
  }, [distanceMode]);

  const startPeriodicRefocus = useCallback((mode: PerformanceMode) => {
    if (refocusIntervalRef.current) clearInterval(refocusIntervalRef.current);
    const interval = PERFORMANCE_CONFIG[mode].refocusInterval;
    refocusIntervalRef.current = setInterval(() => triggerRefocus(), interval);
  }, [triggerRefocus]);

  const stopPeriodicRefocus = useCallback(() => {
    if (refocusIntervalRef.current) {
      clearInterval(refocusIntervalRef.current);
      refocusIntervalRef.current = null;
    }
  }, []);

  // ============================================================
  // ⚡ إعدادات الكاميرا المحسّنة لتقليل الحرارة
  // ============================================================
  const applyAdvancedCameraSettings = useCallback(async (mode: PerformanceMode) => {
    try {
      await new Promise(resolve => setTimeout(resolve, 800));

      const videoElement = document.querySelector(
        `#${QR_REGION_ID} video`
      ) as HTMLVideoElement;
      if (!videoElement?.srcObject) return;

      const stream = videoElement.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      videoTrackRef.current = track;

      const capabilities = track.getCapabilities?.() as any || {};
      const settings = track.getSettings?.() || {};

      setCameraLabel(track.label || '');
      if (settings.width && settings.height) {
        setResolution(`${settings.width}×${settings.height}`);
      }

      // ✅ تطبيق كل إعداد على حدة
      const applyOne = async (constraint: any) => {
        try {
          await track.applyConstraints({ advanced: [constraint] } as any);
        } catch {}
      };

      // Focus
      if (capabilities.focusMode?.includes('continuous')) {
        await applyOne({ focusMode: 'continuous' });
      } else if (capabilities.focusMode?.includes('auto')) {
        await applyOne({ focusMode: 'auto' });
      }

      // Exposure
      if (capabilities.exposureMode?.includes('continuous')) {
        await applyOne({ exposureMode: 'continuous' });
      }

      // White Balance
      if (capabilities.whiteBalanceMode?.includes('continuous')) {
        await applyOne({ whiteBalanceMode: 'continuous' });
      }

      // ⚡ Sharpness - نقلله في وضع Eco لتوفير المعالجة
      if (capabilities.sharpness) {
        const sharpVal = mode === 'eco'
          ? Math.floor((capabilities.sharpness.max + capabilities.sharpness.min) / 2)
          : capabilities.sharpness.max;
        await applyOne({ sharpness: sharpVal });
      }

      // ⚡ Contrast - معتدل
      if (capabilities.contrast) {
        const { min, max } = capabilities.contrast;
        const ratio = mode === 'eco' ? 0.5 : 0.7;
        await applyOne({ contrast: min + (max - min) * ratio });
      }

      // ⚡ ISO - نخليه أوطى في eco (أقل ضجيج + أقل معالجة)
      if (capabilities.iso) {
        const maxISO = mode === 'eco' ? 400 : mode === 'balanced' ? 600 : 800;
        await applyOne({ iso: Math.min(capabilities.iso.max, maxISO) });
      }

      // Exposure Compensation
      if (capabilities.exposureCompensation) {
        await applyOne({ exposureCompensation: 0 });
      }

      // Zoom - يبدأ بـ 2x
      if (capabilities.zoom) {
        const zMin = capabilities.zoom.min || 1;
        const zMax = capabilities.zoom.max || 1;
        const zStep = capabilities.zoom.step || 0.1;
        setMinZoom(zMin);
        setMaxZoom(zMax);
        setZoomStep(zStep);
        setSupportsZoom(zMax > zMin);
        const targetZoom = zMax >= 2 ? 2 : zMax >= 1.5 ? 1.5 : zMin;
        await applyOne({ zoom: targetZoom });
        setZoom(targetZoom);
      }

      // Torch - تلقائي
      if (capabilities.torch) {
        setHasTorch(true);
        try {
          await track.applyConstraints({ advanced: [{ torch: true }] as any });
          setTorchOn(true);
        } catch {}
      }

      // بدء الفوكس الدوري بالفترة المناسبة للوضع
      startPeriodicRefocus(mode);
      setTimeout(() => triggerRefocus(), 600);

    } catch (e) {
      console.error('فشل تطبيق إعدادات الكاميرا:', e);
    }
  }, [startPeriodicRefocus, triggerRefocus]);

  const applyZoom = useCallback(async (newZoom: number) => {
    if (!videoTrackRef.current || !supportsZoom) return;
    try {
      const v = Math.max(minZoom, Math.min(maxZoom, newZoom));
      await videoTrackRef.current.applyConstraints({ advanced: [{ zoom: v }] as any });
      setZoom(v);
    } catch {}
  }, [supportsZoom, minZoom, maxZoom]);

  const toggleTorch = useCallback(async () => {
    if (!videoTrackRef.current || !hasTorch) return;
    try {
      const next = !torchOn;
      await videoTrackRef.current.applyConstraints({ advanced: [{ torch: next }] as any });
      setTorchOn(next);
    } catch {}
  }, [hasTorch, torchOn]);

  const changeDistanceMode = useCallback((mode: 'near' | 'medium' | 'far') => {
    setDistanceMode(mode);
    if (supportsZoom) {
      applyZoom(mode === 'near' ? minZoom : mode === 'medium' ? 2 : 3);
    }
    setTimeout(() => triggerRefocus(), 300);
  }, [supportsZoom, minZoom, applyZoom, triggerRefocus]);

  // ============================================================
  // 🎯 بدء الكاميرا
  // ============================================================
  const startCamera = useCallback(async (mode: PerformanceMode = 'balanced') => {
    try {
      setErrorMessage('');
      const bestCamera = await selectBestCamera();
      const qrBox = getOptimalQrBox();
      const res = getResolutionForMode(mode);
      const fps = PERFORMANCE_CONFIG[mode].fps;

      const cameraConfig = bestCamera?.deviceId
        ? { deviceId: { exact: bestCamera.deviceId } }
        : { facingMode: 'environment' };

      const html5QrCode = new Html5Qrcode(QR_REGION_ID, {
        verbose: false,
        formatsToSupport: undefined,
      } as any);
      scannerRef.current = html5QrCode;

      const isPortrait = window.innerHeight > window.innerWidth;

      await html5QrCode.start(
        cameraConfig as any,
        {
          fps,
          qrbox: qrBox,
          aspectRatio: isPortrait ? 9 / 16 : 16 / 9,
          disableFlip: false,
          videoConstraints: {
            facingMode: 'environment',
            width: res.width,
            height: res.height,
            frameRate: { ideal: fps, max: fps },   // ⚡ تحديد max لمنع الارتفاع
            advanced: [
              { focusMode: 'continuous' } as any,
              { exposureMode: 'continuous' } as any,
              { whiteBalanceMode: 'continuous' } as any,
            ],
          } as any,
        },
        handleDecoded,
        () => {}
      );

      setCameraStarted(true);
      await applyAdvancedCameraSettings(mode);

    } catch (err: any) {
      const msg = err?.message || err?.toString() || '';
      let userMessage = 'فشل فتح الكاميرا';
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        userMessage = 'لم يتم السماح باستخدام الكاميرا. اسمح بها من إعدادات المتصفح.';
      } else if (msg.includes('NotFoundError')) {
        userMessage = 'لم يتم العثور على كاميرا في الجهاز';
      } else if (msg.includes('NotReadableError')) {
        userMessage = 'الكاميرا مستخدمة من تطبيق آخر.';
      } else {
        // Fallback بأبسط إعدادات
        try {
          const html5QrCode = new Html5Qrcode(QR_REGION_ID);
          scannerRef.current = html5QrCode;
          await html5QrCode.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            handleDecoded, () => {}
          );
          setCameraStarted(true);
          await applyAdvancedCameraSettings(mode);
          return;
        } catch {
          userMessage = 'إعدادات الكاميرا غير مدعومة على هذا الجهاز';
        }
      }
      setErrorMessage(userMessage);
      showToast({ type: 'error', title: 'فشل فتح الكاميرا', text: userMessage });
    }
  }, [handleDecoded, applyAdvancedCameraSettings, showToast]);

  const stopCamera = useCallback(async () => {
    try {
      stopPeriodicRefocus();
      if (torchOn && videoTrackRef.current) {
        try {
          await videoTrackRef.current.applyConstraints({ advanced: [{ torch: false }] as any });
        } catch {}
      }
      if (scannerRef.current) {
        try {
          if (scannerRef.current.getState()) await scannerRef.current.stop();
          await scannerRef.current.clear();
        } catch {}
      }
    } catch {}
    finally {
      scannerRef.current = null;
      videoTrackRef.current = null;
      setCameraStarted(false);
      setTorchOn(false);
    }
  }, [stopPeriodicRefocus, torchOn]);

  // ============================================================
  // ⚡ تغيير وضع الأداء - يعيد تشغيل الكاميرا
  // ============================================================
  const changePerfMode = useCallback(async (mode: PerformanceMode) => {
    setPerfMode(mode);
    await stopCamera();
    await new Promise(r => setTimeout(r, 500));
    await startCamera(mode);
  }, [stopCamera, startCamera]);

  // ============================================================
  // ⚡ إيقاف الكاميرا عند إخفاء الصفحة (Page Visibility API)
  // ============================================================
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isPausedRef.current = true;
        // إطفاء الفلاش عند الإخفاء لتوفير الطاقة
        if (videoTrackRef.current && torchOn) {
          videoTrackRef.current.applyConstraints({
            advanced: [{ torch: false }] as any,
          }).catch(() => {});
        }
      } else {
        isPausedRef.current = false;
        // إعادة الفلاش
        if (videoTrackRef.current && torchOn) {
          videoTrackRef.current.applyConstraints({
            advanced: [{ torch: true }] as any,
          }).catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [torchOn]);

  useEffect(() => {
    const handleResize = () => setCameraHeight(getOptimalCameraHeight());
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  useEffect(() => {
    startCamera('balanced');
    return () => { stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = async () => {
    await stopCamera();
    onClose();
  };

  const handleLinkStudent = async (student: Student) => {
    if (!pendingQrCodeId || !onUpdateStudent) return;
    const updated: Student = { ...student, qrCodeId: pendingQrCodeId };
    onUpdateStudent(student.id, { qrCodeId: pendingQrCodeId });
    setPendingQrCodeId(null);
    setStudentSearch('');
    await handleKnownStudent(updated, pendingQrCodeId);
  };

  const toastColors: Record<ToastType, string> = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-amber-500',
  };

  const distanceModeLabels = {
    near:   { icon: '📱', label: 'قريب' },
    medium: { icon: '📏', label: 'متوسط' },
    far:    { icon: '🔭', label: 'بعيد' },
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 text-white flex flex-col" dir="rtl">

      {/* ===== Header ===== */}
      <div className="p-3 bg-gray-900 border-b border-white/10 flex items-center justify-between gap-2 safe-area-top">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold truncate">التسجيل عن طريق هوية الطالب</h2>
          <p className="text-[10px] text-gray-400 truncate">
            {activeSession ? `السجل: ${activeSession.name}` : 'لا يوجد سجل نشط'}
            {resolution && <span className="opacity-60"> • {resolution}</span>}
          </p>
        </div>

        {/* مؤشرات الحالة */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* فوكس */}
          <div className={`w-2.5 h-2.5 rounded-full transition-colors duration-300 ${
            focusStatus === 'focusing' ? 'bg-yellow-400 animate-pulse' :
            focusStatus === 'locked'   ? 'bg-emerald-400' : 'bg-gray-600'
          }`} title="الفوكس" />
          {/* فلاش */}
          {torchOn && (
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-300 animate-pulse" title="الفلاش" />
          )}
        </div>

        <button
          onClick={handleClose}
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-bold text-sm active:scale-95 transition-transform"
        >
          إغلاق
        </button>
      </div>

      {/* ===== رسالة خطأ ===== */}
      {errorMessage && !cameraStarted && (
        <div className="m-4 p-4 bg-red-900/50 border border-red-500 rounded-xl text-center">
          <p className="text-red-200 font-bold mb-2">❌ {errorMessage}</p>
          <button
            onClick={() => startCamera(perfMode)}
            className="mt-2 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm"
          >
            🔄 إعادة المحاولة
          </button>
        </div>
      )}

      <div className="relative flex-1 flex flex-col items-center justify-start p-3 overflow-y-auto">

        {/* ===== الكاميرا ===== */}
        <div
          className="w-full max-w-2xl rounded-2xl overflow-hidden border-2 border-emerald-500/40 shadow-2xl bg-black relative"
          style={{ minHeight: `${cameraHeight}px` }}
        >
          <div id={QR_REGION_ID} className="w-full" style={{ minHeight: `${cameraHeight}px` }} />

          {cameraStarted && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative" style={{
                width: `${getOptimalQrBox().width}px`,
                height: `${getOptimalQrBox().height}px`,
              }}>
                <div className="absolute top-0 right-0 w-12 h-12 border-t-[3px] border-r-[3px] border-emerald-400 rounded-tr-xl shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <div className="absolute top-0 left-0 w-12 h-12 border-t-[3px] border-l-[3px] border-emerald-400 rounded-tl-xl shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <div className="absolute bottom-0 right-0 w-12 h-12 border-b-[3px] border-r-[3px] border-emerald-400 rounded-br-xl shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <div className="absolute bottom-0 left-0 w-12 h-12 border-b-[3px] border-l-[3px] border-emerald-400 rounded-bl-xl shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <div className="absolute inset-x-2 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(16,185,129,0.8)] animate-laser-scan" />
                <div className="absolute -bottom-7 inset-x-0 text-center">
                  <span className="text-[10px] text-emerald-300/70 bg-black/50 px-2 py-0.5 rounded-full">
                    وجّه الكاميرا نحو رمز QR
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== أدوات الكاميرا ===== */}
        {cameraStarted && (
          <div className="mt-3 w-full max-w-2xl space-y-2">

            {/* ⚡ وضع الأداء - الأهم لتقليل الحرارة */}
            <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
              <p className="text-[10px] text-gray-400 mb-1.5 font-bold">
                ⚡ وضع الأداء (يتحكم في الحرارة):
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['eco', 'balanced', 'performance'] as PerformanceMode[]).map((mode) => {
                  const cfg = PERFORMANCE_CONFIG[mode];
                  return (
                    <button
                      key={mode}
                      onClick={() => changePerfMode(mode)}
                      className={`py-2 px-1 rounded-lg text-xs font-bold transition-all active:scale-95 flex flex-col items-center gap-0.5 ${
                        perfMode === mode
                          ? mode === 'eco'
                            ? 'bg-green-700 text-white shadow-lg shadow-green-700/30'
                            : mode === 'balanced'
                            ? 'bg-blue-700 text-white shadow-lg shadow-blue-700/30'
                            : 'bg-orange-700 text-white shadow-lg shadow-orange-700/30'
                          : 'bg-white/10 text-gray-300 hover:bg-white/15'
                      }`}
                    >
                      <span className="text-base">{cfg.icon}</span>
                      <span>{cfg.label}</span>
                      <span className={`text-[9px] font-normal ${
                        perfMode === mode ? 'opacity-80' : 'opacity-50'
                      }`}>{cfg.desc}</span>
                    </button>
                  );
                })}
              </div>
              {/* معلومات الوضع الحالي */}
              <div className="mt-2 flex justify-between text-[9px] text-gray-500 px-1">
                <span>FPS: {PERFORMANCE_CONFIG[perfMode].fps}</span>
                <span>فوكس: كل {PERFORMANCE_CONFIG[perfMode].refocusInterval / 1000}ث</span>
                <span>دقة: {PERFORMANCE_CONFIG[perfMode].targetWidth}p</span>
              </div>
            </div>

            {/* المسافة + فلاش + فوكس */}
            <div className="bg-white/5 rounded-xl p-2 border border-white/5">
              <div className="flex gap-1.5 flex-wrap">
                {/* فوكس */}
                <button
                  onClick={() => triggerRefocus()}
                  className={`flex-1 min-w-[70px] py-2 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                    focusStatus === 'focusing'
                      ? 'bg-yellow-600 text-white animate-pulse'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {focusStatus === 'focusing' ? '🔄 تركيز...' : '🎯 فوكس'}
                </button>

                {/* فلاش */}
                {hasTorch && (
                  <button
                    onClick={toggleTorch}
                    className={`flex-1 min-w-[70px] py-2 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                      torchOn
                        ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {torchOn ? '💡 إطفاء' : '🔦 فلاش'}
                  </button>
                )}

                {/* المسافة */}
                {(['near', 'medium', 'far'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => changeDistanceMode(mode)}
                    className={`flex-1 min-w-[50px] py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                      distanceMode === mode
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    }`}
                  >
                    {distanceModeLabels[mode].icon} {distanceModeLabels[mode].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Zoom */}
            {supportsZoom && (
              <div className="bg-white/5 rounded-xl p-2 border border-white/5">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-emerald-300">
                    🔍 {zoom.toFixed(1)}x
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((z) => (
                      maxZoom >= z && (
                        <button
                          key={z}
                          onClick={() => applyZoom(z)}
                          className={`px-2 py-0.5 rounded text-xs font-bold transition active:scale-90 ${
                            Math.abs(zoom - z) < 0.2
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white/15 hover:bg-white/25'
                          }`}
                        >
                          {z}x
                        </button>
                      )
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min={minZoom}
                  max={maxZoom}
                  step={zoomStep}
                  value={zoom}
                  onChange={(e) => applyZoom(parseFloat(e.target.value))}
                  className="w-full h-2 accent-emerald-400 cursor-pointer"
                />
              </div>
            )}
          </div>
        )}

        {/* ===== إحصائيات ===== */}
        <div className="mt-3 grid grid-cols-2 gap-2 w-full max-w-2xl">
          <div className="bg-white/5 rounded-xl p-2.5 text-center border border-white/5">
            <div className="text-2xl font-bold text-emerald-400">{scanCount}</div>
            <div className="text-[10px] text-gray-400">تم تسجيلهم</div>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center border border-white/5">
            <div className="text-lg font-bold">
              {cameraStarted
                ? `🟢 ${PERFORMANCE_CONFIG[perfMode].icon} ${PERFORMANCE_CONFIG[perfMode].label}`
                : '🔴 متوقف'}
            </div>
            <div className="text-[10px] text-gray-400">
              {cameraStarted ? `${PERFORMANCE_CONFIG[perfMode].fps} FPS` : 'الكاميرا'}
            </div>
          </div>
        </div>

        {/* ===== آخر المسجلين ===== */}
        {lastStudents.length > 0 && (
          <div className="mt-3 w-full max-w-2xl bg-white/5 rounded-xl p-3 border border-white/5">
            <p className="text-xs font-bold mb-2 text-emerald-300">آخر المسجلين:</p>
            <div className="space-y-1">
              {lastStudents.map((s) => (
                <div key={s.id} className="flex justify-between items-center bg-black/25 rounded-lg px-3 py-1.5">
                  <span className="text-xs">{s.name}</span>
                  <span className="text-[10px] bg-emerald-600 px-2 py-0.5 rounded-full">{s.group || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== Toast ===== */}
        {toast && (
          <div className={`fixed top-16 left-1/2 -translate-x-1/2 ${toastColors[toast.type]} text-white rounded-2xl px-5 py-4 shadow-2xl w-[90%] max-w-md animate-bounce-in z-[10001]`}>
            <div className="flex items-center gap-3">
              <div className="text-3xl">
                {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}
              </div>
              <div>
                <p className="font-bold text-lg">{toast.title}</p>
                {toast.text && <p className="text-sm opacity-95">{toast.text}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== نافذة ربط الطالب ===== */}
      {pendingQrCodeId && (
        <div className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-2">ربط هوية طالب لأول مرة</h3>
            <p className="text-sm text-gray-600 mb-3">
              هذا الرمز غير مربوط بأي طالب. اختر الطالب مرة واحدة فقط، وبعدها يسجل تلقائياً.
            </p>
            <div className="mb-3 bg-gray-100 border rounded-lg p-2 text-xs font-mono break-all" dir="ltr">
              {pendingQrCodeId}
            </div>
            {!onUpdateStudent && (
              <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
                لا توجد صلاحية ربط.
              </div>
            )}
            <input
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الرمز أو الكروب..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
              autoFocus
            />
            <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
              {filteredStudents.length === 0 ? (
                <div className="p-4 text-center text-gray-500">لا توجد نتائج</div>
              ) : (
                filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => handleLinkStudent(student)}
                    className="w-full text-right p-3 hover:bg-emerald-50 flex items-center justify-between transition"
                    disabled={!onUpdateStudent}
                  >
                    <div>
                      <div className="font-bold">{student.name}</div>
                      <div className="text-xs text-gray-500">
                        الرمز: {student.code} | الكروب: {student.group || '-'}
                      </div>
                    </div>
                    <span className="text-emerald-600 font-bold">اختيار</span>
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => setPendingQrCodeId(null)}
              className="mt-4 w-full bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg font-bold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounceIn {
          0%   { opacity:0; transform:translate(-50%,-20px) scale(0.95); }
          60%  { opacity:1; transform:translate(-50%,5px) scale(1.02); }
          100% { opacity:1; transform:translate(-50%,0) scale(1); }
        }
        .animate-bounce-in { animation: bounceIn 0.25s ease-out; }

        @keyframes laserScan {
          0%,100% { top:5%;  opacity:0; }
          5%,95%  { opacity:1; }
          50%     { top:92%; opacity:0.6; }
        }
        .animate-laser-scan { animation:laserScan 2.5s ease-in-out infinite; position:absolute; }

        .safe-area-top { padding-top: max(0.75rem, env(safe-area-inset-top)); }

        #${QR_REGION_ID} video {
          width:100% !important;
          height:auto !important;
          min-height:${cameraHeight}px !important;
          object-fit:cover !important;
        }
        #${QR_REGION_ID} { border-radius:1rem; overflow:hidden; position:relative; }
        #${QR_REGION_ID} img[alt="Info icon"],
        #${QR_REGION_ID} > div:last-child { display:none !important; }

        input[type="range"] {
          -webkit-appearance:none; appearance:none;
          background:rgba(255,255,255,0.1); border-radius:999px; height:6px;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none; appearance:none;
          width:20px; height:20px; border-radius:50%;
          background:#10b981; cursor:pointer;
          box-shadow:0 0 6px rgba(16,185,129,0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width:20px; height:20px; border-radius:50%;
          background:#10b981; cursor:pointer; border:none;
        }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.2); border-radius:999px; }
      `}</style>
    </div>
  );
};

export default QRAttendance;