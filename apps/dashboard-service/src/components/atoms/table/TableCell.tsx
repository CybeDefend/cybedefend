import React from 'react';
import { cn } from '@/utils/function/utils';

type TableCellVariant = 'compact' | 'default' | 'spacious';
type TableCellAlign = 'left' | 'center' | 'right';

interface TableCellProps {
  children: React.ReactNode;
  className?: string;
  variant?: TableCellVariant;
  align?: TableCellAlign;
  hover?: boolean;
}

const variantStyles: Record<TableCellVariant, string> = {
  compact: 'px-4 py-2',
  default: 'px-6 py-4',
  spacious: 'px-8 py-6',
};

const alignStyles: Record<TableCellAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const TableCell: React.FC<TableCellProps> = ({
  children,
  className,
  variant = 'default',
  align = 'left',
  hover = false,
}) => (
  <td
    className={cn(
      variantStyles[variant],
      alignStyles[align],
      'text-gray-600 dark:text-gray-300',
      'bg-white dark:bg-neutral-900',
      hover && 'hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-150',
      'first:rounded-l-2xl last:rounded-r-2xl',
      className
    )}
  >
    {children}
  </td>
);

export default TableCell;