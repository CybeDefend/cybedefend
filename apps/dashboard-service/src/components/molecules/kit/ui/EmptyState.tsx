import React from 'react';

import { cn } from '@/utils/function/utils';

/**
 * What a list says when it has nothing: one sentence and
 * one action. No illustration, no icon in a circle. `title` is the sentence
 * in ink; `description` may add a second, quieter one.
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** One `Button` (size `sm`). */
  action?: React.ReactNode;
  /** `left` inside a list row, `center` (default) as a panel's whole body. */
  align?: 'center' | 'left';
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ title, description, action, align = 'center', className, ...rest }, ref) => (
    <div
      ref={ref}
      data-empty-state=""
      className={cn(
        'flex flex-col gap-3 py-10',
        align === 'center' ? 'items-center px-6 text-center' : 'items-start px-4 sm:px-5',
        className,
      )}
      {...rest}
    >
      <div className="max-w-sm">
        <p className="text-sm font-medium leading-5 text-zinc-900 dark:text-zinc-100">{title}</p>
        {description ? <p className="mt-1 text-sm leading-5 text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  ),
);

EmptyState.displayName = 'EmptyState';

export { EmptyState };
export default EmptyState;
