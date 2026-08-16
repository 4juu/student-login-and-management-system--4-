import { createPortal } from 'react-dom';
import type { LoadProgressInfo } from '../services/faceRecognition';

interface FaceModelLoadingOverlayProps {
  progress: LoadProgressInfo;
  onCancel?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  detector: 'كشف الوجوه',
  landmarks: 'نقاط الوجه',
  recognition: 'التعرف على الهوية',
};

const STAGE_ICONS: Record<string, string> = {
  detector: '🔍',
  landmarks: '📍',
  recognition: '🧠',
};

export const FaceModelLoadingOverlay: React.FC<FaceModelLoadingOverlayProps> = ({ progress, onCancel }) => {
  const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const isDone = progress.stage === 'done';
  const isError = progress.stage === 'error';

  return createPortal(
    <div
      dir="rtl"
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="w-full max-w-sm mx-4 text-center">
        {/* Face icon with pulse animation */}
        <div className="relative w-24 h-24 mx-auto mb-8">
          <div
            className={`absolute inset-0 rounded-full ${
              isDone ? 'bg-emerald-500/20' : isError ? 'bg-red-500/20' : 'bg-blue-500/20'
            }`}
            style={{
              animation: isDone || isError ? 'none' : 'pulse-ring 2s ease-out infinite',
            }}
          />
          <div
            className={`absolute inset-2 rounded-full flex items-center justify-center text-4xl ${
              isDone ? 'bg-emerald-500/30' : isError ? 'bg-red-500/30' : 'bg-blue-500/30'
            }`}
          >
            {isDone ? '✅' : isError ? '❌' : '👤'}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-white text-xl font-extrabold mb-2">
          {isDone ? 'الموديلات جاهزة!' : isError ? 'فشل التحميل' : 'جاري تحميل نظام التعرف'}
        </h2>
        <p className="text-slate-400 text-sm mb-8">
          {isDone
            ? 'يمكنك المتابعة الآن'
            : isError
            ? progress.error || 'حدث خطأ أثناء التحميل'
            : 'يرجى الانتظار حتى اكتمال التحميل...'}
        </p>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                isDone ? 'bg-emerald-500' : isError ? 'bg-red-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-slate-400 text-xs font-bold">{progress.detail}</span>
            <span
              className={`text-sm font-extrabold tabular-nums ${
                isDone ? 'text-emerald-400' : isError ? 'text-red-400' : 'text-blue-400'
              }`}
            >
              {pct}%
            </span>
          </div>
        </div>

        {/* Per-stage checklist */}
        <div className="space-y-2 mb-8">
          {(['detector', 'landmarks', 'recognition'] as const).map((stage) => {
            const stageProgress = progress.stage === stage;
            const stageDone =
              progress.stageIndex > ['detector', 'landmarks', 'recognition'].indexOf(stage) ||
              (progress.stage === 'done');
            const stageError = progress.stage === 'error' && progress.stageIndex === ['detector', 'landmarks', 'recognition'].indexOf(stage);

            return (
              <div
                key={stage}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 ${
                  stageDone
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : stageError
                    ? 'bg-red-500/10 border border-red-500/20'
                    : stageProgress
                    ? 'bg-blue-500/10 border border-blue-500/20'
                    : 'bg-white/5 border border-white/10'
                }`}
              >
                <span className="text-lg">{STAGE_ICONS[stage]}</span>
                <span className="flex-1 text-right text-sm font-bold text-slate-200">{STAGE_LABELS[stage]}</span>
                <span className="text-sm">
                  {stageDone ? '✅' : stageError ? '❌' : stageProgress ? '⏳' : '⬜'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Cancel button */}
        {onCancel && !isDone && (
          <button
            onClick={onCancel}
            className="bg-white/10 hover:bg-white/20 text-slate-300 px-6 py-2.5 rounded-xl text-sm font-bold transition active:scale-95"
          >
            إلغاء
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.15); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>
    </div>,
    document.body
  );
};
