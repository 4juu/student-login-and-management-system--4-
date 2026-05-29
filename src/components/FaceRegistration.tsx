import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Student } from '../types/student';
import {
  loadFaceModels, extractFaceDescriptorMultiCapture, areModelsLoaded,
  buildMultiDescriptor, checkForTamperingAsync,
  type CaptureProgress, type FaceDirection, type QualityLevel, type LightLevel,
} from '../services/faceRecognition';

interface FaceRegistrationProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

type Step = 'search' | 'camera' | 'capture' | 'success';

const DIR_EMOJI: Record<FaceDirection, string> = { center: '⬜', right: '➡️', left: '⬅️', up: '⬆️', down: '⬇️' };
const QUALITY_COLORS: Record<QualityLevel, string> = { excellent: 'text-green-600 bg-green-50', good: 'text-blue-600 bg-blue-50', fair: 'text-amber-600 bg-amber-50', poor: 'text-red-600 bg-red-50' };
const QUALITY_LABELS: Record<QualityLevel, string> = { excellent: '🟢 ممتاز', good: '🔵 جيد', fair: '🟡 مقبول', poor: '🔴 ضعيف' };
const LIGHT_LABELS: Record<LightLevel, string> = { dark: '🌑 مظلم', dim: '🌙 خافت', good: '☀️ جيد', bright: '🔆 ساطع' };
const ALL_DIRS: FaceDirection[] = ['center', 'right', 'left', 'up', 'down'];

export const FaceRegistration: React.FC<FaceRegistrationProps> = ({ students, onUpdateStudent, onClose }) => {
  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [capInfo, setCapInfo] = useState<CaptureProgress | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const filtered = search.trim()
    ? students.filter(s =>
        s.code.includes(search.trim()) ||
        s.name.toLowerCase().includes(search.trim().toLowerCase())
      ).slice(0, 10)
    : [];

  useEffect(() => {
    mountedRef.current = true;
    if (areModelsLoaded()) { setModelsReady(true); return; }
    loadFaceModels().then(() => { if (mountedRef.current) setModelsReady(true); }).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

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

  const handleSelectStudent = (s: Student) => {
    setSelectedStudent(s);
    setStep('camera');
  };

  const handleCameraChoice = (f: 'user' | 'environment') => {
    setFacing(f);
    setStep('capture');
    setTimeout(() => openCamera(f), 100);
  };

  const handleStartCapture = useCallback(() => {
    if (!videoRef.current || !cameraReady || capturing) return;
    setCountdown(3);
    let c = 3;
    const iv = setInterval(() => {
      c--;
      if (c > 0) { setCountdown(c); }
      else {
        clearInterval(iv);
        setCountdown(0);
        startCapture();
      }
    }, 1000);
  }, [cameraReady, capturing]);

  const startCapture = async () => {
    if (!videoRef.current) return;
    setCapturing(true);
    setError('');
    try {
      const result = await extractFaceDescriptorMultiCapture(
        videoRef.current,
        (info) => { if (mountedRef.current) setCapInfo(info); }
      );
      if (!result || !result.descriptor) {
        setError('لم نتمكن من التقاط الوجه بوضوح. تأكد من الإضاءة وأن وجهك في المنتصف');
        setCapturing(false);
        return;
      }
      if (students.length > 1 && selectedStudent) {
        const tamper = await checkForTamperingAsync(result.descriptor, students, selectedStudent.id, 0.35);
        if (tamper.isTamper) {
          setError(`⚠️ هذا الوجه مسجل للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`);
          setCapturing(false);
          return;
        }
      }
      const multiDesc = buildMultiDescriptor(result.descriptor, result.angleDescs, result.quality, result.directions);
      if (selectedStudent) {
        onUpdateStudent(selectedStudent.id, { faceDescriptor: multiDesc as any, faceRegisteredAt: new Date().toISOString() });
      }
      cleanupCamera();
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'فشل التقاط الوجه');
      setCapturing(false);
    }
  };

  const cleanupCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  const handleRetry = () => {
    setError('');
    setCapturing(false);
    openCamera(facing);
  };

  const handleBackToSearch = () => {
    cleanupCamera();
    setSelectedStudent(null);
    setSearch('');
    setStep('search');
    setError('');
    setCapturing(false);
    setCapInfo(null);
    setCountdown(0);
  };

  useEffect(() => {
    return () => { cleanupCamera(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-3" dir="rtl">
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
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 كود الطالب أو اسمه..."
              className="w-full p-3 border-2 border-purple-300 rounded-xl text-sm focus:border-purple-500 outline-none"
              autoFocus
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

        {/* Capture Step */}
        {step === 'capture' && selectedStudent && (
          <div className="p-4">
            <div className="text-center mb-3">
              <h3 className="text-sm font-bold text-gray-800 truncate">{selectedStudent.name}</h3>
            </div>

            {error && !capturing && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs whitespace-pre-line">{error}</div>
            )}

            <div className="relative mb-3">
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 mx-auto" style={{ width: 260, height: 260 }}>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                {!cameraReady && !error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                    <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {cameraReady && !capturing && countdown === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-52 h-52 border-4 border-purple-400/70 rounded-full" style={{ boxShadow: '0 0 40px rgba(168,85,247,0.4)' }} />
                  </div>
                )}
                {countdown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="text-white text-7xl font-bold animate-pulse">{countdown}</span>
                  </div>
                )}
                {capturing && capInfo && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(139,92,246,0.15)" strokeWidth="5" />
                    <circle cx="100" cy="100" r="92" fill="none"
                      stroke={capInfo.progress >= 100 ? '#10b981' : '#8b5cf6'} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 92}`}
                      strokeDashoffset={`${2 * Math.PI * 92 * (1 - capInfo.progress / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.15s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
                    {capInfo.phase === 'capture' && capInfo.faceDetected && (() => {
                      const angle = (capInfo.rotationAngle - 90) * (Math.PI / 180);
                      const cx = 100 + 92 * Math.cos(angle);
                      const cy = 100 + 92 * Math.sin(angle);
                      return (
                        <>
                          <circle cx={cx} cy={cy} r="8" fill="#8b5cf6" stroke="white" strokeWidth="3">
                            <animate attributeName="r" values="7;10;7" dur="0.8s" repeatCount="indefinite" />
                          </circle>
                          <circle cx={cx} cy={cy} r="4" fill="white" />
                        </>
                      );
                    })()}
                    {ALL_DIRS.map(dir => {
                      const angles: Record<FaceDirection, number> = { right: 0, down: 90, left: 180, up: 270, center: 315 };
                      const a = (angles[dir] - 90) * (Math.PI / 180);
                      const cx = 100 + 92 * Math.cos(a);
                      const cy = 100 + 92 * Math.sin(a);
                      const done = capInfo.capturedDirections.has(dir);
                      return <circle key={dir} cx={cx} cy={cy} r="6" fill={done ? '#10b981' : 'rgba(139,92,246,0.2)'} stroke={done ? '#065f46' : 'rgba(139,92,246,0.4)'} strokeWidth="2" />;
                    })}
                  </svg>
                )}
                {capturing && capInfo?.phase === 'capture' && (
                  <div className={`absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold shadow-lg ${
                    capInfo.faceDetected ? 'bg-green-500 text-white' : 'bg-red-500 text-white animate-pulse'
                  }`}>
                    {capInfo.faceDetected ? '✅ وجه واضح' : '❌ أين وجهك؟'}
                  </div>
                )}
              </div>
            </div>

            {capturing && capInfo && (
              <div className="space-y-2 mb-3">
                <div className={`py-2 px-3 rounded-xl font-bold text-center text-sm ${
                  capInfo.phase === 'stabilize' ? 'bg-blue-50 text-blue-700'
                    : capInfo.faceDetected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {capInfo.phase === 'stabilize' ? '🔍 جاري التثبيت...' : capInfo.directionLabel}
                </div>
                <div className="flex justify-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${QUALITY_COLORS[capInfo.qualityLevel]}`}>{QUALITY_LABELS[capInfo.qualityLevel]}</span>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-600">{LIGHT_LABELS[capInfo.lightLevel]}</span>
                </div>
                <div className="flex justify-center gap-2 items-center">
                  <span className="text-[10px] text-gray-500">🔄 دوران:</span>
                  <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${capInfo.rotationCoverage}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-purple-600">{capInfo.rotationCoverage}%</span>
                </div>
                <div className="flex justify-center gap-2 text-[10px] text-gray-500">
                  {ALL_DIRS.map(dir => (
                    <span key={dir} className={`text-lg transition-opacity ${capInfo.capturedDirections.has(dir) ? 'opacity-100' : 'opacity-25'}`}>{DIR_EMOJI[dir]}</span>
                  ))}
                </div>
              </div>
            )}

            {!capturing && !error && cameraReady && (
              <div className="mb-3 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                <p className="text-xs font-bold text-purple-800 mb-1">📋 التعليمات:</p>
                <ul className="text-[10px] text-purple-700 space-y-0.5 list-decimal list-inside">
                  <li>اضغط "بدء التسجيل"</li>
                  <li>انظر للكاميرا مباشرة</li>
                  <li>حرّك وجهك ببطء (يمين، يسار، أعلى، أسفل)</li>
                  <li>التسجيل يستغرق <strong>10 ثوانٍ</strong> فقط</li>
                </ul>
              </div>
            )}

            {!capturing && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleBackToSearch} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
                {error ? (
                  <button onClick={handleRetry} className="py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-lg active:scale-95 text-sm">🔄 إعادة</button>
                ) : (
                  <button onClick={handleStartCapture} disabled={!cameraReady}
                    className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 disabled:opacity-40 text-white font-bold rounded-lg active:scale-95 text-sm">
                    📸 بدء التسجيل
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Success Step */}
        {step === 'success' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3 animate-bounce">🎉</div>
            <h3 className="text-lg font-bold text-green-700 mb-1">تم تسجيل البصمة!</h3>
            <p className="text-gray-800 font-bold">{selectedStudent.name}</p>
            {capInfo && (
              <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-2.5">
                <p className="text-xs text-green-700 font-medium">✨ {capInfo.totalGood} لقطة • {capInfo.capturedDirections.size} اتجاه • دوران {capInfo.rotationCoverage}%</p>
                <div className="flex justify-center gap-1 mt-1">
                  {ALL_DIRS.map(dir => <span key={dir} className={`text-sm ${capInfo.capturedDirections.has(dir) ? '' : 'opacity-20'}`}>{DIR_EMOJI[dir]}</span>)}
                </div>
                <p className={`text-[10px] font-bold mt-1 ${QUALITY_COLORS[capInfo.qualityLevel]}`}>{QUALITY_LABELS[capInfo.qualityLevel]}</p>
              </div>
            )}
            <button onClick={onClose} className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-lg active:scale-95 text-sm">✅ تم</button>
          </div>
        )}

      </div>
    </div>
  );
};

export default FaceRegistration;
