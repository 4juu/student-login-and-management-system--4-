import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Maximize,
  Minimize,
  Users,
  UserCheck,
  UserX,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { database } from '../firebase/config';
import { getActiveAcademicYear } from '../firebase/dataService';
import { decompressRecord } from '../firebase/dataServiceCompressed';
import type { AttendanceRecord, AttendanceSession } from '../types/student';

interface LiveAttendanceWallProps {
  adminUid: string;
  teacherId: string;
  stageId: string;
  sessions: AttendanceSession[];
  activeSessionId: string | null;
  subjectName?: string;
  onClose: () => void;
}

const MAX_CARDS = 90;

const methodLabel = (m?: AttendanceRecord['method']): string =>
  m === 'qr' ? 'QR' : m === 'face' ? 'الوجه' : 'يدوي';

const playArrival = (
  ctxRef: React.MutableRefObject<AudioContext | null>,
  present: boolean
): void => {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = present ? 'sine' : 'triangle';
    const base = present ? 740 : 294;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.25, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(present ? 0.2 : 0.14, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.start(t);
    osc.stop(t + 0.65);
  } catch {
    /* تجاهل أي خطأ صوتي */
  }
};

const useCountUp = (target: number, duration = 700): number => {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
};

export const LiveAttendanceWall: React.FC<LiveAttendanceWallProps> = ({
  adminUid,
  teacherId,
  stageId,
  sessions,
  activeSessionId,
  subjectName,
  onClose,
}) => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [pathError, setPathError] = useState('');
  const [muted, setMuted] = useState(false);
  const [lastArrivalId, setLastArrivalId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(activeSessionId || 'all');
  const [now, setNow] = useState(() => new Date());
  const [isFs, setIsFs] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const mutedRef = useRef(muted);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // ============================================================
  // 🔴 الاشتراك الحي بسجلات الحضور المضغوطة
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    getActiveAcademicYear()
      .then((year) => {
        if (cancelled) return;
        const path = `academicYears/${year}/userData/${adminUid}/stageData/${stageId}/teacherRecords/${teacherId}/recordsCompressed`;
        unsub = onValue(
          ref(database, path),
          (snap) => {
            const val = snap.val();
            setRecords(Array.isArray(val) ? val.map((r) => decompressRecord(r)) : []);
          },
          () => {
            if (!cancelled) setPathError('تعذر الاتصال بقاعدة البيانات');
          }
        );
      })
      .catch(() => {
        if (!cancelled) setPathError('تعذر الاتصال بقاعدة البيانات');
      });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [adminUid, teacherId, stageId]);

  // ============================================================
  // 🎵 كشف الوصولات الجديدة + الصوت + التمييز
  // ============================================================
  useEffect(() => {
    const seen = seenIdsRef.current;
    const arrivals = records.filter((r) => !seen.has(r.id));
    if (arrivals.length === 0) return;

    arrivals.forEach((r) => seen.add(r.id));
    const sorted = [...arrivals].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // بعد أول تحميل فقط (seen كانت فارغة)
    if (seen.size > sorted.length) {
      const latest = sorted[0];
      if (!mutedRef.current) playArrival(audioCtxRef, latest.status !== 'absent');
      setLastArrivalId(latest.id);
      window.setTimeout(() => {
        setLastArrivalId((cur) => (cur === latest.id ? null : cur));
      }, 3000);
    }
  }, [records]);

  // ============================================================
  // ⏱️ ساعة حية + إغلاق بـ Esc + قفل التمرير
  // ============================================================
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => {});
      } else {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      /* غير مدعوم */
    }
  };

  // ============================================================
  // 📊 التصفية والفرز والعدّادات
  // ============================================================
  const sessionNames = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions]);

  const sessionIds = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(r.sessionId));
    return Array.from(set);
  }, [records]);

  const visible = useMemo(() => {
    let list = filter === 'all' ? records : records.filter((r) => r.sessionId === filter);
    return [...list].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [records, filter]);

  const counts = useMemo(() => {
    const present = visible.filter((r) => r.status !== 'absent').length;
    return { present, absent: visible.length - present, total: visible.length };
  }, [visible]);

  const presentCount = useCountUp(counts.present);
  const absentCount = useCountUp(counts.absent);
  const totalCount = useCountUp(counts.total);

  const displayRecords = useMemo(() => visible.slice(0, MAX_CARDS), [visible]);

  const groups = useMemo(() => {
    const m = new Map<string, { present: number; absent: number; total: number }>();
    for (const r of visible) {
      const key = r.studentGroup || 'بدون كروب';
      const e = m.get(key) || { present: 0, absent: 0, total: 0 };
      if (r.status !== 'absent') e.present++;
      else e.absent++;
      e.total++;
      m.set(key, e);
    }
    return Array.from(m.entries());
  }, [visible]);

  const presentRatio = counts.total > 0 ? counts.present / counts.total : 0;
  const presentPct = useCountUp(Math.round(presentRatio * 100));

  const timeStr = now.toLocaleTimeString('ar-IQ', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateStr = now.toLocaleDateString('ar-IQ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const currentSessionName = filter !== 'all' ? sessionNames.get(filter) : undefined;

  // ============================================================
  // 🖥️ الواجهة
  // ============================================================
  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex flex-col overflow-hidden text-slate-100"
      style={{
        background:
          'radial-gradient(1100px 500px at 85% -10%, rgba(56,189,248,0.14), transparent 60%),' +
          'radial-gradient(900px 420px at 10% 110%, rgba(16,185,129,0.12), transparent 60%),' +
          '#060B18',
      }}
    >
      {/* ===== الهيدر ===== */}
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 sm:px-8 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative flex h-3.5 w-3.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
              نبض الحضور
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 truncate">
              {(subjectName || 'الحضور')}
              {currentSessionName ? ` — ${currentSessionName}` : ''}
            </p>
          </div>
        </div>

        <div className="text-center hidden sm:block">
          <div className="text-2xl font-bold tabular-nums tracking-wide" dir="ltr">
            {timeStr}
          </div>
          <div className="text-xs text-slate-400">{dateStr}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            title={muted ? 'تشغيل الصوت' : 'كتم الصوت'}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition"
          >
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFs ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition"
          >
            {isFs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
          <button
            onClick={onClose}
            title="إغلاق (Esc)"
            className="p-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ===== العدّادات ===== */}
      <div className="grid grid-cols-3 gap-3 sm:gap-5 px-5 sm:px-8 pt-5">
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-4 sm:py-5 text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-300">
            <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-xs sm:text-sm font-bold">الحاضرون</span>
          </div>
          <div className="mt-1 text-4xl sm:text-6xl font-black text-emerald-300 tabular-nums">
            {presentCount}
          </div>
        </div>

        <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-4 sm:py-5 text-center">
          <div className="flex items-center justify-center gap-2 text-rose-300">
            <UserX className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-xs sm:text-sm font-bold">الغائبون</span>
          </div>
          <div className="mt-1 text-4xl sm:text-6xl font-black text-rose-300 tabular-nums">
            {absentCount}
          </div>
        </div>

        <div className="rounded-2xl border border-sky-400/25 bg-sky-400/10 px-4 py-4 sm:py-5 text-center">
          <div className="flex items-center justify-center gap-2 text-sky-300">
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-xs sm:text-sm font-bold">الإجمالي</span>
          </div>
          <div className="mt-1 text-4xl sm:text-6xl font-black text-sky-300 tabular-nums">
            {totalCount}
          </div>
        </div>
      </div>

      {/* ===== نسبة الحضور الكلية ===== */}
      {visible.length > 0 && (
        <div className="px-5 sm:px-8 pt-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="font-bold text-slate-300">نسبة الحضور الكلية</span>
              <span className="font-black text-emerald-300 tabular-nums">{presentPct}%</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                initial={false}
                animate={{ width: `${presentPct}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ===== الحضور حسب الكروب ===== */}
      {groups.length > 0 && (
        <div className="px-5 sm:px-8 pt-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {groups.map(([name, g]) => {
              const pct = g.total > 0 ? Math.round((g.present / g.total) * 100) : 0;
              return (
                <div
                  key={name}
                  className="shrink-0 min-w-[150px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-300">{name}</span>
                    <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                      {g.present}/{g.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-300 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div
                    className={`mt-1 text-[11px] font-black tabular-nums ${
                      pct >= 75 ? 'text-emerald-300' : pct >= 50 ? 'text-amber-300' : 'text-rose-300'
                    }`}
                  >
                    {pct}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== فلاتر الجلسات ===== */}
      <div className="flex items-center gap-2 overflow-x-auto px-5 sm:px-8 pt-4 pb-1 [scrollbar-width:thin]">
        <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
          <Activity className="w-3.5 h-3.5" /> الجلسة:
        </span>
        <button
          onClick={() => setFilter('all')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold border transition ${
            filter === 'all'
              ? 'bg-sky-400/20 border-sky-400/50 text-sky-200'
              : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
          }`}
        >
          جميع الجلسات
        </button>
        {sessionIds.map((id) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs sm:text-sm font-bold border transition ${
              filter === id
                ? 'bg-sky-400/20 border-sky-400/50 text-sky-200'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
            }`}
          >
            {sessionNames.get(id) || 'جلسة'}
          </button>
        ))}
      </div>

      {/* ===== شبكة البطاقات الحية ===== */}
      <main className="flex-1 overflow-y-auto px-5 sm:px-8 py-5">
        {pathError ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-6 py-8 text-center">
              <p className="text-lg font-bold text-rose-300">{pathError}</p>
              <p className="mt-1 text-sm text-slate-400">تحقق من اتصال الإنترنت وأعد المحاولة</p>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-8 py-10 text-center">
              <Activity className="mx-auto h-10 w-10 text-slate-500" />
              <p className="mt-3 text-lg font-bold text-slate-300">بانتظار أول تسجيل دخول…</p>
              <p className="mt-1 text-sm text-slate-500">
                ستظهر هنا السجلات فور دخول الطلاب عبر QR أو يدوياً
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            <AnimatePresence initial={false}>
              {displayRecords.map((r) => {
                const isPresent = r.status !== 'absent';
                const isLast = r.id === lastArrivalId;
                return (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, scale: 0.85, y: 24 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    className={`relative overflow-hidden rounded-2xl border p-4 transition ${
                      isLast
                        ? 'border-emerald-300/70 shadow-[0_0_0_2px_rgba(52,211,153,0.35),0_0_40px_rgba(16,185,129,0.25)]'
                        : isPresent
                          ? 'border-emerald-400/20 bg-gradient-to-b from-emerald-400/10 to-transparent'
                          : 'border-rose-400/20 bg-gradient-to-b from-rose-400/10 to-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isPresent
                            ? 'bg-emerald-400/20 text-emerald-300'
                            : 'bg-rose-400/20 text-rose-300'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isPresent ? 'bg-emerald-300' : 'bg-rose-300'}`} />
                        {isPresent ? 'حاضر' : 'غائب'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium" dir="ltr">
                        {methodLabel(r.method)}
                      </span>
                    </div>

                    <p className="mt-3 text-base sm:text-lg font-extrabold text-slate-100 leading-tight line-clamp-2 min-h-[2.5em]">
                      {r.studentName}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 font-semibold" dir="ltr">
                      {r.studentCode}
                      {r.studentGroup ? ` · ${r.studentGroup}` : ''}
                    </p>

                    <p className="mt-3 text-[11px] text-slate-500 font-medium tabular-nums">
                      {r.time}
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {visible.length > MAX_CARDS && (
          <p className="mt-4 text-center text-xs text-slate-500">
            يتم عرض آخر {MAX_CARDS} دخول — المجموع الكلي {visible.length}
          </p>
        )}
      </main>

      <footer className="border-t border-white/10 px-5 sm:px-8 py-3 text-center text-[11px] text-slate-500">
        الشاشة تُحدَّث تلقائياً لحظياً — لا حاجة لإعادة التحميل
      </footer>
    </div>
  );
};
