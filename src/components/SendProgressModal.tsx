import React, { useEffect, useRef } from 'react';

const styles = `
@keyframes draw-check {
  from { stroke-dashoffset: 50; }
  to { stroke-dashoffset: 0; }
}
.draw-check {
  animation: draw-check 0.5s ease-out forwards;
}
`;

interface ChannelStatus {
  channelLabel: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
}

interface GroupProgress {
  groupName: string;
  channels: ChannelStatus[];
  allDone: boolean;
}

interface SendProgressModalProps {
  isOpen: boolean;
  subjectName: string;
  groups: GroupProgress[];
  onHide: () => void;
  isSending: boolean;
  totalDone: number;
  totalGroups: number;
}

const AnimatedCheck: React.FC = () => {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (pathRef.current) {
      pathRef.current.classList.remove('draw-check');
      void pathRef.current.getBoundingClientRect();
      pathRef.current.classList.add('draw-check');
    }
  }, []);

  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" stroke="#22c55e" strokeWidth="2" fill="#14532d" />
      <path
        ref={pathRef}
        d="M7 13l3 3 7-7"
        stroke="#22c55e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{
          strokeDasharray: 50,
          strokeDashoffset: 50,
        }}
        className="draw-check"
      />
    </svg>
  );
};

const Spinner: React.FC = () => (
  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="3" />
    <path d="M12 2a10 10 0 019.95 9" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const PendingDot: React.FC = () => (
  <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center">
    <div className="w-2 h-2 rounded-full bg-gray-300" />
  </div>
);

const FailedIcon: React.FC = () => (
  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="11" stroke="#ef4444" strokeWidth="2" fill="#7f1d1d" />
    <path d="M8 8l8 8M16 8l-8 8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const SendProgressModal: React.FC<SendProgressModalProps> = ({
  isOpen,
  subjectName,
  groups,
  onHide,
  isSending,
  totalDone,
  totalGroups,
}) => {
  if (!isOpen) return null;

  const percent = totalGroups > 0 ? Math.round((totalDone / totalGroups) * 100) : 0;

  return (
    <>
      <style>{styles}</style>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onHide} />
      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden border border-slate-600">
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-white">🎯 إرسال إشعارات الغياب</h2>
            <div className="text-xs text-slate-400">
              {totalDone === totalGroups ? '✅ اكتمل' : `${totalDone}/${totalGroups}`}
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-3">📚 {subjectName}</p>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                totalDone === totalGroups ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {totalDone === totalGroups
              ? 'تم إرسال جميع الإشعارات بنجاح'
              : `جاري الإرسال... ${percent}%`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 min-h-0">
          {groups.map((group) => (
            <div
              key={group.groupName}
              className={`flex items-center gap-3 p-3 rounded-xl border transition ${
                group.allDone
                  ? 'bg-green-900/40 border-green-700'
                  : group.channels.some(c => c.status === 'sending')
                  ? 'bg-blue-900/40 border-blue-700'
                  : 'bg-slate-700/50 border-slate-600'
              }`}
            >
              <div className="shrink-0">
                {group.allDone ? (
                  <AnimatedCheck />
                ) : group.channels.some(c => c.status === 'sending') ? (
                  <Spinner />
                ) : group.channels.some(c => c.status === 'failed') ? (
                  <FailedIcon />
                ) : (
                  <PendingDot />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white text-sm truncate">
                    {group.groupName}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {group.channels.length} {group.channels.length > 1 ? 'قنوات' : 'قناة'}
                  </span>
                </div>
                {group.channels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {group.channels.map((ch) => (
                      <span
                        key={ch.channelLabel}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          ch.status === 'sent'
                            ? 'bg-green-900 text-green-300'
                            : ch.status === 'failed'
                            ? 'bg-red-900 text-red-300'
                            : ch.status === 'sending'
                            ? 'bg-blue-900 text-blue-300'
                            : 'bg-slate-600 text-slate-400'
                        }`}
                      >
                        {ch.channelLabel}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-slate-700 flex gap-2">
          {totalDone === totalGroups ? (
            <button
              onClick={onHide}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 px-4 rounded-xl transition"
            >
              ✅ تم
            </button>
          ) : (
            <button
              onClick={onHide}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2.5 px-4 rounded-xl transition"
            >
              {isSending ? '📨 الإرسال في الخلفية' : 'إخفاء'}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
};
