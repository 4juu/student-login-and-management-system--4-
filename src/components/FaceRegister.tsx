import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Student } from '../types/student';
import {
  loadFaceModels,
  extractFaceDescriptorMultiCapture,
  buildMultiDescriptor,
  checkForTamperingAsync,
  type CaptureProgress,
} from '../services/faceRecognition';

interface FaceRegisterProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  onClose: () => void;
}

const DIR_EMOJI: Record<string, string> = { center: '⬜', right: '➡️', left: '⬅️', up: '⬆️', down: '⬇️' };
const ALL_DIRS: string[] = ['center', 'right', 'left', 'up', 'down'];

export const FaceRegister: React.FC<FaceRegisterProps> = ({
  students,
  onUpdateStudent,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoQueued = useRef(false);

  const [modelsReady, setModelsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'without'>('without');
  const [capturing, setCapturing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [capInfo, setCapInfo] = useState<CaptureProgress | null>(null);
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
        await loadFaceModels();
        if (!mounted) return;
        setModelsReady(true);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setLoading(false);
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: 'فشل فتح الكاميرا أو تحميل النظام' });
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleStartCapture = () => {
    setMessage(null);
    setCapInfo(null);
    let c = 3;
    setCountdown(c);
    const iv = setInterval(() => {
      c--;
      if (c > 0) setCountdown(c);
      else {
        clearInterval(iv);
        setCountdown(0);
        startCapture();
      }
    }, 700);
  };

  const startCapture = async () => {
    if (!videoRef.current || !currentStudent) return;
    setCapturing(true);
    try {
      const result = await extractFaceDescriptorMultiCapture(
        videoRef.current,
        (info) => setCapInfo(info),
        true
      );
      if (!result || !result.descriptor) {
        setMessage({ type: 'error', text: '❌ لم نتمكن من التقاط الوجه بوضوح. تأكد من الإضاءة وأن وجهك في المنتصف' });
        setCapturing(false);
        return;
      }
      const tamper = await checkForTamperingAsync(result.descriptor, students, currentStudent.id, 0.35);
      if (tamper.isTamper) {
        setMessage({
          type: 'error',
          text: `⚠️ هذه البصمة مسجلة أصلاً للطالب: ${tamper.matchedStudents.map(m => m.name).join('، ')}`,
        });
        setCapturing(false);
        return;
      }
      const multiDesc = buildMultiDescriptor(result.descriptor, result.angleDescs, result.quality, result.directions);
      onUpdateStudent(currentStudent.id, {
        faceDescriptor: multiDesc as any,
        faceRegisteredAt: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: `✅ ${currentStudent.name}` });
      setCapturing(false);
      setTimeout(() => {
        setMessage(null);
        setCapInfo(null);
        if (currentIndex < filteredStudents.length - 1) {
          setCurrentIndex(i => i + 1);
          if (autoMode) {
            autoQueued.current = true;
          }
        } else {
          setMessage({ type: 'success', text: '🎉 انتهى التسجيل!' });
          setAutoMode(false);
        }
      }, 600);
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: '❌ خطأ في التقاط البصمة' });
      setCapturing(false);
    }
  };

  useEffect(() => {
    if (autoMode && !capturing && currentStudent && !autoQueued.current) {
      autoQueued.current = true;
      const t = setTimeout(() => {
        autoQueued.current = false;
        handleStartCapture();
      }, 200);
      return () => clearTimeout(t);
    }
    if (!autoMode) autoQueued.current = false;
  }, [autoMode, capturing, currentIndex]);

  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!capturingRef.current && countdownRef.current === 0) handleStartCapture();
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
          <h2 className="text-lg font-bold">📷 تسجيل بصمات الوجه</h2>
          <p className="text-xs text-gray-400">{withFaceCount} / {students.length} مسجّلين</p>
        </div>
        <button onClick={onClose} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold">✕ إغلاق</button>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 bg-black flex items-center justify-center relative min-h-[300px]">
          {loading && (
            <div className="text-center">
              <div className="inline-block w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p>جاري التحميل...</p>
            </div>
          )}

          <video ref={videoRef} autoPlay playsInline muted
            className={`max-w-full max-h-full object-contain ${loading ? 'hidden' : ''}`}
            style={{ transform: 'scaleX(-1)' }}
          />

          {!loading && currentStudent && !capturing && countdown === 0 && !capInfo && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-56 sm:w-64 h-72 sm:h-80 lg:w-72 lg:h-96 border-4 border-purple-400/60 rounded-3xl shadow-[0_0_30px_rgba(168,85,247,0.3)]" />
            </div>
          )}

          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
              <span className="text-white text-7xl font-bold animate-pulse">{countdown}</span>
            </div>
          )}

          {capturing && capInfo && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(139,92,246,0.15)" strokeWidth="5" />
              <circle cx="100" cy="100" r="92" fill="none"
                stroke={capInfo.progress >= 100 ? '#10b981' : '#8b5cf6'} strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 92}`}
                strokeDashoffset={`${2 * Math.PI * 92 * (1 - capInfo.progress / 100)}`}
                style={{ transition: 'stroke-dashoffset 0.15s linear', transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
              {capInfo.faceDetected && (() => {
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
                const angles: Record<string, number> = { right: 0, down: 90, left: 180, up: 270, center: 315 };
                const a = (angles[dir] - 90) * (Math.PI / 180);
                const cx = 100 + 92 * Math.cos(a);
                const cy = 100 + 92 * Math.sin(a);
                const done = capInfo.capturedDirections.has(dir as any);
                return <circle key={dir} cx={cx} cy={cy} r="6" fill={done ? '#10b981' : 'rgba(139,92,246,0.2)'} stroke={done ? '#065f46' : 'rgba(139,92,246,0.4)'} strokeWidth="2" />;
              })}
            </svg>
          )}

          {capturing && capInfo?.phase === 'capture' && (
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-xs font-bold shadow-lg z-20 ${
              capInfo.faceDetected ? 'bg-green-600' : 'bg-red-600 animate-pulse'
            }`}>
              {capInfo.faceDetected ? '✅ وجه واضح' : '❌ أين وجهك؟'}
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
                <div className="mt-2 inline-block bg-white/20 px-3 py-1 rounded-full text-xs">✅ مسجّل سابقًا</div>
              )}
              {capturing && capInfo && (
                <div className="mt-3 text-xs space-y-1">
                  <div className={`font-bold ${capInfo.faceDetected ? 'text-green-300' : 'text-red-300'}`}>
                    {capInfo.phase === 'stabilize' ? '🔍 جاري التثبيت...' : capInfo.directionLabel}
                  </div>
                  <div className="flex justify-center gap-2">
                    {ALL_DIRS.map(dir => (
                      <span key={dir} className={`text-sm transition-opacity ${capInfo.capturedDirections.has(dir as any) ? 'opacity-100' : 'opacity-25'}`}>{DIR_EMOJI[dir]}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-700 rounded-xl p-4 mb-4 text-center text-gray-400">لا يوجد طلاب</div>
          )}

          <button onClick={handleStartCapture}
            disabled={!currentStudent || capturing || loading || countdown > 0}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-40 py-4 rounded-xl font-bold text-lg mb-2 active:scale-95 transition-all">
            {countdown > 0 ? `⏳ ${countdown}` : capturing ? '⏳ جاري التقاط متعدد...' : '📸 التقاط البصمة'}
          </button>

          <p className="text-xs text-center text-gray-400 mb-3">(أو اضغط Enter / مسطرة)</p>

          <label className="flex items-center gap-2 bg-gray-700 p-3 rounded-lg mb-4 cursor-pointer hover:bg-gray-600">
            <input type="checkbox" checked={autoMode} onChange={e => setAutoMode(e.target.checked)}
              className="w-5 h-5 accent-purple-500" />
            <div>
              <div className="font-bold text-sm">⚡ الوضع التلقائي</div>
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
              placeholder="🔍 بحث..." className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
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
