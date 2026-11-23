import React from 'react';
import { cn } from '@/utils/function/utils';

/** A command, a path or an identifier quoted inside running text. */
export type InlineCodeProps = React.HTMLAttributes<HTMLElement>;

const InlineCode = React.forwardRef<HTMLElement, InlineCodeProps>(({ className, ...rest }, ref) => (
  <code
    ref={ref}
    className={cn(
      'rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-800 dark:bg-neutral-800 dark:text-gray-200',
      className,
    )}
    {...rest}
  />
));

InlineCode.displayName = 'InlineCode';

export { InlineCode };
export default InlineCode;
