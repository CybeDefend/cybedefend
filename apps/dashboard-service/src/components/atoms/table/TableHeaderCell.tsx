import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_TH } from '@/components/atoms/appsec/styles';

type TableHeaderCellVariant = 'compact' | 'default' | 'spacious';
type TableHeaderCellAlign = 'left' | 'center' | 'right';

interface TableHeaderCellProps {
  children: React.ReactNode;
  className?: string;
  variant?: TableHeaderCellVariant;
  align?: TableHeaderCellAlign;
  hover?: boolean;
}

/* `AS_TH` is the default: a 36 px head, 16 px between cells, 20 px at the row's edges. */
const variantStyles: Record<TableHeaderCellVariant, string> = {
  compact: 'h-8 px-3',
  default: '',
  spacious: 'px-8 py-5',
};

const alignStyles: Record<TableHeaderCellAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const TableHeaderCell: React.FC<TableHeaderCellProps> = ({
  children,
  className,
  variant = 'default',
  align = 'left',
  hover = false,
}) => (
  <th
    className={cn(
      AS_TH,
      variantStyles[variant],
      alignStyles[align],
      'bg-zinc-50/70 dark:bg-white/[0.02]',
      hover && 'hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors duration-[120ms] cursor-pointer',
      className
    )}
  >
    {children}
  </th>
);

export default TableHeaderCell;