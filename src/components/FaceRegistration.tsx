import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Student } from '../types/student';
import {
  extractFaceDescriptor, detectSingleFace,
  buildMultiDescriptor, checkForTamperingAsync,
  normalizeDescriptor,
} from '../services/faceRecognition';
import { useCameraReady } from '../hooks/useCameraReady';
import { useFaceModels } from '../hooks/useFaceModels';
import { FaceModelLoadingOverlay } from './FaceModelLoadingOverlay';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '../hooks/useModalBehavior';

interface FaceRegistrationProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

type Step = 'search' | 'camera' | 'capture' | 'success' | 'confirm';

export const FaceRegistration: React.FC<FaceRegistrationProps> = ({ students, onUpdateStudent, onClose }) => {
  const panelRef = useModalBehavior({ open: true, onClose });
  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);

  // بيانات الكشف للرسم
  const [detBox, setDetBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { videoReady, handleVideoReady, resetVideoReady, armForceReady } = useCameraReady(videoRef);
  const { loaded: modelsLoaded, progress: modelProgress } = useFaceModels();
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const detectIntervalRef = useRef<number | null>(null);

  const filtered = search.trim()
    ? students.filter(s =>
        s.code.includes(search.trim()) ||
        s.name.toLowerCase().includes(search.trim().toLowerCase())
      ).slice(0, 10)
    : [];

  useEffect(() => { mountedRef.current = true; if (step === 'search') setTimeout(() => searchRef.current?.focus(), 300);   }, [step]);

  const openCamera = useCallback(async (f: 'user' | 'environment') => {
    setError(''); setCameraReady(false); resetVideoReady();
    try {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: f, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
      if (!mountedRef.current) { s.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; armForceReady(); await videoRef.current.play(); }
      if (mountedRef.current) setCameraReady(true);
    } catch (e: any) {
      if (!mountedRef.current) return;
      if (e.name === 'NotAllowedError') setError('الرجاء السماح باستخدام الكاميرا');
      else if (e.name === 'NotFoundError') setError('لا توجد كاميرا');
      else setError(e.message || 'فشل فتح الكاميرا');
    }
  }, [armForceReady, resetVideoReady]);

  const hasFaceDesc = (s: Student) => s.faceDescriptor && (Array.isArray(s.faceDescriptor) ? s.faceDescriptor.length > 0 : true);

  const handleSelectStudent = (s: Student) => {
    setSelectedStudent(s);
    if (hasFaceDesc(s)) setStep('confirm');
    else setStep('camera');
  };

  const handleCameraChoice = (f: 'user' | 'environment') => {
    setFacing(f); setFaceDetected(false); setDetBox(null);
    setStep('capture'); openCamera(f);
  };

  // continuous detection loop — article pattern
  useEffect(() => {
    if (!cameraReady || !videoReady || capturing || !videoRef.current || !modelsLoaded) return;
    detectIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || !mountedRef.current) return;
      try {
        const det = await detectSingleFace(videoRef.current, 320, 224);
        if (!mountedRef.current) return;
        if (det) {
          setFaceDetected(true);
          setDetBox(det.box);
        } else {
          setFaceDetected(false);
        }
      } catch {}
    }, 250);
    return () => { if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; } };
  }, [cameraReady, videoReady, capturing]);

  const handleCapture = async () => {
    if (!videoRef.current || capturing) return;
    setCapturing(true);
    setError('');
    try {
      const desc = await extractFaceDescriptor(videoRef.current);
      if (!desc) { setError('لم يتم التعرف على الوجه'); setCapturing(false); return; }
      const normalized = normalizeDescriptor(desc);

      if (students.length > 1 && selectedStudent) {
        const tamper = await checkForTamperingAsync(normalized, students, selectedStudent.id, 0.35);
        if (tamper.isTamper) {
          setError(`⚠️ هذا الوجه مسجل للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`);
          setCapturing(false); return;
        }
      }

      const angleDescs = new Map<string, Float32Array[]>();
      angleDescs.set('center', [normalized]);
      const multiDesc = buildMultiDescriptor(normalized, angleDescs, 1, new Set(['center']));
      onUpdateStudent(selectedStudent!.id, { faceDescriptor: multiDesc as any, faceRegisteredAt: new Date().toISOString() });
      cleanupCamera();
      setStep('success');
    } catch (e: any) { setError(e.message || 'فشل التقاط الوجه'); setCapturing(false); }
  };

  const cleanupCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    resetVideoReady();
    if (detectIntervalRef.current) { clearInterval(detectIntervalRef.current); detectIntervalRef.current = null; }
  };

  const handleBackToSearch = () => {
    cleanupCamera(); setSelectedStudent(null); setSearch(''); setStep('search'); setError(''); setCapturing(false);
    setFaceDetected(false); setDetBox(null);
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  useEffect(() => () => { cleanupCamera(); }, []);

  return createPortal(
    <div ref={panelRef} className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-3" dir="rtl"
      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      {!modelsLoaded && (
        <FaceModelLoadingOverlay progress={modelProgress} onCancel={onClose} />
      )}
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm max-h-[96vh] overflow-y-auto">

        {step === 'search' && (
          <div className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">📸</div>
              <h3 className="text-lg font-bold text-white">إضافة بصمة وجه</h3>
              <p className="text-xs text-slate-400 mt-1">ابحث عن الطالب بكود أو اسم</p>
            </div>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بكود الطالب أو اسمه..." autoFocus
              className="w-full p-3 border-2 border-purple-500/30 rounded-xl text-sm bg-slate-800 text-white placeholder:text-slate-500 focus:border-purple-500 outline-none" />
            {filtered.length > 0 && (
              <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
                {filtered.map(s => (
                  <button key={s.id} onClick={() => handleSelectStudent(s)}
                    className="w-full text-right p-3 rounded-xl border border-white/10 hover:border-purple-500/40 hover:bg-purple-500/10 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-white truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-400">#{s.code}{s.group ? ` • ${s.group}` : ''}</div>
                    </div>
                    {hasFaceDesc(s) && <span className="text-[10px] bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full shrink-0">لديه بصمة</span>}
                  </button>
                ))}
              </div>
            )}
            {search.trim() && filtered.length === 0 && <p className="mt-3 text-center text-sm text-slate-400">❌ لا يوجد طالب</p>}
            <button onClick={onClose} className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 text-slate-300 font-bold rounded-lg active:scale-95 text-sm">إلغاء</button>
          </div>
        )}

        {step === 'confirm' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3">🔄</div>
            <h3 className="text-lg font-bold text-white mb-2">بصمة موجودة</h3>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
              <p className="text-sm font-bold text-amber-300 mb-1">{selectedStudent.name}</p>
              <p className="text-xs text-amber-400">هذا الطالب لديه بصمة مسجلة بالفعل. هل تريد تحديثها؟</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleBackToSearch} className="py-3.5 bg-white/10 hover:bg-white/20 text-slate-300 font-bold rounded-xl active:scale-95 text-sm">إلغاء</button>
              <button onClick={() => setStep('camera')} className="py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl active:scale-95 text-sm">✅ تحديث</button>
            </div>
          </div>
        )}

        {step === 'camera' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-4xl mb-2">📷</div>
            <h3 className="text-lg font-bold text-white mb-1">{selectedStudent.name}</h3>
            <p className="text-xs text-slate-400 mb-4">اختر الكاميرا</p>
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
            <button onClick={handleBackToSearch} className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 text-slate-300 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
          </div>
        )}

        {step === 'capture' && selectedStudent && (
          <div className="p-4">
            <div className="text-center mb-3">
              <h3 className="text-sm font-bold text-white truncate">{selectedStudent.name}</h3>
            </div>

            {error && <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-xs">{error}</div>}

            <div className="relative mb-3">
              <div className="relative rounded-2xl overflow-hidden bg-gray-900 w-full" style={{ aspectRatio: '4 / 3' }}>
                <video ref={videoRef} autoPlay playsInline muted
                  onLoadedMetadata={handleVideoReady}
                  className={`w-full h-full object-cover transition-opacity duration-300 ${videoReady ? 'opacity-100' : 'invisible'}`}
                  style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />

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
            </div>

            {cameraReady && !capturing && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleBackToSearch} className="py-3 bg-white/10 hover:bg-white/20 text-slate-300 font-bold rounded-lg active:scale-95 text-sm">🔙 رجوع</button>
                <button onClick={handleCapture} className="py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-lg active:scale-95 text-sm">
                  {faceDetected ? '📸 التقاط' : '⏳ انتظر الكشف'}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'success' && selectedStudent && (
          <div className="p-5 text-center">
            <div className="text-5xl mb-3 animate-bounce">🎉</div>
            <h3 className="text-lg font-bold text-emerald-400 mb-1">تم تسجيل البصمة!</h3>
            <p className="text-white font-bold">{selectedStudent.name}</p>
            <button onClick={onClose} className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-lg active:scale-95 text-sm">👍 موافق</button>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
};

export default FaceRegistration;
