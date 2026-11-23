import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { EmptyState } from '@/components/molecules/empty-state/EmptyState';
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import useActiveIssueRow from "@/server/hooks/useActiveIssueRow";
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkRow } from '@/components/atoms/link';
import { ChevronDown, ChevronRight, Package, Shield, CheckCircle, XCircle } from '@/components/atoms/icon/icons';
import { Slot } from '@/edition/slots';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import FilterBar, { FilterConfig, SortConfig } from '@/components/molecules/filter-bar/FilterBar';
import SeverityBreakdownBadges from '@/components/atoms/badge/SeverityBreakdownBadges';
import { SeverityMark } from '@/components/atoms/badge/SeverityCount';
import ExploitabilityBadge from '@/components/atoms/badge/ExploitabilityBadge';
import TicketTracker from '@/components/molecules/ticket-tracker/TicketTracker';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';
import { GroupedScaVulnerability } from '@/server/interfaces/Vulnerability';
import { filterStatusOptions } from '@/utils/data/historyVulnData';
import {
    exploitabilityOptions,
    orderDirectionOptions,
    orderOptions,
    severityOptions,
} from '@/utils/data/resultsVulnData';
import {
    getSeverityVariant,
    getSeverityLabel,
    getWorstExploitabilityVerdict,
    cn,
} from '@/utils/function/utils';
import { AS_TAG, AS_FOCUS, AS_TD, AS_TH, AS_TOUCH_SQUARE, AS_ROW_MARKER } from '@/components/atoms/appsec/styles';

// Label key map for the exploitability filter options.
const EXPLOITABILITY_I18N_KEY: Record<string, string> = {
    actively_exploited: 'exploitabilityActive',
    proven: 'exploitabilityProven',
    theoretical: 'exploitabilityTheoretical',
    not_exploitable: 'exploitabilityNotExploitable',
    not_evaluated: 'exploitabilityNotEvaluated',
};

interface GroupedResultsScaTableProps {
    projectId: string | undefined;
    groups: GroupedScaVulnerability[];
    totalGroups: number;
    currentPage: number;
    totalPages: number;
    pageSize: number;
    pageSizeOptions: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    selectedSeverity: string[];
    selectedStatus: string[];
    selectedExploitability?: string[];
    selectedOrder: string;
    selectedOrderDirection: string;
    onSeverityChange: (value: string[]) => void;
    onStatusChange: (value: string[]) => void;
    onExploitabilityChange?: (value: string[]) => void;
    onOrderChange: (value: string) => void;
    onOrderDirectionChange: (value: string) => void;
    onSearchQueryChange: (value: string) => void;
    loading: boolean;
    triageMode?: boolean;
    onTriageModeChange?: (value: boolean) => void;
    onFocusTop5?: () => void;
    focusTop5Active?: boolean;
    scanId?: string;
    // Jira and Linear tickets of the project
    issueTracking?: IssueTracking;
    selectedPackageType?: string[];
    onPackageTypeChange?: (value: string[]) => void;
    selectedPackageManager?: string[];
    onPackageManagerChange?: (value: string[]) => void;
    selectedPackageSource?: string[];
    onPackageSourceChange?: (value: string[]) => void;
    packageManagerOptions?: string[];
    packageSourceOptions?: string[];
    /** The badges the active edition adds beside a group's severity, in every view. */
    rowBadges?: React.ComponentType<{ vulnerability: unknown; layout?: 'row' | 'group' }>[];
}

const NO_ROW_BADGES: React.ComponentType<{ vulnerability: unknown; layout?: 'row' | 'group' }>[] = [];

export const GroupedResultsScaTable: React.FC<GroupedResultsScaTableProps> = ({
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
    selectedExploitability,
    selectedOrder,
    selectedOrderDirection,
    onSeverityChange,
    onStatusChange,
    onExploitabilityChange,
    onOrderChange,
    onOrderDirectionChange,
    onSearchQueryChange,
    loading,
    triageMode,
    onTriageModeChange,
    onFocusTop5,
    focusTop5Active,
    scanId,
    issueTracking,
    selectedPackageType,
    onPackageTypeChange,
    selectedPackageManager,
    onPackageManagerChange,
    selectedPackageSource,
    onPackageSourceChange,
    packageManagerOptions,
    packageSourceOptions,
    rowBadges = NO_ROW_BADGES,
}) => {
  const { issueLinkTo } = useIssueQuickView();
  const { activeIssueId, activeRowRef } = useActiveIssueRow();
    const { t } = useTranslation();
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Auto-expand the category containing the issue open in the quick-view
    // drawer (and collapse the others) so stepping next/prev always reveals
    // the current occurrence. Re-runs when the open issue or the page changes.
    useEffect(() => {
        if (!activeIssueId) return;
        const activeGroup = groups.find((group) =>
            (group.occurrences || []).some((o) => o.id === activeIssueId),
        );
        if (!activeGroup) return;
        const key = `${activeGroup.cveId}-${activeGroup.packageName}`;
        setExpandedGroups((prev) =>
            prev.size === 1 && prev.has(key) ? prev : new Set([key]),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIssueId, groups]);

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

    const getGroupKey = (group: GroupedScaVulnerability) => `${group.cveId}-${group.packageName}`;

    // Configure filters for FilterBar (SCA doesn't have priority filter)
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
        ...(selectedPackageType && onPackageTypeChange
            ? [{
                id: 'packageType',
                label: t('components.resultsScaTable.packageType'),
                options: [
                    { label: t('scaDependencies.direct'), value: 'direct' },
                    { label: t('scaDependencies.dev'), value: 'dev' },
                    { label: t('scaDependencies.transitive'), value: 'transitive' },
                ],
                value: selectedPackageType,
                onChange: onPackageTypeChange,
            }]
            : []),
        ...(selectedPackageManager && onPackageManagerChange
            ? [{
                id: 'packageManager',
                label: t('components.resultsScaTable.packageManager'),
                options: (packageManagerOptions ?? []).map((v) => ({ label: v, value: v })),
                value: selectedPackageManager,
                onChange: onPackageManagerChange,
            }]
            : []),
        ...(selectedPackageSource && onPackageSourceChange
            ? [{
                id: 'packageSource',
                label: t('components.resultsScaTable.packageSource'),
                options: (packageSourceOptions ?? []).map((v) => ({ label: v, value: v })),
                value: selectedPackageSource,
                onChange: onPackageSourceChange,
            }]
            : []),
    ];

    const sort: SortConfig = {
        orderOptions,
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

                                                {/* The badges the active edition adds (the cloud's red Malware badge). */}
                                                {rowBadges.map((RowBadge, index) => (
                                                    <RowBadge key={index} vulnerability={group} layout="group" />
                                                ))}

                                                {/* CVE and Package Info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-3">
                                                        <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
                                                            {group.cveId || 'No CVE'}
                                                        </h3>
                                                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-white/[0.06]">
                                                            <Package className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                                                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                                                {group.packageName}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* On a phone the summary wraps to two lines instead of being cut (Task 8 Step 2). */}
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate max-w-xl max-md:whitespace-normal max-md:line-clamp-2">
                                                        {group.vulnerability?.summary || 'Unknown Vulnerability'}
                                                    </p>
                                                    {/* Worst-case exploitability verdict across occurrences */}
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
                                                {/* Cybe Analysis / Cybe Autofix as the quiet tags of the other
                                                    tables: a hairline and a zinc
                                                    glyph, in place of the violet and cyan gradient pills. The
                                                    AutoFix mark is a `finding.actions` registration of the
                                                    active edition. */}
                                                <Slot
                                                    name="finding.actions"
                                                    context={{ projectId, vulnerability: group, vulnerabilityType: 'sca', host: 'results-group' }}
                                                />

                                                {/* Fix Available indicator */}
                                                {group.hasFix ? (
                                                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                                                        <CheckCircle className="w-4 h-4" />
                                                        <span className="text-xs font-medium">{t('common.fixAvailable')}</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                                                        <XCircle className="w-4 h-4" />
                                                        <span className="text-xs">{t('components.resultsTable.noFix')}</span>
                                                    </div>
                                                )}

                                                {/* Severity Breakdown */}
                                                <SeverityBreakdownBadges breakdown={group.severityBreakdown} appearance="dot" />

                                                {/* Jira and Linear tickets of the group */}
                                                {issueTracking?.anyConfigured && (
                                                    <span onClick={(e) => e.stopPropagation()} className="relative">
                                                        <TicketTracker
                                                            tracking={issueTracking}
                                                            projectId={projectId || ''}
                                                            groupName={group.vulnerability?.summary || group.cveId}
                                                            occurrenceIds={(group.occurrences || []).map((occ) => occ.id)}
                                                            vulnerabilities={(group.occurrences || []).map((occ) => ({
                                                                vulnerabilityId: occ.id,
                                                                scannerType: 'sca',
                                                                severity: occ.currentSeverity || group.highestSeverity,
                                                                name: group.vulnerability?.summary || group.cveId,
                                                                shortDescription: group.vulnerability?.summary,
                                                                packageName: group.packageName,
                                                                packageVersion: occ.packageVersion,
                                                                externalId: group.cveId,
                                                                branch: (occ as any).branch,
                                                            }))}
                                                        />
                                                    </span>
                                                )}

                                                {/* Occurrences count */}
                                                <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400 min-w-[80px]">
                                                    <Shield className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                                                    <span className="font-medium font-mono tabular-nums text-zinc-700 dark:text-zinc-200">{group.occurrenceCount}</span>
                                                    <span>{group.occurrenceCount === 1 ? t('common.file_one') : t('common.files')}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Occurrences List */}
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
                                                        {/* Description */}
                                                        {(group.vulnerability?.summary || group.vulnerability?.details) && (
                                                            <div className="px-12 py-3 border-b border-zinc-200 dark:border-as-line">
                                                                <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3">
                                                                    {group.vulnerability.summary || group.vulnerability.details}
                                                                </p>
                                                            </div>
                                                        )}

                                                        <table className="min-w-full">
                                                            <thead>
                                                                <tr className="bg-zinc-100/30 dark:bg-white/[0.03]">
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.manifestFile')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.currentVersion')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.packageManager')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.dependency')}
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
                                                                            ref={occurrence.id === activeIssueId ? activeRowRef : undefined}
                                                                            to={issueLinkTo(occurrence.id)}
                                                                            className={cn(
                                                                                "hover:bg-zinc-50 dark:hover:bg-white/[0.03] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors duration-[120ms]",
                                                                                occurrence.id === activeIssueId && cn('!bg-zinc-100 dark:!bg-white/[0.06]', AS_ROW_MARKER),
                                                                            )}
                                                                        >
                                                                            <td className={AS_TD}>
                                                                                <span
                                                                                    className="text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                                                                                    style={{
                                                                                        direction: 'rtl',
                                                                                        textOverflow: 'ellipsis',
                                                                                        whiteSpace: 'nowrap',
                                                                                        overflow: 'hidden',
                                                                                        display: 'inline-block',
                                                                                        maxWidth: '300px',
                                                                                    }}
                                                                                >
                                                                                    {occurrence.fileName || occurrence.path}
                                                                                </span>
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                <span className="font-mono text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-as-raised px-2 py-0.5 rounded">
                                                                                    {occurrence.packageVersion}
                                                                                </span>
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                <span className="capitalize">
                                                                                    {group.vulnerability?.packages?.[0]?.ecosystem || '-'}
                                                                                </span>
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                <span className={AS_TAG}>
                                                                                    {!occurrence.isTransitive ? t('components.resultsTable.direct') : t('components.resultsTable.transitive')}
                                                                                </span>
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

export default GroupedResultsScaTable;
