import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { cn } from '@/utils/function/utils';

/**
 * A figure that counts up from zero the first time it is painted, and rolls
 * from where it stands when it changes: 700 ms, easing
 * out (expo), one figure per frame, nothing else re-rendered.
 *
 * Where motion is not wanted or cannot be seen (reduced motion, the viewer's
 * Calm choice, jsdom without `matchMedia`) it shows the final figure at once,
 * so a test reads the final text. While it counts, the moving figure is
 * hidden from assistive tech and the final one is read instead.
 *
 * Written in the interface's language (`12 345` in French) unless a `format`
 * is given, which then writes every figure, the intermediate ones included.
 */
export interface NumberTickerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: number;
  /** Writes a figure as the page shows it. Default: the interface language's grouping. */
  format?: (value: number) => string;
  /** Milliseconds, 700 by default. */
  duration?: number;
}

export const NUMBER_TICKER_DURATION = 700;

/** Fast at first, settling softly: most of the way in the first third. */
const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

const NumberTicker = React.forwardRef<HTMLSpanElement, NumberTickerProps>(
  ({ value, format, duration = NUMBER_TICKER_DURATION, className, ...rest }, ref) => {
    const { i18n } = useTranslation();
    const language = i18n?.language;
    const animate = useMotionAllowed() && Number.isFinite(value);
    const [shown, setShown] = useState<number>(() => (animate ? 0 : value));
    // Where the figure stands right now, so a new value rolls from there.
    const standing = useRef(shown);

    useEffect(() => {
      if (!animate) {
        standing.current = value;
        setShown(value);
        return undefined;
      }
      const from = standing.current;
      if (from === value) return undefined;
      let start: number | null = null;
      let frame = 0;
      const tick = (now: number) => {
        if (start === null) start = now;
        const progress = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
        const next = progress >= 1 ? value : from + (value - from) * easeOutExpo(progress);
        standing.current = next;
        setShown(next);
        if (progress < 1) frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(frame);
    }, [value, animate, duration]);

    const write = (n: number) => (format ? format(n) : n.toLocaleString(language));
    const settled = !animate || shown === value;

    return (
      <span ref={ref} className={cn('tabular-nums', className)} {...rest}>
        {settled ? (
          write(value)
        ) : (
          <>
            <span aria-hidden="true">{write(Number.isInteger(value) ? Math.round(shown) : shown)}</span>
            <span className="sr-only">{write(value)}</span>
          </>
        )}
      </span>
    );
  },
);

NumberTicker.displayName = 'NumberTicker';

export { NumberTicker };
export default NumberTicker;
