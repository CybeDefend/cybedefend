import React from 'react';

import NumberTicker from '@/components/atoms/zinc/number-ticker/NumberTicker';
import { PLATE_DARK } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A row of key figures separated by hairlines, the way an instrument panel
 * reads (Vercel's usage strip): the label in 12 px zinc, the figure 24 px /
 * 500, tabular, counting up on first paint (`NumberTicker`), a quiet `Delta`
 * beside it. Two columns on a phone, one row from `sm`. `bare` drops the
 * outer hairline for use inside a `Panel`.
 */
export interface StatStripItem {
  key?: string;
  label: React.ReactNode;
  /** A number counts up; a node (a ratio, "—") is shown as is. */
  value: number | React.ReactNode;
  format?: (value: number) => string;
  /** A `Delta`, a muted unit. */
  delta?: React.ReactNode;
  /** A line under the figure in 12 px zinc. */
  hint?: React.ReactNode;
}

export interface StatStripProps extends Omit<React.HTMLAttributes<HTMLDListElement>, 'children'> {
  items: readonly StatStripItem[];
  bare?: boolean;
}

const CELL = cn(
  'flex min-w-0 flex-col gap-1.5 px-4 py-3.5 sm:flex-1 sm:px-5 sm:py-4',
  'border-zinc-200 dark:border-vd-line',
  '[&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t',
  'sm:border-l sm:first:border-l-0 sm:[&:nth-child(n+3)]:border-t-0',
);

const StatStrip = React.forwardRef<HTMLDListElement, StatStripProps>(({ items, bare = false, className, ...rest }, ref) => (
  <dl
    ref={ref}
    className={cn(
      'grid grid-cols-2 overflow-hidden sm:flex',
      !bare && cn('rounded-xl border border-zinc-200 bg-white', PLATE_DARK),
      className,
    )}
    {...rest}
  >
    {items.map((item, index) => (
      <div key={item.key ?? index} className={CELL}>
        <dt className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">{item.label}</dt>
        <dd className="flex items-baseline gap-2">
          <span className="text-2xl font-medium leading-7 tracking-[-0.02em] tabular-nums text-zinc-900 dark:text-zinc-50">
            {typeof item.value === 'number' ? <NumberTicker value={item.value} format={item.format} /> : item.value}
          </span>
          {item.delta ? <span className="shrink-0">{item.delta}</span> : null}
        </dd>
        {item.hint ? <dd className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">{item.hint}</dd> : null}
      </div>
    ))}
  </dl>
));

StatStrip.displayName = 'StatStrip';

export { StatStrip };
export default StatStrip;
