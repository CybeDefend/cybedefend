import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The tones of the space, and where their colour goes now (no coloured dot any more, the colour moves into the word):
 * red is denied or critical, amber warned or high, mint (the brand green)
 * live, iris (the brand violet) waiting on a person; everything else is zinc.
 *
 * `DOT_TONE_TEXT` is the word in that tone, at least 4.5:1 on white, zinc-50
 * and zinc-100 in light and on every dark surface. `dotVariants` (the former
 * 6 px fill) is kept for the callers that still read it; `Dot` itself renders
 * nothing, so a caller that has not moved yet loses its dot, not its layout.
 */
export const dotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    tone: {
      neutral: 'bg-zinc-400 dark:bg-zinc-500',
      ink: 'bg-zinc-900 dark:bg-zinc-100',
      idle: 'bg-zinc-300 dark:bg-zinc-600',
      live: 'bg-mint',
      warn: 'bg-amber-500 dark:bg-amber-400',
      danger: 'bg-red-500 dark:bg-red-400',
      /** The brand violet, for what waits on a person (rules to validate): the one accent a list may spend. */
      iris: 'bg-iris',
    },
    size: {
      xs: 'h-1.5 w-1.5',
      sm: 'h-2 w-2',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'xs' },
});

export type DotTone = NonNullable<VariantProps<typeof dotVariants>['tone']>;

/** A word in a tone: the colour a dot used to carry. */
export const DOT_TONE_TEXT: Readonly<Record<DotTone, string>> = {
  neutral: 'text-zinc-600 dark:text-zinc-300',
  ink: 'text-zinc-900 dark:text-zinc-100',
  idle: 'text-zinc-500 dark:text-zinc-450',
  live: 'text-mint',
  warn: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
  iris: 'text-iris',
};

/** The class string of a word in `tone` (`neutral` when none). */
export const toneText = (tone: DotTone | null | undefined): string => DOT_TONE_TEXT[tone ?? 'neutral'];

export interface DotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>, VariantProps<typeof dotVariants> {}

/** Kept so no caller breaks; renders nothing (the word next to it carries the colour). */
const Dot = React.forwardRef<HTMLSpanElement, DotProps>(() => null);

Dot.displayName = 'Dot';

export { Dot };
export default Dot;
