import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/utils/function/utils';

/**
 * A 12 px ink bubble (white on zinc-900; zinc-900 on white in dark) that
 * names what the eye cannot read: an icon-only button, a truncated id. Opens
 * after 120 ms of hover or at once on keyboard focus, scales in from its
 * side. Radix keeps it out of the way of touch and wires `aria-describedby`.
 *
 * Self-contained: each tooltip brings its own provider, so a page does not
 * have to mount one.
 */
export interface TooltipProps {
  /** What the bubble says. Nothing (null, '') renders the trigger alone. */
  content: React.ReactNode;
  /** One focusable element: it becomes the trigger. */
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Milliseconds before it opens on hover. Default 120. */
  delay?: number;
  /** A keyboard shortcut after the words, in mono. */
  shortcut?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export const TOOLTIP_CLASSES =
  'z-[70] max-w-[260px] select-none rounded-md bg-zinc-900 px-2 py-1 text-xs leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900 origin-[var(--radix-tooltip-content-transform-origin)] data-[state=delayed-open]:animate-vd-pop-in data-[state=instant-open]:animate-vd-pop-in data-[state=closed]:animate-vd-pop-out motion-reduce:animate-none';

function Tooltip({ content, children, side = 'top', align = 'center', delay = 120, shortcut, open, onOpenChange, className }: TooltipProps) {
  if (content === null || content === undefined || content === false || content === '') return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={300}>
      <TooltipPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={cn(TOOLTIP_CLASSES, className)}>
            <span className="inline-flex items-center gap-2">
              <span>{content}</span>
              {shortcut ? <span className="font-mono text-xs text-zinc-500 dark:text-zinc-450">{shortcut}</span> : null}
            </span>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip };
export default Tooltip;
