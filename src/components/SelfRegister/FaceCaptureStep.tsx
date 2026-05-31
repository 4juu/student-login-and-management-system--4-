import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Student } from '../../types/student';
import {
  loadFaceModels,
  captureSingleDirection,
  areModelsLoaded,
  normalizeDescriptor,
  checkForTamperingAsync,
  buildMultiDescriptor,
  drawFaceLandmarks,
  type CaptureProgress,
  type FaceDirection,
  type LightLevel,
  type QualityLevel,
  type MultiDescriptor,
} from '../../services/faceRecognition';

interface FaceCaptureStepProps {
  student: Student;
  matchPercentage: number;
  allStudents?: Student[];
  onCaptured: (faceDescriptor: MultiDescriptor) => void;
  onCancel: () => void;
}

interface CapturedFace {
  descriptor: Float32Array;
  quality: number;
  direction: FaceDirection;
  landmarks: { leftEye: Array<{ x: number; y: number }>; rightEye: Array<{ x: number; y: number }>; nose: Array<{ x: number; y: number }>; mouth: Array<{ x: number; y: number }>; jawOutline: Array<{ x: number; y: number }> };
  faceBox: { x: number; y: number; width: number; height: number };
  frameWidth: number;
  frameHeight: number;
  eyeDistance: number;
  noseWidth: number;
  mouthWidth: number;
  faceAspectRatio: number;
}

const DIR_EMOJI: Record<FaceDirection, string> = {
  center: '⬜', right: '➡️', left: '⬅️', up: '⬆️', down: '⬇️'
};

const QUALITY_COLORS: Record<QualityLevel, string> = {
  excellent: 'text-green-600 bg-green-50',
  good: 'text-blue-600 bg-blue-50',
  fair: 'text-amber-600 bg-amber-50',
  poor: 'text-red-600 bg-red-50'
};

const QUALITY_LABELS: Record<QualityLevel, string> = {
  excellent: '🟢 ممتاز', good: '🔵 جيد', fair: '🟡 مقبول', poor: '🔴 ضعيف'
};

const LIGHT_LABELS: Record<LightLevel, string> = {
  dark: '🌑 مظلم', dim: '🌙 خافت', good: '☀️ جيد', bright: '🔆 ساطع'
};

const ALL_DIRS: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

const DIR_PROMPTS: Record<FaceDirection, string> = {
  center: '👤 انظر للأمام',
  right: '👉 أدر رأسك لليمين',
  left: '👈 أدر رأسك لليسار',
  up: '👆 ارفع رأسك للأعلى',
  down: '👇 اخفض رأسك للأسفل',
};

export const FaceCaptureStep: React.FC<FaceCaptureStepProps> = ({
  student,
  matchPercentage,
  allStudents = [],
  onCaptured,
  onCancel,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const landmarkCanvasRef = useRef<HTMLCanvasElement>(null);

  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [capturingDir, setCapturingDir] = useState(false);
  const [dirError, setDirError] = useState('');
  const [currentDirIndex, setCurrentDirIndex] = useState(0);
  const [capturedFaces, setCapturedFaces] = useState<CapturedFace[]>([]);
  const [capInfo, setCapInfo] = useState<CaptureProgress | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    if (areModelsLoaded()) {
      setModelsReady(true);
      return;
    }

    (async () => {
      try {
        setModelsLoading(true);
        await loadFaceModels();
        if (!mountedRef.current) return;
        setModelsReady(true);
      } catch (e: any) {
        console.error('فشل تحميل الموديلات:', e);
        if (mountedRef.current) {
          setError('فشل تحميل نظام التعرف على الوجوه');
        }
      } finally {
        if (mountedRef.current) {
          setModelsLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!modelsReady) return;

    let localStream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        localStream = stream;
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;

          try {
            await videoRef.current.play();
          } catch (playErr: any) {
            if (playErr.name !== 'AbortError' && !cancelled) {
              throw playErr;
            }
            return;
          }
        }

        setTimeout(() => {
          if (!cancelled && mountedRef.current) {
            setCameraReady(true);
          }
        }, 1000);

      } catch (e: any) {
        if (cancelled) return;
        console.error('فشل فتح الكاميرا:', e);

        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setError('يرجى السماح للموقع باستخدام الكاميرا من إعدادات المتصفح');
        } else if (e.name === 'NotFoundError') {
          setError('لم يتم العثور على كاميرا في جهازك');
        } else if (e.name === 'NotReadableError') {
          setError('الكاميرا مستخدمة من تطبيق آخر. أغلق التطبيقات الأخرى وحاول مرة ثانية');
        } else if (e.name !== 'AbortError') {
          setError(e.message || 'فشل فتح الكاميرا');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      if (streamRef.current === localStream) {
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [modelsReady]);

  // 🖌️ رسم معالم الوجه على Canvas
  useEffect(() => {
    const canvas = landmarkCanvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container || !capInfo || !capInfo.landmarks) {
      if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFaceLandmarks(ctx, capInfo, canvas.width, canvas.height, true);
  }, [capInfo]);

  const handleCaptureDirection = async () => {
    if (!videoRef.current || capturingDir) return;
    setCapturingDir(true);
    setDirError('');
    setCapInfo(null);

    try {
      const result = await captureSingleDirection(
        videoRef.current,
        true,
        videoRef.current
      );

      if (!result) {
        setDirError('لم يتم التعرف على الوجه. تأكد من الإضاءة وأن وجهك واضح');
        setCapturingDir(false);
        return;
      }

      setCapInfo({
        progress: 100,
        phase: 'capture',
        direction: result.direction,
        directionLabel: '',
        capturedDirections: new Set(),
        totalGood: capturedFaces.length + 1,
        currentScore: Math.round(result.quality * 100),
        faceDetected: true,
        qualityLevel: result.quality >= 0.8 ? 'excellent' : result.quality >= 0.6 ? 'good' : result.quality >= 0.4 ? 'fair' : 'poor',
        lightLevel: 'good',
        rotationAngle: 0,
        rotationCoverage: 100,
        landmarks: result.landmarks,
        faceBox: result.faceBox,
        eyeDistance: result.eyeDistance,
        noseWidth: result.noseWidth,
        mouthWidth: result.mouthWidth,
        faceAspectRatio: result.faceAspectRatio,
        frameWidth: result.frameWidth,
        frameHeight: result.frameHeight,
      });

      const newFace: CapturedFace = {
        descriptor: result.descriptor,
        quality: result.quality,
        direction: result.direction,
        landmarks: result.landmarks,
        faceBox: result.faceBox,
        frameWidth: result.frameWidth,
        frameHeight: result.frameHeight,
        eyeDistance: result.eyeDistance,
        noseWidth: result.noseWidth,
        mouthWidth: result.mouthWidth,
        faceAspectRatio: result.faceAspectRatio,
      };

      const newCaptured = [...capturedFaces, newFace];
      setCapturedFaces(newCaptured);

      if (currentDirIndex < ALL_DIRS.length - 1) {
        setTimeout(() => {
          if (mountedRef.current) {
            setCurrentDirIndex(currentDirIndex + 1);
            setCapturingDir(false);
            setCapInfo(null);
          }
        }, 600);
      } else {
        await finishCapture(newCaptured);
      }
    } catch (e: any) {
      setDirError(e.message || 'فشل التقاط الوجه');
      setCapturingDir(false);
    }
  };

  const finishCapture = async (faces: CapturedFace[]) => {
    try {
      const centerFace = faces.find(f => f.direction === 'center') || faces[0];
      const angleDescs = new Map<FaceDirection, Float32Array[]>();
      const capturedDirs = new Set<FaceDirection>();

      for (const f of faces) {
        if (!angleDescs.has(f.direction)) angleDescs.set(f.direction, []);
        angleDescs.get(f.direction)!.push(f.descriptor);
        capturedDirs.add(f.direction);
      }

      const avgQuality = faces.reduce((s, f) => s + f.quality, 0) / faces.length;
      const multiDesc = buildMultiDescriptor(centerFace.descriptor, angleDescs, avgQuality, capturedDirs);

      if (allStudents.length > 1) {
        const normalized = normalizeDescriptor(new Float32Array(centerFace.descriptor));
        const tamper = await checkForTamperingAsync(normalized, allStudents, student.id || '');
        if (tamper.isTamper) {
          setCapturingDir(false);
          setCurrentDirIndex(0);
          setCapturedFaces([]);
          setCapInfo(null);
          setError(`⚠️ هذه البصمة مسجلة أصلاً للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}\nلا يمكن تسجيلها لطالب آخر.`);
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
          }
          return;
        }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      setTimeout(() => {
        onCaptured(multiDesc as any);
      }, 1000);

    } catch (e: any) {
      console.error('❌ خطأ في حفظ البصمة:', e);
      setError(e.message || 'فشل حفظ البصمة');
      setCapturingDir(false);
    }
  };

  const handleRetry = () => {
    setError('');
    setDirError('');
    setCapturingDir(false);
    setCapturedFaces([]);
    setCurrentDirIndex(0);
    setCapInfo(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setTimeout(() => { if (mountedRef.current) setCameraReady(true); }, 1000);
      } catch (e: any) {
        if (!mountedRef.current) return;
        setError(e.message || 'فشل فتح الكاميرا');
      }
    })();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-5 md:p-6 max-w-md w-full">

        <div className="text-center mb-4">
          <div className="text-4xl mb-2">😊</div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">تسجيل بصمة الوجه</h2>
          <p className="text-xs text-gray-600">
            مرحباً <span className="font-bold text-purple-700">{student.name}</span>
          </p>
          {matchPercentage >= 90 && (
            <div className="mt-2 inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
              ✓ تطابق الاسم: {matchPercentage}%
            </div>
          )}
        </div>

        <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-start gap-2">
            <span className="text-base">🔒</span>
            <p className="text-xs text-emerald-800">
              <strong>خصوصيتك محمية:</strong> الكاميرا تعمل محلياً، ولا يتم حفظ أي صورة.
              فقط أرقام رياضية (128 رقم) تُحفظ لتمييز وجهك.
            </p>
          </div>
        </div>

        {modelsLoading && (
          <div className="text-center py-6">
            <div className="inline-block w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-600 font-medium">جاري تحميل نظام التعرف على الوجوه...</p>
            <p className="text-xs text-gray-400 mt-1">قد يستغرق 5-10 ثوانٍ</p>
          </div>
        )}

        {error && !capturingDir && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm whitespace-pre-line">
            {error}
          </div>
        )}

        {modelsReady && !modelsLoading && (
          <div className="relative mb-4">
            <div className="relative rounded-2xl overflow-hidden bg-gray-900 aspect-square mx-auto" style={{ maxWidth: 320 }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas ref={landmarkCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {cameraReady && !capturingDir && !capInfo && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-56 h-56 border-4 border-purple-400/70 rounded-full"
                       style={{ boxShadow: '0 0 40px rgba(168,85,247,0.4)' }} />
                </div>
              )}

              {cameraReady && !capturingDir && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 200 200">
                  {ALL_DIRS.map((dir, i) => {
                    const isCenter = dir === 'center';
                    const cx = isCenter ? 100 : 100 + 92 * Math.cos((({ right: 90, down: 180, left: 270, up: 0 } as Record<string, number>)[dir] - 90) * (Math.PI / 180));
                    const cy = isCenter ? 100 : 100 + 92 * Math.sin((({ right: 90, down: 180, left: 270, up: 0 } as Record<string, number>)[dir] - 90) * (Math.PI / 180));
                    const done = i < currentDirIndex;
                    const isCurrent = i === currentDirIndex;
                    const r = isCenter ? 10 : isCurrent ? 8 : 6;
                    return (
                      <g key={dir}>
                        <circle cx={cx} cy={cy} r={r}
                          fill={isCurrent ? '#f59e0b' : done ? '#10b981' : 'rgba(139,92,246,0.2)'}
                          stroke={isCurrent ? '#d97706' : done ? '#065f46' : 'rgba(139,92,246,0.4)'}
                          strokeWidth={isCurrent ? 3 : 2}
                        />
                        {isCurrent && (
                          <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.5">
                            <animate attributeName="r" values={`${r + 4};${r + 8};${r + 4}`} dur="1.2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.5;0;0.5" dur="1.2s" repeatCount="indefinite" />
                          </circle>
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {capturingDir && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}

        {cameraReady && !capturingDir && !error && modelsReady && !modelsLoading && (
          <>
            <div className="text-center mb-3">
              <div className="font-bold text-sm text-gray-800">
                {DIR_PROMPTS[ALL_DIRS[currentDirIndex]]}
              </div>
              <p className="text-xs text-gray-500 mt-1">{currentDirIndex + 1} / {ALL_DIRS.length}</p>
              <div className="flex justify-center gap-2 mt-1">
                {ALL_DIRS.map((dir, i) => (
                  <span key={dir} className={`text-lg transition-opacity ${
                    i < currentDirIndex ? 'opacity-100' : i === currentDirIndex ? 'opacity-100' : 'opacity-25'
                  }`}>
                    {DIR_EMOJI[dir]}
                  </span>
                ))}
              </div>
            </div>

            {dirError && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{dirError}</div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={onCancel} className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95">
                إلغاء
              </button>
              <button onClick={handleCaptureDirection} className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold rounded-lg active:scale-95">
                تم ✅
              </button>
            </div>
          </>
        )}

        {error && !capturingDir && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCancel} className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg active:scale-95">
              إلغاء
            </button>
            <button onClick={handleRetry} className="py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold rounded-lg active:scale-95">
              🔄 إعادة المحاولة
            </button>
          </div>
        )}

        {modelsReady && !modelsLoading && cameraReady && !capturingDir && !error && currentDirIndex === 0 && capturedFaces.length === 0 && (
          <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-xl">
            <p className="text-xs font-bold text-purple-800 mb-2">📋 التعليمات:</p>
            <ul className="text-xs text-purple-700 space-y-1 list-decimal list-inside">
              <li>ضع وجهك أمام الكاميرا</li>
              <li>اضغط <strong>"تم ✅"</strong> لكل اتجاه</li>
              <li>اتبع التعليمات: أمام، يمين، يسار، أعلى، أسفل</li>
              <li>مطلوب <strong>5 اتجاهات</strong> فقط</li>
            </ul>
          </div>
        )}

      </div>
    </div>
  );
};

export default FaceCaptureStep;
