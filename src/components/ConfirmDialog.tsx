import { type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, X } from 'lucide-react';
import { useModalBehavior } from '../hooks/useModalBehavior';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  confirmClassName = 'bg-red-500/90 hover:bg-red-600',
  icon,
  onConfirm,
  onCancel,
}) => {
  const panelRef = useModalBehavior({ open, onClose: onCancel });

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div
        ref={panelRef}
        dir="rtl"
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-modalUp"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon || <LogOut className="w-5 h-5 text-red-400" />}</span>
            <h3 className="font-extrabold text-white">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="bg-white/5 hover:bg-white/15 text-slate-300 p-2 rounded-lg transition active:scale-90"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {message && <p className="px-5 py-4 text-sm text-slate-300 leading-relaxed">{message}</p>}

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
          <button
            onClick={onCancel}
            className="text-slate-400 text-sm font-bold px-4 py-2 rounded-lg hover:text-white transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`text-white text-sm font-bold px-4 py-2 rounded-lg transition active:scale-95 ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmDialog;