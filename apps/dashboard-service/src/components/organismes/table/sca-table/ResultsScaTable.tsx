import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import useActiveIssueRow from "@/server/hooks/useActiveIssueRow";
import React from "react";
import { CheckCircle, XCircle } from '@/components/atoms/icon/icons';
import { LinkRow } from "@/components/atoms/link";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import NotFoundElement from "../../../../components/molecules/not-found-element/NotFoundElement";
import { EmptyState } from "@/components/molecules/empty-state/EmptyState";
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import Pagination from "../../../../components/molecules/pagination/Pagination";
import FilterBar, { FilterConfig, SortConfig } from "@/components/molecules/filter-bar/FilterBar";
import { Slot } from '@/edition/slots';
import PackageTypeBadge from "../../../../components/atoms/badge/PackageTypeBadge";
import ReachabilityBadge from "@/components/atoms/badge/ReachabilityBadge";
import VulnerabilityAgeBadge from "../../../../components/atoms/badge/VulnerabilityAgeBadge";
import ExploitabilityBadge from "../../../../components/atoms/badge/ExploitabilityBadge";
import ScoringSourceBadge from "../../../../components/atoms/badge/ScoringSourceBadge";
import CvssScoreCell from "../../../../components/atoms/cell/CvssScoreCell";
import ColumnSettingsPopover from "../../../../components/molecules/column-settings/ColumnSettingsPopover";
import { pickCvssForTable } from "../../../../utils/data/resultsVulnData";
import TicketTracker from "@/components/molecules/ticket-tracker/TicketTracker";
import type { IssueTracking } from "@/server/hooks/useIssueTracking";
import { ScaVulnerabilityResult } from "../../../../server/interfaces/Vulnerability";
import type { ResultColumn } from "@/server/hooks/useResultColumns";
import { ScanInfo } from "../../../../server/interfaces/Scan";
import {
  priorityOptions,
  filterStatusOptions,
} from "../../../../utils/data/historyVulnData";
import {
  exploitabilityOptions,
  orderDirectionOptions,
  orderOptions,
  severityOptions,
} from "../../../../utils/data/resultsVulnData";
import {
  cn,
  convertDate,
  getSeverityVariant,
  getSeverityLabel,
} from "../../../../utils/function/utils";
import { isPast } from "date-fns";
import { useTranslation } from "react-i18next";
import { AS_TD, AS_TH, AS_ROW_MARKER, AS_ROW_SELECTED } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

/** A SARIF import carries no dependency analysis: the reachability badge is not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

// Map exploitability option values to their i18n label keys under
// components.resultsTable. The "not_evaluated" sentinel is frontend-only
// and used to represent detections without a verdict yet.
const EXPLOITABILITY_I18N_KEY: Record<string, string> = {
  actively_exploited: 'exploitabilityActive',
  proven: 'exploitabilityProven',
  theoretical: 'exploitabilityTheoretical',
  not_exploitable: 'exploitabilityNotExploitable',
  not_evaluated: 'exploitabilityNotEvaluated',
};

interface ResultsScaTableProps {
  projectId: string | undefined;
  issues: ScaVulnerabilityResult[];
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
  selectedPackageTypeVuln: string[];
  selectedExploitability?: string[];
  selectedOrder: string;
  selectedOrderDirection: string;
  onSeverityChange: (value: string[]) => void;
  onStatusChange: (value: string[]) => void;
  onPriorityChange: (value: string[]) => void;
  onPackageTypeVulnChange: (value: string[]) => void;
  onExploitabilityChange?: (value: string[]) => void;
  onOrderChange: (value: string) => void;
  onOrderDirectionChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  /** Triage mode toggle state. Parent owns it. */
  triageMode?: boolean;
  onTriageModeChange?: (value: boolean) => void;
  /** Opens the Focus Top 5 overlay, managed by the parent page. */
  onFocusTop5?: () => void;
  focusTop5Active?: boolean;
  loading: boolean;
  includeDevAndTest: boolean;
  scanInfo?: ScanInfo | null;
  // Jira and Linear tickets of the project
  issueTracking?: IssueTracking;
  // Selection props for batch update
  selectedVulnerabilities?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  /** The columns the active edition adds after CVSS (`useResultColumns`), each shown or hidden by the column settings. */
  extraColumns?: ResultColumn[];
  /** The badges the active edition adds beside a row's severity, in every view. */
  rowBadges?: React.ComponentType<{ vulnerability: unknown; layout?: 'row' | 'group' }>[];
  // Package manager (ecosystem) and package source (manifest file) filters.
  selectedPackageManager?: string[];
  onPackageManagerChange?: (value: string[]) => void;
  selectedPackageSource?: string[];
  onPackageSourceChange?: (value: string[]) => void;
  packageManagerOptions?: string[];
  packageSourceOptions?: string[];
  // True when the table renders a view whose rows have no CVSS (the
  // cloud's Malware sub-tab, where every row is a malicious package): the CVSS
  // column (always "—") is dropped and the CVE column is labelled "Advisory".
  noCvssView?: boolean;
}

const NO_EXTRA_COLUMNS: ResultColumn[] = [];
const NO_ROW_BADGES: React.ComponentType<{ vulnerability: unknown; layout?: 'row' | 'group' }>[] = [];

export const ResultsScaTable: React.FC<ResultsScaTableProps> = ({
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
  selectedPackageTypeVuln,
  selectedExploitability,
  selectedOrder,
  selectedOrderDirection,
  onSeverityChange,
  onStatusChange,
  onPriorityChange,
  onPackageTypeVulnChange,
  onExploitabilityChange,
  onOrderChange,
  onOrderDirectionChange,
  onSearchQueryChange,
  triageMode,
  onTriageModeChange,
  onFocusTop5,
  focusTop5Active,
  loading,
  includeDevAndTest,
  scanInfo,
  issueTracking,
  selectedVulnerabilities,
  onSelectionChange,
  onSelectAll,
  onDeselectAll,
  extraColumns = NO_EXTRA_COLUMNS,
  rowBadges = NO_ROW_BADGES,
  selectedPackageManager,
  onPackageManagerChange,
  selectedPackageSource,
  onPackageSourceChange,
  packageManagerOptions,
  packageSourceOptions,
  noCvssView = false,
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

  const statusOptionsWithResolved = [
    ...filterStatusOptions
  ];

  const extendedOrderOptions = [
    ...orderOptions,
    { label: "CVSS Score", value: "currentCVSS" },
  ];

  const allPackageTypeVulnOptions = [
    { label: t('scaDependencies.direct'), value: "direct" },
    { label: t('scaDependencies.dev'), value: "dev" },
    { label: t('scaDependencies.transitive'), value: "transitive" },
  ];

  // All options when enabled, empty when disabled (since select is hidden)
  const packageTypeVulnOptions = includeDevAndTest ? allPackageTypeVulnOptions : [];

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
    ...(includeDevAndTest ? [{
      id: 'packageType',
      label: t('components.resultsScaTable.packageType'),
      options: packageTypeVulnOptions,
      value: selectedPackageTypeVuln,
      onChange: onPackageTypeVulnChange,
    }] : []),
    // Package manager (ecosystem) filter. Only shown when the parent passes state.
    ...(selectedPackageManager && onPackageManagerChange
      ? [{
          id: 'packageManager',
          label: t('components.resultsScaTable.packageManager'),
          options: (packageManagerOptions ?? []).map((v) => ({ label: v, value: v })),
          value: selectedPackageManager,
          onChange: onPackageManagerChange,
        }]
      : []),
    // Package source (manifest file) filter. Only shown when the parent passes state.
    ...(selectedPackageSource && onPackageSourceChange
      ? [{
          id: 'packageSource',
          label: t('components.resultsScaTable.packageSource'),
          options: (packageSourceOptions ?? []).map((v) => ({ label: v, value: v })),
          value: selectedPackageSource,
          onChange: onPackageSourceChange,
        }]
      : []),
    // Exploitability verdict filter. Only shown when the parent
    // page opted in (it owns the state + localStorage persistence).
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

  const columnSettingsItems = extraColumns.map((column) => ({
    id: column.id,
    label: column.label,
    checked: column.visible,
    onToggle: column.setVisible,
  }));
  const visibleExtraColumns = extraColumns.filter((column) => column.visible);

  const showToolbar =
    !!onTriageModeChange ||
    !!onFocusTop5 ||
    columnSettingsItems.length > 0;

  return (
    <div className="min-h-[calc(100vh-320px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <FilterBar
          filters={filters}
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
                    {/* CVSS is always "—" for malware — drop the column. */}
                    {!noCvssView && (
                      <th className={AS_TH}>
                        {t('components.resultsScaTable.cvss')}
                      </th>
                    )}
                    {visibleExtraColumns.map((column) => (
                      <th key={column.id} className={AS_TH}>
                        {column.label}
                      </th>
                    ))}
                    <th className={AS_TH}>
                      {/* Malware advisories have no CVE — label the column "Advisory". */}
                      {noCvssView
                        ? t('components.resultsScaTable.advisory')
                        : t('components.resultsScaTable.cve')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.resultsScaTable.packageSource')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.resultsScaTable.fixAvailable')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.resultsScaTable.firstDetected')}
                    </th>
                    {issueTracking?.anyConfigured && (
                      <th className={AS_TH}>{t('components.resultsTable.tickets')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                  {issues && issues.length > 0 ? (
                    issues.map((issue) => {
                      if (!issue.vulnerability) return null;
                      const packagesArr = issue.vulnerability.packages || [];
                      const isFixAvailable = packagesArr.some(
                        (p) => p.fixAvailable === true
                      );
                      const isSelected = selectedVulnerabilities?.has(issue.id) || false;
                      const cvss = pickCvssForTable({
                        cvss4BaseScore: issue.cvss4BaseScore,
                        cvss4EnvironmentalScore: issue.cvss4EnvironmentalScore,
                        legacyScore: issue.cvssScore,
                        legacyLabel: 'legacy',
                      });

                      return (
                        <LinkRow
                          key={issue.id}
                          ref={issue.id === activeIssueId ? activeRowRef : undefined}
                          to={issueLinkTo(issue.id)}
                          className={cn(
                            "hover:bg-zinc-50 dark:hover:bg-white/[0.03] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors duration-[120ms]",
                            issue.id === activeIssueId && cn('!bg-zinc-100 dark:!bg-white/[0.06]', AS_ROW_MARKER),
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
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                return (
                                  <SeverityChip level={getSeverityVariant(issue.currentSeverity)} title={t(`common.severity.${getSeverityVariant(issue.currentSeverity)}`)}>{getSeverityLabel(issue.currentSeverity)}</SeverityChip>
                                );
                              })()}
                              {/* The badges the active edition adds (the cloud's red Malware badge). */}
                              {rowBadges.map((RowBadge, index) => (
                                <RowBadge key={index} vulnerability={issue} layout="row" />
                              ))}
                            </div>
                          </td>
                          {!noCvssView && (
                            <td className={cn(AS_TD, 'whitespace-nowrap')}>
                              <CvssScoreCell score={cvss.score} />
                            </td>
                          )}
                          {visibleExtraColumns.map(({ id, Cell }) => (
                            <td key={id} className={cn(AS_TD, 'whitespace-nowrap')}>
                              <Cell vulnerability={issue} />
                            </td>
                          ))}
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <div className="flex flex-col gap-1">
                              {/* Malware has no CVE — show the advisory
                                  id (MAL-*), carried on the vulnerability metadata
                                  id, instead of "N/A". */}
                              <span>
                                {issue.isMalware
                                  ? issue.vulnerability.id ||
                                    issue.vulnerability.cve ||
                                    t('components.resultsScaTable.notAvailable')
                                  : issue.vulnerability.cve ||
                                    t('components.resultsScaTable.notAvailable')}
                              </span>
                              <div className="flex items-center gap-1">
                                <ExploitabilityBadge
                                  verdict={issue.exploitabilityVerdict}
                                  size="sm"
                                  iconOnly
                                  tooltipPlacement="right"
                                />
                                <ScoringSourceBadge
                                  scoringSource={issue.scoringSource}
                                  cvssVersion={cvss.version}
                                  iconOnly
                                  tooltipPlacement="right"
                                />
                                {/* The row's AutoFix control is a `finding.actions`
                                    registration of the active edition. */}
                                <Slot
                                  name="finding.actions"
                                  context={{ projectId, vulnerability: issue, vulnerabilityType: 'sca', host: 'results-row-scored' }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate max-md:whitespace-normal max-md:line-clamp-2" title={issue.package?.packageName}>
                                {issue.package ? issue.package.packageName : t('components.resultsScaTable.notAvailable')}
                              </span>
                              {issue.package && (
                                <PackageTypeBadge
                                  library={issue.package}
                                  compact={true}
                                  iconOnly
                                  tooltipPlacement="right"
                                />
                              )}
                              {!SCANNER_ONLY_HIDDEN && <ReachabilityBadge reachability={issue.package?.reachability} />}
                            </div>
                            <div className="text-xs text-zinc-500 truncate dark:text-zinc-400" title={issue.package ? issue.package.fileName : ''}>
                              {issue.package ? issue.package.fileName : ''}
                            </div>
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            {isFixAvailable ? (
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
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <div className="flex items-center gap-2">
                              <span>{convertDate(issue.createdAt)}</span>
                              <VulnerabilityAgeBadge
                                vulnerabilityCreatedAt={issue.createdAt}
                                lastScanDate={scanInfo?.createAt}
                              />
                            </div>
                          </td>
                          {issueTracking?.anyConfigured && (
                            <td className={cn(AS_TD, 'whitespace-nowrap')}>
                              <span onClick={(e) => e.stopPropagation()} className="relative">
                                <TicketTracker
                                  tracking={issueTracking}
                                  projectId={projectId || ''}
                                  groupName={issue.vulnerability?.cve || issue.vulnerability?.name || ''}
                                  occurrenceIds={[issue.id]}
                                  vulnerabilities={[{
                                    vulnerabilityId: issue.id,
                                    scannerType: 'sca',
                                    severity: issue.currentSeverity,
                                    name: issue.vulnerability?.cve || issue.vulnerability?.name || '',
                                    packageName: issue.package?.packageName,
                                    packageVersion: issue.package?.version,
                                    externalId: issue.vulnerability?.cve,
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
                        <td colSpan={(selectionEnabled ? 7 : 6) - (noCvssView ? 1 : 0) + visibleExtraColumns.length + (issueTracking?.anyConfigured ? 1 : 0)}>
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
