import React from 'react';
import { WifiOff } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface OfflineModalProps {
  open: boolean;
  onDismiss: () => void;
}

export const OfflineModal: React.FC<OfflineModalProps> = ({ open, onDismiss }) => {
  useBodyScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fadeIn">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative glass-modal w-full max-w-sm text-center animate-modalUp">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center">
          <WifiOff className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="mt-4 text-base sm:text-lg font-semibold text-white">فُقد الاتصال بالإنترنت</h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          جميع عمليات تسجيل الحضور ستُحفظ تلقائياً إلى حين رجوع الاتصال بالإنترنت.
          <br />
          <span className="text-amber-300 font-medium">الرجاء عدم إغلاق الموقع لحين إعادة الاتصال.</span>
        </p>
        <button
          onClick={onDismiss}
          className="btn-base btn-danger w-full min-h-12! mt-5"
        >
          موافق
        </button>
      </div>
    </div>
  );
};