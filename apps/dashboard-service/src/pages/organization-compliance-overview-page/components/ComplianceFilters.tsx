// ============================================================================
// ComplianceFilters - Filter bar for compliance overview
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import {
  ComplianceStatus,
  ComplianceOverviewSortBy,
  SortOrder,
} from '@/server/interfaces/OrganizationCompliance';
import { CalendarAlt, Download, Filter, Search, SyncAlt, Times } from '@/components/atoms/icon/icons';
import { AS_FIELD, AS_FIELD_FOCUS, AS_SELECT } from '@/components/atoms/appsec/styles';

interface ComplianceFiltersProps {
  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;
  
  // Status Filter
  complianceStatus: ComplianceStatus | undefined;
  onStatusChange: (status: ComplianceStatus | undefined) => void;
  
  // Date Range
  startDate: string | undefined;
  onStartDateChange: (date: string | undefined) => void;
  endDate: string | undefined;
  onEndDateChange: (date: string | undefined) => void;
  
  // Sorting
  sortBy: ComplianceOverviewSortBy;
  onSortByChange: (sortBy: ComplianceOverviewSortBy) => void;
  sortOrder: SortOrder;
  onSortOrderChange: (order: SortOrder) => void;
  
  // Actions
  onRefresh: () => void;
  onExport?: () => void;
  loading: boolean;
  /** Where the bar sits decides its outer margin (inside the table header: none). */
  className?: string;
}

const statusOptions: { value: ComplianceStatus | undefined; labelKey: string }[] = [
  { value: undefined, labelKey: 'pages.complianceOverview.filters.allStatuses' },
  { value: 'Compliant', labelKey: 'pages.complianceOverview.status.compliant' },
  { value: 'Non-Compliant', labelKey: 'pages.complianceOverview.status.nonCompliant' },
  { value: 'Pending', labelKey: 'pages.complianceOverview.status.pending' },
];

const sortOptions: { value: ComplianceOverviewSortBy; labelKey: string }[] = [
  { value: 'blockedCount', labelKey: 'pages.complianceOverview.filters.sortByBlocked' },
  { value: 'warnedCount', labelKey: 'pages.complianceOverview.filters.sortByWarned' },
  { value: 'totalViolations', labelKey: 'pages.complianceOverview.filters.sortByTotal' },
  { value: 'lastEvaluatedAt', labelKey: 'pages.complianceOverview.filters.sortByLastEvaluated' },
  { value: 'projectName', labelKey: 'pages.complianceOverview.filters.sortByName' },
];

/**
 * ComplianceFilters - Filter bar for compliance overview
 */
const ComplianceFilters: React.FC<ComplianceFiltersProps> = ({
  searchQuery,
  onSearchChange,
  complianceStatus,
  onStatusChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  onRefresh,
  onExport,
  loading,
  className,
}) => {
  const { t } = useTranslation();
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [showFilters, setShowFilters] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  // Count active filters
  const activeFiltersCount = [
    complianceStatus,
    startDate,
    endDate,
  ].filter(Boolean).length;

  const clearAllFilters = useCallback(() => {
    onStatusChange(undefined);
    onStartDateChange(undefined);
    onEndDateChange(undefined);
    setLocalSearch('');
    onSearchChange('');
  }, [onStatusChange, onStartDateChange, onEndDateChange, onSearchChange]);

  return (
    <div className={cn('mb-6 space-y-4', className)}>
      {/* Main Filter Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500"
           />
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={t('pages.complianceOverview.filters.searchPlaceholder')}
            className={cn(
              'w-full h-9 pl-9 pr-9 text-sm max-md:h-11',
              AS_FIELD,
              AS_FIELD_FOCUS
            )}
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch('');
                onSearchChange('');
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-200 dark:text-zinc-400"
            >
              <Times className="h-4 w-4"  />
            </button>
          )}
        </div>

        {/* Filter Toggle Button */}
        <Button
          variant="white"
          size="md"
          onClick={() => setShowFilters(!showFilters)}
          icon={<Filter className="h-4 w-4"  />}
          className="relative"
        >
          {t('pages.complianceOverview.filters.filters')}
          {activeFiltersCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-secondary px-1 font-mono text-xs tabular-nums text-white">
              {activeFiltersCount}
            </span>
          )}
        </Button>

        {/* Refresh Button */}
        <Button
          variant="white"
          size="md"
          onClick={onRefresh}
          disabled={loading}
          icon={
            <SyncAlt
              className={cn(loading && 'animate-spin')}
             />
          }
        >
          {t('pages.complianceOverview.filters.refresh')}
        </Button>

        {/* Export Button */}
        {onExport && (
          <Button
            variant="white"
            size="md"
            onClick={onExport}
            icon={<Download className="h-4 w-4"  />}
          >
            {t('pages.complianceOverview.filters.export')}
          </Button>
        )}
      </div>

      {/* Expanded Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-white dark:bg-as-surface rounded-2xl border border-zinc-200 dark:border-as-line space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Status Filter */}
                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {t('pages.complianceOverview.filters.status')}
                  </label>
                  <select
                    value={complianceStatus || ''}
                    onChange={(e) => onStatusChange(e.target.value as ComplianceStatus || undefined)}
                    className={cn(
                      'w-full h-9 pl-3 text-sm max-md:h-11',
                      AS_SELECT,
                      AS_FIELD,
                      AS_FIELD_FOCUS
                    )}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.labelKey} value={option.value || ''}>
                        {t(option.labelKey, option.value || 'All')}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    <CalendarAlt className="h-4 w-4 mr-1.5"  />
                    {t('pages.complianceOverview.filters.startDate')}
                  </label>
                  <input
                    type="date"
                    value={startDate || ''}
                    onChange={(e) => onStartDateChange(e.target.value || undefined)}
                    className={cn(
                      'w-full h-9 px-3 text-sm max-md:h-11',
                      AS_FIELD,
                      AS_FIELD_FOCUS
                    )}
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    <CalendarAlt className="h-4 w-4 mr-1.5"  />
                    {t('pages.complianceOverview.filters.endDate')}
                  </label>
                  <input
                    type="date"
                    value={endDate || ''}
                    onChange={(e) => onEndDateChange(e.target.value || undefined)}
                    className={cn(
                      'w-full h-9 px-3 text-sm max-md:h-11',
                      AS_FIELD,
                      AS_FIELD_FOCUS
                    )}
                  />
                </div>

                {/* Sort By */}
                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {t('pages.complianceOverview.filters.sortBy')}
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={sortBy}
                      onChange={(e) => onSortByChange(e.target.value as ComplianceOverviewSortBy)}
                      className={cn(
                        'flex-1 h-9 pl-3 text-sm max-md:h-11',
                        AS_SELECT,
                        AS_FIELD,
                        AS_FIELD_FOCUS
                      )}
                    >
                      {sortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey, option.value)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className={cn(
                        'relative h-9 px-3 rounded-lg border transition-colors duration-[120ms] max-md:h-11',
                        'bg-white dark:bg-as-raised',
                        'border-zinc-200 dark:border-as-line-strong',
                        'text-zinc-600 dark:text-zinc-400',
                        'hover:bg-zinc-50 dark:hover:bg-white/[0.06]'
                      )}
                      title={t(sortOrder === 'asc' ? 'components.resultsTable.ascending' : 'components.resultsTable.descending')}
                    >
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Clear Filters */}
              {activeFiltersCount > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={clearAllFilters}
                    className="text-sm text-secondary dark:text-secondary-light hover:underline"
                  >
                    {t('pages.complianceOverview.filters.clearAll')}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ComplianceFilters;
