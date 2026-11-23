import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OrganizationOverviewFilters } from '@/server/interfaces/Vulnerability';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import Select from '@/components/atoms/select/Select';
import FilterChipGroup from '@/components/molecules/filter-chip-group/FilterChipGroup';
import { cn } from '@/utils/function/utils';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { Calendar, ChevronDown, CodeBranch, Filter, RotateRight } from '@/components/atoms/icon/icons';

/**
 * Option lists hold their API value and the key that names them — never the
 * label itself. Written inline in English, they used to sit under French
 * headings on a French screen, and the severity words disagreed with the same
 * four words rendered elsewhere on the page.
 */
const SEVERITY_OPTIONS = [
    { value: 'CRITICAL', key: 'common.severity.critical', tone: AS_WORD_TONE.critical },
    { value: 'HIGH', key: 'common.severity.high', tone: AS_WORD_TONE.high },
    { value: 'MEDIUM', key: 'common.severity.medium', tone: AS_WORD_TONE.medium },
    { value: 'LOW', key: 'common.severity.low', tone: AS_WORD_TONE.low },
];

const STATE_OPTIONS = [
    { value: 'open', key: 'pages.organizationOverview.filters.statusOptions.open' },
    { value: 'confirmed', key: 'pages.organizationOverview.filters.statusOptions.confirmed' },
    { value: 'resolved', key: 'pages.organizationOverview.filters.statusOptions.resolved' },
    { value: 'not_exploitable', key: 'pages.organizationOverview.filters.statusOptions.not_exploitable' },
];

/** Scanner families. These are product names, identical in every locale. */
const ANALYSIS_TYPE_OPTIONS = [
    { value: 'SAST', label: 'SAST' },
    { value: 'IAC', label: 'IaC' },
    { value: 'SCA', label: 'SCA' },
    { value: 'CONTAINER', label: 'Container' },
];

// Sort options - must match API values: total_vulnerabilities, critical_count, risk_level, name
const SORT_OPTIONS = [
    { value: 'critical_count', key: 'pages.organizationOverview.filters.sortOptions.critical_count' },
    { value: 'total_vulnerabilities', key: 'pages.organizationOverview.filters.sortOptions.total_vulnerabilities' },
    { value: 'risk_level', key: 'pages.organizationOverview.filters.sortOptions.risk_level' },
    { value: 'name', key: 'pages.organizationOverview.filters.sortOptions.name' },
];

interface OrganizationOverviewFiltersBarProps {
    filters: OrganizationOverviewFilters;
    onFiltersChange: (filters: OrganizationOverviewFilters) => void;
    onReset: () => void;
    loading?: boolean;
}

/**
 * OrganizationOverviewFiltersBar - Compact filter bar for organization overview
 * Provides quick access to branch, severity, state, and analysis type filters
 */
const OrganizationOverviewFiltersBar: React.FC<OrganizationOverviewFiltersBarProps> = ({
    filters,
    onFiltersChange,
    onReset,
    loading = false,
}) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const updateFilter = <K extends keyof OrganizationOverviewFilters>(
        key: K,
        value: OrganizationOverviewFilters[K]
    ) => {
        onFiltersChange({ ...filters, [key]: value });
    };

    const toggleArrayFilter = (key: 'severities' | 'states' | 'analysisTypes', value: string) => {
        const currentValues = filters[key] || [];
        const newValues = currentValues.includes(value)
            ? currentValues.filter(v => v !== value)
            : [...currentValues, value];
        updateFilter(key, newValues.length > 0 ? newValues : undefined);
    };

    const hasActiveFilters =
        filters.branch ||
        (filters.severities && filters.severities.length > 0) ||
        (filters.states && filters.states.length > 0) ||
        (filters.analysisTypes && filters.analysisTypes.length > 0) ||
        filters.dateFrom ||
        filters.dateTo;

    return (
        <div className="space-y-3 relative z-10">
            {/* Main filter bar */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {/* Branch filter */}
                <div className="flex-shrink-0 w-32 sm:w-40">
                    <Input
                        size="sm"
                        placeholder={t('pages.organizationOverview.filters.branch')}
                        aria-label={t('pages.organizationOverview.filters.branch')}
                        value={filters.branch || ''}
                        onChange={(e) => updateFilter('branch', e.target.value || undefined)}
                        leftIcon={<CodeBranch className="w-4.5 h-4.5 text-zinc-400" />}
                    />
                </div>

                {/* Sort by */}
                <div className="flex-shrink-0">
                    <Select
                        compact
                        label={t('pages.organizationOverview.filters.sortBy')}
                        options={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.key) }))}
                        value={filters.sortBy || 'critical_count'}
                        onChange={(value) => updateFilter('sortBy', value as never)}
                    />
                </div>

                {/* Sort order — the arrows alone say nothing out of context. */}
                <div className="flex-shrink-0 w-36">
                    <Select
                        compact
                        label={t('pages.organizationOverview.filters.sortOrder')}
                        options={[
                            { value: 'DESC', label: `↓ ${t('pages.organizationOverview.filters.descending')}` },
                            { value: 'ASC', label: `↑ ${t('pages.organizationOverview.filters.ascending')}` },
                        ]}
                        value={filters.sortOrder || 'DESC'}
                        onChange={(value) => updateFilter('sortOrder', value as 'ASC' | 'DESC')}
                    />
                </div>

                {/* Expand filters button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="gap-2"
                >
                    <Filter className="w-4 h-4"  />
                    {t('pages.organizationOverview.filters.moreFilters')}
                    <ChevronDown
                        className={cn('w-4.5 h-4.5 transition-transform', isExpanded && 'rotate-180')}
                     />
                </Button>

                {/* Reset button */}
                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onReset}
                        disabled={loading}
                        className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 dark:text-zinc-400"
                    >
                        <RotateRight className="w-4 h-4 mr-1.5"  />
                        {t('pages.organizationOverview.filters.reset')}
                    </Button>
                )}
            </div>

            {/* Expanded filters */}
            {isExpanded && (
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-as-line bg-zinc-50 dark:bg-white/[0.03] space-y-4">
                    <FilterChipGroup
                        label={t('pages.organizationOverview.filters.severity')}
                        options={SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.key), toneClassName: o.tone }))}
                        selected={filters.severities}
                        onToggle={(value) => toggleArrayFilter('severities', value)}
                    />

                    <FilterChipGroup
                        label={t('pages.organizationOverview.filters.state')}
                        options={STATE_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))}
                        selected={filters.states}
                        onToggle={(value) => toggleArrayFilter('states', value)}
                    />

                    <FilterChipGroup
                        label={t('pages.organizationOverview.filters.analysisType')}
                        options={ANALYSIS_TYPE_OPTIONS}
                        selected={filters.analysisTypes}
                        onToggle={(value) => toggleArrayFilter('analysisTypes', value)}
                    />

                    {/* Date range */}
                    <div className="flex items-center gap-4">
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                {t('pages.organizationOverview.filters.dateFrom')}
                            </label>
                            <Input
                                size="sm"
                                type="date"
                                aria-label={t('pages.organizationOverview.filters.dateFrom')}
                                value={filters.dateFrom || ''}
                                onChange={(e) => updateFilter('dateFrom', e.target.value || undefined)}
                                leftIcon={<Calendar className="w-4 h-4 text-zinc-400" />}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                {t('pages.organizationOverview.filters.dateTo')}
                            </label>
                            <Input
                                size="sm"
                                type="date"
                                aria-label={t('pages.organizationOverview.filters.dateTo')}
                                value={filters.dateTo || ''}
                                onChange={(e) => updateFilter('dateTo', e.target.value || undefined)}
                                leftIcon={<Calendar className="w-4 h-4 text-zinc-400" />}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrganizationOverviewFiltersBar;
