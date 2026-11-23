import React from 'react';
import { cn } from '@/utils/function/utils';

/**
 * A key of the keyboard, as a shortcut list or a hint names it (`Esc`, `/`,
 * `F`): a hairline box, Geist Mono 11 px in the zinc kit, no shadow.
 */
export type KbdProps = React.HTMLAttributes<HTMLElement>;

const Kbd = React.forwardRef<HTMLElement, KbdProps>(({ className, children, ...rest }, ref) => (
  <kbd
    ref={ref}
    className={cn(
      'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-[5px] border border-zinc-200 bg-white px-1 font-mono text-xs leading-none text-zinc-500',
      'dark:border-vd-line-strong dark:bg-white/[0.03] dark:text-zinc-400',
      className,
    )}
    {...rest}
  >
    {children}
  </kbd>
));

Kbd.displayName = 'Kbd';

export { Kbd };
export default Kbd;
