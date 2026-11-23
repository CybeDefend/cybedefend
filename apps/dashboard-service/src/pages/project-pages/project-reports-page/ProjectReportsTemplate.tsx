import React, { useEffect, useMemo, useRef, useState } from 'react';
import { projectSectionIcon } from '@/components/atoms/icon/projectSectionIcons';
import ProjectTemplateWrapper from '../../../components/molecules/wrapper/ProjectTemplateWrapper';
import { useTranslation } from 'react-i18next';
import Card from '../../../components/atoms/card/Card';
import Button from '../../../components/atoms/button/Button';
import Select, { Option } from '../../../components/atoms/select/Select';
import Toggle from '../../../components/atoms/toggle/Toggle';
import { GenerateOwaspReportResponse, GenerateCweReportResponse, ProjectBranch } from '@/server/interfaces/Vulnerability';
import { Archive, Download, Eye, FileText } from '@/components/atoms/icon/icons';
import ReportPreviewModal from '@/components/molecules/modal/report-preview-modal/ReportPreviewModal';
import { FeatureGate } from '@/components/molecules/feature-gate';
import { Slot } from '@/edition/slots';
import BranchSelector from '@/components/molecules/branch-selector/BranchSelector';
import StoredReportsDrawer from '@/components/organismes/stored-reports/StoredReportsDrawer';
import StoredReportTypeLink from '@/components/organismes/stored-reports/StoredReportTypeLink';
import { useStoredReports } from '@/server/hooks/useStoredReports';

import { AS_TOOLTIP, AS_PAGE_TITLE, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface ProjectReportsTemplateProps {
  projectId: string | undefined;
  projectTitle: string;
  teamName: string;
  // Deep-link target — auto-opens the stored-reports drawer.
  highlightReportId?: string;
  /** The navigation that named `highlightReportId`: a new one reopens the drawer. */
  highlightKey?: string;
  owaspReportData: GenerateOwaspReportResponse | null;
  cweReportData: GenerateCweReportResponse | null;
  loading: boolean;
  cweLoading: boolean;
  onGenerateOwaspReport: (format: 'json' | 'html' | 'pdf', detailed: boolean) => void;
  onGenerateCweReport: (format: 'json' | 'html' | 'pdf', detailed: boolean) => void;
  onDownloadOwaspReport: () => void;
  onDownloadCweReport: () => void;
  onClearOwaspReport: () => void;
  onClearCweReport: () => void;
  writesBlocked?: boolean;
  /**
   * Available branches for the project. Empty array hides the BranchSelector
   * (e.g. legacy projects that have never scanned a named branch).
   * Defaults to `[]` to keep existing call sites and tests compatible.
   */
  branches?: ProjectBranch[];
  /**
   * Currently selected branch. A report must target a single concrete branch,
   * so the selector below does NOT offer an "All branches" option — the
   * container pre-selects the reference branch (or the first available branch)
   * on load. `null` only occurs for projects with no named branches, where the
   * selector is hidden and reports stay project-wide. Defaults to `null`.
   */
  selectedBranch?: string | null;
  /**
   * Callback when the user picks a branch in the selector. Optional so that
   * call sites that don't yet wire the selector keep working.
   */
  onBranchChange?: (branch: string | null) => void;
  // ── Async / paginated branch selector props ─────────────────────────────────
  /** True while the initial branch list page is loading */
  branchesLoading?: boolean;
  /** Enable async (paginated + backend-search) mode on the BranchSelector */
  branchesAsync?: boolean;
  /** Lifted search handler (debounced upstream) */
  onBranchSearchChange?: (value: string) => void;
  /** Load next page of branches */
  onBranchLoadMore?: () => void;
  /** Whether there are more branch pages to load */
  branchesHasMore?: boolean;
  /** True while the backend is searching branches */
  branchesSearching?: boolean;
  /** True while the next branch page is loading */
  branchesLoadingMore?: boolean;
  /** Whether archived branches are currently included in the backend results */
  branchesIncludeArchived?: boolean;
  /** Toggle includeArchived on the backend */
  onBranchToggleArchived?: () => void;
}

const ProjectReportsTemplate: React.FC<ProjectReportsTemplateProps> = ({
  projectId,
  projectTitle,
  teamName,
  highlightReportId,
  highlightKey,
  owaspReportData,
  cweReportData,
  loading,
  cweLoading,
  onGenerateOwaspReport,
  onGenerateCweReport,
  onDownloadOwaspReport,
  onDownloadCweReport,
  onClearOwaspReport,
  onClearCweReport,
  writesBlocked = false,
  branches = [],
  selectedBranch = null,
  onBranchChange,
  branchesLoading,
  branchesAsync,
  onBranchSearchChange,
  onBranchLoadMore,
  branchesHasMore,
  branchesSearching,
  branchesLoadingMore,
  branchesIncludeArchived,
  onBranchToggleArchived,
}) => {
  const { t } = useTranslation();
  // One format and one level of detail for the OWASP, CWE and EU AI Act
  // reports, chosen once in the shared settings card.
  const [selectedFormat, setSelectedFormat] = useState<'json' | 'html' | 'pdf'>('json');
  const [detailed, setDetailed] = useState<boolean>(true);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState<{ content: string; format: 'json' | 'html'; filename: string; downloadUrl?: string } | null>(null);

  // One shared stored-reports controller feeds BOTH the
  // header drawer AND the per-card "View N stored <type> reports" links, so a
  // delete in the drawer instantly updates every card count (single source of
  // truth). Wide first page so the client-side per-kind counts are accurate —
  // a single project realistically holds far fewer than 100 stored reports.
  const reportsController = useStoredReports(
    projectId ? { kind: 'project', projectId } : null,
    { initialPageSize: 100 },
  );
  const [storedReportsOpen, setStoredReportsOpen] = useState(
    !!highlightReportId,
  );
  const openStoredReports = () => setStoredReportsOpen(true);

  // On mount the drawer is already open and the list already loading: only a
  // later link to this page, which keeps the page mounted, acts here.
  const seenHighlightKey = useRef(highlightKey);
  useEffect(() => {
    if (highlightKey === seenHighlightKey.current) return;
    seenHighlightKey.current = highlightKey;
    if (!highlightReportId) return;
    setStoredReportsOpen(true);
    reportsController.refresh();
  }, [highlightKey, highlightReportId, reportsController]);
  const reportCountsByKind = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const it of reportsController.items) {
      const k = it.kind || it.reportType;
      if (k) acc[k] = (acc[k] ?? 0) + 1;
    }
    return acc;
  }, [reportsController.items]);

  const formatOptions: Option[] = [
    { label: 'JSON', value: 'json' },
    { label: 'HTML', value: 'html' },
    { label: 'PDF', value: 'pdf' },
  ];

  const handleGenerateOwasp = () => {
    onClearOwaspReport();
    onGenerateOwaspReport(selectedFormat, detailed);
  };

  const handleGenerateCwe = () => {
    onClearCweReport();
    onGenerateCweReport(selectedFormat, detailed);
  };

  const handlePreviewOwasp = () => {
    if (owaspReportData && (owaspReportData.format === 'html' || owaspReportData.format === 'json')) {
      setPreviewContent({
        // `content` is empty; the body lives behind the signed
        // downloadUrl, which the modal fetches for the inline preview.
        content: owaspReportData.content,
        format: owaspReportData.format as 'html' | 'json',
        filename: owaspReportData.filename,
        downloadUrl: owaspReportData.downloadUrl,
      });
      setIsPreviewModalOpen(true);
    }
  };

  const handlePreviewCwe = () => {
    if (cweReportData && (cweReportData.format === 'html' || cweReportData.format === 'json')) {
      setPreviewContent({
        // `content` is empty; the body lives behind the signed
        // downloadUrl, which the modal fetches for the inline preview.
        content: cweReportData.content,
        format: cweReportData.format as 'html' | 'json',
        filename: cweReportData.filename,
        downloadUrl: cweReportData.downloadUrl,
      });
      setIsPreviewModalOpen(true);
    }
  };

  const handleClosePreview = () => {
    setIsPreviewModalOpen(false);
    setPreviewContent(null);
  };

  const renderOwaspSection = () => {
    return (
      <Card>
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] mb-1 text-zinc-900 dark:text-zinc-100">
              {t('pages.projectReports.owaspReport')}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('pages.projectReports.owaspDescription')}
            </p>
          </div>

          <div className="flex gap-3">
            {writesBlocked ? (
              <div
                className="relative group inline-flex"
                data-testid="generate-owasp-blocked-wrapper"
              >
                <Button variant="white" disabled onClick={() => {}}>
                  {t('pages.projectReports.generate')}
                </Button>
                <div
                  role="tooltip"
                  className={cn(AS_TOOLTIP, "absolute left-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                >
                  {t('billing.trial_exhausted_report_disabled')}
                </div>
              </div>
            ) : (
              <Button
                variant="white"
                onClick={handleGenerateOwasp}
                loading={loading}
                disabled={loading}
              >
                {t('pages.projectReports.generate')}
              </Button>
            )}
            {owaspReportData && (
              <Button
                variant="white"
                onClick={onClearOwaspReport}
                disabled={loading}
              >
                {t('pages.projectReports.clear')}
              </Button>
            )}
          </div>

          {owaspReportData && !loading && (
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-as-line">
              {owaspReportData.format === 'pdf' ? (
                <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 shrink-0 text-zinc-500 dark:text-zinc-400" size={32} />
                    <div>
                      <h4 className="text-sm font-medium text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100">
                        {owaspReportData.filename}
                      </h4>
                      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        {t('pages.projectReports.pdfReady')}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={onDownloadOwaspReport}
                    icon={<Download size={18} />}
                  >
                    {t('pages.projectReports.download')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 shrink-0 text-zinc-500 dark:text-zinc-400" size={32} />
                    <div>
                      <h4 className="text-sm font-medium text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100">
                        {owaspReportData.filename}
                      </h4>
                      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        {owaspReportData.format.toUpperCase()} {t('pages.projectReports.reportReady')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="white"
                      onClick={handlePreviewOwasp}
                      icon={<Eye size={18} />}
                    >
                      {t('pages.projectReports.preview')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={onDownloadOwaspReport}
                      icon={<Download size={18} />}
                    >
                      {t('pages.projectReports.download')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <StoredReportTypeLink
            kind="owasp"
            count={reportCountsByKind['owasp'] ?? 0}
            onOpen={openStoredReports}
          />
        </div>
      </Card>
    );
  };

  const renderCweSection = () => {
    return (
      <Card>
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] mb-1 text-zinc-900 dark:text-zinc-100">
              {t('pages.projectReports.cweReport')}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('pages.projectReports.cweDescription')}
            </p>
          </div>

          <div className="flex gap-3">
            {writesBlocked ? (
              <div
                className="relative group inline-flex"
                data-testid="generate-cwe-blocked-wrapper"
              >
                <Button variant="white" disabled onClick={() => {}}>
                  {t('pages.projectReports.generate')}
                </Button>
                <div
                  role="tooltip"
                  className={cn(AS_TOOLTIP, "absolute left-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                >
                  {t('billing.trial_exhausted_report_disabled')}
                </div>
              </div>
            ) : (
              <Button
                variant="white"
                onClick={handleGenerateCwe}
                loading={cweLoading}
                disabled={cweLoading}
              >
                {t('pages.projectReports.generate')}
              </Button>
            )}
            {cweReportData && (
              <Button
                variant="white"
                onClick={onClearCweReport}
                disabled={cweLoading}
              >
                {t('pages.projectReports.clear')}
              </Button>
            )}
          </div>

          {cweReportData && !cweLoading && (
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-as-line">
              {cweReportData.format === 'pdf' ? (
                <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 shrink-0 text-zinc-500 dark:text-zinc-400" size={32} />
                    <div>
                      <h4 className="text-sm font-medium text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100">
                        {cweReportData.filename}
                      </h4>
                      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        {t('pages.projectReports.pdfReady')}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={onDownloadCweReport}
                    icon={<Download size={18} />}
                  >
                    {t('pages.projectReports.download')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 shrink-0 text-zinc-500 dark:text-zinc-400" size={32} />
                    <div>
                      <h4 className="text-sm font-medium text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100">
                        {cweReportData.filename}
                      </h4>
                      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                        {cweReportData.format.toUpperCase()} {t('pages.projectReports.reportReady')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="white"
                      onClick={handlePreviewCwe}
                      icon={<Eye size={18} />}
                    >
                      {t('pages.projectReports.preview')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={onDownloadCweReport}
                      icon={<Download size={18} />}
                    >
                      {t('pages.projectReports.download')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <StoredReportTypeLink
            kind="cwe"
            count={reportCountsByKind['cwe'] ?? 0}
            onOpen={openStoredReports}
          />
        </div>
      </Card>
    );
  };

  return (
    <ProjectTemplateWrapper
      projectId={projectId}
      projectTitle={projectTitle}
      selectedTab="reports"
    >
      <FeatureGate feature="reports" preview featureLabel="Reports" requiredPlan="team_v3">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* The section's glyph alone, in zinc, in its 32 px box (no tinted tile). */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
              {React.createElement(projectSectionIcon('reports'), {
                className: 'h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400',
              })}
            </div>
            <div>
              <h2 className={cn(AS_PAGE_TITLE, "text-xl sm:text-2xl")}>
                {t('pages.projectReports.title')}
              </h2>
              <div className="text-[13px] text-zinc-500 dark:text-zinc-400">
                {t('pages.projectOverview.team')} {teamName}
              </div>
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            {/* "Stored reports · N" → opens the shared history drawer
                (also fed by the per-card type links below). */}
            {projectId && (
              <button
                type="button"
                onClick={openStoredReports}
                className={cn("relative inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]", AS_FOCUS, AS_TOUCH)}
              >
                <Archive size={16} className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                {t('pages.reportsPage.storedReports.openButton', {
                  count: reportsController.total,
                })}
              </button>
            )}
            {/*
             * Branch filter applies to all 3 generated reports (OWASP / CWE /
             * EU AI Act). SBOM is project-wide and not affected. Hidden when the
             * project has no named branches AND no callback (defensive:
             * dumb-mode tests don't wire onBranchChange).
             */}
            {(branches.length > 0 || selectedBranch) && onBranchChange && (
              <div
                className="w-full sm:w-64"
                data-testid="reports-branch-selector"
              >
                <BranchSelector
                  branches={branches}
                  selectedBranch={selectedBranch}
                  onBranchChange={onBranchChange}
                  showAllOption={false}
                  label={t('pages.projectReports.branchFilter')}
                  compact
                  loading={branchesLoading}
                  async={branchesAsync}
                  onSearchChange={onBranchSearchChange}
                  onLoadMore={onBranchLoadMore}
                  hasMore={branchesHasMore}
                  searching={branchesSearching}
                  loadingMore={branchesLoadingMore}
                  includeArchived={branchesIncludeArchived}
                  onToggleArchived={onBranchToggleArchived}
                />
              </div>
            )}
          </div>
        </div>

        {/* Format and level of detail are one shared setting, so they are
            chosen once here. Each report card used to carry its own copy of
            these controls — three widgets always showing the same value. */}
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="sm:w-64">
              <Select
                label={t('pages.projectReports.format')}
                options={formatOptions}
                value={selectedFormat}
                onChange={(value) => setSelectedFormat(value as 'json' | 'html' | 'pdf')}
                placeholder={t('pages.projectReports.selectFormat')}
              />
            </div>
            <div className="flex items-center gap-3">
              <Toggle id="detailed-toggle" enabled={detailed} onChange={setDetailed} />
              <div>
                <label
                  htmlFor="detailed-toggle"
                  className={cn("relative inline-block text-sm font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer", AS_TOUCH)}
                >
                  {t('pages.projectReports.detailedReport')}
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('pages.projectReports.detailedDescription')}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {renderOwaspSection()}
        {renderCweSection()}
        {/* The SBOM, EU AI Act and per-scanner report cards are the
            registrations of the `project.reports.cards` slot (the closed tree's
            in a private build); the Community Edition renders none of them. */}
        <Slot
          name="project.reports.cards"
          context={{
            projectId,
            reports: {
              format: selectedFormat,
              detailed,
              selectedBranch,
              openStoredReports,
              storedReportCount: (kind: string) => reportCountsByKind[kind] ?? 0,
            },
          }}
        />
      </div>
      </FeatureGate>

      {projectId && (
        <StoredReportsDrawer
          open={storedReportsOpen}
          onClose={() => setStoredReportsOpen(false)}
          controller={reportsController}
          highlightReportId={highlightReportId}
          scopeMeta={{ teamName, projectTitle }}
        />
      )}

      {previewContent && (
        <ReportPreviewModal
          isOpen={isPreviewModalOpen}
          onClose={handleClosePreview}
          reportContent={previewContent.content}
          reportFormat={previewContent.format}
          reportFilename={previewContent.filename}
          downloadUrl={previewContent.downloadUrl}
          onDownload={
            previewContent.filename.includes('owasp')
              ? onDownloadOwaspReport
              : onDownloadCweReport
          }
        />
      )}
    </ProjectTemplateWrapper>
  );
};

export default ProjectReportsTemplate;
