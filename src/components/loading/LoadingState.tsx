import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { MorphingSquare, type MorphingSquareSize } from '../MorphingSquare';

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  size?: MorphingSquareSize;
  label?: string;
}

export function LoadingState({
  className,
  size = 'lg',
  label = 'جاري التحميل',
  ...props
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('flex items-center justify-center', className)}
      {...props}
    >
      <MorphingSquare size={size} />
    </div>
  );
}
