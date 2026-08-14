import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Student } from '../types/student';
import {
  extractFaceDescriptor,
  detectSingleFace,
  buildMultiDescriptor,
  checkForTamperingAsync,
  normalizeDescriptor,
  drawFaceLandmarks,
} from '../services/faceRecognition';
import * as faceapi from 'face-api.js';

interface FaceRegisterProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

type Step = 'setup' | 'confirm' | 'camera' | 'capture' | 'success';

export const FaceRegister: React.FC<FaceRegisterProps> = ({ students, onUpdateStudent, onClose }) => {
  const [step, setStep] = useState<Step>('setup');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without'>('without');
  const [bulkList, setBulkList] = useState<Student[]>([]);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [autoMode, setAutoMode] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [error, setError] = useState('');
  const [lastCapturedName, setLastCapturedName] = useState('');

  const [detLandmarks, setDetLandmarks] = useState<faceapi.FaceLandmarks68 | null>(null);
  const [detBox, setDetBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [detFrameW, setDetFrameW] = useState(0);
  const [detFrameH, setDetFrameH] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const landmarkCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectIntervalRef = useRef<number | null>(null);
  const autoFiredRef = useRef(false);
  const capturingRef = useRef(false);
  capturingRef.current = capturing;

  const hasFaceDesc = (s: Student) => s.faceDescriptor && (Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 : true);

  const filteredStudents = students.filter(s => {
    if (filterMode === 'without' && hasFaceDesc(s)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.group || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const withFaceCount = students.filter(hasFaceDesc).length;
  const currentStudent = bulkList[currentIndex];

  const filteredCount = (mode: 'all' | 'without') =>
    students.filter(s => (mode === 'without' ? !hasFaceDesc(s) : true)).length;

  // ── الكاميرا ──
  const openCamera = useCallback(async (f: 'user' | 'environment') => {
    setError(''); setCameraReady(false); setVideoReady(false);
    try {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
      if (!mountedRef.current) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); }
      if (mountedRef.current) setCameraReady(true);
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (e.name === 'NotAllowedError') setError('الرجاء السماح باستخدام الكاميرا');
      else if (e.name === 'NotFoundError') setError('لا توجد كاميرا');
      else setError(e.message || 'فشل فتح الكاميرا');
    }
  }, []);

  const cleanupCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; }
  };

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; cleanupCamera(); }; }, []);

  // ── التنقل داخل قائمة التسجيل ──
  const startBulk = () => {
    const list = [...filteredStudents];
    setBulkList(list);
    setBulkTotal(list.length);
    setCurrentIndex(0);
    setDoneCount(0);
    setStep('camera');
  };

  const handleSelectStudent = (s: Student, idx: number) => {
    const list = [...filteredStudents];
    setBulkList(list);
    setBulkTotal(list.length);
    setCurrentIndex(idx);
    setDoneCount(0);
    if (hasFaceDesc(s)) setStep('confirm');
    else setStep('camera');
  };

  const goToStudent = (idx: number) => {
    setCurrentIndex(idx);
    setFaceDetected(false); setDetLandmarks(null); setDetBox(null); setError('');
    autoFiredRef.current = false;
  };

  const handleCameraChoice = (f: 'user' | 'environment') => {
    setFacing(f); setFaceDetected(false); setDetLandmarks(null); setDetBox(null); setError('');
    setStep('capture'); openCamera(f);
  };

  const goNext = () => {
    const nextList = bulkList.slice();
    nextList.splice(currentIndex, 1);
    setBulkList(nextList);
    if (currentIndex < nextList.length) {
      setFaceDetected(false); setDetLandmarks(null); setDetBox(null); setError('');
      autoFiredRef.current = false;
      setStep('capture');
    } else {
      cleanupCamera();
      setStep('setup');
    }
  };

  const handleFinish = () => {
    cleanupCamera();
    setStep('setup');
  };

  // ── حلقة الكشف المستمرة ──
  useEffect(() => {
    if (step !== 'capture' || !cameraReady || capturing || !videoRef.current) return;
    detectIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || !mountedRef.current) return;
      try {
        const det = await detectSingleFace(videoRef.current, 320, 224);
        if (!mountedRef.current) return;
        if (det) {
          setFaceDetected(true);
          setDetLandmarks(det.landmarks);
          setDetBox({ x: det.detection.box.x, y: det.detection.box.y, width: det.detection.box.width, height: det.detection.box.height });
          setDetFrameW(det.detection.box.width > 0 ? (() => { const v = videoRef.current; return v ? v.videoWidth : 640; })() : 640);
          setDetFrameH(det.detection.box.height > 0 ? (() => { const v = videoRef.current; return v ? v.videoHeight : 480; })() : 480);
        } else {
          setFaceDetected(false);
        }
      } catch {}
    }, 250);
    return () => { if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; } };
  }, [cameraReady, capturing, step, currentIndex]);

  // ── رسم معالم الوجه ──
  useEffect(() => {
    const canvas = landmarkCanvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container || !detLandmarks || !detBox) {
      if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = videoRef.current;
    const fw = v ? v.videoWidth : detFrameW;
    const fh = v ? v.videoHeight : detFrameH;
    drawFaceLandmarks(ctx, detLandmarks, detBox, canvas.width, canvas.height, fw, fh, facing === 'user');
  }, [detLandmarks, detBox, facing]);

  // ── الالتقاط ──
  const handleCapture = async () => {
    if (!videoRef.current || !currentStudent || capturing) return;
    setCapturing(true);
    setError('');
    try {
      const desc = await extractFaceDescriptor(videoRef.current);
      if (!desc) { setError('لم يتم التعرف على الوجه'); setCapturing(false); return; }
      const normalized = normalizeDescriptor(desc);

      if (students.length > 1 && currentStudent) {
        const tamper = await checkForTamperingAsync(normalized, students, currentStudent.id, 0.35);
        if (tamper.isTamper) {
          setError(`⚠️ هذا الوجه مسجل للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`);
          setCapturing(false); return;
        }
      }

      const angleDescs = new Map<string, Float32Array[]>();
      angleDescs.set('center', [normalized]);
      const multiDesc = buildMultiDescriptor(normalized, angleDescs, 1, new Set(['center']));
      onUpdateStudent(currentStudent.id, { faceDescriptor: multiDesc as any, faceRegisteredAt: new Date().toISOString() });
      setLastCapturedName(currentStudent.name);
      setDoneCount(d => d + 1);
      setCapturing(false);
      setStep('success');
    } catch (e: any) {
      setError(e.message || 'فشل التقاط الوجه');
      setCapturing(false);
    }
  };

  // ── الالتقاط التلقائي ──
  useEffect(() => {
    if (step === 'capture' && autoMode && faceDetected && !capturing && !autoFiredRef.current) {
      autoFiredRef.current = true;
      const t = setTimeout(() => {
        autoFiredRef.current = false;
        handleCapture();
      }, 450);
      return () => clearTimeout(t);
    }
  }, [step, autoMode, faceDetected, capturing, currentIndex]);

  // ── التقدم التلقائي بعد النجاح ──
  useEffect(() => {
    if (step === 'success' && autoMode) {
      const t = setTimeout(() => goNext(), 900);
      return () => clearTimeout(t);
    }
  }, [step, autoMode, currentIndex]);

  // ── اختصارات لوحة المفاتيح ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (step === 'capture' && !capturingRef.current) { e.preventDefault(); handleCapture(); }
        else if (step === 'success') goNext();
      } else if (e.key === 'ArrowRight') {
        if (bulkList.length > 1) goToStudent(Math.min(currentIndex + 1, bulkList.length - 1));
      } else if (e.key === 'ArrowLeft') {
        if (bulkList.length > 1) goToStudent(Math.max(currentIndex - 1, 0));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, currentIndex, bulkList.length, onClose]);

  const progressPct = withFaceCount > 0 ? Math.round((withFaceCount / students.length) * 100) : 0;
  const bulkPct = bulkTotal > 0 ? Math.round((Math.min(doneCount + 1, bulkTotal) / bulkTotal) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-3" dir="rtl"
      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[96vh] overflow-y-auto">

        {step === 'setup' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">📸</div>
              <h3 className="text-lg font-bold text-gray-800">تسجيل بصمات الوجه الجماعي</h3>
              <p className="text-xs text-gray-500 mt-1">{withFaceCount} / {students.length} مسجّلين</p>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mt-3">
                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو الكروب..." autoFocus
              className="w-full p-3 border-2 border-purple-300 rounded-xl text-sm focus:border-purple-500 outline-none" />

            <div className="flex gap-2 mt-3">
              <button onClick={() => { setFilterMode('without'); setSearchQuery(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${filterMode === 'without' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                غير مسجّلين ({filteredCount('without')})
              </button>
              <button onClick={() => { setFilterMode('all'); setSearchQuery(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${filterMode === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                الكل ({filteredCount('all')})
              </button>
            </div>

            <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
              {filteredStudents.map((s, idx) => (
                <button key={s.id} onClick={() => handleSelectStudent(s, idx)}
                  className="w-full text-right p-3 rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50 flex items-center justify-between gap-2 transition">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-gray-800 truncate">{s.name}</div>
                    <div className="text-[10px] text-gray-500">#{s.code}{s.group ? ` • ${s.group}` : ''}</div>
                  </div>
                  {hasFaceDesc(s) && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">لديه بصمة</span>}
                </button>
              ))}
              {filteredStudents.length === 0 && (
                <p className="text-center text-sm text-gray-500 py-6">🎉 لا يوجد طلاب غير مسجلين</p>
              )}
            </div>

            {filteredStudents.length > 0 && (
              <button onClick={startBulk}
                className="w-full mt-4 py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-xl active:scale-95 transition shadow-md">
                🚀 ابدأ التسجيل الجماعي ({filteredStudents.length} طالب)
              </button>
            )}
            <button onClick={onClose} className="w-full mt-2 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">إغلاق</button>
          </div>
        )}

        {step === 'confirm' && currentStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3">🔄</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">بصمة موجودة</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-bold text-amber-800 mb-1">{currentStudent.name}</p>
              <p className="text-xs text-amber-600">هذا الطالب لديه بصمة مسجلة بالفعل. هل تريد تحديثها؟</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setStep('setup')} className="py-3.5 bg-gray-200 text-gray-700 font-bold rounded-xl active:scale-95 text-sm">إلغاء</button>
              <button onClick={() => setStep('camera')} className="py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl active:scale-95 text-sm">✅ تحديث</button>
            </div>
          </div>
        )}

        {step === 'camera' && currentStudent && (
          <div className="p-5 text-center">
            <div className="text-4xl mb-2">📷</div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">{currentStudent.name}</h3>
            <p className="text-xs text-gray-500 mb-4">اختر الكاميرا</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => handleCameraChoice('user')}
                className="py-6 bg-gradient-to-br from-purple-500 to-pink-600 text-white font-bold rounded-2xl active:scale-95">
                <div className="text-3xl mb-2">🤳</div>
                <div className="text-sm">أمامية</div>
              </button>
              <button onClick={() => handleCameraChoice('environment')}
                className="py-6 bg-gradient-to-br from-blue-500 to-cyan-600 text-white font-bold rounded-2xl active:scale-95">
                <div className="text-3xl mb-2">📷</div>
                <div className="text-sm">خلفية</div>
              </button>
            </div>
            <button onClick={() => setStep('setup')} className="w-full mt-4 py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
          </div>
        )}

        {step === 'capture' && currentStudent && (
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-gray-800 truncate">{currentStudent.name}</h3>
              <span className="text-[10px] text-gray-500 shrink-0">الطالب {Math.min(doneCount + 1, bulkTotal)} من {bulkTotal}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500" style={{ width: `${bulkPct}%` }} />
            </div>

            {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div>}

            <div className="relative rounded-2xl overflow-hidden bg-gray-900 w-full" style={{ aspectRatio: '4 / 3' }}>
              <video ref={videoRef} autoPlay playsInline muted
                onLoadedMetadata={() => setVideoReady(true)}
                className="w-full h-full object-cover"
                style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
              <canvas ref={landmarkCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {(!cameraReady || !videoReady) && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                  <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {cameraReady && !capturing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`w-52 h-52 border-4 rounded-full ${faceDetected ? 'border-green-400/70' : 'border-purple-400/70'}`}
                    style={{ boxShadow: faceDetected ? '0 0 40px rgba(34,197,94,0.4)' : '0 0 40px rgba(168,85,247,0.4)' }} />
                </div>
              )}

              {capturing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {cameraReady && !capturing && (
              <>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => setStep('camera')} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
                  <button onClick={handleCapture} className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-lg active:scale-95 text-sm">
                    {faceDetected ? '📸 التقاط' : '⏳ انتظر الكشف'}
                  </button>
                </div>
                {bulkList.length > 1 && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button onClick={() => goToStudent(Math.max(0, currentIndex - 1))}
                      disabled={currentIndex === 0}
                      className="py-2 bg-gray-100 text-gray-600 font-bold rounded-lg active:scale-95 text-xs disabled:opacity-40">→ السابق</button>
                    <button onClick={() => goToStudent(Math.min(bulkList.length - 1, currentIndex + 1))}
                      disabled={currentIndex >= bulkList.length - 1}
                      className="py-2 bg-gray-100 text-gray-600 font-bold rounded-lg active:scale-95 text-xs disabled:opacity-40">التالي ←</button>
                  </div>
                )}
                <label className="flex items-center gap-2 mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg cursor-pointer">
                  <input type="checkbox" checked={autoMode} onChange={e => setAutoMode(e.target.checked)} className="w-5 h-5 accent-purple-500" />
                  <div>
                    <div className="font-bold text-sm text-purple-800">الوضع التلقائي</div>
                    <div className="text-xs text-purple-500">يلتقط تلقائياً ويمر للطالب التالي</div>
                  </div>
                </label>
              </>
            )}
          </div>
        )}

        {step === 'success' && currentStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3 animate-bounce">🎉</div>
            <h3 className="text-lg font-bold text-green-700 mb-1">تم تسجيل البصمة!</h3>
            <p className="text-gray-800 font-bold">{lastCapturedName}</p>
            <p className="text-xs text-gray-500 mt-2">اكتمل {doneCount} من {bulkTotal}</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button onClick={handleFinish} className="py-3 bg-gray-200 text-gray-700 font-bold rounded-xl active:scale-95 text-sm">🔚 إنهاء</button>
              <button onClick={goNext} className="py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl active:scale-95 text-sm">
                ▶️ الطالب التالي
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default FaceRegister;
