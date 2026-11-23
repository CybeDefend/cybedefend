import React from 'react';
import { cn } from '@/utils/function/utils';

interface MeterProps {
  /** 0 to 1; anything outside is clamped. */
  ratio: number;
  /** The fill, in place of the ink default (a whole replacement: twMerge would keep the default's `dark:` shade). */
  fillClassName?: string;
  className?: string;
}

/**
 * A hairline meter: a 4 px zinc track and a fill in ink. It measures, it does
 * not colour: the colour of a row is its dot, and the meter is the same in
 * every row so lengths can be compared.
 */
const Meter: React.FC<MeterProps> = ({ ratio, fillClassName, className }) => {
  const width = `${Math.round(Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0)) * 1000) / 10}%`;
  return (
    <div
      aria-hidden="true"
      className={cn('h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]', className)}
    >
      <div className={cn('h-full rounded-full', fillClassName ?? 'bg-zinc-800 dark:bg-zinc-200')} style={{ width }} />
    </div>
  );
};

export default Meter;
