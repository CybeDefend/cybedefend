// ============================================================================
// PolicyFilters Component - Search and filter controls for policies
// ============================================================================

import React from 'react';
import Input from '@/components/atoms/input/Input';
import FilterChipGroup from '@/components/molecules/filter-chip-group/FilterChipGroup';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { PolicyScope } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import { Filter, Search } from '@/components/atoms/icon/icons';

interface PolicyFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  scopeFilter: PolicyScope | 'all';
  onScopeChange: (scope: PolicyScope | 'all') => void;
  statusFilter: 'all' | 'enabled' | 'disabled';
  onStatusChange: (status: 'all' | 'enabled' | 'disabled') => void;
  /** Without its own panel: the list hosts it at the top of its own. */
  bare?: boolean;
}

const PolicyFilters: React.FC<PolicyFiltersProps> = ({
  searchQuery,
  onSearchChange,
  scopeFilter,
  onScopeChange,
  statusFilter,
  onStatusChange,
  bare = false,
}) => {
  const { t } = useTranslation();

  const scopeOptions = [
    { value: 'all', label: t('common.all') },
    { value: PolicyScope.ORGANIZATION, label: t('pages.policies.scope.organization') },
    { value: PolicyScope.TEAM, label: t('pages.policies.scope.team') },
    { value: PolicyScope.PROJECT, label: t('pages.policies.scope.project') },
  ];

  const statusOptions = [
    { value: 'all', label: t('common.all') },
    { value: 'enabled', label: t('pages.policies.status.enabled') },
    { value: 'disabled', label: t('pages.policies.status.disabled') },
  ];

  const controls = (
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1">
          <Input
            size="sm"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('pages.policies.searchPlaceholder')}
            aria-label={t('pages.policies.searchPlaceholder')}
            leftIcon={<Search className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />}
          />
        </div>

        {/* Both facets are the same control, so they are the same component —
            one of them used to read "Status: Tous / Enabled / Disabled". */}
        <FilterChipGroup
          label={t('pages.policies.scope.label')}
          options={scopeOptions}
          selected={[scopeFilter]}
          onToggle={(value) => onScopeChange(value as PolicyScope | 'all')}
        />

        <FilterChipGroup
          label={t('pages.policies.statusLabel')}
          options={statusOptions}
          selected={[statusFilter]}
          onToggle={(value) => onStatusChange(value as 'all' | 'enabled' | 'disabled')}
        />
      </div>
  );

  if (bare) return controls;
  return (
    <Card variant="default" padding="md" className="mb-6 p-3 sm:p-4">
      {controls}
    </Card>
  );
};

export default PolicyFilters;
