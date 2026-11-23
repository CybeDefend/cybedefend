

import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import { ChevronLeft, ChevronRight, EllipsisH } from '@/components/atoms/icon/icons';
import { AS_SELECT, AS_TOUCH, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  /** Compact mode for smaller spaces */
  compact?: boolean;
  /** Show items count */
  showItemsCount?: boolean;
  /**
   * Keep the page-size selector mounted when there is nothing left to navigate.
   *
   * OFF by default, and every existing caller stays on that default: they
   * paginate a list they already hold, so a size that leaves one page costs
   * nothing and a stray control below a short table would be noise.
   *
   * On for a caller whose page size IS the request (the container tag panel asks
   * the registry for exactly `pageSize` rows): there, growing the size past the
   * number of items unmounts the pager, and with it the only control able to
   * lower the size again — the choice then silently outlives the list it was
   * made for.
   */
  alwaysShowPageSize?: boolean;
  /**
   * Render the page-size selector (default true). Off for a list whose page
   * size is fixed: a selector with one option is noise.
   */
  showPageSize?: boolean;
  /**
   * Render the page numbers (default true). Off for a list paged by a cursor,
   * where only the page next to the current one can be asked: Previous and
   * Next, the count and the size selector stay.
   */
  showPageNumbers?: boolean;
  className?: string;
}

/**
 * Modern Pagination component with consistent styling
 */
const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10],
  compact = false,
  showItemsCount = true,
  alwaysShowPageSize = false,
  showPageSize = true,
  showPageNumbers = true,
  className,
}) => {
  const { t, i18n } = useTranslation();
  // « 12 345 » in French, « 12,345 » in English: the interface's language, not the browser's.
  const count = (n: number) => n.toLocaleString(i18n.language);

  // Nothing to navigate: a single page, or fewer items than the smallest page.
  const canPaginate = totalItems > 5 && totalPages > 1;

  // Don't render if there's nothing to paginate
  if (!canPaginate && !alwaysShowPageSize) return null;

  const pageNumbers: number[] = [];
  const maxPageNumbersToShow = compact ? 3 : 5;

  let startPage = Math.max(currentPage - Math.floor(maxPageNumbersToShow / 2), 1);
  let endPage = Math.min(startPage + maxPageNumbersToShow - 1, totalPages);

  if (endPage - startPage < maxPageNumbersToShow - 1) {
    startPage = Math.max(endPage - maxPageNumbersToShow + 1, 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onPageSizeChange(Number(e.target.value));
  };

  // Calculate items range
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Base button styles
  const buttonBase = cn(
    'inline-flex items-center justify-center transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:ring-offset-1',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    // AppSec: a ring for the keyboard only (other spaces keep the default one, PAGER_INK recolours it).
    'relative appsec:transition-colors appsec:duration-[120ms] appsec:focus:ring-0 appsec:focus:ring-offset-0',
    'appsec:focus-visible:ring-2 appsec:focus-visible:ring-secondary appsec:focus-visible:ring-offset-1 appsec-dark:focus-visible:ring-offset-as-bg'
  );

  // Page number button styles
  const pageButtonBase = cn(
    buttonBase,
    'min-h-[36px] min-w-[36px] text-sm font-medium rounded-lg',
    'border border-gray-200 dark:border-neutral-700',
    'appsec:min-h-8 appsec:min-w-8 appsec:rounded-md appsec:font-mono appsec:text-[13px] appsec:tabular-nums',
    // An invisible 44 px reach on a phone, the same in both spaces.
    AS_TOUCH_SQUARE
  );

  const pageButtonInactive = cn(
    pageButtonBase,
    'text-gray-600 dark:text-gray-300',
    'hover:bg-gray-100 dark:hover:bg-neutral-800',
    'bg-white dark:bg-neutral-900',
    // AppSec: a quiet page number, a tint when hovered (the variant outranks the plain hover).
    'appsec:border-transparent appsec:bg-transparent appsec:text-zinc-600 appsec:hover:bg-zinc-100',
    'appsec-dark:border-transparent appsec-dark:bg-transparent appsec-dark:text-zinc-400 appsec-dark:hover:bg-white/[0.06]'
  );

  const pageButtonActive = cn(
    pageButtonBase,
    'bg-secondary text-white border-secondary',
    'hover:bg-secondary/90',
    // AppSec: the current page is violet text on a
    // hairline square, never a solid fill. Other spaces keep the fill (PAGER_INK).
    'appsec:border-zinc-300 appsec:bg-transparent appsec:text-secondary appsec:hover:bg-secondary/[0.06]',
    'appsec-dark:border-as-line-strong appsec-dark:bg-transparent appsec-dark:text-secondary-light appsec-dark:hover:bg-secondary/10'
  );

  // Nav button styles (prev/next)
  const navButton = cn(
    buttonBase,
    'h-9 px-3 text-sm font-medium rounded-xl',
    'text-gray-600 dark:text-gray-300',
    'hover:bg-gray-100 dark:hover:bg-neutral-800',
    'border border-gray-200 dark:border-neutral-700',
    'bg-white dark:bg-neutral-900',
    'appsec:h-8 appsec:px-2.5 appsec:rounded-lg appsec:text-[13px] appsec:text-zinc-600 appsec:border-zinc-200 appsec:hover:bg-zinc-100',
    'appsec-dark:bg-as-raised appsec-dark:border-as-line-strong appsec-dark:text-zinc-200 appsec-dark:hover:bg-white/[0.09]',
    AS_TOUCH
  );

  // Page size selector — the one control that survives a listing with a single
  // page, because the size is what MAKES it a single page. No vertical padding
  // (AS_SELECT): the line is centred in the whole box, descenders included, at
  // 32 px (AppSec), 36 px (other spaces) and 44 px on a phone, where it takes
  // 16 px text in both spaces, as every field does.
  const pageSizeSelector = showPageSize && (
    <div className="flex items-center gap-2 order-3">
      <select
        value={pageSize}
        onChange={handlePageSizeChange}
        className={cn(
          'h-9 px-4 pr-8 text-sm font-medium rounded-xl appearance-none cursor-pointer max-md:h-11 max-md:text-base',
          AS_SELECT,
          'bg-white dark:bg-neutral-900',
          'border border-gray-200 dark:border-neutral-700',
          'text-gray-600 dark:text-gray-300',
          'hover:border-gray-300 dark:hover:border-neutral-600',
          'appsec:border-zinc-200 appsec:text-zinc-600 appsec:hover:border-zinc-300',
          'focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary',
          'transition-colors duration-200',
          'appsec:h-8 appsec:rounded-lg appsec:pl-2.5 appsec:text-[13px] appsec:max-md:h-11 appsec:max-md:text-base',
          'appsec:focus:ring-[3px] appsec:focus:ring-secondary/15 appsec:focus:border-secondary/60',
          'appsec-dark:bg-as-raised appsec-dark:border-as-line-strong appsec-dark:text-zinc-200 appsec-dark:focus:ring-secondary/25'
        )}
        style={{ minWidth: '100px' }}
      >
        {pageSizeOptions.map((size) => (
          <option key={size} value={size}>
            {size} / {t('components.pagination.page')}
          </option>
        ))}
      </select>
    </div>
  );

  // Opted in, with nothing to navigate: the size selector alone. No page
  // numbers to click and no "Showing 1-90 of 90" restating the whole list.
  if (!canPaginate) {
    return (
      <div className={cn('flex items-center justify-end w-full', className)}>
        {pageSizeSelector}
      </div>
    );
  }

  return (
    <div className={cn(
      // Wraps: four-digit page numbers ran out of the page at 320 and 768 px.
      'flex flex-col sm:flex-row sm:flex-wrap items-center justify-between gap-4 w-full',
      className
    )}>
      {/* Items count */}
      {showItemsCount && (
        <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap order-2 sm:order-1 appsec:text-[13px] appsec:tabular-nums appsec:text-zinc-500 appsec-dark:text-zinc-400">
          {t('components.pagination.showing')} {count(startItem)}-{count(endItem)} {t('components.pagination.of')} {count(totalItems)}
        </div>
      )}

      {/* Page numbers */}
      <nav
        className="flex flex-wrap items-center justify-center gap-1 order-1 sm:order-2"
        aria-label="Pagination"
      >
        {/* Previous button */}
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          className={navButton}
          disabled={currentPage === 1}
          aria-label={t('common.previous')}
        >
          <ChevronLeft className="h-4.5 w-4.5 appsec:h-4 appsec:w-4"  />
          {!compact && <span className="ml-1.5 hidden sm:inline">{t('common.previous')}</span>}
        </button>

        {/* First page + ellipsis */}
        {showPageNumbers && startPage > 1 && (
          <>
            <button
              onClick={() => onPageChange(1)}
              className={pageButtonInactive}
            >
              1
            </button>
            {startPage > 2 && (
              <span className="px-2 text-gray-500 dark:text-gray-500 appsec:text-zinc-500">
                <EllipsisH className="h-4.5 w-4.5"  />
              </span>
            )}
          </>
        )}

        {/* Page numbers */}
        {showPageNumbers && pageNumbers.map((number) => (
          <button
            key={number}
            onClick={() => onPageChange(number)}
            className={currentPage === number ? pageButtonActive : pageButtonInactive}
            aria-current={currentPage === number ? "page" : undefined}
          >
            {number}
          </button>
        ))}

        {/* Last page + ellipsis */}
        {showPageNumbers && endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && (
              <span className="px-2 text-gray-500 dark:text-gray-500 appsec:text-zinc-500">
                <EllipsisH className="h-4.5 w-4.5"  />
              </span>
            )}
            <button
              onClick={() => onPageChange(totalPages)}
              className={pageButtonInactive}
            >
              {totalPages}
            </button>
          </>
        )}

        {/* Next button */}
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          className={navButton}
          disabled={currentPage === totalPages}
          aria-label={t('common.next')}
        >
          {!compact && <span className="mr-1.5 hidden sm:inline">{t('common.next')}</span>}
          <ChevronRight className="h-4.5 w-4.5 appsec:h-4 appsec:w-4"  />
        </button>
      </nav>

      {/* Page size selector */}
      {pageSizeSelector}
    </div>
  );
};

export default Pagination;
