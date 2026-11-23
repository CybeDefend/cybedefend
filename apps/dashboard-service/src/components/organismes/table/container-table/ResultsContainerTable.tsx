import useIssueQuickView from "@/server/hooks/useIssueQuickView";
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { EmptyState } from '@/components/molecules/empty-state/EmptyState';
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import useActiveIssueRow from "@/server/hooks/useActiveIssueRow";

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LinkRow } from '@/components/atoms/link';
import { ContainerVulnerabilityResult, CVSSInfo } from '@/server/interfaces/Vulnerability';
import { ScanInfo } from '@/server/interfaces/Scan';
import { getSeverityVariant, getSeverityLabel, convertDate, cn } from '@/utils/function/utils';
import TicketTracker from '@/components/molecules/ticket-tracker/TicketTracker';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import FilterBar, { FilterConfig, SortConfig } from '@/components/molecules/filter-bar/FilterBar';
import {
  severityOptions,
  orderDirectionOptions,
  orderOptions as defaultOrderOptions,
  exploitabilityOptions,
} from '@/utils/data/resultsVulnData';
import { filterStatusOptions as defaultStatusOptions, priorityOptions } from '@/utils/data/historyVulnData';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import Pagination from '@/components/molecules/pagination/Pagination';
import VulnerabilityAgeBadge from '@/components/atoms/badge/VulnerabilityAgeBadge';
import ExploitabilityBadge from '@/components/atoms/badge/ExploitabilityBadge';
import ScoringSourceBadge from '@/components/atoms/badge/ScoringSourceBadge';
import DetectionSourceBadge from '@/components/atoms/badge/DetectionSourceBadge';
import CvssScoreCell from '@/components/atoms/cell/CvssScoreCell';
import { pickCvssForTable } from '@/utils/data/resultsVulnData';
import { AS_TAG, AS_TD, AS_TH, AS_ROW_MARKER, AS_ROW_SELECTED } from '@/components/atoms/appsec/styles';

const EXPLOITABILITY_I18N_KEY: Record<string, string> = {
  actively_exploited: 'exploitabilityActive',
  proven: 'exploitabilityProven',
  theoretical: 'exploitabilityTheoretical',
  not_exploitable: 'exploitabilityNotExploitable',
  not_evaluated: 'exploitabilityNotEvaluated',
};

/**
 * @interface ResultsContainerTableProps
 * @description Props for the ResultsContainerTable component.
 */
interface ResultsContainerTableProps {
  projectId: string;
  issues: ContainerVulnerabilityResult[];
  totalIssues: number;
  loading: boolean;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  selectedSeverity: string[];
  selectedStatus: string[];
  selectedPriority: string[];
  selectedClassType: string[];
  selectedExploitability?: string[];
  selectedOrder: string;
  selectedOrderDirection: string;
  scanInfo: ScanInfo | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSeverityChange: (value: string[]) => void;
  onStatusChange: (value: string[]) => void;
  onPriorityChange: (value: string[]) => void;
  onClassTypeChange: (value: string[]) => void;
  onExploitabilityChange?: (value: string[]) => void;
  onOrderChange: (value: string) => void;
  onOrderDirectionChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  triageMode?: boolean;
  onTriageModeChange?: (value: boolean) => void;
  onFocusTop5?: () => void;
  focusTop5Active?: boolean;
  // Jira and Linear tickets of the project
  issueTracking?: IssueTracking;
  // Selection props for batch update
  selectedVulnerabilities?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  // Scoring source filter (all / fixed / AI).
}

/**
 * A table component to display container security issues, styled to match the SCA table.
 * @param {ResultsContainerTableProps} props - The component props.
 * @returns {React.ReactElement} The rendered component.
 */
export const ResultsContainerTable: React.FC<ResultsContainerTableProps> = (props) => {
  const { issueLinkTo } = useIssueQuickView();
  const { activeIssueId, activeRowRef } = useActiveIssueRow();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Destructure selection props
  const {
    selectedVulnerabilities,
    onSelectionChange,
    onSelectAll,
    onDeselectAll,
  } = props;

  // Check if selection mode is enabled
  const selectionEnabled = !!onSelectionChange;

  // Check if all current page items are selected
  const allPageSelected = selectionEnabled && props.issues.length > 0 &&
    props.issues.every(issue => selectedVulnerabilities?.has(issue.id));

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

  const handleRowClick = (issueId: string) => {
    navigate(issueLinkTo(issueId));
  };

  /**
   * Gets the best available CVSS score (preferring v3 over v2).
   * @param {object} cvss - The CVSS object from the vulnerability data.
   * @returns {number} The highest CVSS score found, or 0 if none.
   */
  const getBestCvssScore = (cvss: { [key: string]: CVSSInfo } | undefined): number => {
    if (!cvss) return 0;
    const sources = Object.values(cvss);
    const v3Scores = sources.map(s => s.v3Score).filter((s): s is number => s != null && s > 0);
    if (v3Scores.length > 0) return Math.max(...v3Scores);
    const v2Scores = sources.map(s => s.v2Score).filter((s): s is number => s != null && s > 0);
    if (v2Scores.length > 0) return Math.max(...v2Scores);
    return 0;
  };

  const statusOptions = [...defaultStatusOptions];

  const classTypeOptions = [
    { label: t('components.resultsContainerTable.class.os'), value: "os-pkgs" },
    { label: t('components.resultsContainerTable.class.lang'), value: "lang-pkgs" },
  ];

  const extendedOrderOptions = [
    ...defaultOrderOptions,
    { label: "CVSS Score", value: "cvssScore" },
  ];

  // Configure filters for FilterBar
  const filters: FilterConfig[] = [
    {
      id: 'severity',
      label: t('components.resultsTable.severity'),
      options: severityOptions,
      value: props.selectedSeverity,
      onChange: props.onSeverityChange,
    },
    {
      id: 'status',
      label: t('components.resultsTable.status'),
      options: statusOptions,
      value: props.selectedStatus,
      onChange: props.onStatusChange,
    },
    {
      id: 'priority',
      label: t('components.resultsTable.priority'),
      options: priorityOptions,
      value: props.selectedPriority,
      onChange: props.onPriorityChange,
    },
    {
      id: 'classType',
      label: t('components.resultsContainerTable.class.type'),
      options: classTypeOptions,
      value: props.selectedClassType,
      onChange: props.onClassTypeChange,
    },
    ...(props.selectedExploitability && props.onExploitabilityChange
      ? [{
          id: 'exploitability',
          label: t('components.resultsTable.exploitability'),
          options: exploitabilityOptions.map((o) => ({
            ...o,
            label: t(
              `components.resultsTable.${EXPLOITABILITY_I18N_KEY[o.value]}`,
            ),
          })),
          value: props.selectedExploitability,
          onChange: props.onExploitabilityChange,
        }]
      : []),
  ];

  const sort: SortConfig = {
    orderOptions: extendedOrderOptions,
    directionOptions: orderDirectionOptions,
    selectedOrder: props.selectedOrder,
    selectedDirection: props.selectedOrderDirection,
    onOrderChange: props.onOrderChange,
    onDirectionChange: props.onOrderDirectionChange,
  };

  return (
    <div className="min-h-[calc(100vh-320px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <FilterBar
          filters={filters}
          sort={sort}
          onSearchChange={props.onSearchQueryChange}
          searchPlaceholder={t('components.resultsTable.searchPlaceholder')}
        />

        <div className="flex-1 flex flex-col overflow-auto custom-scrollbar bg-white dark:bg-as-surface">
          {props.loading ? (
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
                    <th className={AS_TH}>{t('components.resultsTable.severity')}</th>
                    <th className={AS_TH}>{t('components.resultsScaTable.cvss')}</th>
                    <th className={AS_TH}>{t('components.resultsContainerTable.class.type')}</th>
                    <th className={AS_TH}>{t('components.resultsScaTable.cve')}</th>
                    <th className={AS_TH}>{t('common.package')}</th>
                    <th className={AS_TH}>{t('components.resultsTable.exploitabilityShort')}</th>
                    <th className={AS_TH}>{t('components.resultsScaTable.fixAvailable')}</th>
                    <th className={AS_TH}>{t('components.resultsScaTable.firstDetected')}</th>
                    {props.issueTracking?.anyConfigured && (
                      <th className={AS_TH}>{t('components.resultsTable.tickets')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                  {props.issues.length > 0 ? (
                    props.issues.map((issue) => {
                      const cvssScore = getBestCvssScore(issue.vulnerability.cvss);
                      const isFixAvailable = !!issue.vulnerability.fixedVersion;
                      const classTypeLabel = issue.vulnerability.class === 'os-pkgs'
                        ? t('components.resultsContainerTable.class.os')
                        : t('components.resultsContainerTable.class.lang');

                      const cveIdentifier = issue.vulnerabilityIdentifier || issue.vulnerability?.vulnerabilityId;

                      const isSelected = selectedVulnerabilities?.has(issue.id) || false;

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
                            <SeverityChip level={getSeverityVariant(issue.currentSeverity)} title={t(`common.severity.${getSeverityVariant(issue.currentSeverity)}`)}>{getSeverityLabel(issue.currentSeverity)}</SeverityChip>
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            {(() => {
                              const cvss = pickCvssForTable({
                                cvss4BaseScore: issue.cvss4BaseScore,
                                cvss4EnvironmentalScore: issue.cvss4EnvironmentalScore,
                                // Persisted Trivy score first; OSV map as fallback
                                // (stub OSV records have no severities → score 0).
                                legacyScore:
                                  issue.cvssScore ||
                                  (cvssScore > 0 ? cvssScore : null),
                                legacyLabel: 'v3',
                              });
                              return (
                                <div className="flex items-center gap-2">
                                  <CvssScoreCell score={cvss.score} />
                                  <ScoringSourceBadge
                                    scoringSource={issue.scoringSource}
                                    cvssVersion={cvss.version}
                                  />
                                  <DetectionSourceBadge detectionSource={issue.detectionSource} />
                                </div>
                              );
                            })()}
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <span className={AS_TAG}>
                              {classTypeLabel}
                            </span>
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            {cveIdentifier || t('components.resultsScaTable.notAvailable')}
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <div className="font-medium text-zinc-900 dark:text-zinc-300">{issue.package.name}</div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">{issue.package.version}</div>
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <ExploitabilityBadge
                              verdict={issue.exploitabilityVerdict}
                              size="sm"
                            />
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            {isFixAvailable ? t('components.resultsScaTable.yes') : t('components.resultsScaTable.no')}
                          </td>
                          <td className={cn(AS_TD, 'whitespace-nowrap')}>
                            <div className="flex items-center gap-2">
                              {convertDate(issue.createdAt)}
                              {props.scanInfo && (
                                <VulnerabilityAgeBadge
                                  vulnerabilityCreatedAt={issue.createdAt}
                                  lastScanDate={props.scanInfo.createAt}
                                />
                              )}
                            </div>
                          </td>
                          {props.issueTracking?.anyConfigured && (
                            <td className={cn(AS_TD, 'whitespace-nowrap')}>
                              <span onClick={(e) => e.stopPropagation()} className="relative">
                                <TicketTracker
                                  tracking={props.issueTracking}
                                  projectId={props.projectId}
                                  groupName={issue.vulnerabilityIdentifier || issue.vulnerability?.vulnerabilityId || ''}
                                  occurrenceIds={[issue.id]}
                                  vulnerabilities={[{
                                    vulnerabilityId: issue.id,
                                    scannerType: 'container',
                                    severity: issue.currentSeverity,
                                    name: issue.vulnerabilityIdentifier || issue.vulnerability?.vulnerabilityId || '',
                                    packageName: issue.package?.name,
                                    packageVersion: issue.package?.version,
                                    externalId: issue.vulnerabilityIdentifier,
                                  }]}
                                />
                              </span>
                            </td>
                          )}
                        </LinkRow>
                      )
                    })
                  ) : (
                    <tr><td colSpan={(selectionEnabled ? 9 : 8) + (props.issueTracking?.anyConfigured ? 1 : 0)}><EmptyState
                            cybeMessage
                            title={t(EMPTY_STATE_COPY.noVuln)}
                            className="my-4"
                          /></td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

        {!props.loading && (
          <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:justify-between md:items-center border-t border-zinc-200 dark:border-as-line bg-white dark:bg-as-surface">
            <div className="flex-grow flex justify-center"><Pagination {...props} totalItems={props.totalIssues} /></div>
          </div>
        )}
      </div>
    </div>
  );
};
