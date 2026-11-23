import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip, { priorityChipLevel } from '@/components/atoms/badge/SeverityChip';
import { EmptyState } from '@/components/molecules/empty-state/EmptyState';
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import useActiveIssueRow from "@/server/hooks/useActiveIssueRow";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import React from "react";
import { LinkRow } from "@/components/atoms/link";

import NotFoundElement from "../../../../components/molecules/not-found-element/NotFoundElement";
import Pagination from "../../../../components/molecules/pagination/Pagination";
import FilterBar, { FilterConfig, SortConfig, TextFilterConfig } from "@/components/molecules/filter-bar/FilterBar";
import VulnerabilityAgeBadge from "../../../../components/atoms/badge/VulnerabilityAgeBadge";
import { Slot } from '@/edition/slots';
import TicketTracker from "@/components/molecules/ticket-tracker/TicketTracker";
import type { IssueTracking } from "@/server/hooks/useIssueTracking";
import { SecretVulnerabilityResult } from "../../../../server/interfaces/Vulnerability";
import { ScanInfo } from "../../../../server/interfaces/Scan";
import {
    priorityOptions,
    filterStatusOptions,
} from "../../../../utils/data/historyVulnData";
import {
    orderDirectionOptions,
    orderOptions,
    severityOptions,
} from "../../../../utils/data/resultsVulnData";
import {
    cn,
    convertDate,
    getPriorityLabel,
    getSeverityVariant,
    getSeverityLabel,
    getStatusLabel,
} from "../../../../utils/function/utils";
import { useTranslation } from "react-i18next";
import { CodeBranch, Key } from '@/components/atoms/icon/icons';
import { AS_TAG, AS_TD, AS_TH, AS_ROW_MARKER, AS_ROW_SELECTED } from '@/components/atoms/appsec/styles';

interface ResultsSecretTableProps {
    projectId: string | undefined;
    issues: SecretVulnerabilityResult[];
    totalIssues: number;
    currentPage: number;
    totalPages: number;
    pageSize: number;
    pageSizeOptions: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    selectedSeverity: string[];
    selectedStatus: string[];
    selectedPriority: string[];
    selectedOrder: string;
    selectedOrderDirection: string;
    onSeverityChange: (value: string[]) => void;
    onStatusChange: (value: string[]) => void;
    onPriorityChange: (value: string[]) => void;
    onOrderChange: (value: string) => void;
    onOrderDirectionChange: (value: string) => void;
    onSearchQueryChange: (value: string) => void;
    loading: boolean;
    scanInfo?: ScanInfo | null;
    triageMode?: boolean;
    onTriageModeChange?: (value: boolean) => void;
    onFocusTop5?: () => void;
    focusTop5Active?: boolean;
    // Jira and Linear tickets of the project
    issueTracking?: IssueTracking;
    // Agent UI indicators (static, no animation)
    agentActiveIds?: string[];
    agentProcessedIds?: string[];
    // Selection props for batch update
    selectedVulnerabilities?: Set<string>;
    onSelectionChange?: (id: string) => void;
    onSelectAll?: () => void;
    onDeselectAll?: () => void;
    // Source filter (head / history)
    selectedSource?: string[];
    onSourceChange?: (value: string[]) => void;
    // Commit SHA text filter
    commitShaFilter?: string;
    onCommitShaFilterChange?: (value: string) => void;
    // Language filter (multi-select from facets) + source path filter.
    languageOptions?: { label: string; value: string }[];
    selectedLanguage?: string[];
    onLanguageChange?: (value: string[]) => void;
    sourcePath?: string;
    onSourcePathChange?: (value: string) => void;
}

export const ResultsSecretTable: React.FC<ResultsSecretTableProps> = ({
    projectId,
    issues,
    totalIssues,
    currentPage,
    totalPages,
    pageSize,
    pageSizeOptions,
    onPageChange,
    onPageSizeChange,
    selectedSeverity,
    selectedStatus,
    selectedPriority,
    selectedOrder,
    selectedOrderDirection,
    onSeverityChange,
    onStatusChange,
    onPriorityChange,
    onOrderChange,
    onOrderDirectionChange,
    onSearchQueryChange,
    loading,
    scanInfo,
    triageMode,
    onTriageModeChange,
    onFocusTop5,
    focusTop5Active,
    issueTracking,
    agentActiveIds,
    agentProcessedIds,
    selectedVulnerabilities,
    onSelectionChange,
    onSelectAll,
    onDeselectAll,
    selectedSource,
    onSourceChange,
    commitShaFilter,
    onCommitShaFilterChange,
    languageOptions,
    selectedLanguage,
    onLanguageChange,
    sourcePath,
    onSourcePathChange,
}) => {
  const { issueLinkTo } = useIssueQuickView();
  const { activeIssueId, activeRowRef } = useActiveIssueRow();
    const { t } = useTranslation();

    // Check if selection mode is enabled
    const selectionEnabled = !!onSelectionChange;

    // Check if all current page items are selected
    const allPageSelected = selectionEnabled && issues.length > 0 && 
        issues.every(issue => selectedVulnerabilities?.has(issue.id));

    // Handle header checkbox click
    const handleHeaderCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (allPageSelected) {
            onDeselectAll?.();
        } else {
            onSelectAll?.();
        }
    };

    // Handle row checkbox click
    const handleRowCheckboxClick = (e: React.MouseEvent, issueId: string) => {
        e.stopPropagation();
        onSelectionChange?.(issueId);
    };

    // Determine agent state for each issue (static indicators only)
    const getAgentState = (issueId: string) => {
        const isActive = agentActiveIds?.includes(issueId) || false;
        const isProcessed = agentProcessedIds?.includes(issueId) || false;
        return { isActive, isProcessed };
    };

    const statusOptionsWithResolved = [
        ...filterStatusOptions
    ];

    const sourceOptions = [
        { value: 'head', label: t('components.scanningSettings.typesOfAnalyzes.source.code') },
        { value: 'history', label: t('components.scanningSettings.typesOfAnalyzes.source.history') },
    ];

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
            options: statusOptionsWithResolved,
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
        ...(onSourceChange
            ? [
                {
                    id: 'source',
                    label: t('components.scanningSettings.typesOfAnalyzes.source.label'),
                    options: sourceOptions,
                    value: selectedSource ?? sourceOptions.map((o) => o.value),
                    onChange: onSourceChange,
                },
            ]
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
                <FilterBar
                    filters={filters}
                    textFilters={textFilters}
                    sort={sort}
                    onSearchChange={onSearchQueryChange}
                    searchPlaceholder={t('components.resultsTable.searchPlaceholder')}
                />

                <div className="flex-1 flex flex-col overflow-auto custom-scrollbar bg-white dark:bg-as-surface">
                    {loading ? (
                        <div className="p-4">
                            <Skeleton type="table" rows={10} columns={1} />
                        </div>
                    ) : (
                        <>
                            <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line">
                                <thead className="bg-zinc-50/70 dark:bg-white/[0.02]">
                                    <tr>
                                        {selectionEnabled && (
                                            <th className={cn(AS_TH, 'w-10')}>
                                                <input
                                                    type="checkbox"
                                                    checked={allPageSelected}
                                                    onChange={() => {}}
                                                    onClick={handleHeaderCheckboxClick}
                                                    className={cn(
                                                        "h-4 w-4 rounded border-zinc-300 dark:border-as-line-strong",
                                                        "text-secondary focus:ring-secondary focus:ring-offset-0",
                                                        "cursor-pointer"
                                                    )}
                                                    title={allPageSelected ? t('common.deselectAll') : t('common.selectAll')}
                                                />
                                            </th>
                                        )}
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.severity')}
                                        </th>
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.details')}
                                        </th>
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.language')}
                                        </th>
                                        <th className={cn(AS_TH, 'text-center')}>
                                            {t('components.resultsTable.source')}
                                        </th>
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.status')}
                                        </th>
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.priority')}
                                        </th>
                                        <th className={AS_TH}>
                                            {t('components.resultsTable.firstDetection')}
                                        </th>
                                        {issueTracking?.anyConfigured && (
                                            <th className={AS_TH}>{t('components.resultsTable.tickets')}</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                                    {issues && issues.length > 0 ? (
                                        issues.map((issue) => {
                                            const agentState = getAgentState(issue.id);
                                            const isSelected = selectedVulnerabilities?.has(issue.id) || false;
                                            return (
                                                <LinkRow
                                                    key={issue.id}
                                                    ref={issue.id === activeIssueId ? activeRowRef : undefined}
                                                    to={issueLinkTo(issue.id)}
                                                    className={cn(
                                                        "hover:bg-zinc-50 dark:hover:bg-white/[0.03] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors duration-[120ms]",
                                                        issue.id === activeIssueId && cn('!bg-zinc-100 dark:!bg-white/[0.06]', AS_ROW_MARKER),
                                                        agentState.isActive && "bg-blue-50 dark:bg-blue-900/20",
                                                        isSelected && AS_ROW_SELECTED
                                                    )}
                                                >
                                                    {selectionEnabled && (
                                                        <td className={cn(AS_TD, 'w-10')} onClick={(e) => handleRowCheckboxClick(e, issue.id)}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => {}}
                                                                className={cn(
                                                                    "h-4 w-4 rounded border-zinc-300 dark:border-as-line-strong",
                                                                    "text-secondary focus:ring-secondary focus:ring-offset-0",
                                                                    "cursor-pointer"
                                                                )}
                                                            />
                                                        </td>
                                                    )}
                                                    <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                        {(() => {
                                                            return (
                                                                <SeverityChip level={getSeverityVariant(issue.currentSeverity)} title={t(`common.severity.${getSeverityVariant(issue.currentSeverity)}`)}>{getSeverityLabel(issue.currentSeverity)}</SeverityChip>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className={cn(AS_TD, 'whitespace-normal w-[350px] max-w-[350px] break-words')}>
                                                        <span className="truncate block max-md:whitespace-normal max-md:line-clamp-2" title={issue.vulnerability.name}>
                                                            {issue.vulnerability.name}
                                                        </span>
                                                        {/* The row's AutoFix control is a `finding.actions`
                                                            registration of the active edition. */}
                                                        <Slot
                                                          name="finding.actions"
                                                          context={{ projectId, vulnerability: issue, vulnerabilityType: 'secret', host: 'results-row-block' }}
                                                        />
                                                    </td>
                                                    <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                        {issue.language}
                                                    </td>
                                                    <td className={cn(AS_TD, 'max-w-[300px] truncate text-center')}>
                                                        <span
                                                            className="font-mono text-xs text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100"
                                                            style={{
                                                                direction: "rtl",
                                                                textOverflow: "ellipsis",
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                display: "inline-block",
                                                                maxWidth: "100%",
                                                            }}
                                                        >
                                                            {issue.path}
                                                        </span>
                                                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                                            {issue.vulnerableStartLine ===
                                                                issue.vulnerableEndLine
                                                                ? t('components.resultsTable.line')
                                                                : t('components.resultsTable.lines')}
                                                            <span className="font-medium ml-1">
                                                                {issue.vulnerableStartLine ===
                                                                    issue.vulnerableEndLine
                                                                    ? `${issue.vulnerableStartLine}`
                                                                    : `${issue.vulnerableStartLine} - ${issue.vulnerableEndLine}`}
                                                            </span>
                                                        </span>
                                                        {issue.source === 'history' ? (
                                                            <span className={`${AS_TAG} mt-1`}>
                                                                <CodeBranch className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
                                                                {t('components.scanningSettings.typesOfAnalyzes.source.history')}
                                                            </span>
                                                        ) : (
                                                            <span className={`${AS_TAG} mt-1`}>
                                                                <Key className="w-3 h-3 text-zinc-400 dark:text-zinc-500" />
                                                                {t('components.scanningSettings.typesOfAnalyzes.source.code')}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                        {getStatusLabel(issue.currentState)}
                                                    </td>
                                                    <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                        <SeverityChip level={priorityChipLevel(issue.currentPriority)}>{getPriorityLabel(issue.currentPriority)}</SeverityChip>
                                                    </td>
                                                    <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                        <div className="flex items-center gap-2">
                                                            {convertDate(issue.createdAt)}
                                                            {scanInfo && (
                                                                <VulnerabilityAgeBadge
                                                                    vulnerabilityCreatedAt={issue.createdAt}
                                                                    lastScanDate={scanInfo.createAt}
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                    {issueTracking?.anyConfigured && (
                                                        <td className={cn(AS_TD, 'whitespace-nowrap')}>
                                                            <span onClick={(e) => e.stopPropagation()} className="relative">
                                                                <TicketTracker
                                                                    tracking={issueTracking}
                                                                    projectId={projectId || ''}
                                                                    groupName={issue.vulnerability.name}
                                                                    occurrenceIds={[issue.id]}
                                                                    vulnerabilities={[{
                                                                        vulnerabilityId: issue.id,
                                                                        scannerType: 'secret',
                                                                        severity: issue.currentSeverity,
                                                                        name: issue.vulnerability.name,
                                                                        filePath: issue.path,
                                                                        startLine: issue.vulnerableStartLine,
                                                                    }]}
                                                                />
                                                            </span>
                                                        </td>
                                                    )}
                                                </LinkRow>
                                            );
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={(selectionEnabled ? 8 : 7) + (issueTracking?.anyConfigured ? 1 : 0)}>
                                                <EmptyState
                            cybeMessage
                            title={t(EMPTY_STATE_COPY.noVuln)}
                            className="my-4"
                          />
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>

                {!loading && (
                    <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:justify-between md:items-center border-t border-zinc-200 dark:border-as-line bg-white dark:bg-as-surface">
                        <div className="flex-grow flex justify-center">
                            <Pagination
                                currentPage={currentPage}
                                totalPages={totalPages}
                                totalItems={totalIssues}
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
