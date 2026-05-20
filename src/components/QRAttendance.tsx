import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { AttendanceSession, Student } from '../types/student';

interface QRAttendanceProps {
  students: Student[];
  activeSession: AttendanceSession | null;
  onMarkAttendance: (student: Student) => Promise<void> | void;
  onUpdateStudent?: (id: string, updates: Partial<Student>) => void;
  alreadyPresentIds: Set<string>;
  onClose: () => void;
}

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  type: ToastType;
  title: string;
  text?: string;
  student?: Student;
}

const QR_REGION_ID = 'qr-reader-fast-attendance';
const DUPLICATE_BLOCK_MS = 60_000;

const extractQrCodeId = (decodedText: string): string | null => {
  const raw = decodedText.trim();

  try {
    const url = new URL(raw);
    const id = url.searchParams.get('id');
    if (id) return id.trim();
  } catch {
    // ignore
  }

  try {
    const obj = JSON.parse(raw);
    const possible =
      obj.qrCodeId ||
      obj.qrId ||
      obj.id ||
      obj.studentId ||
      obj.universityId ||
      obj.code;

    if (possible) return String(possible).trim();
  } catch {
    // ignore
  }

  if (/^[A-Za-z0-9_-]{5,100}$/.test(raw)) return raw;

  return null;
};

const playSuccessFeedback = () => {
  try {
    navigator.vibrate?.([80, 40, 80]);
  } catch {}

  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;

    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.12);
  } catch {}
};

const playErrorFeedback = () => {
  try {
    navigator.vibrate?.([200]);
  } catch {}
};

export const QRAttendance: React.FC<QRAttendanceProps> = ({
  students,
  activeSession,
  onMarkAttendance,
  onUpdateStudent,
  alreadyPresentIds,
  onClose,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);
  const lastScanRef = useRef<Record<string, number>>({});

  const [cameraStarted, setCameraStarted] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [lastStudents, setLastStudents] = useState<Student[]>([]);

  const [pendingQrCodeId, setPendingQrCodeId] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');

  const studentsByQr = useMemo(() => {
    const map = new Map<string, Student>();

    students.forEach((s) => {
      if (s.qrCodeId) map.set(s.qrCodeId.trim(), s);
      if (s.universityId) map.set(s.universityId.trim(), s);
    });

    return map;
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();

    return students
      .filter((s) => {
        if (s.qrCodeId) return false;
        if (!q) return true;

        return (
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          (s.group || '').toLowerCase().includes(q) ||
          (s.universityId || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 30);
  }, [students, studentSearch]);

  const showToast = (message: ToastMessage, timeout = 2200) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? null : current));
    }, timeout);
  };

  const handleKnownStudent = async (student: Student, qrCodeId: string) => {
    const now = Date.now();

    const lastTime = lastScanRef.current[qrCodeId] || 0;
    if (now - lastTime < DUPLICATE_BLOCK_MS) {
      return;
    }

    lastScanRef.current[qrCodeId] = now;

    if (alreadyPresentIds.has(student.id)) {
      showToast(
        {
          type: 'warning',
          title: 'مسجل مسبقاً',
          text: `${student.name} مسجل حضور مسبقاً بهذا السجل`,
          student,
        },
        1800
      );
      return;
    }

    await onMarkAttendance(student);

    setScanCount((prev) => prev + 1);
    setLastStudents((prev) =>
      [student, ...prev.filter((s) => s.id !== student.id)].slice(0, 5)
    );

    playSuccessFeedback();

    showToast({
      type: 'success',
      title: `تم تسجيل ${student.name}`,
      text: student.group ? `الكروب: ${student.group}` : 'تم تسجيل الحضور بنجاح',
      student,
    });
  };

  const handleDecoded = async (decodedText: string) => {
    if (isProcessingRef.current) return;

    const qrCodeId = extractQrCodeId(decodedText);

    if (!qrCodeId) {
      playErrorFeedback();
      showToast({
        type: 'error',
        title: 'QR غير صالح',
        text: 'لم يتم التعرف على رمز الهوية',
      });
      return;
    }

    isProcessingRef.current = true;

    try {
      const student = studentsByQr.get(qrCodeId);

      if (student) {
        await handleKnownStudent(student, qrCodeId);
      } else {
        const lastTime = lastScanRef.current[qrCodeId] || 0;
        const now = Date.now();

        if (now - lastTime < DUPLICATE_BLOCK_MS) {
          return;
        }

        lastScanRef.current[qrCodeId] = now;
        setPendingQrCodeId(qrCodeId);
        playErrorFeedback();

        showToast(
          {
            type: 'info',
            title: 'هوية غير مربوطة',
            text: 'اختر الطالب مرة واحدة فقط لربط الهوية',
          },
          3000
        );
      }
    } finally {
      window.setTimeout(() => {
        isProcessingRef.current = false;
      }, 350);
    }
  };

  const startCamera = async () => {
    try {
      const html5QrCode = new Html5Qrcode(QR_REGION_ID);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
          disableFlip: false,
        },
        handleDecoded,
        () => {}
      );

      setCameraStarted(true);
    } catch (err) {
      console.error(err);
      showToast({
        type: 'error',
        title: 'فشل فتح الكاميرا',
        text: 'تأكد من السماح للمتصفح باستخدام الكاميرا',
      });
    }
  };

  const stopCamera = async () => {
    try {
      if (scannerRef.current) {
        const state = scannerRef.current.getState();
        if (state) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      }
    } catch (err) {
      console.warn('Camera stop error:', err);
    } finally {
      scannerRef.current = null;
      setCameraStarted(false);
    }
  };

  useEffect(() => {
    startCamera();

    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = async () => {
    await stopCamera();
    onClose();
  };

  const handleLinkStudent = async (student: Student) => {
    if (!pendingQrCodeId || !onUpdateStudent) return;

    const updatedStudent: Student = {
      ...student,
      qrCodeId: pendingQrCodeId,
    };

    onUpdateStudent(student.id, { qrCodeId: pendingQrCodeId });

    setPendingQrCodeId(null);
    setStudentSearch('');

    await handleKnownStudent(updatedStudent, pendingQrCodeId);
  };

  const toastColors: Record<ToastType, string> = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-blue-600',
    warning: 'bg-amber-500',
  };

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 text-white flex flex-col"
      dir="rtl"
    >
      <div className="p-4 bg-gray-900 border-b border-white/10 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">التسجيل عن طريق هوية الطالب</h2>
          <p className="text-xs text-gray-300">
            {activeSession
              ? `السجل النشط: ${activeSession.name}`
              : 'لا يوجد سجل نشط'}
          </p>
        </div>

        <button
          onClick={handleClose}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold"
        >
          إغلاق
        </button>
      </div>

      <div className="relative flex-1 flex flex-col items-center justify-start p-4 overflow-y-auto">
        <div className="w-full max-w-md rounded-2xl overflow-hidden border-4 border-emerald-500 shadow-2xl bg-black">
          <div id={QR_REGION_ID} className="w-full min-h-[320px]" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-md">
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-emerald-400">
              {scanCount}
            </div>
            <div className="text-xs text-gray-300">تم تسجيلهم الآن</div>
          </div>

          <div className="bg-white/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">
              {cameraStarted ? '🟢' : '🔴'}
            </div>
            <div className="text-xs text-gray-300">
              {cameraStarted ? 'الكاميرا تعمل' : 'الكاميرا متوقفة'}
            </div>
          </div>
        </div>

        {lastStudents.length > 0 && (
          <div className="mt-4 w-full max-w-md bg-white/10 rounded-xl p-3">
            <p className="text-sm font-bold mb-2 text-emerald-300">
              آخر المسجلين:
            </p>
            <div className="space-y-2">
              {lastStudents.map((s) => (
                <div
                  key={s.id}
                  className="flex justify-between items-center bg-black/25 rounded-lg px-3 py-2"
                >
                  <span className="text-sm">{s.name}</span>
                  <span className="text-xs bg-emerald-600 px-2 py-1 rounded-full">
                    {s.group || '-'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {toast && (
          <div
            className={`fixed top-20 left-1/2 -translate-x-1/2 ${toastColors[toast.type]} text-white rounded-2xl px-5 py-4 shadow-2xl w-[90%] max-w-md animate-bounce-in z-[10001]`}
          >
            <div className="flex items-center gap-3">
              <div className="text-3xl">
                {toast.type === 'success'
                  ? '✅'
                  : toast.type === 'error'
                  ? '❌'
                  : toast.type === 'warning'
                  ? '⚠️'
                  : 'ℹ️'}
              </div>
              <div>
                <p className="font-bold text-lg">{toast.title}</p>
                {toast.text && (
                  <p className="text-sm opacity-95">{toast.text}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {pendingQrCodeId && (
        <div className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-lg">
            <h3 className="text-xl font-bold mb-2">ربط هوية طالب لأول مرة</h3>
            <p className="text-sm text-gray-600 mb-3">
              هذا الرمز غير مربوط بأي طالب. اختر الطالب مرة واحدة فقط، وبعدها
              يسجل تلقائياً.
            </p>

            <div
              className="mb-3 bg-gray-100 border rounded-lg p-2 text-xs font-mono break-all"
              dir="ltr"
            >
              {pendingQrCodeId}
            </div>

            {!onUpdateStudent && (
              <div className="mb-3 p-3 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm">
                لا توجد صلاحية ربط. يجب تمرير دالة تحديث الطالب إلى الماسح.
              </div>
            )}

            <input
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الرمز أو الكروب..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3"
              autoFocus
            />

            <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
              {filteredStudents.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  لا توجد نتائج أو كل الطلاب مربوطين
                </div>
              ) : (
                filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => handleLinkStudent(student)}
                    className="w-full text-right p-3 hover:bg-emerald-50 flex items-center justify-between"
                    disabled={!onUpdateStudent}
                  >
                    <div>
                      <div className="font-bold">{student.name}</div>
                      <div className="text-xs text-gray-500">
                        الرمز: {student.code} | الكروب: {student.group || '-'}
                      </div>
                    </div>
                    <span className="text-emerald-600 font-bold">اختيار</span>
                  </button>
                ))
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setPendingQrCodeId(null)}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded-lg font-bold"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounceIn {
          0% { opacity: 0; transform: translate(-50%, -20px) scale(0.95); }
          60% { opacity: 1; transform: translate(-50%, 5px) scale(1.02); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        .animate-bounce-in {
          animation: bounceIn 0.25s ease-out;
        }
      `}</style>
    </div>
  );
};

export default QRAttendance;