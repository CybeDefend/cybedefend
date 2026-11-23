import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_COUNT_ZERO_VALUE } from '@/components/atoms/appsec/styles';

export type SeverityCountSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'fixed';

export interface SeverityCountProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: SeverityCountSeverity;
  count: number;
  /**
   * What follows the figure: a letter (`C`) in a narrow column, the word
   * elsewhere. Give the whole an `aria-label` when the letter alone would not
   * be understood.
   */
  label?: React.ReactNode;
  className?: string;
}

/*
  The severity chip, outlined soberly on a soft tinted fill: a 1 px hairline in the
  severity's hue, a 12 % tint of its -400 shade, the letter in its colour.
  The one place a soft chip comes back, so it stays quiet: no shadow, no
  weight above 500. Letter on its tint, measured (WCAG 2.x): light, -700 on
  the -400/12 % tint, red 5.75, orange 4.71, amber 4.71, blue 6.04, emerald
  5.06 on white (4.53 at worst on zinc-50, a hovered row); dark, -400 on the
  same tint over the AppSec surface, red 5.80, orange 6.96, amber 8.98, blue
  6.22, emerald 8.02 (5.22 at worst on the raised layer). The figure takes
  the letter's colour, so the same measures hold for it.
*/
const CHIP_TONE: Record<SeverityCountSeverity, { chip: string; text: string }> = {
  critical: {
    chip: 'border-red-400/40 bg-red-400/[0.12] dark:border-red-400/25',
    text: 'text-red-700 dark:text-red-400',
  },
  high: {
    chip: 'border-orange-400/45 bg-orange-400/[0.12] dark:border-orange-400/25',
    text: 'text-orange-700 dark:text-orange-400',
  },
  medium: {
    chip: 'border-amber-400/50 bg-amber-400/[0.12] dark:border-amber-400/25',
    text: 'text-amber-700 dark:text-amber-400',
  },
  low: {
    chip: 'border-blue-400/40 bg-blue-400/[0.12] dark:border-blue-400/25',
    text: 'text-blue-700 dark:text-blue-400',
  },
  info: {
    chip: 'border-blue-400/40 bg-blue-400/[0.12] dark:border-blue-400/25',
    text: 'text-blue-700 dark:text-blue-400',
  },
  fixed: {
    chip: 'border-emerald-400/45 bg-emerald-400/[0.12] dark:border-emerald-400/25',
    text: 'text-emerald-700 dark:text-emerald-400',
  },
};

/** A zero keeps its slot, so four counts align from one row to the next: a zinc hairline, no tint, the figure and letter quiet. */
const ZERO_CHIP = 'border-zinc-200 bg-transparent dark:border-white/[0.08]';

const CHIP_BASE = 'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs leading-none';

/**
 * A severity count as one unit: the mono figure and its unit (the letter `C`,
 * or the word), both in the severity's colour, inside one soft chip tinted in
 * that colour, so the letter reads with its figure. A zero is a quiet zinc
 * outline.
 */
const SeverityCount: React.FC<SeverityCountProps> = ({ severity, count, label, className, ...rest }) => {
  const zero = count === 0;
  const hasLabel = label !== undefined && label !== null && label !== '';
  const tone = CHIP_TONE[severity] ?? CHIP_TONE.low;
  return (
    <span className={cn(CHIP_BASE, zero ? ZERO_CHIP : tone.chip, className)} data-severity={severity} {...rest}>
      <span className={cn('font-mono tabular-nums', zero ? AS_COUNT_ZERO_VALUE : tone.text)}>{count}</span>
      {/* The unit is a word or its letter: the UI font, the figure alone in mono. */}
      {hasLabel && <span className={cn('font-sans font-medium', zero ? AS_COUNT_ZERO_VALUE : tone.text)}>{label}</span>}
    </span>
  );
};

export interface SeverityMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: SeverityCountSeverity;
  /** The letter shown (`C`, `H`, `M`, `L`); give the whole an accessible name when it stands alone. */
  label: React.ReactNode;
  className?: string;
}

/**
 * The severity of a group of findings, at the head of its row: the same chip
 * as a count, a little larger and square, the letter alone in it, so the
 * worst severity of each group is the first thing the eye meets.
 */
export const SeverityMark: React.FC<SeverityMarkProps> = ({ severity, label, className, ...rest }) => {
  const tone = CHIP_TONE[severity] ?? CHIP_TONE.low;
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium leading-none',
        tone.chip,
        tone.text,
        className,
      )}
      data-severity={severity}
      {...rest}
    >
      {label}
    </span>
  );
};

export default SeverityCount;
