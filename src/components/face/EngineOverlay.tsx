import { createPortal } from 'react-dom';

interface EngineOverlayProps {
  progress: { percent: number; detail: string };
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

const STEPS = [
  { max: 30, label: 'محرك كشف الوجوه', icon: '🎯' },
  { max: 65, label: 'موديل بصمة الوجه', icon: '🧠' },
  { max: 100, label: 'التسخين والتحقق', icon: '⚡' },
] as const;

export const EngineOverlay: React.FC<EngineOverlayProps> = ({ progress, error, onCancel, onRetry }) => {
  const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const isError = !!error;
  const isDone = pct >= 100;

  return createPortal(
    <div
      dir="rtl"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl"
    >
      {onCancel && (
        <button
          onClick={onCancel}
          aria-label="إغلاق"
          className="fixed top-4 left-4 z-10 w-11 h-11 flex items-center justify-center bg-white/5 hover:bg-white/15 text-white rounded-full border border-white/10 transition active:scale-90"
        >
          ✕
        </button>
      )}

      <div className="w-full max-w-xs mx-4 text-center">
        {/* حلقة تقدم دائرية */}
        <div className="relative w-28 h-28 mx-auto mb-8">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke={isError ? '#f43f5e' : isDone ? '#34d399' : '#6366f1'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 326.7} 326.7`}
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {isDone ? (
              <span className="text-4xl">✅</span>
            ) : isError ? (
              <span className="text-4xl">⚠️</span>
            ) : (
              <ScanFaceGlyph />
            )}
          </div>
        </div>

        <h2 className="text-white text-lg font-extrabold mb-1.5">
          {isDone ? 'المحرك جاهز' : isError ? 'تعذر التحميل' : 'تهيئة محرك التعرف'}
        </h2>
        <p className={`text-sm mb-6 ${isError ? 'text-red-400' : 'text-slate-400'}`}>
          {isDone ? 'يمكنك المتابعة الآن' : isError ? error : 'يعمل بالكامل على جهازك — لا تُرفع أي صورة'}
        </p>

        {!isError && !isDone && (
          <>
            <div className="h-1.5 bg-white/8 rounded-full overflow-hidden mb-5">
              <div
                className="h-full rounded-full bg-gradient-to-l from-indigo-500 to-violet-500 transition-all duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="space-y-1.5 text-right">
              {STEPS.map((s, i) => {
                const done = pct >= s.max;
                const active = !done && (i === 0 || pct >= STEPS[i - 1].max);
                return (
                  <div
                    key={s.label}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                      done ? 'bg-emerald-500/10 text-emerald-300'
                        : active ? 'bg-indigo-500/10 text-indigo-200'
                        : 'bg-white/4 text-slate-500'
                    }`}
                  >
                    <span>{done ? '✅' : active ? '⏳' : '⚪'}</span>
                    <span className="flex-1">{s.label}</span>
                    {active && <span className="tabular-nums text-[10px] opacity-70">{pct}%</span>}
                  </div>
                );
              })}
            </div>
            <p className="text-slate-500 text-[11px] mt-4">{progress.detail}</p>
          </>
        )}

        {isError && onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold transition active:scale-95"
          >
            إعادة المحاولة
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

function ScanFaceGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.6" strokeLinecap="round" className="w-12 h-12 animate-pulse">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="9" cy="10" r="1" fill="#818cf8" />
      <circle cx="15" cy="10" r="1" fill="#818cf8" />
      <path d="M9 14.5c.9.7 1.9 1 3 1s2.1-.3 3-1" />
    </svg>
  );
}
