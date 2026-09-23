import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface TableSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ className, rows = 6, cols = 5, ...props }: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="جاري التحميل"
      className={cn('space-y-2 animate-fadeIn', className)}
      {...props}
    >
      <div className="flex gap-3 rounded-xl bg-white/5 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1 rounded" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={`c-${r}-${c}`} className="h-3.5 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
