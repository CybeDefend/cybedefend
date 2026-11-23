import React from 'react';

import { cn } from '@/utils/function/utils';

/**
 * A data table of the zinc kit: no zebra, no card per row. 36 px
 * header in 13 px zinc-500, 14 px body, 44 px rows separated by hairlines, a 120 ms tint
 * on hover when the row opens something. `numeric` cells are mono, tabular
 * and right-aligned. Wrap in a `Panel padded={false}` to give it an edge;
 * the table scrolls sideways inside its wrapper on a phone, never the page.
 */
export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...rest }, ref) => (
    // `relative`: the box is the containing block of what the table positions
    // (an `sr-only` header label). Without it that label was placed against
    // the page and widened it by the table's width: the whole page scrolled
    // sideways on a phone (agent rules, 769 px at 390).
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full border-collapse text-left text-sm', className)} {...rest} />
    </div>
  ),
);
Table.displayName = 'VdTable';

export const TableHead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...rest }, ref) => <thead ref={ref} className={cn('[&_tr]:hover:bg-transparent', className)} {...rest} />,
);
TableHead.displayName = 'VdTableHead';

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...rest }, ref) => <tbody ref={ref} className={cn('[&_tr:last-child>td]:border-b-0', className)} {...rest} />,
);
TableBody.displayName = 'VdTableBody';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** The row opens something: hover tint and pointer. */
  interactive?: boolean;
  selected?: boolean;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ interactive = false, selected = false, className, ...rest }, ref) => (
    <tr
      ref={ref}
      aria-selected={selected || undefined}
      className={cn(
        'transition-colors duration-[120ms]',
        interactive && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-vd-raised',
        selected && 'bg-zinc-50 dark:bg-vd-raised',
        className,
      )}
      {...rest}
    />
  ),
);
TableRow.displayName = 'VdTableRow';

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** Secondary text (a time, a path) in zinc-500. */
  muted?: boolean;
}

const EDGE = 'first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5';

export const TableHeaderCell = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }>(
  ({ numeric = false, scope = 'col', className, ...rest }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        'h-9 whitespace-nowrap border-b border-zinc-200 px-3 align-middle text-[13px] font-medium text-zinc-500 dark:border-vd-line dark:text-zinc-400',
        EDGE,
        numeric && 'text-right',
        className,
      )}
      {...rest}
    />
  ),
);
TableHeaderCell.displayName = 'VdTableHeaderCell';

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ numeric = false, muted = false, className, ...rest }, ref) => (
    <td
      ref={ref}
      className={cn(
        'h-11 border-b border-zinc-200 px-3 align-middle text-zinc-900 dark:border-vd-line dark:text-zinc-100',
        EDGE,
        numeric && 'text-right font-mono text-[13px] tabular-nums',
        muted && 'text-zinc-500 dark:text-zinc-400',
        className,
      )}
      {...rest}
    />
  ),
);
TableCell.displayName = 'VdTableCell';
