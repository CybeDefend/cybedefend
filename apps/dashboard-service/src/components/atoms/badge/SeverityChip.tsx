import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** `cn` without the rest of `utils/function/utils` (and its i18n import): this atom is mounted by suites that mock react-i18next bare. */
const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export type SeverityChipLevel = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none' | 'fixed';

const SEVERITY_LEVELS: Readonly<Record<string, SeverityChipLevel>> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  moderate: 'medium',
  low: 'low',
  info: 'info',
  informational: 'info',
  none: 'none',
};

const PRIORITY_LEVELS: Readonly<Record<string, SeverityChipLevel>> = {
  critical_urgent: 'critical',
  urgent: 'high',
  normal: 'medium',
  low: 'low',
  very_low: 'info',
};

const readLevel = (levels: Readonly<Record<string, SeverityChipLevel>>, value: string | null | undefined): SeverityChipLevel => {
  const key = (value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(levels, key) ? levels[key] : 'none';
};

/**
 * The chip level of a severity or a CybeRisk level as the API sends it
 * (`CRITICAL`, `high`, `moderate`…). A value it does not know is `none`: a
 * quiet zinc chip, never a colour the finding did not earn.
 */
export const severityChipLevel = (value: string | null | undefined): SeverityChipLevel => readLevel(SEVERITY_LEVELS, value);

/**
 * The chip level of a vulnerability priority: `critical_urgent` in the
 * critical red, `urgent` in the high orange, `normal` in the medium amber,
 * `low` in the low blue, `very_low` in zinc.
 */
export const priorityChipLevel = (value: string | null | undefined): SeverityChipLevel => readLevel(PRIORITY_LEVELS, value);

/*
  The soft chip of a severity, CybeRisk or priority word: outlined, in the
  former colours, with care for contrast. The recipe of `SeverityCount`:
  a 1 px border in the hue at low alpha, a 12 % tint of the hue's -400 shade
  (the dashboard's former risk colours, `critical-risk` #ff6659, `high-risk`
  #ff8c4a, `medium-risk` #e6b800, `low-risk` #4a90e2, read through their
  Tailwind neighbours so a C count and a Critical word share one tint), the
  word in the hue's dark shade in light and its -400 in dark.

  Light orange and amber are a step deeper than -700 (#B43C0A, #A84E08): -700
  is 4.31:1 and 4.34:1 on its tint over a raised zinc-100 row, these are 4.87
  and 4.83. Measured (WCAG 2.x, the word on its tint over the surface), light
  on white / zinc-50 / zinc-100: red 5.75 / 5.55 / 5.26, orange 5.32 / 5.12 /
  4.87, amber 5.24 / 5.05 / 4.83, blue 6.04 / 5.83 / 5.57, zinc 9.50 / 9.09 /
  8.69; dark on #09090B / #111115 / #1B1B20: red 6.32 / 5.80 / 5.22, orange
  7.55 / 6.96 / 6.19, amber 9.79 / 8.98 / 7.94, blue 6.75 / 6.22 / 5.53,
  zinc 6.70 / 6.18 / 5.49.
*/
const TONES: Record<SeverityChipLevel, string> = {
  critical: 'border-red-400/40 bg-red-400/[0.12] text-red-700 dark:border-red-400/25 dark:text-red-400',
  high: 'border-orange-400/45 bg-orange-400/[0.12] text-[#b43c0a] dark:border-orange-400/25 dark:text-orange-400',
  medium: 'border-amber-400/50 bg-amber-400/[0.12] text-[#a84e08] dark:border-amber-400/25 dark:text-amber-400',
  low: 'border-blue-400/40 bg-blue-400/[0.12] text-blue-700 dark:border-blue-400/25 dark:text-blue-400',
  info: 'border-zinc-400/40 bg-zinc-400/[0.12] text-zinc-700 dark:border-zinc-400/25 dark:text-zinc-400',
  none: 'border-zinc-400/40 bg-zinc-400/[0.12] text-zinc-700 dark:border-zinc-400/25 dark:text-zinc-400',
  /** A fixed finding (the former `fixed` token's green), asked for by name only: no severity reads as fixed. */
  fixed: 'border-emerald-400/45 bg-emerald-400/[0.12] text-emerald-700 dark:border-emerald-400/25 dark:text-emerald-400',
};

const SIZES = {
  /** 20 px: a table cell, a list row, a legend. */
  sm: 'h-5 px-1.5 text-xs',
  /** 24 px: the head of a detail. */
  md: 'h-6 px-2 text-[13px]',
} as const;

export interface SeverityChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** A chip level, or the raw value the API sent (`CRITICAL`), read by `severityChipLevel`. */
  level: SeverityChipLevel | string;
  /** The word (or the letter) shown, already in the interface language. */
  children: React.ReactNode;
  size?: keyof typeof SIZES;
}

const KNOWN = new Set<string>(Object.keys(TONES));

/**
 * A severity, CybeRisk or priority level as a word in its soft chip: the
 * same chip in both spaces, in a table, a list, a detail or a legend. Never
 * a control: no hover, no pointer.
 */
const SeverityChip = React.forwardRef<HTMLSpanElement, SeverityChipProps>(
  ({ level, children, size = 'sm', className, ...rest }, ref) => {
    const resolved: SeverityChipLevel = KNOWN.has(level) ? (level as SeverityChipLevel) : severityChipLevel(level);
    return (
      <span
        ref={ref}
        data-severity={resolved}
        className={cn(
          'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-sans font-medium leading-none',
          SIZES[size],
          TONES[resolved],
          className,
        )}
        {...rest}
      >
        {children}
      </span>
    );
  },
);

SeverityChip.displayName = 'SeverityChip';

export default SeverityChip;
