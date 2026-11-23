import React from 'react';
import { cn } from '@/utils/function/utils';

export type SkeletonType = 'table' | 'text' | 'avatar' | 'card' | 'list-item' | 'line' | 'block' | 'button';

interface SkeletonProps {
  type?: SkeletonType;
  rows?: number;
  columns?: number;
  height?: string;
  width?: string;
  className?: string;
  /** Rounded corners variant */
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  /** Animation variant */
  animate?: boolean;
}

const roundedClasses = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};

/**
 * Modern Skeleton component for loading states.
 * Supports multiple types and can be composed for complex layouts.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  type = 'line',
  rows = 3,
  columns = 5,
  height,
  width,
  className,
  rounded,
  animate = true,
}) => {
  // A quiet zinc block (a faint white in dark), 6 px corners unless asked otherwise.
  const baseClasses = cn(
    'bg-zinc-200/70 dark:bg-white/[0.06]',
    animate && 'animate-pulse',
    roundedClasses[rounded ?? 'md']
  );

  // Simple line skeleton
  if (type === 'line') {
    return (
      <div
        className={cn(baseClasses, 'h-3.5', rounded === undefined && 'rounded', className)}
        style={{ height, width: width || '100%' }}
      />
    );
  }

  // Block skeleton for custom shapes
  if (type === 'block') {
    return (
      <div
        className={cn(baseClasses, className)}
        style={{ height: height || '100px', width: width || '100%' }}
      />
    );
  }

  // Button skeleton
  if (type === 'button') {
    return (
      <div
        className={cn(baseClasses, 'h-8 w-24 rounded-lg', className)}
        style={{ height, width }}
      />
    );
  }

  // Table skeleton
  if (type === 'table') {
    return (
      <div className={cn('rounded-2xl p-4 space-y-4', className)}>
        {[...Array(rows)].map((_, rowIndex) => (
          <div key={`row-${rowIndex}`} className="flex gap-4">
            {[...Array(columns)].map((_, colIndex) => (
              <div
                key={`cell-${rowIndex}-${colIndex}`}
                className={cn('h-6 flex-1', baseClasses)}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Text skeleton (multiple lines)
  if (type === 'text') {
    return (
      <div className={cn('space-y-3', className)}>
        {[...Array(rows)].map((_, index) => (
          <div
            key={`text-line-${index}`}
            className={cn('h-4', baseClasses)}
            style={{
              width: width || (index === rows - 1 ? '75%' : '100%')
            }}
          />
        ))}
      </div>
    );
  }

  // Avatar skeleton
  if (type === 'avatar') {
    return (
      <div
        className={cn(baseClasses, 'rounded-full', className)}
        style={{ height: height || '40px', width: width || '40px' }}
      />
    );
  }

  // Card skeleton
  if (type === 'card') {
    return (
      <div className={cn(
        'rounded-2xl border border-zinc-200 dark:border-as-line p-6 space-y-6 bg-white dark:bg-as-surface',
        className
      )}>
        <div className="flex items-center gap-4">
          <div className={cn('h-12 w-12 rounded-full shrink-0', baseClasses)} />
          <div className="flex-1 space-y-3">
            <div className={cn('h-4 w-3/4', baseClasses)} />
            <div className={cn('h-3 w-1/2', baseClasses)} />
          </div>
        </div>
        <div className="space-y-3">
          <div className={cn('h-4 w-full', baseClasses)} />
          <div className={cn('h-4 w-5/6', baseClasses)} />
          <div className={cn('h-4 w-4/6', baseClasses)} />
        </div>
      </div>
    );
  }

  // List item skeleton
  if (type === 'list-item') {
    return (
      <div className={cn(
        'border border-zinc-200 dark:border-as-line rounded-xl p-4 bg-white dark:bg-as-surface',
        className
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={cn('w-5 h-5', baseClasses)} />
            <div className="flex-1 space-y-2">
              <div className={cn('h-4 w-1/3', baseClasses)} />
              <div className={cn('h-3 w-1/2', baseClasses)} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={cn('h-6 w-16 rounded-full', baseClasses)} />
            <div className={cn('h-6 w-20 rounded-lg', baseClasses)} />
          </div>
        </div>
      </div>
    );
  }

  return null;
};

/**
 * Simple line skeleton for inline usage
 */
export const SkeletonLine: React.FC<{
  width?: string;
  height?: string;
  className?: string;
}> = ({ width = '100%', height = '1rem', className }) => (
  <Skeleton type="line" width={width} height={height} className={className} />
);

/**
 * Circle skeleton for avatars
 */
export const SkeletonCircle: React.FC<{
  size?: string;
  className?: string;
}> = ({ size = '40px', className }) => (
  <Skeleton type="avatar" width={size} height={size} className={className} />
);

/**
 * Row skeleton for table rows
 */
export const SkeletonRow: React.FC<{
  columns?: number;
  className?: string;
}> = ({ columns = 4, className }) => (
  <div className={cn('flex gap-4 p-4', className)}>
    {[...Array(columns)].map((_, i) => (
      <SkeletonLine key={i} width={`${Math.random() * 30 + 50}%`} />
    ))}
  </div>
);

export default Skeleton;