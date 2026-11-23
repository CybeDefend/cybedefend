import React, { useId } from 'react';
import { motion } from 'framer-motion';
import type { To } from 'react-router-dom';

import Button from '@/components/atoms/button/Button';
import { TOUCH_HIT } from '@/components/atoms/zinc/styles';
import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { cn } from '@/utils/function/utils';

/**
 * Tabs and segmented controls of the zinc kit:
 * - `segmented` (default): a zinc track, the selected option on an ink pill
 *   (white text; in dark a white pill, ink text), the others zinc-500. For a
 *   period, a window, the Dashboard | Brain switch.
 * - `underline`: text tabs over a hairline, the selected one in ink with a
 *   1.5 px underline. For the sections of a page.
 * The pill or the underline slides to the new option (framer `layoutId`,
 * a ~200 ms spring), and jumps on a calm page.
 *
 * No accent by default. `indicator="accent"` paints the underline in the
 * accent, for the one place a screen spends it on its current tab.
 *
 * Options with `to` are links (`aria-current="page"` on the current one) in a
 * `nav`; otherwise they are buttons (`aria-pressed`) in a named group, and
 * `onChange` hears the option picked. Built on the `Button` atom: no native
 * control here.
 */
export interface SegmentedTabsOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /** A destination: the option is a link and the control is navigation. */
  to?: To;
  testId?: string;
  disabled?: boolean;
}

export type SegmentedTabsVariant = 'segmented' | 'underline';
export type SegmentedTabsSize = 'sm' | 'md';

export interface SegmentedTabsProps<V extends string = string>
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange' | 'children'> {
  options: readonly SegmentedTabsOption<V>[];
  value: V;
  onChange?: (value: V) => void;
  /** Names the group (or the navigation). */
  ariaLabel: string;
  variant?: SegmentedTabsVariant;
  /** The underline's colour: ink (default) or the accent. */
  indicator?: 'ink' | 'accent';
  /** `md` (default): 28 px options in a 32 px track; `sm`: 24 px in 28 px. */
  size?: SegmentedTabsSize;
}

export const SEGMENTED_TRACK = 'inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.04]';
export const TABS_TRACK = 'flex items-center gap-5 border-b border-zinc-200 dark:border-vd-line';

/** What the `ghost` Button needs to become one of these options: no tint, no shrink, a neutral focus ring. */
const OPTION_BASE =
  'relative font-medium transition-colors duration-[120ms] active:scale-100 hover:bg-transparent dark:hover:bg-transparent focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-iris/80 ' +
  TOUCH_HIT;
const IDLE = 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100';

const SEGMENT: Record<SegmentedTabsSize, string> = {
  md: 'h-7 rounded-md px-2.5 py-0 text-[13px]',
  sm: 'h-6 rounded-md px-2 py-0 text-xs',
};
const TAB: Record<SegmentedTabsSize, string> = {
  md: 'h-8 rounded-none px-0 py-0 text-[13px]',
  sm: 'h-7 rounded-none px-0 py-0 text-xs',
};

const PILL = 'absolute inset-0 rounded-md bg-zinc-900 dark:bg-zinc-100';
const UNDERLINE = 'absolute inset-x-0 -bottom-px h-[1.5px] rounded-full';
const UNDERLINE_TONE = { ink: 'bg-zinc-900 dark:bg-zinc-100', accent: 'bg-secondary' } as const;

/** About 200 ms to settle: the indicator glides, it does not bounce. */
const SLIDE = { type: 'spring', stiffness: 520, damping: 42 } as const;

function SegmentedTabs<V extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  variant = 'segmented',
  indicator = 'ink',
  size = 'md',
  className,
  ...rest
}: SegmentedTabsProps<V>) {
  const layoutId = `vd-tabs-${useId()}`;
  const motionAllowed = useMotionAllowed();
  const navigates = options.some((option) => option.to !== undefined);
  const segmented = variant === 'segmented';

  const items = options.map((option) => {
    const selected = option.value === value;
    const tone = selected
      ? segmented
        ? 'text-white hover:text-white dark:text-zinc-900 dark:hover:text-zinc-900'
        : 'text-zinc-900 hover:text-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-50'
      : IDLE;
    const marker = selected ? (
      <motion.span
        aria-hidden="true"
        data-tabs-indicator=""
        layoutId={layoutId}
        transition={motionAllowed ? SLIDE : { duration: 0 }}
        className={segmented ? PILL : cn(UNDERLINE, UNDERLINE_TONE[indicator])}
      />
    ) : null;
    const selection = option.to !== undefined
      ? { 'aria-current': selected ? ('page' as const) : undefined }
      : { 'aria-pressed': selected };

    return (
      <Button
        key={option.value}
        variant="ghost"
        size="sm"
        to={option.to}
        disabled={option.disabled}
        data-testid={option.testId}
        onClick={option.to !== undefined || selected ? undefined : () => onChange?.(option.value)}
        className={cn(OPTION_BASE, segmented ? SEGMENT[size] : TAB[size], tone)}
        {...selection}
      >
        {marker}
        <span className="relative">{option.label}</span>
      </Button>
    );
  });

  const trackClasses = cn(segmented ? SEGMENTED_TRACK : TABS_TRACK, className);
  return navigates ? (
    <nav aria-label={ariaLabel} className={trackClasses} {...rest}>
      {items}
    </nav>
  ) : (
    <div role="group" aria-label={ariaLabel} className={trackClasses} {...rest}>
      {items}
    </div>
  );
}

export { SegmentedTabs };
export default SegmentedTabs;
