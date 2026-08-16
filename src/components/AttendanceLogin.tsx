import React, { useState, useEffect, useRef, useCallback, useLayoutEffect, lazy, Suspense } from 'react';
import { Student, AttendanceRecord, AttendanceSession } from '../types/student';
import { User } from '../types/user';
import { QRAttendance } from './QRAttendance';
import { Camera, Info, TriangleAlert, User as UserIcon, Zap } from 'lucide-react';

// 🚀 شاشة الحضور بالبصمة تُحمَّل عند فتحها فقط (مكتبة الوجوه ثقيلة)
const LazyFaceAttendance = lazy(() =>
  import('./FaceAttendance').then(m => ({ default: m.FaceAttendance }))
);

interface AttendanceLoginProps {
  students: Student[];
  activeSessionId: string | null;
  activeSession?: AttendanceSession | null;
  records?: AttendanceRecord[];
  onAttendanceRecord: (record: AttendanceRecord) => void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  currentUser?: User | null;
}
export const AttendanceLogin: React.FC<AttendanceLoginProps> = React.memo(({
  students,
  activeSessionId,
  activeSession,
  records = [],
  onAttendanceRecord,
  onUpdateStudent,
  currentUser,
}) => {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; } | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showFaceAttendance, setShowFaceAttendance] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }, [code, message, pressedKey]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const checkAndSubmitRef = useRef<(code: string) => void>(null as any);

  const checkAndSubmit = (codeToCheck: string) => {
    if (!activeSessionId) {
      setMessage({ type: 'error', text: 'لا يوجد سجل نشط!\nالرجاء تفعيل سجل أولاً' });
      setCode('');
      return;
    }

    const student = students.find((s) => s.code === codeToCheck);

    if (student) {
      const alreadyPresent = records.some(
        r => r.sessionId === activeSessionId && r.studentId === student.id && r.status === 'present'
      );
      if (alreadyPresent) {
        setMessage({ type: 'error', text: `${student.name} مسجل حضور مسبقاً` });
        setCode('');
        return;
      }

      const now = new Date();
      const record: AttendanceRecord = {
        id: Date.now().toString(),
        studentId: student.id,
        studentName: student.name,
        studentCode: student.code,
        studentGroup: student.group,
        timestamp: now.toISOString(),
        date: now.toLocaleDateString('ar-EG'),
        time: now.toLocaleTimeString('ar-EG'),
        sessionId: activeSessionId,
        status: 'present',
        method: 'manual',
        teacherName: currentUser?.displayName,
        subjectName: currentUser?.bio || currentUser?.displayName,
      };

      onAttendanceRecord(record);
      setMessage({
        type: 'success',
        text: `مرحباً ${student.name}!\n${student.group ? `الكروب: ${student.group}\n` : ''}تم تسجيل حضورك بنجاح`,
      });
      setCode('');
    } else {
      setMessage({ type: 'error', text: 'الرمز غير صحيح\nحاول مرة أخرى' });
      setCode('');
    }
  };
  checkAndSubmitRef.current = checkAndSubmit;

  const handleCodeInput = useCallback((digit: string) => {
    setCode(prev => {
      if (prev.length >= 4) return prev;
      const newCode = prev + digit;
      if (newCode.length === 4) setTimeout(() => checkAndSubmitRef.current(newCode), 150);
      return newCode;
    });
  }, []);

  const handleClear = useCallback(() => { setCode(''); setMessage(null); }, []);
  const handleBackspace = useCallback(() => { setCode(prev => prev.slice(0, -1)); }, []);

  useEffect(() => {
    if (showQRScanner) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleCodeInput(e.key);
        setPressedKey(e.key);
        setTimeout(() => setPressedKey(null), 150);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        setPressedKey('backspace');
        setTimeout(() => setPressedKey(null), 150);
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        handleClear();
        setPressedKey('clear');
        setTimeout(() => setPressedKey(null), 150);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (code.length === 4) checkAndSubmit(code);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [code, handleCodeInput, handleBackspace, handleClear, showQRScanner]);

  const alreadyPresentIds = React.useMemo(() => {
    const ids = new Set<string>();
    records.filter(r => r.sessionId === activeSessionId && r.status === 'present').forEach(r => ids.add(r.studentId));
    return ids;
  }, [records, activeSessionId]);

  const handleQRMarkAttendance = useCallback(async (student: Student) => {
    if (!activeSessionId) throw new Error('لا توجد جلسة نشطة');
    const now = new Date();
    const record: AttendanceRecord = {
      id: `${Date.now()}_${student.id}`,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.code,
      studentGroup: student.group,
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('ar-EG'),
      time: now.toLocaleTimeString('ar-EG'),
      sessionId: activeSessionId,
      status: 'present',
      method: 'qr',
      teacherName: currentUser?.displayName,
      subjectName: currentUser?.bio || currentUser?.displayName,
    };
    await onAttendanceRecord(record);
  }, [activeSessionId, onAttendanceRecord, currentUser]);

  const codeDigits = Array(4).fill('').map((_, i) => code[i] || '');
  const studentsWithUniId = students.filter(s => s.universityId).length;

  return (
    <>
      <div ref={containerRef} className="bg-white rounded-2xl shadow-xl p-6 md:p-8 select-none">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-3 shadow-lg">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-800">تسجيل الحضور</h2>
          <p className="text-sm text-gray-500 mt-1">أدخل رمزك المكون من 4 أرقام أو استخدم QR</p>
        </div>

        <div className="mb-6">
          <button
            onClick={() => setShowFaceAttendance(true)}
            disabled={!activeSessionId}
            className="w-full relative overflow-hidden bg-gradient-to-r from-purple-500 via-violet-500 to-indigo-600 hover:from-purple-600 hover:via-violet-600 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 group transition-all duration-200 mb-3"
          >
            <UserIcon className="w-10 h-10 group-hover:scale-110 transition-transform" />
            <div className="text-right">
              <div className="text-base sm:text-lg">تسجيل الحضور ببصمة الوجه</div>
              <div className="text-[10px] sm:text-xs opacity-90 font-normal">تعرف تلقائي على الوجه وسجل الحضور</div>
            </div>
            <span className="absolute top-1 left-2 bg-yellow-400 text-yellow-900 text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow inline-flex items-center gap-0.5">
              جديد <Zap className="w-2.5 h-2.5" />
            </span>
          </button>

          <button
            onClick={() => setShowQRScanner(true)}
            disabled={!activeSessionId}
            className="w-full relative overflow-hidden bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:from-emerald-600 hover:via-teal-600 hover:to-cyan-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 group transition-all duration-200"
          >
            <Camera className="w-10 h-10 group-hover:scale-110 transition-transform" />
            <div className="text-right">
              <div className="text-base sm:text-lg">تسجيل حضور عن طريق هوية الطالب QR Code</div>
              <div className="text-[10px] sm:text-xs opacity-90 font-normal">افتح الكاميرا وامسح رمز QR</div>
            </div>
            <span className="absolute top-1 left-2 bg-yellow-400 text-yellow-900 text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow inline-flex items-center gap-0.5">
              جديد <Zap className="w-2.5 h-2.5" />
            </span>
          </button>

          {students.length > 0 && studentsWithUniId === 0 && (
            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800 text-center flex items-center justify-center gap-1">
              <TriangleAlert className="w-4 h-4" /> لم يتم إضافة أرقام جامعية بعد
            </div>
          )}
          {students.length > 0 && studentsWithUniId > 0 && studentsWithUniId < students.length && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 text-center flex items-center justify-center gap-1">
              <Info className="w-4 h-4" /> {studentsWithUniId} من {students.length} طالب لديهم رقم جامعي للـ QR
            </div>
          )}
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-3 bg-white text-gray-500 font-medium">أو أدخل الرمز يدوياً</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border-2 border-gray-200 shadow-inner" dir="ltr">
            <div className="flex items-center justify-center gap-3 md:gap-4" dir="ltr">
              {codeDigits.map((digit, index) => (
                <div
                  key={index}
                  className={`w-14 h-16 sm:w-16 sm:h-20 md:w-20 md:h-24 flex items-center justify-center rounded-xl border-2 transition-all duration-200 ${
                    digit
                      ? 'bg-gradient-to-br from-blue-500 to-blue-600 border-blue-700 text-white shadow-lg scale-105'
                      : 'bg-white border-gray-300 text-gray-300'
                  }`}
                  style={{ fontFamily: 'Arial, sans-serif' }}
                >
                  <span className="text-3xl sm:text-4xl md:text-5xl font-bold" style={{ fontFeatureSettings: '"tnum"' }}>
                    {digit || '·'}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-center mt-4">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white rounded-full shadow-sm border border-gray-200">
                <span className="text-xs text-gray-500">الأرقام المدخلة:</span>
                <span className={`font-bold ${code.length === 4 ? 'text-green-600' : 'text-blue-600'}`}>
                  {code.length}/4
                </span>
              </div>
            </div>
          </div>

          {message && (
            <div
              className={`mt-4 p-4 rounded-xl text-center font-medium whitespace-pre-line border-2 shadow-md animate-fadeIn ${
                message.type === 'success'
                  ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-800 border-green-300'
                  : 'bg-gradient-to-r from-red-50 to-rose-50 text-red-800 border-red-300'
              }`}
              dir="rtl"
            >
              {message.text}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-sm mx-auto" dir="ltr">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => {
            const numStr = num.toString();
            const isPressed = pressedKey === numStr;
            return (
              <button
                key={num}
                onClick={() => handleCodeInput(numStr)}
                disabled={code.length >= 4}
                className={`relative overflow-hidden bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:from-blue-700 active:to-blue-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-2xl sm:text-3xl font-bold py-3 sm:py-5 rounded-xl transition-all duration-150 shadow-md hover:shadow-lg transform active:scale-95 ${
                  isPressed ? 'scale-95 from-blue-700 to-blue-800 shadow-inner' : ''
                }`}
                style={{ fontFamily: 'Arial, sans-serif' }}
              >
                {num}
              </button>
            );
          })}

          <button
            onClick={handleClear}
            className={`bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white text-sm sm:text-base font-bold py-3 sm:py-5 rounded-xl transition-all duration-150 shadow-md hover:shadow-lg transform active:scale-95 flex items-center justify-center gap-1 ${
              pressedKey === 'clear' ? 'scale-95 from-red-700 to-red-800 shadow-inner' : ''
            }`}
          >
            <span>مسح</span>
          </button>

          <button
            onClick={() => handleCodeInput('0')}
            disabled={code.length >= 4}
            className={`bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white text-2xl sm:text-3xl font-bold py-3 sm:py-5 rounded-xl transition-all duration-150 shadow-md hover:shadow-lg transform active:scale-95 ${
              pressedKey === '0' ? 'scale-95 from-blue-700 to-blue-800 shadow-inner' : ''
            }`}
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            0
          </button>

          <button
            onClick={handleBackspace}
            className={`bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xl sm:text-2xl font-bold py-3 sm:py-5 rounded-xl transition-all duration-150 shadow-md hover:shadow-lg transform active:scale-95 flex items-center justify-center ${
              pressedKey === 'backspace' ? 'scale-95' : ''
            }`}
          >
            ⌫
          </button>
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        `}</style>
      </div>

      {showFaceAttendance && (
<Suspense fallback={null}>
<LazyFaceAttendance
  students={students}
  activeSession={activeSession || null}
  onMarkAttendance={handleQRMarkAttendance}
  onUpdateStudent={onUpdateStudent}
  alreadyPresentIds={alreadyPresentIds}
  currentUser={currentUser}
  onClose={() => setShowFaceAttendance(false)}
/>
</Suspense>
      )}

      {showQRScanner && (
<QRAttendance
  students={students}
  activeSession={activeSession || null}
  onMarkAttendance={handleQRMarkAttendance}
  onUpdateStudent={onUpdateStudent}
  alreadyPresentIds={alreadyPresentIds}
  onClose={() => setShowQRScanner(false)}
/>
      )}
    </>
  );
});