import React from 'react';
import { Lightbulb, ScanFace, ShieldCheck, Smile, TriangleAlert, Zap } from 'lucide-react';
import type { CalibrationReport, MatchProfile } from '../../services/faceAI/gallery';

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
  /** تقرير معايرة المطابقة — يُحسب في الإدارة ويُعرض في اللوحة */
  report?: CalibrationReport | null;
  /** الحدود الفعلية القابلة للمعايرة */
  profile?: MatchProfile | null;
  /** فتح تسجيل مجدداً لزوج طالبين متعارضين */
  onReEnrollPair?: ((a: string, b: string) => void) | undefined;
}

export const FaceHealthPanel: React.FC<FaceHealthPanelProps> = ({
  variant,
  studentsCount,
  studentsWithoutFace,
  health,
  canEnroll,
  onReEnrollNoFace,
  onOpenEnroll,
  report,
  profile,
  onReEnrollPair,
}) => {
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
          <div className="text-xs text-emerald-400">بصمة v5 (معرض)</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
          <div className="text-2xl font-bold text-purple-300">{health.matureCount}</div>
          <div className="text-xs text-purple-400">ناضجة (≥80%)</div>
        </div>
        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/10">
          <div className="text-2xl font-bold text-slate-500">{health.noFaceCount}</div>
          <div className="text-xs text-slate-400">بدون بصمة</div>
        </div>
      </div>

      {/* ── معايرة المطابقة + الأزواج الخطرة ── */}
      {report && profile && report.students >= 2 && (
        <div className="mb-3 bg-white/5 border border-white/10 rounded-lg p-3">
          <p className="text-xs font-bold text-purple-200 mb-2 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> معايرة المطابقة (دقة المنع من الخلط)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-2">
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-lg font-bold text-indigo-300 font-mono" dir="ltr">{profile.d1Cap.toFixed(2)}</div>
              <div className="text-[10px] text-slate-400">أقصى مسافة مطابقة</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-lg font-bold text-indigo-300 font-mono" dir="ltr">{profile.margin.toFixed(2)}</div>
              <div className="text-[10px] text-slate-400">الهامش بين طالبين</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className={`text-lg font-bold ${report.separation ? 'text-emerald-300' : 'text-red-300'}`}>
                {report.separation ? '✓ مفصل' : '✗ ضعيف'}
              </div>
              <div className="text-[10px] text-slate-400">فصل الطلاب ({report.intraMax.toFixed(2)} ← {report.interMin.toFixed(2)})</div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-lg font-bold text-amber-300 font-mono" dir="ltr">{(report.estFalseAccept * 100).toFixed(2)}%</div>
              <div className="text-[10px] text-slate-400">خطر قبول خاطئ (تقديري)</div>
            </div>
          </div>

          {report.dangerPairs.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
              <p className="text-xs font-bold text-red-300 mb-1.5 flex items-center gap-1.5">
                <TriangleAlert className="w-4 h-4 shrink-0" />
                {report.dangerPairs.length} زوج طالبين متعارضين — بصمتاهما متشابكتان وقد يختلط حضورهما
              </p>
              <div className="space-y-1.5">
                {report.dangerPairs.slice(0, 8).map(p => (
                  <div key={`${p.a}-${p.b}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-300 truncate">
                      {p.aName || p.a} ↔ {p.bName || p.b}
                      <span className="text-red-400 font-mono mr-1.5" dir="ltr">d={p.distance.toFixed(2)}</span>
                    </span>
                    {onReEnrollPair && (
                      <button
                        onClick={() => onReEnrollPair(p.a, p.b)}
                        className="shrink-0 px-2 py-0.5 bg-red-500 hover:bg-red-400 text-white rounded font-bold transition"
                      >
                        إعادة تسجيل الاثنين
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
        <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" /> <strong>كيف يعمل؟</strong> اختر الطلاب واضغط زر الإضافة — الكاميرا تلتقط 3 عينات لكل طالب تلقائياً خلال ثوانٍ، ثم يُسجّل حضورهم بمجرد المرور أمام الكاميرا.
      </p>

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
