import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Student, AttendanceRecord, AttendanceSession } from '../../types/student';

interface StudentProfileModalProps {
  student: Student;
  records: AttendanceRecord[];
  sessions: AttendanceSession[];
  stageName?: string;
  onClose: () => void;
}

const PAGE_SIZE = 8;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  present: { label: 'حاضر', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  absent: { label: 'غائب', cls: 'bg-red-50 text-red-700 border-red-200' },
  none: { label: 'لم يُسجَّل', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

const METHOD_LABEL: Record<string, string> = {
  manual: 'يدوي',
  qr: 'QR',
  face: 'بصمة الوجه',
};

const formatDate = (iso?: string): string => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const formatDateTime = (iso?: string): string => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export const StudentProfileModal: React.FC<StudentProfileModalProps> = ({
  student,
  records,
  sessions,
  stageName,
  onClose,
}) => {
  const [page, setPage] = useState(1);

  const studentRecords = useMemo(
    () => records.filter(r => r.studentId === student.id),
    [records, student.id]
  );

  const sortedByDate = useMemo(
    () => [...sessions].sort((a, b) => a.date.localeCompare(b.date)),
    [sessions]
  );

  const presentCount = studentRecords.filter(r => r.status === 'present').length;
  const absentCount = studentRecords.filter(r => r.status === 'absent').length;
  const unrecordedCount = Math.max(
    0,
    sessions.length - new Set(studentRecords.map(r => r.sessionId)).size
  );

  const methodCounts = useMemo(() => {
    const counts: Record<string, number> = { manual: 0, qr: 0, face: 0 };
    studentRecords.forEach(r => {
      if (r.status === 'present') {
        const m = r.method || 'manual';
        counts[m] = (counts[m] || 0) + 1;
      }
    });
    return counts;
  }, [studentRecords]);

  const timeline = useMemo(
    () =>
      [...studentRecords].sort((a, b) =>
        (b.timestamp || '').localeCompare(a.timestamp || '')
      ),
    [studentRecords]
  );

  const totalPages = Math.max(1, Math.ceil(timeline.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRecords = timeline.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const attendanceRate = (presentCount + absentCount) > 0
    ? Math.round((presentCount / (presentCount + absentCount)) * 100)
    : 0;

  const badges: { label: string; show: boolean; cls: string }[] = [
    { label: 'رمز QR', show: !!student.qrCodeId, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { label: 'بصمة الوجه', show: !!student.faceDescriptor, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    {
      label: 'تسجيل ذاتي',
      show: !!student.selfRegisteredAt,
      cls: student.selfRegistrationApproved
        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
        : 'bg-amber-50 text-amber-700 border-amber-200',
    },
  ];

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(student.code);
    } catch {
      // تجاهل - بعض المتصفحات تمنع النسخ التلقائي
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="modal-height bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden border border-slate-200"
        onClick={e => e.stopPropagation()}
      >
        {/* ── الهيدر ── */}
        <div className="shrink-0 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">📋 ملف الطالب</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-xl leading-none transition"
              aria-label="إغلاق"
            >
              &times;
            </button>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white font-bold text-xl sm:text-2xl shadow-md">
              {student.name.trim().charAt(0) || '؟'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 text-base sm:text-lg truncate">{student.name}</p>
                {stageName && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full border border-indigo-100">
                    📖 {stageName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <button
                  onClick={copyCode}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 font-mono text-xs font-bold rounded-md border border-blue-100 hover:bg-blue-100 transition"
                  title="نسخ الكود"
                >
                  {student.code} 📋
                </button>
                {student.universityId && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 font-mono text-xs rounded-md">
                    {student.universityId}
                  </span>
                )}
                {student.group && (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-md border border-amber-100">
                    🏷️ {student.group}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-3">
            {badges.filter(b => b.show).map(b => (
              <span
                key={b.label}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${b.cls}`}
              >
                ✔ {b.label}
              </span>
            ))}
            {badges.every(b => !b.show) && (
              <span className="text-xs text-gray-400">لا توجد بيانات تسجيل إضافية</span>
            )}
          </div>
        </div>

        {/* ── الجسم ── */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4 min-h-0">
          {/* بطاقات الإحصاءات */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
              <p className="text-xl font-bold text-gray-900">{sessions.length}</p>
              <p className="text-xs text-gray-500 mt-1">الجلسات</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
              <p className="text-xl font-bold text-emerald-700">{presentCount}</p>
              <p className="text-xs text-emerald-600 mt-1">حاضر</p>
            </div>
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-center">
              <p className="text-xl font-bold text-red-700">{absentCount}</p>
              <p className="text-xs text-red-600 mt-1">غائب</p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-center">
              <p className="text-xl font-bold text-indigo-700">{attendanceRate}%</p>
              <p className="text-xs text-indigo-600 mt-1">نسبة الحضور</p>
            </div>
          </div>

          {/* شريط توزيع الحضور */}
          {sessions.length > 0 && (
            <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-gray-800">معدل الحضور</p>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> حاضر {presentCount}</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> غائب {absentCount}</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" /> لم يُسجَّل {unrecordedCount}</span>
                </div>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden">
                <div className="bg-emerald-500" style={{ width: sessions.length ? `${(presentCount / sessions.length) * 100}%` : 0 }} />
                <div className="bg-red-500" style={{ width: sessions.length ? `${(absentCount / sessions.length) * 100}%` : 0 }} />
                <div className="bg-gray-300 flex-1" />
              </div>

              {/* طريقة التسجيل */}
              <div className="grid grid-cols-3 gap-2 mt-4">
                {(['manual', 'qr', 'face'] as const).map(m => (
                  <div key={m} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-center">
                    <p className="text-base font-bold text-gray-800">{methodCounts[m] || 0}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{METHOD_LABEL[m] || m}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* شبكة الجلسات */}
          {sessions.length > 0 && (
            <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
              <p className="text-sm font-bold text-gray-800 mb-3">كل الجلسات</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto pl-1">
                {sortedByDate.map(s => {
                  const rec = studentRecords.find(r => r.sessionId === s.id);
                  const status = rec ? (rec.status || 'present') : 'none';
                  const meta = STATUS_META[status] || STATUS_META.none;
                  return (
                    <div key={s.id} className={`px-2.5 py-2 rounded-lg border text-center ${meta.cls}`}>
                      <p className="text-xs font-semibold truncate" title={s.name}>{s.name}</p>
                      <p className="text-[10px] opacity-80 mt-0.5">{formatDate(s.date)}</p>
                      <p className="text-[11px] font-bold mt-1">{meta.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* معلومات التسجيل */}
          <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
            <p className="text-sm font-bold text-gray-800 mb-3">معلومات التسجيل</p>
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2.5 text-sm">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
                <span className="text-gray-500 text-xs">تاريخ الإضافة</span>
                <span className="text-gray-800 font-medium text-xs">{formatDate(student.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
                <span className="text-gray-500 text-xs">تسجيل ذاتي</span>
                <span className="text-gray-800 font-medium text-xs">
                  {student.selfRegisteredAt
                    ? `${formatDate(student.selfRegisteredAt)}${student.selfRegistrationApproved ? ' ✔' : ' (بانتظار الموافقة)'}`
                    : 'غير مسجّل ذاتياً'}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
                <span className="text-gray-500 text-xs">تسجيل بصمة الوجه</span>
                <span className="text-gray-800 font-medium text-xs">{formatDate(student.faceRegisteredAt)}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50">
                <span className="text-gray-500 text-xs">ربط رمز QR</span>
                <span className="text-gray-800 font-medium text-xs truncate max-w-[50%]" dir="ltr" title={student.qrCodeId}>
                  {student.qrCodeId || 'غير مربوط'}
                </span>
              </div>
            </div>
          </div>

          {/* الخط الزمني */}
          {timeline.length > 0 && (
            <div className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
              <p className="text-sm font-bold text-gray-800 mb-3">سجل الحضور ({timeline.length})</p>
              <div className="space-y-2 max-h-72 overflow-y-auto pl-1">
                {visibleRecords.map(r => {
                  const meta = STATUS_META[r.status || 'present'] || STATUS_META.present;
                  const method = r.method || 'manual';
                  const session = sessions.find(s => s.id === r.sessionId);
                  return (
                    <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800 truncate">{session?.name || 'جلسة'}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{formatDateTime(r.timestamp || `${r.date} ${r.time}`)}</p>
                      </div>
                      <span className="text-[11px] px-2 py-1 rounded-md bg-gray-100 text-gray-600">{METHOD_LABEL[method] || method}</span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${meta.cls}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="px-3 py-1 bg-white border border-gray-300 rounded-md text-sm disabled:opacity-30 hover:bg-gray-50"
                  >
                    السابق
                  </button>
                  <span className="text-xs text-gray-500">صفحة {safePage} من {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="px-3 py-1 bg-white border border-gray-300 rounded-md text-sm disabled:opacity-30 hover:bg-gray-50"
                  >
                    التالي
                  </button>
                </div>
              )}
            </div>
          )}

          {timeline.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">
              لا توجد سجلات حضور لهذا الطالب
            </div>
          )}
        </div>

        {/* ── التذييل ── */}
        <div className="shrink-0 px-5 sm:px-6 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={copyCode}
            className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition"
          >
            📋 نسخ الكود
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
