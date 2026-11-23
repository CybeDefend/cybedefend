import IssueQuickViewHost from "@/components/organismes/issue-drawer/IssueQuickViewHost";
import { resolveLastScanAt } from '@/utils/function/lastScanAt';
import React from "react";
import { motion } from "framer-motion";
import AnalyseWrapper from "../../../../components/molecules/wrapper/AnalyseWrapper";
import { ScanInfo, ScanResponseDto } from "../../../../server/interfaces/Scan";
import { SastVulnerabilityResult, GroupedVulnerability } from "../../../../server/interfaces/Vulnerability";
import { ProjectIntegrationInfo } from "../../../../server/hooks/useProjectIntegrations";
import { ResultsSastTable } from "@/components/organismes/table/sast-table/ResultsSastTable";
import { GroupedResultsSastTable } from "@/components/organismes/table/grouped-sast-table/GroupedResultsSastTable";
import ViewModeToggle, { ViewMode } from "@/components/molecules/view-mode-toggle/ViewModeToggle";
import TriageToggle from '@/components/molecules/triage-toggle/TriageToggle';
import { Branch } from "@/server/interfaces/Branch";
import type { IssueTracking } from "@/server/hooks/useIssueTracking";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import Card from "@/components/atoms/card/Card";
import { AS_RESULTS_SCROLLER } from '@/components/atoms/appsec/styles';

interface ResultsSastTemplateProps {
  projectId: string | undefined;
  projectName: string;
  issues: SastVulnerabilityResult[];
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
  // Language filter (multi-select from facets) + source path filter.
  languageOptions?: { label: string; value: string }[];
  selectedLanguage?: string[];
  onLanguageChange?: (value: string[]) => void;
  sourcePath?: string;
  onSourcePathChange?: (value: string) => void;
  triageMode?: boolean;
  onTriageModeChange?: (value: boolean) => void;
  onFocusTop5?: () => void;
  focusTop5Active?: boolean;
  selectedScoringSource?: import("@/utils/data/resultsVulnData").ScoringSourceFilterValue;
  onScoringSourceChange?: (
    next: import("@/utils/data/resultsVulnData").ScoringSourceFilterValue,
  ) => void;
  showStartScanModal: boolean;
  handleStartScanClick: () => void;
  /** Community Edition with a cluster: « Import results » next to « Start scan ». */
  onImportResultsClick?: () => void;
  handleCloseStartScanModal: () => void;
  handleScanSubmit: () => void;
  errors: { file?: string };
  setSelectedFile: (file: File | null) => void;
  showLoader: boolean;
  scanData: ScanResponseDto | null;
  vulnCount: number;
  showPulse: boolean;
  onCloseLoader: () => void;
  /** Callback to reopen the scan loader manually */
  onReopenLoader?: () => void;
  vulnCounts: {
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
  };
  loading: boolean;
  scanInfo: ScanInfo | null;
  uploadProgress?: number;
  isUploading?: boolean;
  linkedGithubRepo?: string | null; // GitHub integration
  linkedGitlabRepo?: string | null; // GitLab integration
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
  // Agentic scanner UI (optional)
  agentPhase?: string;
  agentAction?: string;
  agentMessage?: string;
  agentProgress?: number;
  agentActiveIds?: string[];
  agentProcessedIds?: string[];
  agentPrioritizationActive?: boolean;
  classicDone?: boolean;
  /** Whether the project has been parsed for AI features */
  isProjectParsed?: boolean;
  // View mode toggle
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  // Grouped view data
  groupedVulnerabilities?: GroupedVulnerability[];
  totalGroups?: number;
  totalOccurrences?: number;
  groupedLoading?: boolean;
  // Selection props for batch update
  selectedVulnerabilities?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  scanId?: string;
  // Jira and Linear tickets of the project
  issueTracking?: IssueTracking;
  // Stale-verdict banner rendered inside AnalyseWrapper.
  staleBanner?: React.ReactNode;
}

const ResultsSastTemplate: React.FC<ResultsSastTemplateProps> = ({
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
  triageMode,
  onTriageModeChange,
  onFocusTop5,
  focusTop5Active,
  selectedScoringSource,
  onScoringSourceChange,
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
  onReopenLoader,
  vulnCounts,
  loading,
  scanInfo,
  uploadProgress,
  isUploading,
  linkedGithubRepo,
  linkedGitlabRepo,
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
  agentPhase,
  agentAction,
  agentMessage,
  agentProgress,
  agentActiveIds,
  agentProcessedIds,
  agentPrioritizationActive,
  classicDone,
  isProjectParsed,
  viewMode,
  onViewModeChange,
  groupedVulnerabilities,
  totalGroups,
  totalOccurrences,
  groupedLoading,
  selectedVulnerabilities,
  onSelectionChange,
  onSelectAll,
  onDeselectAll,
  scanId,
  issueTracking,
  staleBanner,
}) => {
  const { t } = useTranslation();

  // Derive agent animation steps from current issues and scan progress
  // Use the real agentActiveIds and agentProcessedIds passed from the page
  const agentIndicators = React.useMemo(() => {
    return {
      active: agentActiveIds || [],
      processed: agentProcessedIds || [],
    };
  }, [agentActiveIds, agentProcessedIds]);

  return (
    <AnalyseWrapper
      projectName={projectName}
      selectedTab="sast"
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
      onReopenLoader={onReopenLoader}
      vulnCounts={vulnCounts}
      loading={loading}
      scanInfo={scanInfo}
      uploadProgress={uploadProgress}
      isUploading={isUploading}
      linkedGithubRepo={linkedGithubRepo}
      linkedGitlabRepo={linkedGitlabRepo}
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
      agentPhase={agentPhase}
      agentAction={agentAction}
      agentMessage={agentMessage}
      agentProgress={agentProgress}
      classicDone={!!classicDone}
      afterStatusBanner={staleBanner}
      onFocusTop5={onFocusTop5}
      focusTop5Active={focusTop5Active}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn("flex flex-col")}
      >
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

          <div className={AS_RESULTS_SCROLLER}>
            {viewMode === 'detailed' ? (
              <ResultsSastTable
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
                selectedExploitability={selectedExploitability}
                selectedOrder={selectedOrder}
                selectedOrderDirection={selectedOrderDirection}
                onSeverityChange={onSeverityChange}
                onStatusChange={onStatusChange}
                onPriorityChange={onPriorityChange}
                onExploitabilityChange={onExploitabilityChange}
                onOrderChange={onOrderChange}
                onOrderDirectionChange={onOrderDirectionChange}
                onSearchQueryChange={onSearchQueryChange}
                languageOptions={languageOptions}
                selectedLanguage={selectedLanguage}
                onLanguageChange={onLanguageChange}
                sourcePath={sourcePath}
                onSourcePathChange={onSourcePathChange}
                triageMode={triageMode}
                onTriageModeChange={onTriageModeChange}
                selectedScoringSource={selectedScoringSource}
                onScoringSourceChange={onScoringSourceChange}
                loading={loading}
                scanInfo={scanInfo}
                issueTracking={issueTracking}
                agentActiveIds={agentIndicators.active}
                agentProcessedIds={agentIndicators.processed}
                selectedVulnerabilities={selectedVulnerabilities}
                onSelectionChange={onSelectionChange}
                onSelectAll={onSelectAll}
                onDeselectAll={onDeselectAll}
              />
            ) : (
              <GroupedResultsSastTable
                projectId={projectId}
                lastScanAt={resolveLastScanAt(scanInfo, 'sast')}
                groups={groupedVulnerabilities || []}
                totalGroups={totalGroups || 0}
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                pageSizeOptions={pageSizeOptions}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
                selectedSeverity={selectedSeverity}
                selectedStatus={selectedStatus}
                selectedPriority={selectedPriority}
                selectedExploitability={selectedExploitability}
                selectedOrder={selectedOrder}
                selectedOrderDirection={selectedOrderDirection}
                onSeverityChange={onSeverityChange}
                onStatusChange={onStatusChange}
                onPriorityChange={onPriorityChange}
                onExploitabilityChange={onExploitabilityChange}
                onOrderChange={onOrderChange}
                onOrderDirectionChange={onOrderDirectionChange}
                onSearchQueryChange={onSearchQueryChange}
                languageOptions={languageOptions}
                selectedLanguage={selectedLanguage}
                onLanguageChange={onLanguageChange}
                sourcePath={sourcePath}
                onSourcePathChange={onSourcePathChange}
                triageMode={triageMode}
                onTriageModeChange={onTriageModeChange}
                loading={groupedLoading || false}
                scanId={scanId}
                issueTracking={issueTracking}
              />
            )}
          </div>
        </Card>
      </motion.div>
      <IssueQuickViewHost
        projectId={projectId}
        type="sast"
        lastScanAt={resolveLastScanAt(scanInfo, 'sast')}
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

export default ResultsSastTemplate;
