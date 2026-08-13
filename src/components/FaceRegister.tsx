import React, { useEffect, useRef, useState } from 'react';
import { Student } from '../types/student';
import {
  extractFaceDescriptor,
  buildMultiDescriptor,
  checkForTamperingAsync,
  normalizeDescriptor,
} from '../services/faceRecognition';

interface FaceRegisterProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

export const FaceRegister: React.FC<FaceRegisterProps> = ({
  students,
  onUpdateStudent,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoQueued = useRef(false);

  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without'>('without');
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [autoMode, setAutoMode] = useState(false);

  const filteredStudents = students.filter(s => {
    if (filterMode === 'without' && s.faceDescriptor) return false;
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

  const currentStudent = filteredStudents[currentIndex];

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        if (mounted) setLoading(false);
      } catch {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !currentStudent || capturing) return;
    setMessage(null);
    setCapturing(true);
    try {
      const descriptor = await extractFaceDescriptor(videoRef.current);
      if (!descriptor) {
        setMessage({ type: 'error', text: 'لم يتم التعرف على الوجه. تأكد من الإضاءة' });
        setCapturing(false);
        return;
      }
      const normalized = normalizeDescriptor(new Float32Array(descriptor));
      const tamper = await checkForTamperingAsync(normalized, students, currentStudent.id, 0.35);
      if (tamper.isTamper) {
        setMessage({
          type: 'error',
          text: `هذه البصمة مسجلة أصلاً للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`,
        });
        setCapturing(false);
        return;
      }
      const angleDescs = new Map<string, Float32Array[]>();
      angleDescs.set('center', [normalized]);
      const multiDesc = buildMultiDescriptor(normalized, angleDescs, 1, new Set(['center']));
      onUpdateStudent(currentStudent.id, {
        faceDescriptor: multiDesc as any,
        faceRegisteredAt: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: currentStudent.name });
      setCapturing(false);
      setTimeout(() => {
        setMessage(null);
        if (currentIndex < filteredStudents.length - 1) {
          setCurrentIndex(i => i + 1);
          if (autoMode) autoQueued.current = true;
        } else {
          setMessage({ type: 'success', text: 'انتهى التسجيل!' });
          setAutoMode(false);
        }
      }, 600);
    } catch (e) {
      setMessage({ type: 'error', text: 'خطأ في التقاط البصمة' });
      setCapturing(false);
    }
  };

  useEffect(() => {
    if (autoMode && !capturing && currentStudent && !autoQueued.current) {
      autoQueued.current = true;
      const t = setTimeout(() => {
        autoQueued.current = false;
        handleCapture();
      }, 400);
      return () => clearTimeout(t);
    }
    if (!autoMode) autoQueued.current = false;
  }, [autoMode, capturing, currentIndex]);

  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!capturingRef.current) handleCapture();
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex(i => Math.min(i + 1, filteredStudents.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filteredStudents.length, onClose]);

  const withFaceCount = students.filter(s => s.faceDescriptor).length;

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-900 text-white flex flex-col" dir="rtl">
      <header className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
        <div>
          <h2 className="text-lg font-bold">تسجيل بصمات الوجه</h2>
          <p className="text-xs text-gray-400">{withFaceCount} / {students.length} مسجّلين</p>
        </div>
        <button onClick={onClose} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold">✕ إغلاق</button>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 bg-black relative min-h-[300px] overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="inline-block w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p>جاري التحميل...</p>
              </div>
            </div>
          )}

          <video ref={videoRef} autoPlay playsInline muted
            className={`absolute inset-0 w-full h-full object-cover ${loading ? 'hidden' : ''}`}
            style={{ transform: 'scaleX(-1)' }}
          />

          {!loading && currentStudent && !capturing && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-56 sm:w-64 h-72 sm:h-80 lg:w-72 lg:h-96 border-4 border-purple-400/60 rounded-3xl shadow-[0_0_30px_rgba(168,85,247,0.3)]" />
            </div>
          )}

          {capturing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
              <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {message && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-xl font-bold shadow-2xl z-30 ${
              message.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        <div className="lg:w-96 bg-gray-800 flex flex-col p-4 overflow-y-auto max-h-[50vh] lg:max-h-full">
          {currentStudent ? (
            <div className="bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl p-4 mb-4 text-center">
              <div className="text-3xl mb-2">👤</div>
              <h3 className="text-xl font-bold">{currentStudent.name}</h3>
              <p className="text-sm opacity-90">{currentStudent.code} • {currentStudent.group || '-'}</p>
              <p className="text-xs mt-2 opacity-75">{currentIndex + 1} من {filteredStudents.length}</p>
              {currentStudent.faceDescriptor && (
                <div className="mt-2 inline-block bg-white/20 px-3 py-1 rounded-full text-xs">مسجّل سابقًا</div>
              )}
            </div>
          ) : (
            <div className="bg-gray-700 rounded-xl p-4 mb-4 text-center text-gray-400">لا يوجد طلاب</div>
          )}

          <button onClick={handleCapture}
            disabled={!currentStudent || capturing || loading}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 py-4 rounded-xl font-bold text-lg mb-2 active:scale-95 transition-all">
            {capturing ? 'جاري...' : 'التقاط البصمة'}
          </button>

          <p className="text-xs text-center text-gray-400 mb-3">(أو اضغط Enter / مسطرة)</p>

          <label className="flex items-center gap-2 bg-gray-700 p-3 rounded-lg mb-4 cursor-pointer hover:bg-gray-600">
            <input type="checkbox" checked={autoMode} onChange={e => setAutoMode(e.target.checked)}
              className="w-5 h-5 accent-purple-500" />
            <div>
              <div className="font-bold text-sm">الوضع التلقائي</div>
              <div className="text-xs text-gray-400">يلتقط تلقائياً لكل طالب</div>
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 py-2 rounded-lg text-sm font-bold">
              → السابق
            </button>
            <button onClick={() => setCurrentIndex(i => Math.min(filteredStudents.length - 1, i + 1))}
              disabled={currentIndex >= filteredStudents.length - 1}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 py-2 rounded-lg text-sm font-bold">
              التالي ←
            </button>
          </div>

          <div className="mb-3">
            <div className="flex gap-2 mb-2">
              <button onClick={() => { setFilterMode('without'); setCurrentIndex(0); }}
                className={`flex-1 py-2 rounded text-xs font-bold ${filterMode === 'without' ? 'bg-purple-600' : 'bg-gray-700'}`}>
                غير مسجّلين
              </button>
              <button onClick={() => { setFilterMode('all'); setCurrentIndex(0); }}
                className={`flex-1 py-2 rounded text-xs font-bold ${filterMode === 'all' ? 'bg-purple-600' : 'bg-gray-700'}`}>
                الكل
              </button>
            </div>
            <input type="text" value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentIndex(0); }}
              placeholder="بحث..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="flex-1 overflow-y-auto bg-gray-900 rounded-lg p-2 space-y-1 min-h-[150px]">
            {filteredStudents.map((s, idx) => (
              <button key={s.id} onClick={() => setCurrentIndex(idx)}
                className={`w-full text-right p-2 rounded text-xs transition ${
                  idx === currentIndex ? 'bg-purple-600' : 'bg-gray-800 hover:bg-gray-700'
                }`}>
                <div className="flex items-center justify-between">
                  <span className="truncate">{s.name}</span>
                  {s.faceDescriptor && <span>✅</span>}
                </div>
                <div className="text-[10px] opacity-60">{s.code} • {s.group || '-'}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FaceRegister;
