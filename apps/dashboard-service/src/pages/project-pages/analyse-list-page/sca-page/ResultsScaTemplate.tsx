import IssueQuickViewHost from "@/components/organismes/issue-drawer/IssueQuickViewHost";
import React from "react";
import { motion } from "framer-motion";
import AnalyseWrapper from "../../../../components/molecules/wrapper/AnalyseWrapper";
import { ResultsScaTable } from "@/components/organismes/table/sca-table/ResultsScaTable";
import { GroupedResultsScaTable } from "@/components/organismes/table/grouped-sca-table/GroupedResultsScaTable";
import { ViewModeToggle, ViewMode } from "@/components/molecules/view-mode-toggle/ViewModeToggle";
import TriageToggle from '@/components/molecules/triage-toggle/TriageToggle';
import ResultsScaPackagesTable from "@/components/organismes/table/sca-table/ResultsScaPackagesTable";
import ResultsScaLicensesTable from "@/components/organismes/table/sca-table/ResultsScaLicensesTable";
import Button from "@/components/atoms/button/Button";
import Toggle from "@/components/atoms/toggle/Toggle";
import { useTranslation } from "react-i18next";
import { ScanInfo } from "@/server/interfaces/Scan";
import { Branch } from "@/server/interfaces/Branch";
import { ProjectIntegrationInfo } from "@/server/hooks/useProjectIntegrations";
import type { IssueTracking } from "@/server/hooks/useIssueTracking";
import { GroupedScaVulnerability } from "@/server/interfaces/Vulnerability";
import { cn } from "@/utils/function/utils";
import {
  AS_COUNT,
  AS_NOTICE,
  AS_SEGMENT_ITEM,
  AS_SEGMENT_OFF,
  AS_SEGMENT_ON,
  AS_SEGMENT_TRACK,
  AS_TOUCH,
} from "@/components/atoms/appsec/styles";
import Card from "@/components/atoms/card/Card";
import { LicenseSummaryResponse } from "@/server/interfaces/Packages";
import { AS_RESULTS_SCROLLER } from '@/components/atoms/appsec/styles';
import type { ScaViewExtension } from "@/edition/extensions";
import type { ResultColumn } from "@/server/hooks/useResultColumns";
import { EDITION } from "@/edition/edition";

/** The SCA page's own views; the active edition may add others (`ScaViewExtension`). */
export const CORE_SCA_VIEWS = ['vulnerabilities', 'packages', 'licenses'] as const;

const NO_VIEWS: readonly ScaViewExtension[] = [];

/** A SARIF import carries no licence and no dependency analysis: the licences
 * view and the reachability-ignored notice are not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';
const NO_COUNTS: Record<string, number> = {};
const NO_COLUMNS: ResultColumn[] = [];

interface ResultsScaTemplateProps {
  projectId: string | undefined;
  projectName: string;
  issues: any[];
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
  triageMode?: boolean;
  onTriageModeChange?: (value: boolean) => void;
  onFocusTop5?: () => void;
  focusTop5Active?: boolean;
  /** The columns the active edition adds to the vulnerabilities table (`useResultColumns`). */
  resultColumns?: ResultColumn[];
  showStartScanModal: boolean;
  handleStartScanClick: () => void;
  /** Community Edition with a cluster: « Import results » next to « Start scan ». */
  onImportResultsClick?: () => void;
  handleCloseStartScanModal: () => void;
  handleScanSubmit: () => void;
  errors: { file?: string };
  setSelectedFile: (file: File | null) => void;
  showLoader: boolean;
  scanData: any;
  vulnCount: number;
  showPulse: boolean;
  onCloseLoader: () => void;
  vulnCounts: { sast: number; iac: number; cicd: number; secret: number; sca: number; container: number };
  loading: boolean;
  scaPackages: any[];
  scaTotalPackages: number;
  scaTotalPages: number;
  scaCurrentPage: number;
  scaPackagesPageSize: number;
  scaPackagesLoading: boolean;
  scaPackagesError: string | null;
  scaPackagesGoToPage: (page: number) => void;
  scaPackagesRefresh: () => void;
  scaPackagesOnPageSizeChange: (size: number) => void;
  scaSelectedPackageType: string[];
  scaOnPackageTypeChange: (value: string[]) => void;
  /** A core view (`CORE_SCA_VIEWS`) or the id of a view the active edition adds. */
  view: string;
  setView: (view: string) => void;
  /** The views the active edition adds after the core's, in `order`. */
  extensionViews?: readonly ScaViewExtension[];
  /** Each added view's count, by id. */
  extensionCounts?: Record<string, number>;
  scanInfo: ScanInfo | null;
  uploadProgress?: number;
  isUploading?: boolean;
  includeDevAndTest: boolean;
  onIncludeDevAndTestChange: (enabled: boolean) => void;
  linkedGithubRepo?: string | null; // New prop for GitHub integration
  integrationInfo?: ProjectIntegrationInfo; // Unified integration info
  isSecurityContextCustomized?: boolean | null;
  // Branch filtering and scan selection (unified state)
  branches?: Branch[];
  selectedBranch?: string;
  defaultBranch?: string;
  loadingBranches?: boolean;
  onBranchChange?: (branch: string) => void;
  onArchive?: (branch: string) => void;
  onUnarchive?: (branch: string) => void;
  // Branch name for manual ZIP uploads
  manualBranchName?: string;
  onManualBranchNameChange?: (name: string) => void;
  /** Whether the project has been parsed for AI features */
  isProjectParsed?: boolean;
  /** Callback to reopen the scan loader */
  onReopenLoader?: () => void;
  // Agent progress props
  agentPhase?: string;
  agentAction?: string;
  agentMessage?: string;
  agentProgress?: number;
  classicDone?: boolean;
  /** View mode: 'detailed' (classic) or 'grouped' (by CVE+package) */
  viewMode?: ViewMode;
  /** Callback to change view mode */
  onViewModeChange?: (mode: ViewMode) => void;
  /** Grouped SCA vulnerabilities data */
  groupedVulnerabilities?: GroupedScaVulnerability[];
  /** Total number of groups for pagination */
  totalGroups?: number;
  totalOccurrences?: number;
  /** Loading state for grouped data */
  groupedLoading?: boolean;
  /** Count of vulnerabilities auto-ignored due to unused reachability */
  reachabilityIgnoredCount?: number;
  // License summary data
  licenseSummary?: LicenseSummaryResponse | null;
  licenseSummaryLoading?: boolean;
  licenseSummaryError?: string | null;
  licenseSummaryRefresh?: () => void;
  // Jira and Linear tickets of the project
  issueTracking?: IssueTracking;
  // Selection props for batch update
  selectedVulnerabilities?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  scanId?: string;
  // SCA package manager / source filters
  selectedPackageManager?: string[];
  selectedPackageSource?: string[];
  onPackageManagerChange?: (value: string[]) => void;
  onPackageSourceChange?: (value: string[]) => void;
  packageManagerOptions?: string[];
  packageSourceOptions?: string[];
}

const ResultsScaTemplate: React.FC<ResultsScaTemplateProps> = ({
  projectId,
  projectName,
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
  resultColumns = NO_COLUMNS,
  showStartScanModal,
  handleStartScanClick,
  onImportResultsClick,
  handleCloseStartScanModal,
  handleScanSubmit,
  errors,
  setSelectedFile,
  showLoader,
  scanData,
  vulnCount,
  showPulse,
  onCloseLoader,
  vulnCounts,
  loading,
  scaPackages,
  scaTotalPackages,
  scaTotalPages,
  scaCurrentPage,
  scaPackagesPageSize,
  scaPackagesLoading,
  scaPackagesError,
  scaPackagesGoToPage,
  scaPackagesRefresh,
  scaPackagesOnPageSizeChange,
  scaSelectedPackageType,
  scaOnPackageTypeChange,
  view,
  setView,
  extensionViews = NO_VIEWS,
  extensionCounts = NO_COUNTS,
  scanInfo,
  uploadProgress,
  isUploading,
  includeDevAndTest,
  onIncludeDevAndTestChange,
  linkedGithubRepo,
  integrationInfo,
  isSecurityContextCustomized,
  branches,
  selectedBranch,
  defaultBranch,
  loadingBranches,
  onBranchChange,
  onArchive,
  onUnarchive,
  manualBranchName,
  onManualBranchNameChange,
  isProjectParsed,
  onReopenLoader,
  agentPhase,
  agentAction,
  agentMessage,
  agentProgress,
  classicDone,
  viewMode = 'detailed',
  onViewModeChange,
  groupedVulnerabilities = [],
  totalGroups = 0,
  totalOccurrences = 0,
  groupedLoading = false,
  reachabilityIgnoredCount = 0,
  licenseSummary,
  licenseSummaryLoading = false,
  licenseSummaryError = null,
  licenseSummaryRefresh,
  issueTracking,
  selectedVulnerabilities,
  onSelectionChange,
  onSelectAll,
  onDeselectAll,
  scanId,
  selectedPackageManager,
  selectedPackageSource,
  onPackageManagerChange,
  onPackageSourceChange,
  packageManagerOptions,
  packageSourceOptions,
}) => {
  const { t } = useTranslation();
  // The added view shown, when one is: it lists vulnerabilities, with its own flags.
  const activeExtensionView = extensionViews.find((extension) => extension.id === view) ?? null;
  const rowBadges = extensionViews.flatMap((extension) => (extension.RowBadge ? [extension.RowBadge] : []));

  return (
    <AnalyseWrapper
      projectName={projectName}
      selectedTab="sca"
      projectId={projectId}
      showStartScanModal={showStartScanModal}
      handleStartScanClick={handleStartScanClick}
      onImportResultsClick={onImportResultsClick}
      handleCloseStartScanModal={handleCloseStartScanModal}
      handleScanSubmit={handleScanSubmit}
      errors={errors}
      setSelectedFile={setSelectedFile}
      showLoader={showLoader}
      scanData={scanData}
      vulnCount={vulnCount}
      showPulse={showPulse}
      onCloseLoader={onCloseLoader}
      vulnCounts={vulnCounts}
      loading={loading}
      scanInfo={scanInfo}
      uploadProgress={uploadProgress}
      isUploading={isUploading}
      linkedGithubRepo={linkedGithubRepo}
      integrationInfo={integrationInfo}
      isSecurityContextCustomized={isSecurityContextCustomized}
      branches={branches}
      selectedBranch={selectedBranch}
      onBranchChange={onBranchChange}
      loadingBranches={loadingBranches}
      defaultBranch={defaultBranch}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
      manualBranchName={manualBranchName}
      onManualBranchNameChange={onManualBranchNameChange}
      onReopenLoader={onReopenLoader}
      agentPhase={agentPhase}
      agentAction={agentAction}
      agentMessage={agentMessage}
      agentProgress={agentProgress}
      classicDone={!!classicDone}
      onFocusTop5={onFocusTop5}
      focusTop5Active={focusTop5Active}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* The four view buttons and the dev-dependency switch shared one
            rigid row: on a phone the switch held its width and clipped the
            last button. They wrap onto separate lines until there is room. */}
        <div className={cn(
          "mb-4 flex flex-col gap-3 md:flex-row md:justify-between md:items-center md:gap-4",
          "bg-white dark:bg-as-surface p-4 rounded-2xl",
          "border border-zinc-200 dark:border-as-line"
        )}>
          {/* A segmented control: the view picked is the white pill
              with violet words; Malware keeps its red in both states. */}
          <div className={cn(AS_SEGMENT_TRACK, "max-w-full overflow-x-auto overflow-y-hidden scrollbar-hide")}>
            <Button
              variant="ghost"
              onClick={() => setView("vulnerabilities")}
              className={cn(AS_SEGMENT_ITEM, AS_TOUCH, view === "vulnerabilities" ? AS_SEGMENT_ON : AS_SEGMENT_OFF)}
            >
              {t('components.resultsScaTemplate.vulnerabilities')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setView("packages")}
              className={cn(AS_SEGMENT_ITEM, AS_TOUCH, view === "packages" ? AS_SEGMENT_ON : AS_SEGMENT_OFF)}
            >
              {t('components.resultsScaTemplate.packages')}
            </Button>
            {!SCANNER_ONLY_HIDDEN && (
            <Button
              variant="ghost"
              onClick={() => setView("licenses")}
              className={cn(AS_SEGMENT_ITEM, AS_TOUCH, view === "licenses" ? AS_SEGMENT_ON : AS_SEGMENT_OFF)}
            >
              {t('components.resultsScaTemplate.licenses')}
            </Button>
            )}
            {/* The views the active edition adds (the cloud's Malware sub-tab),
                always shown, like the other SCA sub-tabs, with an always-visible
                count badge (mirrors the analysis-type tab badges in CustomTabs). */}
            {extensionViews.map((extension) => {
              const TabCount = extension.TabCount;
              return (
                <Button
                  key={extension.id}
                  variant="ghost"
                  onClick={() => setView(extension.id)}
                  className={cn(
                    AS_SEGMENT_ITEM,
                    AS_TOUCH,
                    extension.tabClassName
                      ? extension.tabClassName(view === extension.id)
                      : view === extension.id ? AS_SEGMENT_ON : AS_SEGMENT_OFF
                  )}
                >
                  {t(extension.labelKey)}
                  {TabCount && <TabCount count={extensionCounts[extension.id] ?? 0} />}
                </Button>
              );
            })}
          </div>
          <div className={cn("flex items-center gap-2")}>
            <span className={cn("text-sm text-zinc-600 dark:text-zinc-400")}>
              {t('components.resultsScaTemplate.includeDevAndTest')}
            </span>
            <Toggle
              enabled={includeDevAndTest}
              onChange={onIncludeDevAndTestChange}
            />
          </div>
        </div>
        {(view === "vulnerabilities" || activeExtensionView) ? (
          <>
            {/* The banner of the added view shown (the cloud's malware danger banner). */}
            {activeExtensionView?.Banner && (
              <activeExtensionView.Banner count={extensionCounts[activeExtensionView.id] ?? 0} />
            )}
            {!SCANNER_ONLY_HIDDEN && view === "vulnerabilities" && reachabilityIgnoredCount > 0 && (
              // A hairline row in place of a tinted banner, no dot; the link stays.
              <div className={cn(AS_NOTICE, "mb-4")}>
                <span className="min-w-0">
                  {t('components.resultsScaTemplate.reachabilityIgnoredBanner', { count: reachabilityIgnoredCount })}
                </span>
                <button
                  onClick={() => {
                    if (selectedStatus.includes('ignored')) {
                      onStatusChange(selectedStatus.filter(s => s !== 'ignored'));
                    } else {
                      onStatusChange([...selectedStatus, 'ignored']);
                      if (!includeDevAndTest) {
                        onIncludeDevAndTestChange(true);
                      }
                    }
                  }}
                  className={`relative ml-auto flex-shrink-0 text-xs font-medium underline hover:no-underline text-secondary dark:text-secondary-light ${AS_TOUCH}`}
                >
                  {selectedStatus.includes('ignored')
                    ? t('components.resultsScaTemplate.reachabilityHideIgnored')
                    : t('components.resultsScaTemplate.reachabilityShowIgnored')}
                </button>
              </div>
            )}
            <Card
              variant="default"
              padding="none"
              className={cn(
                "rounded-2xl overflow-hidden",
                "bg-white dark:bg-as-surface",
                "border border-zinc-200 dark:border-as-line"
              )}
            >
              {/* Header with View Mode Toggle */}
              {onViewModeChange && (
                <div className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-as-line">
                  <div className="text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {viewMode === 'grouped'
                      ? t('components.resultsTable.vulnerabilityGroupCount', { count: totalGroups || 0 })
                      : t('components.resultsTable.vulnerabilityCount', { count: totalIssues || 0 })
                    }
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {onTriageModeChange && (
                      <TriageToggle value={!!triageMode} onChange={onTriageModeChange} />
                    )}
                    <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
                  </div>
                </div>
              )}

              <div className={AS_RESULTS_SCROLLER}>
                {viewMode === 'grouped' ? (
                  <GroupedResultsScaTable
                    projectId={projectId}
                    groups={groupedVulnerabilities}
                    totalGroups={totalGroups}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    pageSizeOptions={pageSizeOptions}
                    onPageChange={onPageChange}
                    onPageSizeChange={onPageSizeChange}
                    selectedSeverity={selectedSeverity}
                    selectedStatus={selectedStatus}
                    selectedExploitability={selectedExploitability}
                    selectedOrder={selectedOrder}
                    selectedOrderDirection={selectedOrderDirection}
                    onSeverityChange={onSeverityChange}
                    onStatusChange={onStatusChange}
                    onExploitabilityChange={onExploitabilityChange}
                    onOrderChange={onOrderChange}
                    onOrderDirectionChange={onOrderDirectionChange}
                    onSearchQueryChange={onSearchQueryChange}
                    loading={groupedLoading}
                    triageMode={triageMode}
                    onTriageModeChange={onTriageModeChange}
                    scanId={scanId}
                    issueTracking={issueTracking}
                    selectedPackageType={selectedPackageTypeVuln}
                    onPackageTypeChange={onPackageTypeVulnChange}
                    selectedPackageManager={selectedPackageManager}
                    onPackageManagerChange={onPackageManagerChange}
                    selectedPackageSource={selectedPackageSource}
                    onPackageSourceChange={onPackageSourceChange}
                    packageManagerOptions={packageManagerOptions}
                    packageSourceOptions={packageSourceOptions}
                    rowBadges={rowBadges}
                  />
                ) : (
                  <ResultsScaTable
                    projectId={projectId}
                    issues={issues}
                    totalIssues={totalIssues}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    pageSizeOptions={pageSizeOptions}
                    onPageChange={onPageChange}
                    onPageSizeChange={onPageSizeChange}
                    selectedSeverity={selectedSeverity}
                    selectedStatus={selectedStatus}
                    selectedPriority={selectedPriority}
                    selectedPackageTypeVuln={selectedPackageTypeVuln}
                    selectedExploitability={selectedExploitability}
                    selectedOrder={selectedOrder}
                    selectedOrderDirection={selectedOrderDirection}
                    onSeverityChange={onSeverityChange}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onPackageTypeVulnChange={onPackageTypeVulnChange}
                    onExploitabilityChange={onExploitabilityChange}
                    onOrderChange={onOrderChange}
                    onOrderDirectionChange={onOrderDirectionChange}
                    onSearchQueryChange={onSearchQueryChange}
                    triageMode={triageMode}
                    onTriageModeChange={onTriageModeChange}
                    extraColumns={resultColumns}
                    rowBadges={rowBadges}
                    loading={loading}
                    includeDevAndTest={includeDevAndTest}
                    scanInfo={scanInfo}
                    issueTracking={issueTracking}
                    selectedVulnerabilities={selectedVulnerabilities}
                    onSelectionChange={onSelectionChange}
                    onSelectAll={onSelectAll}
                    onDeselectAll={onDeselectAll}
                    noCvssView={activeExtensionView?.noCvss ?? false}
                    selectedPackageManager={selectedPackageManager}
                    onPackageManagerChange={onPackageManagerChange}
                    selectedPackageSource={selectedPackageSource}
                    onPackageSourceChange={onPackageSourceChange}
                    packageManagerOptions={packageManagerOptions}
                    packageSourceOptions={packageSourceOptions}
                  />
                )}
              </div>
            </Card>
          </>
        ) : view === "packages" ? (
          <Card
            variant="default"
            padding="none"
            className={cn(
              "rounded-2xl overflow-hidden",
              "bg-white dark:bg-as-surface",
              "border border-zinc-200 dark:border-as-line"
            )}
          >
            <div className={AS_RESULTS_SCROLLER}>
              <ResultsScaPackagesTable
                projectId={projectId}
                packages={scaPackages}
                totalPackages={scaTotalPackages}
                currentPage={scaCurrentPage}
                totalPages={scaTotalPages}
                pageSize={scaPackagesPageSize}
                pageSizeOptions={pageSizeOptions}
                onPageChange={scaPackagesGoToPage}
                onPageSizeChange={scaPackagesOnPageSizeChange}
                selectedPackageType={scaSelectedPackageType}
                onPackageTypeChange={scaOnPackageTypeChange}
                onSearchQueryChange={onSearchQueryChange}
                loading={scaPackagesLoading}
                error={scaPackagesError}
                refresh={scaPackagesRefresh}
                includeDevAndTest={includeDevAndTest}
              />
            </div>
          </Card>
        ) : SCANNER_ONLY_HIDDEN ? null : (
          <Card
            variant="default"
            padding="none"
            className={cn(
              "rounded-2xl overflow-hidden",
              "bg-white dark:bg-as-surface",
              "border border-zinc-200 dark:border-as-line"
            )}
          >
            <div className={AS_RESULTS_SCROLLER}>
              <ResultsScaLicensesTable
                data={licenseSummary ?? null}
                loading={licenseSummaryLoading}
                error={licenseSummaryError ?? null}
                refresh={licenseSummaryRefresh ?? (() => {})}
                selectedBranch={selectedBranch}
                packageType={scaSelectedPackageType}
              />
            </div>
          </Card>
        )}
      </motion.div>
      <IssueQuickViewHost
        projectId={projectId}
        type="sca"
        units={
          viewMode === 'detailed'
            ? issues.map((i) => [i.id])
            : (groupedVulnerabilities || []).map((g) => (g.occurrences || []).map((o) => o.id))
        }
        pagination={
          viewMode === 'detailed'
            ? { currentPage, totalPages, pageSize, totalCount: totalIssues, onPageChange }
            : {
                currentPage,
                totalPages,
                pageSize,
                totalCount: totalOccurrences || totalIssues,
                occurrenceOffset:
                  totalPages > 1
                    ? Math.round(((currentPage - 1) * (totalOccurrences || 0)) / totalPages)
                    : 0,
                onPageChange,
              }
        }
      />
    </AnalyseWrapper>
  );
};

export default ResultsScaTemplate;
