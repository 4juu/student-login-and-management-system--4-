import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Student } from '../../types/student';
import {
  hasValidDescriptor,
  type StoredFaceDescriptor,
  type FaceGalleryDescriptor,
} from '../../services/faceAI/descriptors';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const LazySelfCapture = lazy(() =>
  import('./SelfCaptureStep').then(m => ({ default: m.SelfCaptureStep }))
);

interface FaceEnrollModalProps {
  students: Student[];
  onUpdateStudent: (id: string, updates: Partial<Student>) => void;
  initialSelectedIds?: string[];
  onClose: () => void;
}

interface Result {
  studentId: string;
  name: string;
  ok: boolean;
  reason?: string;
}

export const FaceEnrollModal: React.FC<FaceEnrollModalProps> = ({
  students,
  onUpdateStudent,
  initialSelectedIds,
  onClose,
}) => {
  const validPreset = useMemo(
    () => (initialSelectedIds ?? []).filter(id => students.some(s => s.id === id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [phase, setPhase] = useState<'select' | 'live' | 'summary'>(validPreset.length ? 'live' : 'select');
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds ?? []));
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<string[]>(validPreset);
  const [qi, setQi] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  useBodyScrollLock(true);

  const filtered = useMemo(() => {
    const q = search.trim();
    const list = q ? students.filter(s => s.name.includes(q) || s.code.includes(q)) : students;
    return [...list].sort((a, b) => {
      const av = hasValidDescriptor(a.faceDescriptor) ? 0 : 1;
      const bv = hasValidDescriptor(b.faceDescriptor) ? 0 : 1;
      return av - bv || a.name.localeCompare(b.name, 'ar');
    });
  }, [students, search]);

  const currentStudent = queue[qi] ? students.find(s => s.id === queue[qi]) : undefined;

  const finishStudent = useCallback((studentId: string, name: string, ok: boolean, reason?: string) => {
    setResults(prev => [...prev, { studentId, name, ok, reason }]);
    if (qi + 1 >= queue.length) {
      setPhase('summary');
    } else {
      setQi(i => i + 1);
    }
  }, [qi, queue.length]);

  const handleCaptured = useCallback((descriptor: StoredFaceDescriptor | FaceGalleryDescriptor) => {
    if (!currentStudent) return;
    onUpdateStudent(currentStudent.id, {
      faceDescriptor: descriptor,
      faceRegisteredAt: new Date().toISOString(),
    });
    finishStudent(currentStudent.id, currentStudent.name, true);
  }, [currentStudent, onUpdateStudent, finishStudent]);

  const handleSkip = useCallback(() => {
    if (!currentStudent) return;
    finishStudent(currentStudent.id, currentStudent.name, false, 'تم التخطي');
  }, [currentStudent, finishStudent]);

  const startEnrollment = () => {
    if (selected.size === 0) return;
    setQueue([...selected]);
    setQi(0);
    setResults([]);
    setPhase('live');
  };

  const toggleStudent = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const okCount = results.filter(r => r.ok).length;

  return createPortal(
    <div dir="rtl" className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-slate-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-lg max-h-[96vh] overflow-y-auto overscroll-contain">
        {/* رأس */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur px-5 py-4 border-b border-white/8 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-extrabold text-base leading-tight">تسجيل بصمة الوجه</h2>
            <p className="text-[11px] text-slate-400">
              {phase === 'select' && 'اختر طالباً أو أكثر — التقاط يدوي لكل طالب'}
              {phase === 'live' && queue.length > 0 && `الطالب ${qi + 1} من ${queue.length}`}
              {phase === 'summary' && `اكتمل: ${okCount} نجح · ${results.length - okCount} فشل`}
            </p>
          </div>
          <button onClick={onClose} aria-label="إغلاق"
            className="w-9 h-9 rounded-full bg-white/8 hover:bg-red-500/80 text-white flex items-center justify-center transition active:scale-90">
            ✕
          </button>
        </div>

        {/* خطوة الاختيار */}
        {phase === 'select' && (
          <div className="p-5">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الرمز..."
              className="w-full mb-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-slate-400">{selected.size} محدد</span>
              <button
                onClick={() => setSelected(selected.size === students.length ? new Set() : new Set(students.map(s => s.id)))}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300"
              >
                {selected.size === students.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
              </button>
            </div>
            <ul className="max-h-[46vh] overflow-y-auto space-y-1.5 mb-4 pl-1">
              {filtered.map(s => {
                const has = hasValidDescriptor(s.faceDescriptor);
                const isSel = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => toggleStudent(s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-right transition ${
                        isSel ? 'bg-indigo-500/15 border-indigo-400/50' : 'bg-white/4 border-white/8 hover:bg-white/8'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] shrink-0 ${
                        isSel ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-500'
                      }`}>{isSel ? '✓' : ''}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-white truncate">{s.name}</span>
                        <span className="block text-[11px] text-slate-400">
                          كود {s.code}{has && ' · لديه بصمة (ستُستبدل)'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={startEnrollment}
              disabled={selected.size === 0}
              className="w-full bg-gradient-to-l from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold py-3 rounded-xl transition active:scale-[0.98]"
            >
              ابدأ الالتقاط ({selected.size})
            </button>
          </div>
        )}

        {/* خطوة الالتقاط — يستخدم SelfCaptureStep نفسه المستخدم بالرابط */}
        {phase === 'live' && currentStudent && (
          <Suspense fallback={
            <div className="p-5 text-center">
              <div className="inline-block w-9 h-9 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-white/50 text-sm">جاري تحميل محرك الالتقاط...</p>
            </div>
          }>
            <div className="p-2">
              <LazySelfCapture
                student={currentStudent}
                allStudents={students}
                onCaptured={handleCaptured}
                onCancel={handleSkip}
              />
            </div>
          </Suspense>
        )}

        {phase === 'live' && !currentStudent && (
          <div className="p-5 text-center">
            <p className="text-slate-300 font-bold text-sm mb-3">تعذر العثور على بيانات الطالب في قائمة الانتظار.</p>
            <button onClick={() => setPhase('summary')} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-sm transition px-6">عرض النتائج</button>
          </div>
        )}

        {/* ملخص */}
        {phase === 'summary' && (
          <div className="p-5">
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">{okCount === results.length ? '🎉' : '📋'}</div>
              <p className="text-white font-extrabold">
                تم تسجيل {okCount} من {results.length} بصمة بنجاح
              </p>
            </div>
            <ul className="space-y-1.5 mb-5 max-h-[42vh] overflow-y-auto">
              {results.map(r => (
                <li key={r.studentId} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm ${
                  r.ok ? 'bg-emerald-500/10 border-emerald-500/25' : 'bg-red-500/10 border-red-500/25'
                }`}>
                  <span>{r.ok ? '✅' : '❌'}</span>
                  <span className="flex-1 font-bold text-white truncate">{r.name}</span>
                  {!r.ok && r.reason && <span className="text-[11px] text-red-300 text-left max-w-[55%]">{r.reason}</span>}
                </li>
              ))}
            </ul>
            <button onClick={onClose} className="w-full bg-gradient-to-l from-indigo-600 to-violet-600 text-white font-extrabold py-3 rounded-xl transition active:scale-[0.98]">
              تم
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
