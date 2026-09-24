import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FieldControlProps {
  id: string;
  /** بدل required الأصلي: يعلن الأهمية لقارئ الشاشة دون حجب submit —
   *  التحقق يبقى رسائل مخصصة من النموذج (StudentManager.handleSubmit) */
  'aria-required'?: 'true' | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
}

interface FieldProps {
  /** نص التصنيف — يُربط بالحقل تلقائياً عبر htmlFor/id */
  label: ReactNode;
  /** وصف مساعد أسفل الحقل (يُربط عبر aria-describedby) */
  hint?: ReactNode;
  /** خطأ أسفل الحقل (يُعلن عبر role=alert) */
  error?: string;
  required?: boolean;
  labelClassName?: string;
  className?: string;
  /** الحقل — يأخذ حَمولة معرّف + وصف نصي من Field لضمان الربط */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * حقل نموذجي مركزي: تصنيف مربوط (htmlFor/id) + وصف مساعد + خطأ معلن
 * — يمنع حقول label بلا ربط (label-has-associated-control)
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  labelClassName,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn('block text-sm font-medium text-slate-300 mb-2', labelClassName)}
      >
        {label}
        {required && <span className="text-red-400 ms-0.5" aria-hidden="true">*</span>}
      </label>
      {children({
        id,
        'aria-required': required ? 'true' : undefined,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-slate-400 mt-1">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
