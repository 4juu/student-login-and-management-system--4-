import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Student } from '../types/student';
import {
  loadFaceModels, areModelsLoaded,
  captureSingleDirection,
  buildMultiDescriptor, checkForTamperingAsync,
  drawFaceLandmarks,
  type CaptureProgress, type FaceDirection, type QualityLevel, type LightLevel,
} from '../services/faceRecognition';

interface FaceRegistrationProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

type Step = 'search' | 'camera' | 'capture' | 'success' | 'confirm';

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

const DIR_EMOJI: Record<FaceDirection, string> = { center: '⬜', right: '➡️', left: '⬅️', up: '⬆️', down: '⬇️' };
const QUALITY_COLORS: Record<QualityLevel, string> = { excellent: 'text-green-600 bg-green-50', good: 'text-blue-600 bg-blue-50', fair: 'text-amber-600 bg-amber-50', poor: 'text-red-600 bg-red-50' };
const QUALITY_LABELS: Record<QualityLevel, string> = { excellent: '🟢 ممتاز', good: '🔵 جيد', fair: '🟡 مقبول', poor: '🔴 ضعيف' };
const LIGHT_LABELS: Record<LightLevel, string> = { dark: '🌑 مظلم', dim: '🌙 خافت', good: '☀️ جيد', bright: '🔆 ساطع' };
const ALL_DIRS: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

const DIR_PROMPTS: Record<FaceDirection, string> = {
  center: '👤 انظر للأمام',
  right: '👉 أدر رأسك لليمين',
  left: '👈 أدر رأسك لليسار',
  up: '👆 ارفع رأسك للأعلى',
  down: '👇 اخفض رأسك للأسفل',
};

export const FaceRegistration: React.FC<FaceRegistrationProps> = ({ students, onUpdateStudent, onClose }) => {
  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturingDir, setCapturingDir] = useState(false);
  const [dirError, setDirError] = useState('');
  const [currentDirIndex, setCurrentDirIndex] = useState(0);
  const [capturedFaces, setCapturedFaces] = useState<CapturedFace[]>([]);
  const [capInfo, setCapInfo] = useState<CaptureProgress | null>(null);
  const [captureQuality, setCaptureQuality] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const landmarkCanvasRef = useRef<HTMLCanvasElement>(null);

  const filtered = search.trim()
    ? students.filter(s =>
        s.code.includes(search.trim()) ||
        s.name.toLowerCase().includes(search.trim().toLowerCase())
      ).slice(0, 10)
    : [];

  useEffect(() => {
    mountedRef.current = true;
    if (step === 'search') setTimeout(() => searchRef.current?.focus(), 300);
    if (areModelsLoaded()) { setModelsReady(true); return; }
    loadFaceModels().then(() => { if (mountedRef.current) setModelsReady(true); }).catch(() => {});
  }, [step]);

  const openCamera = useCallback(async (f: 'user' | 'environment') => {
    setError('');
    setCameraReady(false);
    try {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: f, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setTimeout(() => { if (mountedRef.current) setCameraReady(true); }, 500);
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (e.name === 'NotAllowedError') setError('الرجاء السماح باستخدام الكاميرا');
      else if (e.name === 'NotFoundError') setError('لا توجد كاميرا');
      else setError(e.message || 'فشل فتح الكاميرا');
    }
  }, []);

  const hasFaceDesc = (s: Student) => s.faceDescriptor && (
    Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 :
    typeof s.faceDescriptor === 'object' ? true : true
  );

  const handleSelectStudent = (s: Student) => {
    setSelectedStudent(s);
    if (hasFaceDesc(s)) setStep('confirm');
    else setStep('camera');
  };

  const handleCameraChoice = (f: 'user' | 'environment') => {
    setFacing(f);
    setCurrentDirIndex(0);
    setCapturedFaces([]);
    setDirError('');
    setCapInfo(null);
    setStep('capture');
    setTimeout(() => openCamera(f), 400);
  };

  // 🖌️ رسم معالم الوجه على Canvas
  useEffect(() => {
    const canvas = landmarkCanvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container || !capInfo || !capInfo.landmarks) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFaceLandmarks(ctx, capInfo, canvas.width, canvas.height, facing === 'user');
  }, [capInfo, facing]);

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

      if (students.length > 1 && selectedStudent) {
        const tamper = await checkForTamperingAsync(centerFace.descriptor, students, selectedStudent.id, 0.35);
        if (tamper.isTamper) {
          setError(`⚠️ هذا الوجه مسجل للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`);
          setCapturingDir(false);
          setCurrentDirIndex(0);
          setCapturedFaces([]);
          return;
        }
      }

      setCaptureQuality(Math.round(avgQuality * 100));
      onUpdateStudent(selectedStudent!.id, { faceDescriptor: multiDesc as any, faceRegisteredAt: new Date().toISOString() });
      cleanupCamera();
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'فشل حفظ البصمة');
      setCapturingDir(false);
    }
  };

  const cleanupCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  const handleRetry = () => {
    setError('');
    setCapturingDir(false);
    openCamera(facing);
  };

  const handleBackToSearch = () => {
    cleanupCamera();
    setSelectedStudent(null);
    setSearch('');
    setStep('search');
    setError('');
    setCapturingDir(false);
    setCurrentDirIndex(0);
    setCapturedFaces([]);
    setDirError('');
    setCapInfo(null);
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  useEffect(() => {
    return () => { cleanupCamera(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-3" dir="rtl"
      onClick={e => { e.stopPropagation(); searchRef.current?.focus(); }}
      onKeyDown={e => e.stopPropagation()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[96vh] overflow-y-auto">

        {/* Search Step */}
        {step === 'search' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">📸</div>
              <h3 className="text-lg font-bold text-gray-800">إضافة بصمة وجه</h3>
              <p className="text-xs text-gray-500 mt-1">ابحث عن الطالب بكود أو اسم</p>
            </div>
            <input
              ref={searchRef}
              value={search}
              onChange={e => { e.stopPropagation(); setSearch(e.target.value); }}
              onFocus={e => e.stopPropagation()}
              onKeyDown={e => e.stopPropagation()}
              placeholder="ابحث بكود الطالب أو اسمه..."
              inputMode="search"
              autoFocus
              className="w-full p-3 border-2 border-purple-300 rounded-xl text-sm focus:border-purple-500 outline-none"
            />
            {filtered.length > 0 && (
              <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
                {filtered.map(s => {
                  const hasFace = s.faceDescriptor && (
                    Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 :
                    typeof s.faceDescriptor === 'object' ? true : true
                  );
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSelectStudent(s)}
                      className="w-full text-right p-3 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-gray-800 truncate">{s.name}</div>
                        <div className="text-[10px] text-gray-500">#{s.code}{s.group ? ` • ${s.group}` : ''}</div>
                      </div>
                      {hasFace && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">لديه بصمة</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {search.trim() && filtered.length === 0 && (
              <p className="mt-3 text-center text-sm text-gray-500">❌ لا يوجد طالب بهذا الاسم أو الكود</p>
            )}
            <button onClick={onClose} className="w-full mt-4 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">إلغاء</button>
          </div>
        )}

        {/* Confirm Update Step */}
        {step === 'confirm' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3">🔄</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">بصمة موجودة</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-bold text-amber-800 mb-1">{selectedStudent.name}</p>
              <p className="text-xs text-amber-600">هذا الطالب لديه بصمة مسجلة بالفعل. هل تريد تحديثها؟</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleBackToSearch} className="py-3.5 bg-gray-200 text-gray-700 font-bold rounded-xl active:scale-95 text-sm">إلغاء</button>
              <button onClick={() => setStep('camera')} className="py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl active:scale-95 text-sm">✅ تحديث</button>
            </div>
          </div>
        )}

        {/* Camera Choice Step */}
        {step === 'camera' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-4xl mb-2">📷</div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">{selectedStudent.name}</h3>
            <p className="text-xs text-gray-500 mb-4">اختر الكاميرا</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleCameraChoice('user')}
                className="py-6 bg-gradient-to-br from-purple-500 to-pink-600 text-white font-bold rounded-2xl active:scale-95 transition-transform"
              >
                <div className="text-3xl mb-2">🤳</div>
                <div className="text-sm">أمامية</div>
              </button>
              <button
                onClick={() => handleCameraChoice('environment')}
                className="py-6 bg-gradient-to-br from-blue-500 to-cyan-600 text-white font-bold rounded-2xl active:scale-95 transition-transform"
              >
                <div className="text-3xl mb-2">📷</div>
                <div className="text-sm">خلفية</div>
              </button>
            </div>
            <button onClick={handleBackToSearch} className="w-full mt-4 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
          </div>
        )}

        {/* Capture Step — يدوي خطوة بخطوة */}
        {step === 'capture' && selectedStudent && (
          <div className="p-4">
            <div className="text-center mb-3">
              <h3 className="text-sm font-bold text-gray-800 truncate">{selectedStudent.name}</h3>
              <p className="text-[10px] text-gray-500">{currentDirIndex + 1} / {ALL_DIRS.length}</p>
            </div>

            {error && !capturingDir && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs whitespace-pre-line">{error}</div>
            )}

            <div className="relative mb-3">
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 mx-auto" style={{ width: 260, height: 260 }}>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
                <canvas ref={landmarkCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                {!cameraReady && !error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {cameraReady && !capturingDir && !capInfo && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-52 h-52 border-4 border-purple-400/70 rounded-full" style={{ boxShadow: '0 0 40px rgba(168,85,247,0.4)' }} />
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

            {cameraReady && !capturingDir && (
              <>
                <div className="text-center mb-3">
                  <div className="font-bold text-sm text-gray-800">
                    {DIR_PROMPTS[ALL_DIRS[currentDirIndex]]}
                  </div>
                  <div className="flex justify-center gap-2 mt-2">
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
                  <button onClick={handleBackToSearch} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">
                    🔙 رجوع
                  </button>
                  <button onClick={handleCaptureDirection} className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-lg active:scale-95 text-sm">
                    تم ✅
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Success Step */}
        {step === 'success' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3 animate-bounce">🎉</div>
            <h3 className="text-lg font-bold text-green-700 mb-1">تم تسجيل البصمة!</h3>
            <p className="text-gray-800 font-bold">{selectedStudent.name}</p>
            {capturedFaces.length > 0 && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-2.5">
                <div className="flex justify-center gap-3 mb-2">
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{capturedFaces.length}</div>
                    <div className="text-[8px] text-green-500">اتجاه</div>
                  </div>
                  <div className="w-px bg-green-200" />
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{Math.round(capturedFaces.reduce((s, f) => s + f.quality, 0) / capturedFaces.length * 100)}%</div>
                    <div className="text-[8px] text-green-500">الجودة</div>
                  </div>
                </div>
                <div className="flex justify-center gap-1">
                  {ALL_DIRS.map(dir => {
                    const captured = capturedFaces.some(f => f.direction === dir);
                    return <span key={dir} className={`text-sm ${captured ? '' : 'opacity-20'}`}>{DIR_EMOJI[dir]}</span>;
                  })}
                </div>
                <div className="text-lg font-extrabold mt-1 text-green-700">
                  {captureQuality}%
                </div>
              </div>
            )}
            <button onClick={onClose} className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-lg active:scale-95 text-sm">👍 موافق</button>
          </div>
        )}

      </div>
    </div>
  );
};

export default FaceRegistration;
