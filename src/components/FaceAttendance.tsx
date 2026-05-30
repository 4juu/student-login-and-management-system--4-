import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Student, AttendanceSession } from '../types/student';
import { User } from '../types/user';
import {
  loadFaceModels, extractAllFaceDescriptors, compareFaces, normalizeDescriptor,
  areModelsLoaded, IOUTracker, shouldAutoImprove, autoImproveDescriptor, detectFaceDirection,
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

interface DetectedFaceBox {
  box: { x: number; y: number; width: number; height: number };
  student: Student | null;
  status: 'recognized' | 'already' | 'unknown';
  confidence: number;
  cx: number; cy: number;
}

const VIDEO_ID = 'face-attendance-video';
const CONFIDENCE_THRESHOLD = 0.55;
const RECOGNITION_COOLDOWN = 30000;

export const FaceAttendance: React.FC<FaceAttendanceProps> = ({
  students, activeSession, onMarkAttendance, onUpdateStudent,
  alreadyPresentIds, currentUser, onClose,
}) => {
  const [mode, setMode] = useState<FaceMode>('loading');
  const [recognizedStudent, setRecognizedStudent] = useState<Student | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState('');
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<IOUTracker | null>(null);
  const mountedRef = useRef(true);
  const faceRunningRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);
  const faceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecognitionRef = useRef<Map<string, number>>(new Map());
  const recognizedIdsRef = useRef<Set<string>>(new Set(alreadyPresentIds));
  const processingRef = useRef(false);

  const studentsWithFace = useMemo(() =>
    students.filter(s => s.faceDescriptor && (
      Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 : true
    )), [students]);

  useEffect(() => {
    mountedRef.current = true;
    if (areModelsLoaded()) {
      setModelsReady(true);
      initCamera();
      return;
    }
    loadFaceModels().then(() => {
      if (mountedRef.current) {
        setModelsReady(true);
        initCamera();
      }
    }).catch(() => {
      if (mountedRef.current) {
        setError('فشل تحميل موديلات التعرف على الوجوه');
        setMode('loading');
      }
    });
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, []);

  const cleanup = () => {
    faceRunningRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (faceTimerRef.current) clearTimeout(faceTimerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const initCamera = async () => {
    if (!mountedRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
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

  const getFaceCenter = (det: any) => {
    if (det.landmarks) {
      const pts = det.landmarks.positions;
      if (pts && pts.length > 0) {
        let sx = 0, sy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; }
        return { cx: sx / pts.length, cy: sy / pts.length };
      }
    }
    const box = det.detection?.box || det.box;
    return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
  };

  const calculateIoU = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 < x1 || y2 < y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / (a.width * a.height + b.width * b.height - inter);
  };

  const stopFaceLoop = useCallback(() => {
    faceRunningRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (faceTimerRef.current) clearTimeout(faceTimerRef.current);
    if (trackerRef.current) trackerRef.current.reset();
  }, []);

  const startFaceLoop = useCallback(() => {
    if (!faceRunningRef.current) faceRunningRef.current = true;
    if (!trackerRef.current) trackerRef.current = new IOUTracker();

    const detectedFaces = new Map<string, DetectedFaceBox>();
    const frameSkipRef = { val: 0 };
    const trackDescriptors = new Map<number, Float32Array[]>();
    let loopRunning = true;

    const processLoop = async () => {
      if (!faceRunningRef.current || !mountedRef.current) { loopRunning = false; return; }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.paused || video.ended) {
        faceTimerRef.current = setTimeout(processLoop, 300) as any;
        return;
      }

      frameSkipRef.val = (frameSkipRef.val + 1) % 3;
      if (frameSkipRef.val !== 0) {
        faceTimerRef.current = setTimeout(processLoop, 100) as any;
        return;
      }

      try {
        const detections = await Promise.race([
          extractAllFaceDescriptors(video, false, 640),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),
        ]) as any[];

        if (!faceRunningRef.current || !mountedRef.current) return;

        const now = Date.now();
        const tracked = trackerRef.current?.update(
          detections.map(d => ({ box: d.detection.box, descriptor: d.descriptor }))
        ) || [];

        const currentKeys = new Set<string>();

        for (const det of detections) {
          if (!faceRunningRef.current) break;
          if (processingRef.current) break;

          const box = det.detection.box;
          const qScore = det.detection.score;
          if (qScore < 0.75 || box.width < 50 || box.height < 50) continue;

          const track = tracked.find(t => calculateIoU(t.box, box) > 0.3);

          if (track) {
            const descs = trackDescriptors.get(track.id) || [];
            descs.push(det.descriptor);
            if (descs.length > 5) descs.shift();
            trackDescriptors.set(track.id, descs);
            if (descs.length < 2) continue;
          }

          const matchDesc = track && trackDescriptors.get(track.id)
            ? (() => {
                const ds = trackDescriptors.get(track.id)!;
                const out = new Float32Array(128);
                for (const d of ds) for (let i = 0; i < 128; i++) out[i] += d[i];
                for (let i = 0; i < 128; i++) out[i] /= ds.length;
                return normalizeDescriptor(out);
              })()
            : det.descriptor;

          const adaptiveThreshold = qScore < 0.85 ? 0.48 : qScore < 0.92 ? 0.52 : 0.55;

          let bestStudent: Student | null = null;
          let bestDist = Infinity;
          let bestConfidence = 0;

          for (const s of studentsWithFace) {
            if (!s.faceDescriptor) continue;
            const dist = compareFaces(matchDesc, s.faceDescriptor);
            if (dist < bestDist && dist < adaptiveThreshold) {
              bestDist = dist;
              bestStudent = s;
              bestConfidence = Math.round((1 - dist / adaptiveThreshold) * 100);
              if (bestConfidence >= 95) break;
            }
          }

          const fc = getFaceCenter(det);
          const boxKey = `${Math.round(box.x / 40)}_${Math.round(box.y / 40)}`;

          if (bestStudent) {
            const lastTime = lastRecognitionRef.current.get(bestStudent.id) || 0;
            const isDuplicate = now - lastTime < RECOGNITION_COOLDOWN;
            const isAlreadyMarked = recognizedIdsRef.current.has(bestStudent.id) || alreadyPresentIds.has(bestStudent.id);

            if (isAlreadyMarked || isDuplicate) {
              setRecognizedStudent(bestStudent);
              setConfidence(bestConfidence);
              setMode('already_marked');
              detectedFaces.set(boxKey, { box, student: bestStudent, status: 'already', confidence: bestConfidence, ...fc });
              setTimeout(() => { if (mountedRef.current) setMode('active'); }, 1500);
            } else {
              lastRecognitionRef.current.set(bestStudent.id, now);
              recognizedIdsRef.current.add(bestStudent.id);
              setRecognizedStudent(bestStudent);
              setConfidence(bestConfidence);
              setMode('info');
              detectedFaces.set(boxKey, { box, student: bestStudent, status: 'recognized', confidence: bestConfidence, ...fc });

              setTimeout(async () => {
                if (!mountedRef.current) return;
                setMode('marked');
                try { await onMarkAttendance(bestStudent!); } catch {}
                playSuccess();

                if (onUpdateStudent && bestStudent!.faceDescriptor && shouldAutoImprove(bestStudent!.faceDescriptor as any)) {
                  const dir = detectFaceDirection(det.landmarks);
                  const improved = autoImproveDescriptor(bestStudent!.faceDescriptor as any, det.descriptor, dir, bestConfidence / 100);
                  if (improved) onUpdateStudent(bestStudent!.id, { faceDescriptor: improved as any });
                }

                setTimeout(() => {
                  if (mountedRef.current) {
                    setRecognizedStudent(null);
                    setMode('active');
                  }
                }, 2500);
              }, 600);
            }
          } else {
            currentKeys.add(boxKey);
            detectedFaces.set(boxKey, { box, student: null, status: 'unknown', confidence: 0, ...fc });
          }
        }

        for (const key of detectedFaces.keys()) {
          if (!currentKeys.has(key)) detectedFaces.delete(key);
        }

        drawCanvas(video, canvas, detectedFaces);
      } catch {}
      if (loopRunning) faceTimerRef.current = setTimeout(processLoop, 350) as any;
    };

    processLoop();
    return () => { loopRunning = false; };
  }, [studentsWithFace, alreadyPresentIds, onMarkAttendance, onUpdateStudent]);

  const drawCanvas = (
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    faces: Map<string, DetectedFaceBox>
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

    faces.forEach(face => {
      if (face.status === 'unknown') return;

      let stroke = '#10b981';
      let label = face.student?.name || '';
      let sublabel = `${face.confidence}%`;

      if (face.status === 'already') {
        stroke = '#f59e0b';
        sublabel = 'مسجل مسبقاً';
      } else if (face.status === 'recognized') {
        stroke = '#3b82f6';
      }

      const dx = face.cx * sx - 40;
      const dy = face.cy * sy - 52;
      const dw = 80;
      const dh = 104;

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(dx, dy, dw, dh);

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const c = 8;
      ctx.beginPath();
      ctx.moveTo(dx, dy + c); ctx.lineTo(dx, dy); ctx.lineTo(dx + c, dy);
      ctx.moveTo(dx + dw - c, dy); ctx.lineTo(dx + dw, dy); ctx.lineTo(dx + dw, dy + c);
      ctx.moveTo(dx + dw, dy + dh - c); ctx.lineTo(dx + dw, dy + dh); ctx.lineTo(dx + dw - c, dy + dh);
      ctx.moveTo(dx + c, dy + dh); ctx.lineTo(dx, dy + dh); ctx.lineTo(dx, dy + dh - c);
      ctx.stroke();

      ctx.fillStyle = stroke + 'e0';
      const fs = 11;
      ctx.font = `bold ${fs}px Arial`;
      const tw = ctx.measureText(label).width;
      const tw2 = ctx.measureText(sublabel).width;
      const bw = Math.max(tw, tw2) + 12;
      ctx.beginPath();
      ctx.roundRect(dx + (dw - bw) / 2, dy - fs - 8, bw, fs + 6, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(label, dx + dw / 2, dy - 6);

      ctx.fillStyle = stroke + 'c0';
      ctx.beginPath();
      ctx.roundRect(dx + (dw - bw) / 2, dy + dh + 2, bw, fs + 6, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold 10px Arial`;
      ctx.fillText(sublabel, dx + dw / 2, dy + dh + fs + 2);
    });
  };

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

  const handleClose = () => {
    mountedRef.current = false;
    stopFaceLoop();
    cleanup();
    onClose();
  };

  const modeConfig = {
    loading: { icon: '⏳', text: 'جاري التحميل...', bg: 'bg-gray-600' },
    active: { icon: '🔍', text: 'البحث عن وجه...', bg: 'bg-emerald-500' },
    info: { icon: '👤', text: `تم التعرف على ${recognizedStudent?.name || ''}`, bg: 'bg-blue-500' },
    marked: { icon: '✅', text: 'تم تسجيل الحضور!', bg: 'bg-emerald-500' },
    already_marked: { icon: '⚠️', text: `${recognizedStudent?.name || ''} — مسجل مسبقاً`, bg: 'bg-amber-500' },
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900/90 border-b border-white/10"
        style={{ paddingTop: 'max(0.75rem,env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-3">
          <div className={`px-4 py-1.5 rounded-full text-white text-sm font-bold transition-all duration-300 flex items-center gap-2 ${modeConfig[mode].bg}`}>
            <span>{modeConfig[mode].icon}</span>
            <span className="truncate max-w-[200px]">{modeConfig[mode].text}</span>
          </div>
        </div>
        <button onClick={handleClose}
          className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-sm font-bold transition active:scale-95">
          ✕ إغلاق
        </button>
      </header>

      {/* Error */}
      {error && (
        <div className="absolute top-16 left-4 right-4 z-10 bg-red-600/90 text-white p-3 rounded-xl text-sm font-bold text-center">
          {error}
          <button onClick={initCamera} className="block mx-auto mt-2 bg-white/20 px-4 py-1.5 rounded-lg text-xs">
            🔄 إعادة المحاولة
          </button>
        </div>
      )}

      {/* Video + Canvas */}
      <div className="flex-1 relative bg-gray-900 overflow-hidden flex items-center justify-center">
        {studentsWithFace.length === 0 && mode !== 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="bg-gray-800/90 rounded-2xl p-6 text-center max-w-xs">
              <div className="text-4xl mb-3">📸</div>
              <p className="text-white font-bold text-lg">لا يوجد طلاب ببصمة وجه</p>
              <p className="text-gray-400 text-sm mt-1">قم بتسجيل بصمات الوجوه أولاً من خلال إدارة الطلاب</p>
            </div>
          </div>
        )}

        <video ref={videoRef} id={VIDEO_ID}
          autoPlay playsInline muted
          className="w-full h-full object-contain"
          style={{ transform: 'scaleX(-1)' }}
        />

        <canvas ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Mode indicator overlay */}
        {mode === 'marked' && recognizedStudent && (
          <div className="absolute bottom-0 left-0 right-0 p-6 pb-8 bg-gradient-to-t from-black/80 to-transparent">
            <div className="bg-gray-900/90 backdrop-blur-sm rounded-2xl p-5 border border-emerald-500/30 max-w-sm mx-auto">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                  {recognizedStudent.name.charAt(0)}
                </div>
                <div className="text-right flex-1 min-w-0">
                  <p className="text-white font-bold text-lg truncate">{recognizedStudent.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-emerald-400 text-xs font-bold bg-emerald-500/20 px-2 py-0.5 rounded-full">
                      #{recognizedStudent.code}
                    </span>
                    {recognizedStudent.group && (
                      <span className="text-gray-400 text-xs">🏷️ {recognizedStudent.group}</span>
                    )}
                  </div>
                </div>
                <div className="text-emerald-400 text-3xl">✅</div>
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 text-emerald-400/80 text-sm">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
                <span>تم تسجيل الحضور بنجاح</span>
              </div>
            </div>
          </div>
        )}

        {mode === 'already_marked' && recognizedStudent && (
          <div className="absolute top-16 left-4 right-4 z-10 bg-amber-600/90 backdrop-blur-sm text-white p-3 rounded-xl text-sm font-bold text-center shadow-lg">
            ⚠️ {recognizedStudent.name} — مسجل حضور مسبقاً
          </div>
        )}

        {mode === 'active' && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none">
            <div className="bg-gray-900/70 backdrop-blur-sm text-white/80 px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 border border-white/10">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
              أنظر إلى الكاميرا للتسجيل
            </div>
          </div>
        )}

        {mode === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-white font-bold">جاري تحميل موديلات التعرف...</p>
              <p className="text-gray-400 text-sm mt-1">قد يستغرق 5-10 ثواني لأول مرة</p>
            </div>
          </div>
        )}
      </div>

      {/* Student info quick bar */}
      {mode === 'info' && recognizedStudent && (
        <footer className="bg-gray-900/90 border-t border-blue-500/30 px-4 py-4">
          <div className="flex items-center gap-4 max-w-md mx-auto">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shrink-0">
              {recognizedStudent.name.charAt(0)}
            </div>
            <div className="text-right flex-1 min-w-0">
              <p className="text-white font-bold text-lg truncate">{recognizedStudent.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-blue-400 text-xs font-bold">#{recognizedStudent.code}</span>
                {recognizedStudent.group && (
                  <span className="text-gray-400 text-xs">🏷️ {recognizedStudent.group}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 text-blue-400">
              <span className="text-lg font-bold">{confidence}%</span>
            </div>
          </div>
        </footer>
      )}

      {/* Close button at bottom when no recognition */}
      {mode === 'error' && (
        <footer className="bg-gray-900/90 p-4">
          <button onClick={handleClose}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl active:scale-95 transition text-sm">
            ✕ إغلاق
          </button>
        </footer>
      )}
    </div>
  );
};

export default FaceAttendance;
