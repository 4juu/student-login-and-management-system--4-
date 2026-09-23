import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface StageSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  cards?: number;
}

export function StageSkeleton({ className, cards = 6, ...props }: StageSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="جاري التحميل"
      className={cn('space-y-4 animate-fadeIn', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-44 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg ms-auto" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
