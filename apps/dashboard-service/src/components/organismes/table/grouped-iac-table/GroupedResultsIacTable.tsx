import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { EmptyState } from '@/components/molecules/empty-state/EmptyState';
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import useActiveIssueRow from "@/server/hooks/useActiveIssueRow";
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinkRow } from '@/components/atoms/link';
import { ChevronDown, ChevronRight, FileCode } from '@/components/atoms/icon/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import FilterBar, { FilterConfig, SortConfig, TextFilterConfig } from '@/components/molecules/filter-bar/FilterBar';
import SeverityBreakdownBadges from '@/components/atoms/badge/SeverityBreakdownBadges';
import { SeverityMark } from '@/components/atoms/badge/SeverityCount';
import { Slot } from '@/edition/slots';
import ExploitabilityBadge from '@/components/atoms/badge/ExploitabilityBadge';
import TicketTracker from '@/components/molecules/ticket-tracker/TicketTracker';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';
import { GroupedVulnerability } from '@/server/interfaces/Vulnerability';
import {
    priorityOptions,
    filterStatusOptions,
} from '@/utils/data/historyVulnData';
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
import { AS_FOCUS, AS_TD, AS_TH, AS_TOUCH_SQUARE, AS_ROW_MARKER } from '@/components/atoms/appsec/styles';

const EXPLOITABILITY_I18N_KEY: Record<string, string> = {
    actively_exploited: 'exploitabilityActive',
    proven: 'exploitabilityProven',
    theoretical: 'exploitabilityTheoretical',
    not_exploitable: 'exploitabilityNotExploitable',
    not_evaluated: 'exploitabilityNotEvaluated',
};

interface GroupedResultsIacTableProps {
    projectId: string | undefined;
    groups: GroupedVulnerability[];
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
    selectedExploitability?: string[];
    selectedOrder: string;
    selectedOrderDirection: string;
    onSeverityChange: (value: string[]) => void;
    onStatusChange: (value: string[]) => void;
    onPriorityChange: (value: string[]) => void;
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
    // Language filter (multi-select from facets) + source path filter.
    languageOptions?: { label: string; value: string }[];
    selectedLanguage?: string[];
    onLanguageChange?: (value: string[]) => void;
    sourcePath?: string;
    onSourcePathChange?: (value: string) => void;
    /**
     * Creation date of the latest finished scan of this family
     * (`resolveLastScanAt`), or null. An occurrence whose agent verdict is
     * older gets the amber "analysis from a previous scan" badge.
     */
    lastScanAt?: string | null;
}

export const GroupedResultsIacTable: React.FC<GroupedResultsIacTableProps> = ({
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
    selectedExploitability,
    selectedOrder,
    selectedOrderDirection,
    onSeverityChange,
    onStatusChange,
    onPriorityChange,
    onExploitabilityChange,
    onOrderChange,
    onOrderDirectionChange,
    onSearchQueryChange,
    languageOptions,
    selectedLanguage,
    onLanguageChange,
    sourcePath,
    onSourcePathChange,
    loading,
    triageMode,
    onTriageModeChange,
    onFocusTop5,
    focusTop5Active,
    scanId,
    issueTracking,
    lastScanAt = null,
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
        const key = activeGroup.ruleId;
        setExpandedGroups((prev) =>
            prev.size === 1 && prev.has(key) ? prev : new Set([key]),
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIssueId, groups]);

    const toggleGroup = (groupId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(groupId)) {
                newSet.delete(groupId);
            } else {
                newSet.add(groupId);
            }
            return newSet;
        });
    };

    // Configure filters for FilterBar
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
        ...(languageOptions && onLanguageChange
            ? [{
                id: 'language',
                label: t('components.resultsTable.language'),
                options: languageOptions,
                value: selectedLanguage ?? [],
                onChange: onLanguageChange,
                minChecked: 0,
            }]
            : []),
    ];

    const textFilters: TextFilterConfig[] | undefined = onSourcePathChange
        ? [
            {
                id: 'sourcePath',
                label: t('components.resultsTable.sourcePath'),
                placeholder: t('components.resultsTable.sourcePathPlaceholder'),
                value: sourcePath ?? '',
                onChange: onSourcePathChange,
            },
        ]
        : undefined;

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
                    textFilters={textFilters}
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
                                const isExpanded = expandedGroups.has(group.ruleId);
                                const worstVerdict = getWorstExploitabilityVerdict(
                                    group.occurrences,
                                );

                                return (
                                    <div key={group.ruleId} className="bg-white dark:bg-as-surface">
                                        {/* Group Header */}
                                        <div
                                            onClick={(e) => toggleGroup(group.ruleId, e)}
                                            className={cn(
                                                'flex items-center justify-between px-4 sm:px-5 py-3 cursor-pointer transition-colors duration-[120ms] max-md:flex-wrap max-md:gap-y-2',
                                                'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                                            )}
                                        >
                                            <div className="flex items-center gap-4 flex-1 min-w-0 max-md:basis-full max-md:gap-3">
                                                {/* Expand Icon */}
                                                <button
                                                    className={`relative flex-shrink-0 rounded-md text-zinc-400 transition-colors duration-[120ms] hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 ${AS_FOCUS} ${AS_TOUCH_SQUARE}`}
                                                    onClick={(e) => toggleGroup(group.ruleId, e)}
                                                >
                                                    {isExpanded ? (
                                                        <ChevronDown className="w-4 h-4" />
                                                    ) : (
                                                        <ChevronRight className="w-4 h-4" />
                                                    )}
                                                </button>

                                                {/* Severity Badge */}
                                                <SeverityMark severity={getSeverityVariant(group.highestSeverity)} label={getSeverityLabel(group.highestSeverity)} title={t(`common.severity.${getSeverityVariant(group.highestSeverity)}`)} />

                                                {/* Title */}
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate max-md:whitespace-normal max-md:line-clamp-2">
                                                        {group.vulnerability?.name || 'Unknown Vulnerability'}
                                                    </h3>
                                                    {group.vulnerability?.cwe && group.vulnerability.cwe.length > 0 && (
                                                        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                            {group.vulnerability.cwe.slice(0, 3).join(', ')}
                                                            {group.vulnerability.cwe.length > 3 && ` +${group.vulnerability.cwe.length - 3}`}
                                                        </p>
                                                    )}
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
                                            <div className="flex items-center gap-4 flex-shrink-0 max-md:w-full max-md:flex-wrap max-md:gap-2 max-md:pl-7">
                                                {/* The group's AutoFix mark is a `finding.actions`
                                                    registration of the active edition. */}
                                                <Slot
                                                    name="finding.actions"
                                                    context={{ projectId, vulnerability: group, vulnerabilityType: 'iac', host: 'results-group' }}
                                                />

                                                {/* Severity Breakdown */}
                                                <SeverityBreakdownBadges breakdown={group.severityBreakdown} appearance="dot" />

                                                {/* Jira and Linear tickets of the group */}
                                                {issueTracking?.anyConfigured && (
                                                    <span onClick={(e) => e.stopPropagation()} className="relative">
                                                        <TicketTracker
                                                            tracking={issueTracking}
                                                            projectId={projectId || ''}
                                                            groupName={group.vulnerability?.name || group.ruleId}
                                                            occurrenceIds={(group.occurrences || []).map((occ) => occ.id)}
                                                            vulnerabilities={(group.occurrences || []).map((occ) => ({
                                                                vulnerabilityId: occ.id,
                                                                scannerType: 'iac',
                                                                severity: occ.currentSeverity || group.highestSeverity,
                                                                name: group.vulnerability?.name || group.ruleId,
                                                                shortDescription: group.vulnerability?.shortDescription,
                                                                filePath: occ.path,
                                                                startLine: occ.vulnerableStartLine,
                                                                branch: (occ as any).branch,
                                                            }))}
                                                        />
                                                    </span>
                                                )}

                                                {/* Occurrences count */}
                                                <div className="flex items-center gap-2 text-[13px] text-zinc-500 dark:text-zinc-400">
                                                    <FileCode className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
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
                                                        <table className="min-w-full">
                                                            <thead>
                                                                <tr className="bg-zinc-100/30 dark:bg-white/[0.03]">
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.source')}
                                                                    </th>
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.line')}
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
                                                                    <th className={AS_TH}>
                                                                        {t('components.resultsTable.priority')}
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
                                                                                <div className="flex items-center gap-2">
                                                                                    <span
                                                                                        className="text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                                                                                        style={{
                                                                                            direction: 'rtl',
                                                                                            textOverflow: 'ellipsis',
                                                                                            whiteSpace: 'nowrap',
                                                                                            overflow: 'hidden',
                                                                                            display: 'inline-block',
                                                                                            maxWidth: '350px',
                                                                                        }}
                                                                                    >
                                                                                        {occurrence.path}
                                                                                    </span>
                                                                                    <Slot
                                                                                        name="finding.actions"
                                                                                        context={{ projectId, vulnerability: occurrence, vulnerabilityType: 'iac', host: 'results-row', lastScanAt }}
                                                                                    />
                                                                                </div>
                                                                            </td>
                                                                            <td className={AS_TD}>
                                                                                {occurrence.vulnerableStartLine === occurrence.vulnerableEndLine
                                                                                    ? occurrence.vulnerableStartLine
                                                                                    : `${occurrence.vulnerableStartLine} - ${occurrence.vulnerableEndLine}`}
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
                                                                            <td className={cn(AS_TD, 'capitalize')}>
                                                                                {occurrence.currentPriority?.replace('_', ' ') || '-'}
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

export default GroupedResultsIacTable;
