import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { EmptyState } from '@/components/molecules/empty-state/EmptyState';
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkRow } from '@/components/atoms/link';
import { ChevronDown, ChevronRight, Package, Shield, CheckCircle, XCircle, Brain } from '@/components/atoms/icon/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import FilterBar, { FilterConfig, SortConfig } from '@/components/molecules/filter-bar/FilterBar';
import SeverityBreakdownBadges from '@/components/atoms/badge/SeverityBreakdownBadges';
import { SeverityMark } from '@/components/atoms/badge/SeverityCount';
import ExploitabilityBadge from '@/components/atoms/badge/ExploitabilityBadge';
import { GroupedContainerVulnerability } from '@/server/interfaces/Vulnerability';
import { filterStatusOptions } from '@/utils/data/historyVulnData';
import { priorityOptions } from '@/utils/data/historyVulnData';
import {
    exploitabilityOptions,
    orderDirectionOptions,
    orderOptions as defaultOrderOptions,
    severityOptions,
} from '@/utils/data/resultsVulnData';
import {
    getSeverityVariant,
    getSeverityLabel,
    getWorstExploitabilityVerdict,
    cn,
} from '@/utils/function/utils';
import { AS_TAG, AS_FOCUS, AS_TD, AS_TH, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';

// label key map for the exploitability filter options.
const EXPLOITABILITY_I18N_KEY: Record<string, string> = {
    actively_exploited: 'exploitabilityActive',
    proven: 'exploitabilityProven',
    theoretical: 'exploitabilityTheoretical',
    not_exploitable: 'exploitabilityNotExploitable',
    not_evaluated: 'exploitabilityNotEvaluated',
};

interface GroupedResultsContainerTableProps {
    projectId: string | undefined;
    groups: GroupedContainerVulnerability[];
    totalGroups: number;
    currentPage: number;
    totalPages: number;
    pageSize: number;
    pageSizeOptions: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    selectedSeverity: string[];
    selectedStatus: string[];
    selectedPriority: string[];
    selectedClassType: string[];
    selectedExploitability?: string[];
    selectedOrder: string;
    selectedOrderDirection: string;
    onSeverityChange: (value: string[]) => void;
    onStatusChange: (value: string[]) => void;
    onPriorityChange: (value: string[]) => void;
    onClassTypeChange: (value: string[]) => void;
    onExploitabilityChange?: (value: string[]) => void;
    onOrderChange: (value: string) => void;
    onOrderDirectionChange: (value: string) => void;
    onSearchQueryChange: (value: string) => void;
    loading: boolean;
    triageMode?: boolean;
    onTriageModeChange?: (value: boolean) => void;
}

export const GroupedResultsContainerTable: React.FC<GroupedResultsContainerTableProps> = ({
    projectId,
    groups,
    totalGroups,
    currentPage,
    totalPages,
    pageSize,
    pageSizeOptions,
    onPageChange,
    onPageSizeChange,
    selectedSeverity,
    selectedStatus,
    selectedPriority,
    selectedClassType,
    selectedExploitability,
    selectedOrder,
    selectedOrderDirection,
    onSeverityChange,
    onStatusChange,
    onPriorityChange,
    onClassTypeChange,
    onExploitabilityChange,
    onOrderChange,
    onOrderDirectionChange,
    onSearchQueryChange,
    loading,
    triageMode,
    onTriageModeChange,
}) => {
    const { issueLinkTo } = useIssueQuickView();
    const { t } = useTranslation();
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const toggleGroup = (groupKey: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupKey)) {
                newSet.delete(groupKey);
            } else {
                newSet.add(groupKey);
            }
            return newSet;
        });
    };

    const getGroupKey = (group: GroupedContainerVulnerability) =>
        `${group.packageName}-${group.packageVersion}`;

    const classTypeOptions = [
        { label: t('components.resultsContainerTable.class.os'), value: 'os-pkgs' },
        { label: t('components.resultsContainerTable.class.lang'), value: 'lang-pkgs' },
    ];

    const extendedOrderOptions = [
        ...defaultOrderOptions,
        { label: 'CVSS Score', value: 'cvssScore' },
    ];

    const filters: FilterConfig[] = [
        {
            id: 'severity',
            label: t('components.resultsTable.severity'),
            options: severityOptions,
            value: selectedSeverity,
            onChange: onSeverityChange,
        },
        {
            id: 'status',
            label: t('components.resultsTable.status'),
            options: filterStatusOptions,
            value: selectedStatus,
            onChange: onStatusChange,
        },
        {
            id: 'priority',
            label: t('components.resultsTable.priority'),
            options: priorityOptions,
            value: selectedPriority,
            onChange: onPriorityChange,
        },
        {
            id: 'classType',
            label: t('components.resultsContainerTable.class.type'),
            options: classTypeOptions,
            value: selectedClassType,
            onChange: onClassTypeChange,
        },
        ...(selectedExploitability && onExploitabilityChange
            ? [{
                id: 'exploitability',
                label: t('components.resultsTable.exploitability'),
                options: exploitabilityOptions.map((o) => ({
                    ...o,
                    label: t(
                        `components.resultsTable.${EXPLOITABILITY_I18N_KEY[o.value]}`,
                    ),
                })),
                value: selectedExploitability,
                onChange: onExploitabilityChange,
            }]
            : []),
    ];

    const sort: SortConfig = {
        orderOptions: extendedOrderOptions,
        directionOptions: orderDirectionOptions,
        selectedOrder,
        selectedDirection: selectedOrderDirection,
        onOrderChange,
        onDirectionChange: onOrderDirectionChange,
    };

    return (
        <div className="min-h-[calc(100vh-300px)] w-full max-w-full mx-auto flex flex-col">
            <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
                {/* Filters */}
                <FilterBar
                    filters={filters}
                    sort={sort}
                    onSearchChange={onSearchQueryChange}
                    searchPlaceholder={t('components.resultsTable.searchPlaceholder')}
                />

                {/* Content */}
                <div className="flex-1 flex flex-col bg-white dark:bg-as-surface">
                    {loading ? (
                        <div className="p-4">
                            <Skeleton type="table" rows={10} columns={1} />
                        </div>
                    ) : groups && groups.length > 0 ? (
                        <div className="divide-y divide-zinc-100 dark:divide-as-line">
                            {groups.map((group) => {
                                const groupKey = getGroupKey(group);
                                const isExpanded = expandedGroups.has(groupKey);
                                const worstVerdict = getWorstExploitabilityVerdict(
                                    group.occurrences,
                                );
                                const classLabel = group.packageClass === 'os-pkgs'
                                    ? t('components.resultsContainerTable.class.os')
                                    : t('components.resultsContainerTable.class.lang');

                                return (
                                    <div key={groupKey} className="bg-white dark:bg-as-surface">
                                        {/* Group Header */}
                                        <div
                                            onClick={(e) => toggleGroup(groupKey, e)}
                                            className={cn(
                                                'flex items-center justify-between px-4 sm:px-5 py-3 cursor-pointer transition-colors duration-[120ms] max-md:flex-wrap max-md:gap-y-2',
                                                'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                                            )}
                                        >
                                            <div className="flex items-center gap-4 flex-1 min-w-0 max-md:basis-full max-md:gap-3">
                                                {/* Expand Icon */}
                                                <button
                                                    className={`relative flex-shrink-0 rounded-md text-zinc-400 transition-colors duration-[120ms] hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
                                                    onClick={(e) => toggleGroup(groupKey, e)}
                                                >
                                                    {isExpanded ? (
                                                        <ChevronDown className="w-4 h-4" />
                                                    ) : (
                                                        <ChevronRight className="w-4 h-4" />
                                                    )}
                                                </button>

                                                {/* Severity Badge */}
                                                <SeverityMark severity={getSeverityVariant(group.highestSeverity)} label={getSeverityLabel(group.highestSeverity)} title={t(`common.severity.${getSeverityVariant(group.highestSeverity)}`)} />

                                                {/* Package Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-3">
                                                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
                                                            <Package className="w-5 h-5 text-zinc-500 dark:text-zinc-300" />
                                                            {group.packageName}
                                                        </h3>
                                                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-as-raised px-2 py-0.5 rounded">
                                                            {group.packageVersion}
                                                        </span>
                                                        <span className={AS_TAG}>
                                                            {classLabel}
                                                        </span>
                                                    </div>
                                                    {/* worst-case exploitability verdict across CVEs */}
                                                    <div className="mt-1.5">
                                                        <ExploitabilityBadge
                                                            verdict={worstVerdict}
                                                            size="sm"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right side info */}
                                            <div className="flex items-center gap-6 flex-shrink-0 max-md:w-full max-md:flex-wrap max-md:gap-2 max-md:pl-7">
                                                {/* Cybe Analysis Badge */}
                                                {group.hasCybeAnalysis && (
                                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gradient-to-r from-purple-500/10 to-indigo-500/10 dark:from-purple-500/20 dark:to-indigo-500/20 border border-purple-500/20 dark:border-purple-500/30">
                                                        <Brain className="w-5 h-5 text-purple-500 dark:text-purple-400" />
                                                        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                                            {t('common.cybeAnalysis')}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Fix Available indicator */}
                                                {group.hasFix ? (
                                                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                                                        <CheckCircle className="w-4 h-4" />
                                                        <span className="text-xs font-medium">{t('common.fixAvailable')}</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                                                        <XCircle className="w-5 h-5" />
                                                        <span className="text-xs">{t('components.resultsTable.noFix')}</span>
                                                    </div>
                                                )}

                                                {/* Severity Breakdown */}
                                                <SeverityBreakdownBadges breakdown={group.severityBreakdown} appearance="dot" />

                                                {/* CVE count */}
                                                <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400 min-w-[80px]">
                                                    <Shield className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                                                    <span className="font-medium font-mono tabular-nums text-zinc-700 dark:text-zinc-200">{group.occurrenceCount}</span>
                                                    <span>{group.occurrenceCount === 1 ? t('components.resultsContainerTable.cve_one') : t('components.resultsContainerTable.cve_other')}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* CVE List */}
                                        <AnimatePresence>
                                            {isExpanded && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="bg-zinc-50 dark:bg-white/[0.03] border-t border-zinc-200 dark:border-as-line">
                                                        <table className="min-w-full">
                                                            <thead>
                                                                <tr className="bg-zinc-100/30 dark:bg-white/[0.03]">
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsContainerTable.cve')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsContainerTable.fixedVersion')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.exploitabilityShort')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.severity')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.status')}
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                                                                {group.occurrences.map((occurrence) => {
                                                                    return (
                                                                        <LinkRow
                                                                            key={occurrence.id}
                                                                            to={issueLinkTo(occurrence.id)}
                                                                            className="hover:bg-zinc-50 dark:hover:bg-white/[0.03] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors duration-[120ms]"
                                                                        >
                                                                            <td className={AS_TD}>
                                                                                <span className="text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100 font-medium">
                                                                                    {occurrence.vulnerabilityId}
                                                                                </span>
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                {occurrence.fixedVersion ? (
                                                                                    <span className="font-mono text-xs text-green-700 dark:text-green-400">
                                                                                        {occurrence.fixedVersion}
                                                                                    </span>
                                                                                ) : null /* no fixed version: an empty cell, no dash */}
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                <ExploitabilityBadge
                                                                                    verdict={occurrence.exploitabilityVerdict}
                                                                                    size="sm"
                                                                                />
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                <SeverityChip level={getSeverityVariant(occurrence.currentSeverity)} title={t(`common.severity.${getSeverityVariant(occurrence.currentSeverity)}`)}>{getSeverityLabel(occurrence.currentSeverity)}</SeverityChip>
                                                                            </td>
                                                                            <td className={cn(AS_TD, 'capitalize')}>
                                                                                {occurrence.currentState.replace('_', ' ')}
                                                                            </td>
                                                                        </LinkRow>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <EmptyState
                            cybeMessage
                            title={t(EMPTY_STATE_COPY.noVuln)}
                            className="my-4"
                          />
                    )}
                </div>

                {/* Pagination */}
                {!loading && groups.length > 0 && (
                    <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:justify-between md:items-center border-t border-zinc-200 dark:border-as-line bg-white dark:bg-as-surface">
                        <div className="flex-grow flex justify-center">
                            <Pagination
                                currentPage={currentPage}
                                totalPages={totalPages}
                                totalItems={totalGroups}
                                pageSize={pageSize}
                                onPageChange={onPageChange}
                                onPageSizeChange={onPageSizeChange}
                                pageSizeOptions={pageSizeOptions}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GroupedResultsContainerTable;
