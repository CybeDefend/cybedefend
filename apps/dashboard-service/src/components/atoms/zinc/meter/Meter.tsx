import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { cn } from '@/utils/function/utils';

export type MeterTone = 'neutral' | 'accent';

/**
 * A share, drawn as a meter: 2 px tall, a
 * zinc track, an ink fill. The accent fills it only for the brain series
 * (rules served); never a coloured card. A billed unit's month is not drawn
 * with it: that is `UsageGauge`.
 *
 * It grows from zero on first paint (`scaleX`, 600 ms) and glides when its
 * value changes; on a calm page, or where nothing can animate (jsdom), it is
 * at its value at once. Assistive tech reads a `meter` named by `label`, its
 * value in percent in the interface's language unless `valueText` says it.
 * The figure the eye reads sits beside it, in the caller's row. Made of
 * spans (displayed as blocks), so it is valid under the text of a link or a
 * button row.
 */
export interface MeterProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The share, 0 to 1. Outside is clamped; a broken value reads as empty. */
  value: number;
  tone?: MeterTone;
  /** What the meter measures ("Claude Code"). */
  label?: string;
  /** What a screen reader says for the value. Default: the percent, in the interface's language. */
  valueText?: string;
}

export const METER_TRACK = 'relative block h-0.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]';

const FILL: Record<MeterTone, string> = {
  neutral: 'bg-zinc-900 dark:bg-zinc-100',
  accent: 'bg-secondary',
};

/** Fast, then settling: the same curve as the rest of the space's entrances. */
const GROW = 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1)';

const clampShare = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const Meter = React.forwardRef<HTMLSpanElement, MeterProps>(
  ({ value, tone = 'neutral', label, valueText, className, ...rest }, ref) => {
    const { i18n } = useTranslation();
    const animate = useMotionAllowed();
    const share = clampShare(value);
    // Empty on the first paint when it may grow, so the eye sees it fill.
    const [grown, setGrown] = useState(!animate);

    useEffect(() => {
      if (!animate) {
        setGrown(true);
        return undefined;
      }
      const frame = window.requestAnimationFrame(() => setGrown(true));
      return () => window.cancelAnimationFrame(frame);
    }, [animate]);

    const text =
      valueText ?? new Intl.NumberFormat(i18n?.language, { style: 'percent', maximumFractionDigits: 0 }).format(share);

    return (
      <span
        ref={ref}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={text}
        className={cn(METER_TRACK, className)}
        {...rest}
      >
        <span
          data-meter-fill=""
          className={cn('absolute inset-0 block origin-left rounded-full', FILL[tone])}
          style={{ transform: `scaleX(${grown ? share : 0})`, transition: animate ? GROW : undefined }}
        />
      </span>
    );
  },
);

Meter.displayName = 'Meter';

export { Meter };
export default Meter;
