import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface CardSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function CardSkeleton({ className, lines = 3, ...props }: CardSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="جاري التحميل"
      className={cn(
        'w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl animate-fadeIn',
        className,
      )}
      {...props}
    >
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'h-3 w-3/5' : 'h-3 w-full'} />
      ))}
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-20 rounded-lg" />
      </div>
    </div>
  );
}
