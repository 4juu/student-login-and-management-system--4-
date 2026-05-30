import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Student, AttendanceSession } from '../types/student';
import { User } from '../types/user';
import { FaceRegistration } from './FaceRegistration';
import {
  loadFaceModels, extractAllFaceDescriptors, normalizeDescriptor,
  areModelsLoaded, IOUTracker, shouldAutoImprove, autoImproveDescriptor, detectFaceDirection,
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

const RECOGNITION_COOLDOWN = 30000;
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3];

export const FaceAttendance: React.FC<FaceAttendanceProps> = ({
  students, activeSession, onMarkAttendance, onUpdateStudent,
  alreadyPresentIds, currentUser, onClose,
}) => {
  const [mode, setMode] = useState<FaceMode>('loading');
  const [error, setError] = useState('');
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [showReg, setShowReg] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const trackerRef = useRef<IOUTracker | null>(null);
  const mountedRef = useRef(true);
  const rafRef = useRef<number>(0);
  const lastRecognitionRef = useRef<Map<string, number>>(new Map());
  const recognizedIdsRef = useRef<Set<string>>(new Set(alreadyPresentIds));
  const logsRef = useRef<LogEntry[]>([]);
  const faceRunningRef = useRef(false);
  const lastFrameTime = useRef(0);
  const frameCount = useRef(0);

  const studentsWithFace = useMemo(() =>
    students.filter(s => s.faceDescriptor && (
      Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 : true
    )), [students]);

  const addLog = (entry: LogEntry) => {
    logsRef.current = [entry, ...logsRef.current].slice(0, 50);
    setLogs(logsRef.current);
  };

  useEffect(() => {
    mountedRef.current = true;
    if (studentsWithFace.length > 0) {
      buildDescriptorCache(studentsWithFace as any, 0.6);
    }
    if (areModelsLoaded()) { setModelsReady(true); initCamera(); return; }
    loadFaceModels().then(() => {
      if (mountedRef.current) { setModelsReady(true); initCamera(); }
    }).catch(() => {
      if (mountedRef.current) { setError('فشل تحميل موديلات التعرف'); }
    });
    return () => { mountedRef.current = false; cleanup(); clearDescriptorCache(); };
  }, []);

  useEffect(() => {
    if (studentsWithFace.length > 0) {
      buildDescriptorCache(studentsWithFace as any, 0.6);
    } else {
      clearDescriptorCache();
    }
  }, [studentsWithFace]);

  const cleanup = () => {
    faceRunningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
    try {
      await cleanup();
      await new Promise(r => setTimeout(r, 300));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
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
        await videoRef.current.play();
        setCameraReady(true);
        setMode('active');
        startFaceLoop();
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } },
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
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
    if (!faceRunningRef.current) faceRunningRef.current = true;
    if (!trackerRef.current) trackerRef.current = new IOUTracker();
    lastFrameTime.current = performance.now();
    frameCount.current = 0;

    const detectedFaces = new Map<string, DetectedFaceBox>();
    const trackDescriptors = new Map<number, Float32Array[]>();

    const processFrame = async () => {
      if (!faceRunningRef.current || !mountedRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.paused || video.ended) {
        rafRef.current = requestAnimationFrame(processFrame);
        return;
      }

      frameCount.current++;

      const cache = getDescriptorCache();
      const hasCache = cache && cache.length > 0;

      try {
        const detections = await extractAllFaceDescriptors(video, false, 480);

        if (!faceRunningRef.current || !mountedRef.current) return;

        const now = Date.now();
        const tracked = trackerRef.current?.update(
          detections.map((d: any) => ({ box: d.detection.box, descriptor: d.descriptor }))
        ) || [];

        if (detections.length === 0) {
          frameCount.current = Math.min(frameCount.current + 1, 100);
        } else {
          frameCount.current = 0;
        }

        if (detections.length > 0 && hasCache) {
          const descriptors = detections.map((d: any) => normalizeDescriptor(d.descriptor));
          const matches = await findBestMatchBatchFromCache(descriptors, 0.55);

          if (!faceRunningRef.current || !mountedRef.current) return;

          for (let fi = 0; fi < detections.length; fi++) {
            const det = detections[fi];
            const box = det.detection.box;
            const qScore = det.detection.score;
            if (qScore < 0.75 || box.width < 50 || box.height < 50) continue;

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
              const lastTime = lastRecognitionRef.current.get(bestStudent.id) || 0;
              const isDuplicate = now - lastTime < RECOGNITION_COOLDOWN;
              const isAlreadyMarked = recognizedIdsRef.current.has(bestStudent.id) || alreadyPresentIds.has(bestStudent.id);

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
                    const dir = detectFaceDirection(det.landmarks);
                    const improved = autoImproveDescriptor(bestStudent!.faceDescriptor as any, det.descriptor, dir, confidence / 100);
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
        } else if (detections.length > 0 && !hasCache && studentsWithFace.length > 0) {
          for (const det of detections) {
            const box = det.detection.box;
            const qScore = det.detection.score;
            if (qScore < 0.75 || box.width < 50 || box.height < 50) continue;

            const track = tracked.find((t: any) => calculateIoU(t.box, box) > 0.3);
            let matchDesc = det.descriptor;

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

            const adaptiveThreshold = qScore < 0.85 ? 0.48 : qScore < 0.92 ? 0.52 : 0.55;
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
              const lastTime = lastRecognitionRef.current.get(bestStudent.id) || 0;
              const isDuplicate = now - lastTime < RECOGNITION_COOLDOWN;
              const isAlreadyMarked = recognizedIdsRef.current.has(bestStudent.id) || alreadyPresentIds.has(bestStudent.id);

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
                    const dir = detectFaceDirection(det.landmarks);
                    const improved = autoImproveDescriptor(bestStudent!.faceDescriptor as any, det.descriptor, dir, bestConfidence / 100);
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

        drawBoxes(video, canvas, detectedFaces, facing);
      } catch {}

      if (faceRunningRef.current && mountedRef.current) {
        rafRef.current = requestAnimationFrame(processFrame);
      }
    };

    rafRef.current = requestAnimationFrame(processFrame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [studentsWithFace, alreadyPresentIds, onMarkAttendance, onUpdateStudent]);

  const drawBoxes = (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    faces: Map<string, DetectedFaceBox>,
    camFacing: string
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

    const sx = canvas.width / vw, sy = canvas.height / vh;
    const mirrorX = camFacing === 'user';

    faces.forEach(face => {
      const box = face.box;
      const dx = mirrorX ? canvas.width - box.x * sx - box.width * sx : box.x * sx;
      const dy = box.y * sy;
      const dw = box.width * sx;
      const dh = box.height * sy;

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
      setTimeout(() => initCamera(), 400);
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

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col" dir="rtl">
      <header className="flex items-center justify-between px-3 py-2 bg-gray-900/90 border-b border-white/10"
        style={{ paddingTop: 'max(0.5rem,env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1 rounded-full text-white text-xs font-bold transition-all duration-300 flex items-center gap-1.5 ${modeConfig[mode].bg}`}>
            <span>{modeConfig[mode].icon}</span>
            <span className="truncate max-w-[140px]">{modeConfig[mode].text}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowLog(!showLog)}
            className={`${showLog ? 'bg-blue-600' : 'bg-white/10'} hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 flex items-center gap-1`}>
            <span>📋</span>
            {counts.marked + counts.already > 0 && (
              <span className="bg-emerald-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{counts.marked + counts.already}</span>
            )}
          </button>
          <button onClick={handleShowReg}
            className="bg-purple-600/80 hover:bg-purple-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 flex items-center gap-1">
            <span>📸</span>
            <span className="hidden sm:inline">بصمة</span>
          </button>
          <button onClick={handleClose}
            className="bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95">
            ✕
          </button>
        </div>
      </header>

      {showLog && (
        <div className="absolute top-12 right-2 z-30 w-64 bg-gray-900/98 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <p className="text-white font-bold text-xs flex items-center gap-1.5">
              📋 سجل الحضور
              <span className="text-[10px] text-gray-400 font-normal">({logs.length})</span>
            </p>
            <button onClick={() => setShowLog(false)}
              className="text-gray-400 hover:text-white text-sm">✕</button>
          </div>
          <div className="flex gap-2 px-3 py-1.5 text-[10px] border-b border-white/5">
            <span className="text-emerald-400">✅ {counts.marked} جديد</span>
            <span className="text-amber-400">⚠️ {counts.already} مسبق</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
            {logs.length === 0 && (
              <p className="text-gray-500 text-[10px] text-center py-4">بانتظار التعرف...</p>
            )}
            {logs.map((entry, i) => (
              <div key={`${entry.id}-${i}`}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] ${
                  entry.status === 'marked' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : entry.status === 'already' ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                  : 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold truncate max-w-[120px]">
                    {entry.status === 'marked' ? '✅ ' : entry.status === 'already' ? '⚠️ ' : '⏳ '}
                    {entry.name}
                  </span>
                  <span className="text-[9px] opacity-70 shrink-0">{entry.confidence}%</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] opacity-50">#{entry.code}</span>
                  <span className="text-[9px] opacity-50">{entry.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-14 left-4 right-4 z-10 bg-red-600/90 text-white p-3 rounded-xl text-sm font-bold text-center">
          {error}
          <button onClick={initCamera} className="block mx-auto mt-2 bg-white/20 px-4 py-1.5 rounded-lg text-xs">🔄 إعادة</button>
        </div>
      )}

      <div className="flex-1 relative bg-gray-900 flex items-center justify-center overflow-hidden">
        {studentsWithFace.length === 0 && mode !== 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="bg-gray-800/90 rounded-2xl p-6 text-center max-w-xs">
              <div className="text-4xl mb-3">📸</div>
              <p className="text-white font-bold text-lg">لا يوجد طلاب ببصمة وجه</p>
              <p className="text-gray-400 text-sm mt-1">سجل بصمات الوجوه أولاً</p>
              <button onClick={handleShowReg} className="mt-4 bg-purple-600 text-white px-5 py-2 rounded-xl text-sm font-bold">📸 إضافة بصمة الآن</button>
            </div>
          </div>
        )}

        <video ref={videoRef}
          autoPlay playsInline muted
          className="w-full h-full object-contain"
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
        />

        <canvas ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {cameraReady && (
          <div className="absolute bottom-4 left-4 right-4 z-10">
            {mode === 'active' && studentsWithFace.length > 0 && (
              <div className="flex justify-center mb-2 pointer-events-none">
                <div className="bg-gray-900/70 backdrop-blur-sm text-white/80 px-4 py-2 rounded-full text-xs font-medium flex items-center gap-2 border border-white/10">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                  أنظر إلى الكاميرا للتسجيل
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 bg-gray-900/80 backdrop-blur-sm rounded-2xl px-3 py-2 border border-white/10 mx-auto w-fit">
              <button onClick={toggleCamera}
                className="w-9 h-9 flex items-center justify-center bg-white/15 text-white rounded-full active:scale-90 text-sm"
                title="تبديل الكاميرا">
                🔄
              </button>

              <div className="flex items-center gap-1 px-1 border-r border-l border-white/10">
                {ZOOM_STEPS.map(s => (
                  <button key={s} onClick={() => applyZoom(s)}
                    className={`px-2 py-1 rounded-md text-[10px] font-bold transition active:scale-90 ${
                      Math.abs(zoom - s) < 0.01 ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}>
                    {s}x
                  </button>
                ))}
              </div>

              {hasTorch && (
                <button onClick={toggleTorch}
                  className={`w-9 h-9 flex items-center justify-center rounded-full active:scale-90 text-sm ${
                    torchOn ? 'bg-yellow-500 text-black' : 'bg-white/15 text-white'
                  }`}
                  title="فلاش">
                  {torchOn ? '💡' : '🔦'}
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-white font-bold text-sm">جاري تحميل موديلات التعرف...</p>
            </div>
          </div>
        )}
      </div>

      {showReg && onUpdateStudent && (
        <FaceRegistration
          students={students}
          onUpdateStudent={onUpdateStudent}
          onClose={handleRegClose}
        />
      )}
    </div>
  );
};

export default FaceAttendance;
