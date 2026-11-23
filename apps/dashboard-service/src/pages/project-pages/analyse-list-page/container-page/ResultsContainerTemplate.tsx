import IssueQuickViewHost from "@/components/organismes/issue-drawer/IssueQuickViewHost";
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ResultsContainerTable } from '@/components/organismes/table/container-table/ResultsContainerTable';
import { GroupedResultsContainerTable } from '@/components/organismes/table/grouped-container-table/GroupedResultsContainerTable';
import ResultsContainerPackagesTable from '@/components/organismes/table/container-table/ResultsContainerPackagesTable';
import ViewModeToggle, { ViewMode } from '@/components/molecules/view-mode-toggle/ViewModeToggle';
import { ContainerVulnerabilityResult, GroupedContainerVulnerability } from '@/server/interfaces/Vulnerability';
import { ContainerDetectedPackage, ContainerImage } from '@/server/interfaces/Packages';
import { ScanResponseDto, ScanInfo } from '@/server/interfaces/Scan';
import Button from '@/components/atoms/button/Button';
import Card from '@/components/atoms/card/Card';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@/components/atoms/icon/icons';
import EolOsBanner from '@/components/molecules/banners/EolOsBanner';
import { cn } from '@/utils/function/utils';
import type { IssueTracking } from '@/server/hooks/useIssueTracking';
import { AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

/** A SARIF import never fills the image's OS: its end-of-life banner is not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

interface ResultsContainerTemplateProps {
  // General props
  projectId: string;
  selectedImage: ContainerImage;
  onBackToImages: () => void;
  view: 'vulnerabilities' | 'packages';
  setView: (view: 'vulnerabilities' | 'packages') => void;
  onSearchQueryChange: (value: string) => void;
  selectedClassType: string[];
  onClassTypeChange: (value: string[]) => void;
  pageSizeOptions: number[];
  scanInfo: ScanInfo | null;

  // Vulnerability View mode (detailed vs grouped-by-package)
  vulnViewMode: ViewMode;
  onVulnViewModeChange: (mode: ViewMode) => void;
  groupedVulnerabilities: GroupedContainerVulnerability[];
  totalGroups: number;
  groupedLoading: boolean;
  groupedCurrentPage: number;
  groupedTotalPages: number;
  onGroupedPageChange: (page: number) => void;

  // Vulnerability View Props
  vulnerabilities: ContainerVulnerabilityResult[];
  totalVulnerabilities: number;
  vulnLoading: boolean;
  vulnCurrentPage: number;
  vulnTotalPages: number;
  vulnPageSize: number;
  onVulnPageChange: (page: number) => void;
  onVulnPageSizeChange: (size: number) => void;
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
  triageMode?: boolean;
  onTriageModeChange?: (value: boolean) => void;

  // Package View Props
  packages: ContainerDetectedPackage[];
  totalPackages: number;
  pkgLoading: boolean;
  pkgCurrentPage: number;
  pkgTotalPages: number;
  pkgPageSize: number;
  onPkgPageChange: (page: number) => void;
  onPkgPageSizeChange: (size: number) => void;

  // Jira and Linear tickets of the project
  issueTracking?: IssueTracking;
  // Selection props for batch update
  selectedVulnerabilities?: Set<string>;
  onSelectionChange?: (id: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
}

const ResultsContainerTemplate: React.FC<ResultsContainerTemplateProps> = ({
  projectId,
  selectedImage,
  onBackToImages,
  view,
  setView,
  onSearchQueryChange,
  selectedClassType,
  onClassTypeChange,
  pageSizeOptions,
  scanInfo,
  vulnViewMode,
  onVulnViewModeChange,
  groupedVulnerabilities,
  totalGroups,
  groupedLoading,
  groupedCurrentPage,
  groupedTotalPages,
  onGroupedPageChange,
  vulnerabilities,
  totalVulnerabilities,
  vulnLoading,
  vulnCurrentPage,
  vulnTotalPages,
  vulnPageSize,
  onVulnPageChange,
  onVulnPageSizeChange,
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
  triageMode,
  onTriageModeChange,
  packages,
  totalPackages,
  pkgLoading,
  pkgCurrentPage,
  pkgTotalPages,
  pkgPageSize,
  onPkgPageChange,
  onPkgPageSizeChange,
  issueTracking,
  // Selection props
  selectedVulnerabilities,
  onSelectionChange,
  onSelectAll,
  onDeselectAll,
}) => {
  const { t } = useTranslation();

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn("space-y-6")}
    >
      <div className={cn("flex justify-between items-center")}>
        <div className={cn('flex min-w-0 items-center gap-3')}>
          <Button variant="white" onClick={onBackToImages} className="w-8 px-0" aria-label={t('common.back')}>
            <ArrowLeft size={16} />
          </Button>
          <h2 className={cn(AS_SECTION_TITLE, "truncate")}>
            {selectedImage.artifactName}
          </h2>
        </div>
      </div>

      {!SCANNER_ONLY_HIDDEN && selectedImage.osEosl && (
        <EolOsBanner osFamily={selectedImage.osFamily} osName={selectedImage.osName} />
      )}

      <Card
        variant="default"
        padding="sm"
        className={cn(
          "rounded-2xl",
          "bg-white dark:bg-as-surface",
          "border border-zinc-200 dark:border-as-line"
        )}
      >
        <div className={cn("flex justify-between items-center gap-4")}>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={view === "vulnerabilities" ? "secondary" : "white"}
              onClick={() => setView("vulnerabilities")}
              className={cn(
                view === "vulnerabilities" && "ring-0"
              )}
            >
              {t('components.resultsScaTemplate.vulnerabilities')}
            </Button>
            <Button
              variant={view === "packages" ? "secondary" : "white"}
              onClick={() => setView("packages")}
              className={cn(
                view === "packages" && "ring-0"
              )}
            >
              {t('components.resultsScaTemplate.packages')}
            </Button>
          </div>
        </div>
      </Card>

      <AnimatePresence mode="wait">
        {view === "vulnerabilities" ? (
          <motion.div
            key="vulnerabilities"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
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
              {/* Header with View Mode Toggle (detailed vs grouped-by-package) */}
              <div className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-as-line">
                <div className="text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                  {vulnViewMode === 'grouped'
                    ? `${totalGroups || 0} ${totalGroups === 1 ? t('components.resultsContainerTable.packageGroup_one') : t('components.resultsContainerTable.packageGroup_other')}`
                    : `${totalVulnerabilities || 0} ${t('components.resultsScaTemplate.vulnerabilities')}`}
                </div>
                <ViewModeToggle value={vulnViewMode} onChange={onVulnViewModeChange} />
              </div>

              {vulnViewMode === 'grouped' ? (
                <GroupedResultsContainerTable
                  projectId={projectId}
                  groups={groupedVulnerabilities}
                  totalGroups={totalGroups}
                  currentPage={groupedCurrentPage}
                  totalPages={groupedTotalPages}
                  pageSize={vulnPageSize}
                  pageSizeOptions={pageSizeOptions}
                  onPageChange={onGroupedPageChange}
                  onPageSizeChange={onVulnPageSizeChange}
                  selectedSeverity={selectedSeverity}
                  selectedStatus={selectedStatus}
                  selectedPriority={selectedPriority}
                  selectedClassType={selectedClassType}
                  selectedExploitability={selectedExploitability}
                  selectedOrder={selectedOrder}
                  selectedOrderDirection={selectedOrderDirection}
                  onSeverityChange={onSeverityChange}
                  onStatusChange={onStatusChange}
                  onPriorityChange={onPriorityChange}
                  onClassTypeChange={onClassTypeChange}
                  onExploitabilityChange={onExploitabilityChange}
                  onOrderChange={onOrderChange}
                  onOrderDirectionChange={onOrderDirectionChange}
                  onSearchQueryChange={onSearchQueryChange}
                  loading={groupedLoading}
                  triageMode={triageMode}
                  onTriageModeChange={onTriageModeChange}
                />
              ) : (
              <ResultsContainerTable
                projectId={projectId}
                issues={vulnerabilities}
                totalIssues={totalVulnerabilities}
                loading={vulnLoading}
                currentPage={vulnCurrentPage}
                totalPages={vulnTotalPages}
                pageSize={vulnPageSize}
                pageSizeOptions={pageSizeOptions}
                selectedSeverity={selectedSeverity}
                selectedStatus={selectedStatus}
                selectedPriority={selectedPriority}
                selectedExploitability={selectedExploitability}
                selectedOrder={selectedOrder}
                selectedOrderDirection={selectedOrderDirection}
                selectedClassType={selectedClassType}
                onClassTypeChange={onClassTypeChange}
                onPageChange={onVulnPageChange}
                onPageSizeChange={onVulnPageSizeChange}
                onSeverityChange={onSeverityChange}
                onStatusChange={onStatusChange}
                onPriorityChange={onPriorityChange}
                onExploitabilityChange={onExploitabilityChange}
                onOrderChange={onOrderChange}
                onOrderDirectionChange={onOrderDirectionChange}
                onSearchQueryChange={onSearchQueryChange}
                triageMode={triageMode}
                onTriageModeChange={onTriageModeChange}
                scanInfo={scanInfo}
                issueTracking={issueTracking}
                selectedVulnerabilities={selectedVulnerabilities}
                onSelectionChange={onSelectionChange}
                onSelectAll={onSelectAll}
                onDeselectAll={onDeselectAll}
              />
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="packages"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
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
              <ResultsContainerPackagesTable
                packages={packages}
                totalPackages={totalPackages}
                loading={pkgLoading}
                currentPage={pkgCurrentPage}
                totalPages={pkgTotalPages}
                pageSize={pkgPageSize}
                pageSizeOptions={pageSizeOptions}
                selectedClassType={selectedClassType}
                onClassTypeChange={onClassTypeChange}
                onPageChange={onPkgPageChange}
                onPageSizeChange={onPkgPageSizeChange}
                onSearchQueryChange={onSearchQueryChange}
              />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    <IssueQuickViewHost
      projectId={projectId}
      type="container"
      units={
        vulnViewMode === 'detailed'
          ? vulnerabilities.map((v) => [v.id])
          : (groupedVulnerabilities || []).map((g) => (g.occurrences || []).map((o) => o.id))
      }
      pagination={
        vulnViewMode === 'detailed'
          ? {
              currentPage: vulnCurrentPage,
              totalPages: vulnTotalPages,
              pageSize: vulnPageSize,
              totalCount: totalVulnerabilities,
              onPageChange: onVulnPageChange,
            }
          : {
              currentPage: groupedCurrentPage,
              totalPages: groupedTotalPages,
              pageSize: vulnPageSize,
              totalCount: totalGroups,
              onPageChange: onGroupedPageChange,
            }
      }
    />
    </>
  );
};

export default ResultsContainerTemplate;