import React, { forwardRef, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/utils/function/utils';

// ============================================================================
// Types & Interfaces
// ============================================================================

type TableVariant = 'compact' | 'default' | 'spacious';

interface TableContextValue {
    striped?: boolean;
    hoverable?: boolean;
    variant?: TableVariant;
}

interface TableProps extends HTMLAttributes<HTMLTableElement> {
    striped?: boolean;
    hoverable?: boolean;
    variant?: TableVariant;
    loading?: boolean;
    loadingRows?: number;
    loadingColumns?: number;
    empty?: boolean;
    emptyMessage?: React.ReactNode;
}

interface TableHeaderProps extends HTMLAttributes<HTMLTableSectionElement> { }

interface TableBodyProps extends HTMLAttributes<HTMLTableSectionElement> { }

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
    isHeader?: boolean;
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> { }

interface TableDataProps extends TdHTMLAttributes<HTMLTableCellElement> { }

// ============================================================================
// Context
// ============================================================================

const TableContext = React.createContext<TableContextValue>({});

const useTableContext = () => React.useContext(TableContext);

// ============================================================================
// Variant Styles
// ============================================================================

const variantStyles: Record<TableVariant, { cell: string; head: string }> = {
    compact: {
        cell: 'px-3 py-2 text-sm',
        head: 'px-3 py-2 text-xs',
    },
    default: {
        cell: 'px-4 py-3 text-sm',
        head: 'px-4 py-3 text-xs',
    },
    spacious: {
        cell: 'px-6 py-4 text-base',
        head: 'px-6 py-4 text-sm',
    },
};

// ============================================================================
// Skeleton Components
// ============================================================================

const TableSkeleton: React.FC<{ rows: number; columns: number; variant: TableVariant }> = ({
    rows,
    columns,
    variant,
}) => {
    const styles = variantStyles[variant];

    return (
        <>
            <TableHeader>
                <TableRow isHeader>
                    {Array.from({ length: columns }).map((_, index) => (
                        <TableHead key={`skeleton-head-${index}`} className={styles.head}>
                            <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {Array.from({ length: rows }).map((_, rowIndex) => (
                    <TableRow key={`skeleton-row-${rowIndex}`}>
                        {Array.from({ length: columns }).map((_, colIndex) => (
                            <TableData key={`skeleton-cell-${rowIndex}-${colIndex}`} className={styles.cell}>
                                <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-neutral-700" />
                            </TableData>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </>
    );
};

// ============================================================================
// Empty State Component
// ============================================================================

const TableEmptyState: React.FC<{ message: React.ReactNode; colSpan?: number }> = ({
    message,
    colSpan = 1,
}) => (
    <TableBody>
        <TableRow>
            <TableData colSpan={colSpan} className="py-12 text-center">
                <div className="flex flex-col items-center justify-center gap-2">
                    <svg
                        className="h-12 w-12 text-gray-300 dark:text-neutral-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                        />
                    </svg>
                    <p className="text-sm text-gray-500 dark:text-neutral-400">
                        {message || 'No data available'}
                    </p>
                </div>
            </TableData>
        </TableRow>
    </TableBody>
);

// ============================================================================
// Table Component
// ============================================================================

const Table = forwardRef<HTMLTableElement, TableProps>(
    (
        {
            className,
            striped = false,
            hoverable = false,
            variant = 'default',
            loading = false,
            loadingRows = 5,
            loadingColumns = 4,
            empty = false,
            emptyMessage,
            children,
            ...props
        },
        ref
    ) => {
        const contextValue: TableContextValue = {
            striped,
            hoverable,
            variant,
        };

        return (
            <TableContext.Provider value={contextValue}>
                <div className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                    <div className="overflow-x-auto">
                        <table
                            ref={ref}
                            className={cn('w-full border-collapse text-left', className)}
                            {...props}
                        >
                            {loading ? (
                                <TableSkeleton rows={loadingRows} columns={loadingColumns} variant={variant} />
                            ) : empty ? (
                                <TableEmptyState message={emptyMessage} colSpan={loadingColumns} />
                            ) : (
                                children
                            )}
                        </table>
                    </div>
                </div>
            </TableContext.Provider>
        );
    }
);

Table.displayName = 'Table';

// ============================================================================
// TableHeader Component
// ============================================================================

const TableHeader = forwardRef<HTMLTableSectionElement, TableHeaderProps>(
    ({ className, ...props }, ref) => (
        <thead
            ref={ref}
            className={cn(
                'border-b border-gray-200 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-800/50',
                className
            )}
            {...props}
        />
    )
);

TableHeader.displayName = 'TableHeader';

// ============================================================================
// TableBody Component
// ============================================================================

const TableBody = forwardRef<HTMLTableSectionElement, TableBodyProps>(
    ({ className, ...props }, ref) => (
        <tbody
            ref={ref}
            className={cn('divide-y divide-gray-200 dark:divide-neutral-800', className)}
            {...props}
        />
    )
);

TableBody.displayName = 'TableBody';

// ============================================================================
// TableRow Component
// ============================================================================

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
    ({ className, isHeader = false, ...props }, ref) => {
        const { striped, hoverable } = useTableContext();

        return (
            <tr
                ref={ref}
                className={cn(
                    'transition-colors duration-150',
                    !isHeader && striped && 'even:bg-gray-50 dark:even:bg-neutral-800/30',
                    !isHeader && hoverable && 'hover:bg-gray-100 dark:hover:bg-neutral-800/50',
                    className
                )}
                {...props}
            />
        );
    }
);

TableRow.displayName = 'TableRow';

// ============================================================================
// TableHead Component
// ============================================================================

const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
    ({ className, ...props }, ref) => {
        const { variant = 'default' } = useTableContext();
        const styles = variantStyles[variant];

        return (
            <th
                ref={ref}
                className={cn(
                    styles.head,
                    'whitespace-nowrap font-semibold uppercase tracking-wider text-gray-600 dark:text-neutral-400',
                    className
                )}
                {...props}
            />
        );
    }
);

TableHead.displayName = 'TableHead';

// ============================================================================
// TableData Component
// ============================================================================

const TableData = forwardRef<HTMLTableCellElement, TableDataProps>(
    ({ className, ...props }, ref) => {
        const { variant = 'default' } = useTableContext();
        const styles = variantStyles[variant];

        return (
            <td
                ref={ref}
                className={cn(
                    styles.cell,
                    'text-gray-900 dark:text-neutral-100',
                    className
                )}
                {...props}
            />
        );
    }
);

TableData.displayName = 'TableData';

// ============================================================================
// Exports
// ============================================================================

export {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableData,
};

export type {
    TableProps,
    TableHeaderProps,
    TableBodyProps,
    TableRowProps,
    TableHeadProps,
    TableDataProps,
    TableVariant,
};
