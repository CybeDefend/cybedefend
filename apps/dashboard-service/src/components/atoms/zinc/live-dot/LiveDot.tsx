import React from 'react';

import type { BeatTone } from '@/components/molecules/kit/narrative/beats';

export type LiveDotTone = BeatTone | 'idle';
export type LiveDotSize = 'xs' | 'sm';

/**
 * Was the 6 px breathing status dot. Every dot and every « live » are gone:
 * the colour now goes into the
 * word (`LIVE_DOT_TONE_TEXT`), who is working now is said by `LivePresence`.
 *
 * Kept so no caller breaks: it draws nothing. Given a `label`, it still says
 * it to assistive tech, as the dot did; without one it renders nothing at all.
 */
export interface LiveDotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: LiveDotTone;
  /** Ignored: nothing breathes any more. */
  pulse?: boolean;
  /** Accessible name. Without it nothing is rendered. */
  label?: string;
  /** Ignored. */
  size?: LiveDotSize;
}

/** A word in a beat's tone, at least 4.5:1 on its surface in both themes. */
export const LIVE_DOT_TONE_TEXT: Readonly<Record<LiveDotTone, string>> = {
  did: 'text-zinc-600 dark:text-zinc-300',
  served: 'text-zinc-900 dark:text-zinc-100',
  stopped: 'text-amber-700 dark:text-amber-400',
  denied: 'text-red-700 dark:text-red-400',
  live: 'text-mint',
  idle: 'text-zinc-500 dark:text-zinc-450',
};

const LiveDot = React.forwardRef<HTMLSpanElement, LiveDotProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ tone, pulse, label, size, className, ...rest }, ref) =>
    label ? (
      <span ref={ref} className="sr-only" {...rest}>
        {label}
      </span>
    ) : null,
);

LiveDot.displayName = 'LiveDot';

export { LiveDot };
export default LiveDot;
