import React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/function/utils';

export type TrendPillTone = 'neutral' | 'good' | 'bad';

/**
 * How a figure moved against the previous window: a quiet mono `+12` / `−8` in zinc, no pill,
 * no arrow, no colour. The full sentence ("3 more than the previous 7 days")
 * is what a screen reader hears and what a pointer reads on hover; the page
 * says the window once, elsewhere.
 *
 * The caller decides whether the change is bad news (more refusals): only then
 * a 6 px red dot stands before it. Good news is not painted green. Nothing is
 * rendered when nothing changed. The name stays for the callers' sake.
 */
export interface TrendPillProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  delta: number;
  /** The whole sentence, read out and shown on hover. */
  label: string;
  tone: TrendPillTone;
}

/** U+2212, the minus of typesetting: the width of the plus, so the column does not move. */
const MINUS = '−';

const TrendPill = React.forwardRef<HTMLSpanElement, TrendPillProps>(
  ({ delta, label, tone, className, title, ...rest }, ref) => {
    const { i18n } = useTranslation();
    if (delta === 0 || Number.isNaN(delta)) return null;
    const written = `${delta > 0 ? '+' : MINUS}${Math.abs(delta).toLocaleString(i18n?.language)}`;
    return (
      <span
        ref={ref}
        title={title ?? label}
        className={cn(
          'inline-flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400',
          className,
        )}
        {...rest}
      >
        {/* Bad news is said in red figures, no dot. */}
        <span aria-hidden="true" data-trend-delta="" className={tone === 'bad' ? 'text-red-700 dark:text-red-400' : undefined}>
          {written}
        </span>
        <span className="sr-only">{label}</span>
      </span>
    );
  },
);

TrendPill.displayName = 'TrendPill';

export { TrendPill };
export default TrendPill;
