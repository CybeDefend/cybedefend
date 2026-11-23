import React from 'react';
import { useTranslation } from 'react-i18next';

import { ChevronLeft, ChevronRight } from '@/components/atoms/icon/icons';
import IconButton from '@/components/atoms/zinc/icon-button/IconButton';
import { cn } from '@/utils/function/utils';

/**
 * Pages of a list, said quietly: an optional summary on the left ("1–20 of
 * 312", mono), "Page 2 of 16" and two 28 px outline arrows on the right.
 * Renders nothing for a single page.
 */
export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
  /** 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary?: React.ReactNode;
}

const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  ({ page, pageCount, onPageChange, summary, className, ...rest }, ref) => {
    const { t } = useTranslation();
    if (pageCount <= 1) return null;
    const current = Math.min(Math.max(1, page), pageCount);
    return (
      <nav
        ref={ref}
        aria-label={t('components.kit.pagination')}
        className={cn('flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5', className)}
        {...rest}
      >
        <span className="min-w-0 truncate text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400">{summary}</span>
        <div className="flex items-center gap-2">
          <span className="text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400" aria-live="polite">
            {t('components.kit.pageOf', { page: current, total: pageCount })}
          </span>
          <div className="flex items-center gap-1">
            <IconButton
              variant="outline"
              size="sm"
              aria-label={t('components.kit.previous')}
              icon={<ChevronLeft size={10} />}
              disabled={current <= 1}
              onClick={() => onPageChange(current - 1)}
            />
            <IconButton
              variant="outline"
              size="sm"
              aria-label={t('components.kit.next')}
              icon={<ChevronRight size={10} />}
              disabled={current >= pageCount}
              onClick={() => onPageChange(current + 1)}
            />
          </div>
        </div>
      </nav>
    );
  },
);

Pagination.displayName = 'VdPagination';

export { Pagination };
export default Pagination;
