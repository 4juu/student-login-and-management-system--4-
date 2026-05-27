import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  count?: number;
  direction?: 'row' | 'column';
  gap?: string | number;
}

const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'text',
  width,
  height,
  count = 1,
  direction = 'column',
  gap = '8px',
}) => {
  const baseClass = 'animate-skeleton bg-gray-200 dark:bg-gray-700';
  const variantClass = variant === 'circular' ? 'rounded-full' : variant === 'rectangular' ? 'rounded-md' : 'rounded h-4';

  const items = Array.from({ length: count });

  return (
    <div
      className={`flex ${direction === 'row' ? 'flex-row' : 'flex-col'}`}
      style={{ gap }}
      role="status"
      aria-label="Loading"
    >
      {items.map((_, i) => (
        <div
          key={i}
          className={`${baseClass} ${variantClass} ${className}`}
          style={{
            width: width || (variant === 'circular' ? 40 : '100%'),
            height: height || (variant === 'text' ? 16 : variant === 'circular' ? 40 : 100),
          }}
        />
      ))}
    </div>
  );
};

// === نماذج جاهزة ===

export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 6 }) => (
  <div className="space-y-3" role="status" aria-label="Loading table">
    {/* Header */}
    <div className="flex gap-3">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="flex-1 h-8" />
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex gap-3">
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="flex-1 h-6" />
        ))}
      </div>
    ))}
  </div>
);

export const SkeletonCard: React.FC = () => (
  <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4" role="status" aria-label="Loading card">
    <Skeleton className="h-6 w-1/3" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-5/6" />
    <div className="flex gap-3">
      <Skeleton className="h-10 w-24 rounded-md" />
      <Skeleton className="h-10 w-24 rounded-md" />
    </div>
  </div>
);

export const SkeletonStats: React.FC = () => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="status" aria-label="Loading stats">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm space-y-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
    ))}
  </div>
);

export default Skeleton;
