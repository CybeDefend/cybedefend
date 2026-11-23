import React, { useId } from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { motion } from 'framer-motion';

import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { FOCUS_RING, TOUCH_HIT } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A segmented control (Radix ToggleGroup, single choice, arrow keys move
 * between options): a zinc track (`white/[0.04]` in dark) and the selected
 * option on an ink pill that slides to the next choice (framer `layoutId`,
 * ~200 ms spring; it jumps on a calm page). Idle options zinc-500, selected
 * text in the panel colour. For a period, a window, Dashboard | Brain.
 *
 * Always one option selected: clicking the current one changes nothing.
 */
export interface SegmentedOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /** An accessible name when the label is an icon. */
  ariaLabel?: string;
  disabled?: boolean;
  testId?: string;
}

export interface SegmentedProps<V extends string = string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Names the group. */
  'aria-label': string;
  /** `md` 32 px track (default), `sm` 28 px. */
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

export const SEGMENTED_TRACK_CLASSES = 'inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.04]';

const ITEM = {
  md: 'h-7 px-2.5 text-[13px] max-md:h-9 max-md:px-3',
  sm: 'h-6 px-2 text-xs max-md:h-8',
} as const;

/** About 200 ms to settle: the pill glides, it does not bounce. */
const SLIDE = { type: 'spring', stiffness: 520, damping: 42 } as const;

function Segmented<V extends string = string>({
  options,
  value,
  onValueChange,
  size = 'md',
  fullWidth = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<V>) {
  const layoutId = `vd-segmented-${useId()}`;
  const motionAllowed = useMotionAllowed();

  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as V);
      }}
      aria-label={ariaLabel}
      className={cn(SEGMENTED_TRACK_CLASSES, fullWidth && 'flex w-full', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={option.ariaLabel}
            data-testid={option.testId}
            className={cn(
              'relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-[120ms] disabled:pointer-events-none disabled:opacity-40',
              FOCUS_RING,
              TOUCH_HIT,
              ITEM[size],
              fullWidth && 'flex-1',
              selected
                ? 'text-white dark:text-zinc-900'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            {selected ? (
              <motion.span
                aria-hidden="true"
                data-segmented-pill=""
                layoutId={layoutId}
                transition={motionAllowed ? SLIDE : { duration: 0 }}
                className="absolute inset-0 rounded-md bg-zinc-900 dark:bg-zinc-100"
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">{option.label}</span>
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
}

export { Segmented };
export default Segmented;
