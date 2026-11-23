import React from 'react';
import { motion } from 'framer-motion';
import type { To } from 'react-router-dom';

import Button from '@/components/atoms/button/Button';
import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { cn } from '@/utils/function/utils';

/**
 * Lists over cards: data as dense rows, 44 px (40 px
 * small), separated by hairlines, a 120 ms hover tint, the whole row the link.
 * Think Linear's issue list.
 *
 * Put a `DataList` straight in a `Panel padded={false}`: the rows carry the
 * panel's horizontal padding (16 px, 20 px from `sm`) and the panel clips
 * their tint to its corners. Inside a padded panel, give the list
 * `className="-mx-4 sm:-mx-5"`.
 */
export type DataListProps = React.HTMLAttributes<HTMLUListElement>;

export const DATA_LIST_CLASSES = 'divide-y divide-zinc-200 dark:divide-vd-line';

const DataList = React.forwardRef<HTMLUListElement, DataListProps>(({ className, children, ...rest }, ref) => (
  // `role="list"` keeps the list a list for VoiceOver once its bullets are styled away.
  <ul ref={ref} role="list" className={cn(DATA_LIST_CLASSES, className)} {...rest}>
    {children}
  </ul>
));

DataList.displayName = 'DataList';

export type DataRowSize = 'md' | 'sm';

export interface DataRowProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, 'children' | 'onSelect'> {
  /** A destination: the whole row becomes the link (router `Link` through `Button variant="row"`). */
  to?: To;
  /** An action in place (open a drawer): the whole row becomes a button. Ignored when `to` is set. */
  onSelect?: () => void;
  /** The accessible name of the link or the button, when its text is not enough. */
  label?: string;
  /** Before the text: a 6 px dot, a logo, a 16 px glyph. */
  leading?: React.ReactNode;
  /** The row's text, in ink, truncated. */
  children: React.ReactNode;
  /** Right-aligned mono figures or time, 13 px zinc. */
  meta?: React.ReactNode;
  /** After the meta: a chevron. Nothing interactive when the row is itself a link or a button. */
  trailing?: React.ReactNode;
  /** Under the line, full width: a `Meter`, a second line of meta. Phrasing content (spans) only. */
  below?: React.ReactNode;
  /** `md` 44 px (default), `sm` 40 px. */
  size?: DataRowSize;
  /** Just arrived: it slides down 6 px and carries a 1.2 s highlight that fades. */
  fresh?: boolean;
}

export const DATA_ROW_INNER = 'flex w-full flex-col justify-center gap-1.5 px-4 py-2 sm:px-5';
export const DATA_ROW_HOVER = 'transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-vd-raised';
export const DATA_ROW_TEXT = 'min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100';
/** The meta of a row: a figure, in mono. A caller whose meta is words (a time, a sentence) sets it in `font-sans`. */
export const DATA_ROW_META = 'shrink-0 font-mono text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400';

/**
 * What the `row` variant of `Button` needs to be one of these rows: the line
 * from the left, the text at the list's weight, no press shrink, a neutral
 * inset focus ring instead of the accent one.
 */
const ROW_CONTROL =
  'items-stretch text-sm font-normal transition-colors duration-[120ms] focus-visible:ring-iris/80';

const SLIDE = {
  initial: { y: -6 },
  animate: { y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

const DataRow = React.forwardRef<HTMLLIElement, DataRowProps>(
  (
    { to, onSelect, label, leading, children, meta, trailing, below, size = 'md', fresh = false, className, ...rest },
    ref,
  ) => {
    const motionAllowed = useMotionAllowed();
    const arriving = fresh && motionAllowed;
    const interactive = to !== undefined || onSelect !== undefined;
    const inner = cn(DATA_ROW_INNER, size === 'sm' ? 'min-h-10' : 'min-h-11');

    const body = (
      <>
        <span className="flex w-full min-w-0 items-center gap-3">
          {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
          <span className={DATA_ROW_TEXT}>{children}</span>
          {meta !== undefined && meta !== null ? <span className={DATA_ROW_META}>{meta}</span> : null}
          {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
        </span>
        {below ? <span className="block w-full">{below}</span> : null}
      </>
    );

    let content: React.ReactNode;
    if (to !== undefined) {
      content = (
        <Button variant="row" to={to} aria-label={label} className={cn(inner, ROW_CONTROL)}>
          {body}
        </Button>
      );
    } else if (onSelect !== undefined) {
      content = (
        <Button variant="row" onClick={onSelect} aria-label={label} className={cn(inner, ROW_CONTROL)}>
          {body}
        </Button>
      );
    } else {
      content = <div className={inner}>{body}</div>;
    }

    const rowClasses = cn('group relative', interactive && DATA_ROW_HOVER, className);
    const highlight = arriving ? (
      <motion.span
        aria-hidden="true"
        data-row-fresh=""
        className="pointer-events-none absolute inset-0 bg-zinc-100 dark:bg-white/[0.04]"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    ) : null;

    if (arriving) {
      return (
        <motion.li ref={ref} className={rowClasses} {...SLIDE} {...(rest as Omit<React.ComponentProps<typeof motion.li>, 'children'>)}>
          {highlight}
          {content}
        </motion.li>
      );
    }
    return (
      <li ref={ref} className={rowClasses} {...rest}>
        {content}
      </li>
    );
  },
);

DataRow.displayName = 'DataRow';

export { DataList, DataRow };
export default DataList;
