import React from 'react';

import { cn } from '@/utils/function/utils';

/**
 * A placeholder the shape of what is coming: a zinc block with a slow sheen
 * sweeping across it (1.6 s). Still under reduced motion. Hidden from
 * assistive tech; announce the wait once, on the region (`aria-busy`).
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `line` (default) 12 px high text bar, `block` sized by the caller, `circle` an avatar. */
  shape?: 'line' | 'block' | 'circle';
}

const SHAPES = {
  line: 'h-3 rounded',
  block: 'rounded-lg',
  circle: 'rounded-full',
} as const;

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(({ shape = 'line', className, ...rest }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    data-skeleton=""
    className={cn(
      'relative isolate overflow-hidden bg-zinc-100 dark:bg-white/[0.04]',
      'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.7),transparent)] dark:before:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.04),transparent)] motion-reduce:before:hidden',
      SHAPES[shape],
      className,
    )}
    {...rest}
  />
));

Skeleton.displayName = 'Skeleton';

export { Skeleton };
export default Skeleton;
