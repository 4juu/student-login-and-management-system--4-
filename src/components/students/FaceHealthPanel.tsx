import React, { useState } from 'react';
import { Lightbulb, ScanFace, ShieldAlert, Smile, TriangleAlert, Zap } from 'lucide-react';
import type { Student } from '../../types/student';
import { findSuspiciousPairs } from '../../services/faceAI/descriptors';

interface FaceHealth {
  v5Count: number;
  matureCount: number;
  noFaceCount: number;
  total: number;
}

interface FaceHealthPanelProps {
  variant: 'banner' | 'health';
  studentsCount: number;
  studentsWithoutFace: number;
  health: FaceHealth;
  canEnroll: boolean;
  onReEnrollNoFace: () => void;
  onOpenEnroll: () => void;
  /** للفحص التعارضي: كل الطلاب مع بصماتهم (اختياري) */
  students?: Student[];
}

type Conflict = { a: string; b: string; distance: number };

export const FaceHealthPanel: React.FC<FaceHealthPanelProps> = ({
  variant,
  studentsCount,
  studentsWithoutFace,
  health,
  canEnroll,
  onReEnrollNoFace,
  onOpenEnroll,
  students,
}) => {
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const runConflictScan = () => {
    setScanning(true);
    // إخراج الحساب من خيط الرسم حتى لا يتجمّد الواجهة (O(ن²×49) مسافات)
    window.setTimeout(() => {
      try {
        const roster = (students ?? []).map(s => ({ id: s.id, name: s.name, faceDescriptor: s.faceDescriptor }));
        setConflicts(findSuspiciousPairs(roster));
      } finally {
        setScanning(false);
      }
    }, 30);
  };

  if (variant === 'banner') {
    if (!(studentsCount > 0 && studentsWithoutFace > 0)) return null;
    return (
      <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-3">
        <ScanFace className="w-7 h-7 text-emerald-400" />
        <div className="flex-1">
          <p className="text-sm font-bold text-emerald-300">
            {studentsWithoutFace} طالب بدون بصمة وجه
          </p>
          <p className="text-xs text-emerald-400">
            سيتم تسجيل بصمة الوجه تلقائياً عند أول عملية تسجيل. أو يمكنك إضافتها من الملف الشخصي للطالب.
          </p>
        </div>
      </div>
    );
  }

  if (!(studentsCount > 0 && canEnroll)) return null;
  return (
    <div className="mb-6 p-5 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-2 border-purple-500/30 rounded-lg">
      <h3 className="text-lg font-bold text-purple-200 mb-2 flex items-center gap-2">
        <Smile className="w-5 h-5 text-purple-400" /> بصمات الوجه
        <span className="text-xs font-normal bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
          جديد <Zap className="w-3 h-3" />
        </span>
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
          <div className="text-2xl font-bold text-emerald-300">{health.v5Count}</div>
          <div className="text-xs text-emerald-400">بصمة مسجّلة</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
          <div className="text-2xl font-bold text-purple-300">{health.matureCount}</div>
          <div className="text-xs text-purple-400">سبع زوايا كاملة</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
          <div className="text-2xl font-bold text-slate-500">{health.noFaceCount}</div>
          <div className="text-xs text-slate-400">بدون بصمة</div>
        </div>
      </div>

      {studentsWithoutFace > 0 && (
        <div className="mb-3 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1 text-xs text-slate-300">
            <strong className="text-amber-300">{studentsWithoutFace} طالب</strong> بدون بصمة وجه مسجّلة — سجّلها لتفعيل الحضور بالكاميرا.
            <button
              onClick={onReEnrollNoFace}
              className="mr-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-md font-bold transition"
            >
              تسجيل الآن
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-purple-300 mb-3 bg-white/5 p-2 rounded flex items-start gap-1">
        <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>كيف يعمل؟</strong> لكل طالب رابط تسجيل خاص — الكاميرا تلتقط 7 زوايا (أمام، يمين، يسار، فوق، تحت، اقترب، ابتعد) وتُحفظ كسبع عينات مستقلة بلا دمج، ثم يتعرف النظام عليه فور ظهور وجهه.
      </p>

      {/* فحص تعارض البصمات — يكشف طالبين ببصمات متقاربة (خطر الخلط) */}
      {students && students.length > 1 && (
        <div className="mb-3 bg-white/5 border border-white/10 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-400" /> فحص تعارض البصمات
            </p>
            <button
              type="button"
              onClick={runConflictScan}
              disabled={scanning}
              className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-50 transition"
            >
              {scanning ? 'جارٍ الفحص…' : conflicts !== null ? 'إعادة الفحص' : 'ابدأ الفحص'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mb-2">
            يقارن عينات كل طالب السبع بعينات بقية الطلاب — أي تقارب يدل على وجهين متشابهين ويستحق إعادة التسجيل.
          </p>
          {conflicts !== null && (
            conflicts.length === 0 ? (
              <p className="text-[11px] text-emerald-300 font-bold">✓ لا توجد تعارضات — كل البصمات متميزة عن بعضها.</p>
            ) : (
              <ul className="space-y-1">
                {conflicts.slice(0, 8).map((c, i) => (
                  <li key={i} className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 flex justify-between gap-2">
                    <span className="truncate">{c.a} ↔ {c.b}</span>
                    <span className="font-mono font-bold shrink-0">{c.distance}</span>
                  </li>
                ))}
                {conflicts.length > 8 && (
                  <li className="text-[11px] text-slate-400">… و{conflicts.length - 8} تعارض أخرى</li>
                )}
              </ul>
            )
          )}
        </div>
      )}

      <button
        onClick={onOpenEnroll}
        className="w-full relative overflow-hidden bg-gradient-to-l from-violet-600 via-purple-600 to-fuchsia-600 hover:from-violet-500 hover:via-purple-500 hover:to-fuchsia-500 text-white font-extrabold py-3.5 px-6 rounded-xl shadow-lg shadow-purple-900/40 transition duration-200 transform active:scale-[0.98] flex items-center justify-center gap-2.5"
      >
        <ScanFace className="w-6 h-6" />
        <span className="text-base">إضافة بصمات جديدة</span>
        {studentsWithoutFace > 0 && (
          <span className="absolute top-1 left-2 bg-yellow-400 text-yellow-900 text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow">
            {studentsWithoutFace} بانتظار التسجيل
          </span>
        )}
      </button>
    </div>
  );
};
