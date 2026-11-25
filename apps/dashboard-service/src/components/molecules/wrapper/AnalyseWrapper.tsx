import { supportUrl } from '@/edition/support';
import React, { useCallback, useRef, useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { projectPath } from "@/utils/product";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";
import { ScanInfo, ScanResponseDto } from "../../../server/interfaces/Scan";
import { ProjectIntegrationInfo } from "../../../server/hooks/useProjectIntegrations";
import { Branch } from "../../../server/interfaces/Branch";
import { useEditionEntitlements } from "@/edition/entitlements";
import Button from "../../atoms/button/Button";
import LoaderScan from "../../atoms/loader/LoaderScan";
import StartAnalysisModal from "../start-analysis/StartAnalysisModal";
import ImportResultsButton from "../import-results/ImportResultsButton";
import { EDITION } from "@/edition/edition";
import { useScansRun } from "@/edition/community/instanceCapabilities";
import CustomTabs from "../sidebar/custom-tabs/CustomTabs";
import ProjectSectionNav from "./ProjectSectionNav";
import { usePublishProjectName } from "@/components/molecules/breadcrumbs/BreadcrumbProjectContext";
import LoaderIcon from "@/components/atoms/loader/LoaderIcon";
import useDisabledFeatures from "@/server/hooks/useDisabledFeatures";
import { useProjectBranchesList } from "@/server/hooks/useProjectBranchesList";
import { BranchSelector } from "@/components/molecules/branch-selector";
import SelectAtom from "../../atoms/select/Select";
import { useTranslation } from "react-i18next";
import SecurityContextBanner from "../banners/SecurityContextBanner";
import UploadFilterSummaryNotice from "../banners/UploadFilterSummaryNotice";
import { Ban } from '@/components/atoms/icon/icons';
import { format } from 'date-fns';
import { getScanErrorDetail, getScanErrorI18nKey, getCancelledScanI18nKey, isArchiveScanFailure, isScanRefusedByPlan } from '@/utils/function/scanErrorMessage';
import { buildScanPipelineView } from '@/utils/function/scanPipelineView';
import ScanPipelinePanel from './ScanPipelinePanel';
import { fr } from 'date-fns/locale';
import scanService from "@/server/services/scanService";
import { Slot, useSlotEntries } from "@/edition/slots";
import { CORE_SCANNER_TABS, isScannerTabEntry, scannerTabSegment, type CoreScannerTabKey } from "./scannerTabs";
import {
  isScanInProgress,
  isScanCancellable,
  branchSelectorRowState,
  scanModalContent,
  isStartOut,
  shouldShowPipelinePanel,
} from "./analyseWrapperLogic";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import { useScanBackgroundTask } from "@/server/hooks/useScanBackgroundTask";
import ProjectIdActions from "../project-id-actions/ProjectIdActions";
import { AS_FOCUS, AS_NOTICE, AS_PAGE_TITLE, AS_PANEL_TITLE, AS_TOOLTIP, AS_TOUCH, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/** The label key of each core scanner tab, in `components.analyseWrapper.tabs.*`. */
const SCANNER_TAB_LABELS: Record<CoreScannerTabKey, string> = {
  sast: "components.analyseWrapper.tabs.codeAnalysis",
  iac: "components.analyseWrapper.tabs.infrastructureAsCode",
  cicd: "components.analyseWrapper.tabs.cicd",
  secret: "components.analyseWrapper.tabs.secret",
  sca: "components.analyseWrapper.tabs.softwareCompositionAnalysis",
  container: "components.analyseWrapper.tabs.containerSecurity",
};

interface AnalyseWrapperProps {
  projectId: string | undefined;
  projectName: string;
  selectedTab: string;
  children: React.ReactNode;
  showStartScanModal: boolean;
  handleStartScanClick: () => void;
  handleCloseStartScanModal: () => void;
  handleScanSubmit: () => void;
  errors: { file?: string; imageUrl?: string; branchName?: string };
  setSelectedFile: (file: File | null) => void;
  showLoader: boolean;
  scanData: ScanResponseDto | null;
  vulnCount: number;
  showPulse: boolean;
  onCloseLoader: () => void;
  /** Callback to reopen the scan loader manually */
  onReopenLoader?: () => void;
  vulnCounts: { sast: number; iac: number; cicd: number; secret: number; sca: number; container: number; aibom?: number };
  loading: boolean;
  scanInfo: ScanInfo | null;
  uploadProgress?: number;
  /**
   * Community Edition on an instance that runs scans on a connected cluster:
   * « Import results », shown next to « Start scan », opens the page's import
   * dialog. Unused elsewhere.
   */
  onImportResultsClick?: () => void;
  isUploading?: boolean;
  selectedImageUrl?: string;
  setSelectedImageUrl?: (url: string) => void;
  linkedGithubRepo?: string | null;
  linkedGitlabRepo?: string | null;
  integrationInfo?: ProjectIntegrationInfo;
  agentPhase?: string;
  agentAction?: string;
  agentMessage?: string;
  agentProgress?: number;
  /**
   * Not read here, and no caller passes them: the results templates give these
   * ids to their tables. The props stay declared so that the interface does
   * not change.
   */
  agentActiveIds?: string[];
  agentProcessedIds?: string[];
  /**
   * No longer read here: the scan pipeline panel derives the scanner phase from
   * `scanData`. Still passed by the results pages, which use it themselves.
   */
  classicDone?: boolean;
  // Branch selection props - unified for filtering AND scanning
  branches?: Branch[];
  selectedBranch?: string;
  onBranchChange?: (branch: string) => void;
  loadingBranches?: boolean;
  defaultBranch?: string;
  // Archive handlers
  onArchive?: (branchName: string) => void;
  onUnarchive?: (branchName: string) => void;
  // Branch name for manual ZIP uploads
  manualBranchName?: string;
  onManualBranchNameChange?: (name: string) => void;
  // Optional banner rendered after the scan-status block, used by
  // SAST/IAC/CICD list pages to surface the count of outdated analyses.
  afterStatusBanner?: React.ReactNode;
  // Focus Top 5 entry point hoisted to the page header so the Cybe
  // agent provenance is visible at a glance. The list pages still own the
  // overlay state and pass the toggle handler down here.
  onFocusTop5?: () => void;
  focusTop5Active?: boolean;
  // Customization flag forwarded from useProjectPageData (sourced from the
  // /project/:id payload already fetched by the parent page). null while
  // loading; treated as "customized" until proven otherwise to avoid the
  // banner flashing on mount.
  isSecurityContextCustomized?: boolean | null;
}

const AnalyseWrapper: React.FC<AnalyseWrapperProps> = ({
  projectId,
  projectName,
  selectedTab,
  children,
  showStartScanModal,
  handleStartScanClick,
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
  onImportResultsClick,
  isUploading,
  selectedImageUrl,
  setSelectedImageUrl,
  linkedGithubRepo,
  linkedGitlabRepo,
  integrationInfo,
  agentPhase,
  agentAction,
  agentMessage,
  agentProgress,
  // Branch selection props - unified for filtering AND scanning
  branches,
  selectedBranch,
  onBranchChange,
  loadingBranches,
  defaultBranch,
  // Archive handlers
  onArchive,
  onUnarchive,
  // Branch name for manual ZIP uploads
  manualBranchName,
  onManualBranchNameChange,
  afterStatusBanner,
  onFocusTop5,

  isSecurityContextCustomized,
}) => {
  // The breadcrumb only knows the URL; give it the project's name.
  usePublishProjectName(projectName);

  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const writesBlocked = useEditionEntitlements().writesBlocked;
  const branchSelectorRef = useRef<HTMLDivElement>(null);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Id of the scan we just cancelled. `handleCancelConfirm` runs the
  // cancel here (the page that owns `scanData` isn't notified), so the prop
  // keeps reporting the old non-terminal state until the next poll (≤10s).
  // Remembering the id lets the header drop the "in progress" block + Cancel
  // button immediately instead of lingering on "Waiting for File" (and lets a
  // second cancel — which would error on an already-cancelled scan — be
  // impossible because the button is gone).
  const [cancelledScanId, setCancelledScanId] = useState<string | null>(null);
  const scanInProgress = isScanInProgress(scanData, cancelledScanId);
  const scanCancellable = isScanCancellable(scanData, cancelledScanId);

  // Mirror the scan this page is tracking into the global
  // background-tasks panel. A locally-cancelled scan is reported as
  // "cancelled" right away (same immediate-feedback rationale as above)
  // instead of lingering "running" until the next poll resolves it.
  // The page takes the scan from the app-root tracker, so it
  // must be a scan the page really reads: one of the route's project. The
  // results routes keep this element when `:projectId` changes, and a page
  // can still hold the previous project's scan, which it can no longer read.
  const scanIsThisProjects =
    !!scanData?.id && (!scanData.projectId || scanData.projectId === projectId);
  useScanBackgroundTask(
    scanIsThisProjects
      ? {
          id: scanData.id,
          projectId: scanData.projectId ?? projectId,
          state:
            cancelledScanId && cancelledScanId === scanData.id
              ? "cancelled"
              : scanData.state,
          progress: scanData.progress,
        }
      : null,
  );

  // Auto-close the cancel modal if the scan is no longer in a cancellable state
  useEffect(() => {
    if (showCancelConfirm && !scanCancellable) {
      setShowCancelConfirm(false);
    }
  }, [scanCancellable, showCancelConfirm]);

  const handleCancelScan = useCallback(() => {
    if (!projectId || !scanData?.id) return;
    setShowCancelConfirm(true);
  }, [projectId, scanData?.id]);

  const handleCancelConfirm = useCallback(async () => {
    if (!projectId || !scanData?.id) return;
      try {
      await scanService.cancelScan(projectId, scanData.id);
      // Optimistically mark this scan cancelled so the in-progress header +
      // Cancel button disappear at once, before the next poll catches up.
      setCancelledScanId(scanData.id);
      toast.success(t('components.loaderScan.stateCancelled'));
      setShowCancelConfirm(false);
      onCloseLoader();
    } catch {
      toast.error(t('components.loaderScan.stateFailed'));
    }
  }, [projectId, scanData?.id, onCloseLoader, t]);

  // Feature gating — container scanning is gated via subscription featuresDisabled
  // (the closed tree's own tabs, the AI-BOM one, gate themselves in their slot).
  const disabledFeatures = useDisabledFeatures();
  const isContainerLocked = disabledFeatures.has('container_scanning');

  // Unified paginated/searchable branch source — powers the option lists of
  // the filter dropdown and of the scan modal's branch picker. Selection,
  // localStorage, URL ?branch= and code-graph coordination stay page-owned
  // (via the selectedBranch/onBranchChange props from useProjectPageData,
  // whose `branches` are the first page of this same list).
  const bl = useProjectBranchesList(projectId ?? null);
  // The page reloads its own branches after an (un)archive; the selector holds
  // its own list, reloaded here once the page's handler is done, success or
  // failure. A failure was already logged by the page's handler: the click
  // that started it awaits nothing, so it is not rethrown.
  const archiveThenReload = async (handler: (name: string) => void | Promise<void>, name: string) => {
    try {
      await handler(name);
    } catch {
      // logged by the handler
    } finally {
      await bl.reload?.();
    }
  };
  const scanPickerBranches = useMemo<Branch[]>(
    () =>
      bl.branches.map((b) => ({
        name: b.name,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
        archived: b.archived,
      })),
    [bl.branches],
  );
  // One object for the picker's search props, rebuilt only when the list's
  // state changes (not on every render of the page, e.g. each scan poll).
  const scanPickerSearch = useMemo(
    () => ({
      onSearchChange: bl.setSearch,
      onLoadMore: bl.loadMore,
      hasMore: bl.hasMore,
      searching: bl.searching,
      loadingMore: bl.loadingMore,
    }),
    [bl.setSearch, bl.loadMore, bl.hasMore, bl.searching, bl.loadingMore],
  );

  // The page renders before its branch list has loaded: the selector row and
  // the scan modal show a loading state of their own meanwhile.
  const branchRow = branchSelectorRowState(branches?.length ?? 0, !!loadingBranches);
  const modalContent = scanModalContent(
    integrationInfo?.type,
    branches?.length ?? 0,
    !!loadingBranches,
  );

  // Convert branches to SelectAtom options format
  const branchOptions = useMemo(() => {
    if (!branches) return [];
    return branches.map((branch) => ({
      label: branch.isDefault
        ? `${branch.name} (${t('components.branchSelector.defaultBadge')})`
        : branch.name,
      value: branch.name,
    }));
  }, [branches, t]);

  // Tabs navigation: each scan type has its AppSec results page. The core
  // scanner tabs come from CORE_SCANNER_TABS (each key is its URL segment);
  // the closed tree's tabs (the AI-BOM one) are `project.tabs` registrations
  // whose id starts with `scanner:`, rendered after them.
  const resultsPath = (tab: string): string | undefined =>
    projectId ? projectPath("appsec", projectId, tab) : undefined;

  const onSelectTab = (tab: string) => {
    const path = resultsPath(tab);
    if (path) navigate(path);
  };

  const scannerSlotEntries = useSlotEntries("project.tabs").filter(isScannerTabEntry);

  const tabs = CORE_SCANNER_TABS.map(({ key }) => ({
    label: t(SCANNER_TAB_LABELS[key]),
    value: key,
    link: key === "container" && isContainerLocked ? undefined : resultsPath(key),
    locked: key === "container" ? isContainerLocked : undefined,
    tooltip: key === "container" && isContainerLocked ? t('billing.container_scanning_locked') : undefined,
  }));

  // Community Edition: on an import-only instance no scanner runs, the
  // start action imports a SARIF file. On an instance that runs scans on a
  // connected cluster, every tab but Container starts a scan and offers the
  // import next to it (no image scan in v1).
  const scansRun = useScansRun();
  const isCommunity = EDITION === 'community';
  const importsOnly = isCommunity && (!scansRun || selectedTab === 'container');
  const buttonText = importsOnly
    ? t('components.importResults.button')
    : selectedTab === 'container'
      ? t('components.analyseWrapper.addImage')
      : t('components.analyseWrapper.startScan');

  // Where the tracked scan really is (queue, scanners, AI lane). Rebuilt on
  // every poll or realtime refetch, which also moves the elapsed time on.
  const pipelineView = useMemo(
    () => (scanData ? buildScanPipelineView(scanData, new Date()) : null),
    [scanData],
  );
  const showPipelinePanel = shouldShowPipelinePanel(scanData, pipelineView, showLoader, cancelledScanId);

  return (
    <div>
      <div className="bg-white dark:bg-as-surface dark:text-zinc-100">
        {/* Project header: title + primary actions. Not gated on the
            vulnerability-results `loading` flag — this data comes from
            useProjectPageData (cached, hydrated synchronously on navigation),
            so switching scan-type tabs never flashes a skeleton over the
            project name. Only the table + per-tab counts below reflect loading. */}
        <div className="px-4 pt-5 pb-3 sm:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              {/* The title takes the row (`lg:flex-auto`): the project name
                  first, then the project's actions (a state pill) in what is left. */}
              <div className="flex items-center gap-2 min-w-0 lg:flex-auto">
                {/* The page renders before /project/:id answers: the name
                    comes from it or from the list, whichever arrives first. */}
                {projectName ? (
                  <h1
                    className={cn(AS_PAGE_TITLE, 'truncate')}
                    title={projectName}
                  >
                    {projectName}
                  </h1>
                ) : (
                  <Skeleton type="line" width="220px" height="28px" />
                )}
                {projectId && <ProjectIdActions projectId={projectId} />}
              </div>
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                {/* The « Focus Top 5 » entry: a `project.actions`
                    registration of the active edition (host `analyse-actions`,
                    so the project-id row's host does not render it too). The
                    prop only gates it: the list is not empty. */}
                {onFocusTop5 && (
                  <Slot
                    name="project.actions"
                    context={{ projectId, placement: "header", host: "analyse-actions", projectName }}
                  />
                )}
                {/* Show scan in progress when scanData exists and running, OR when showLoader is true (initializing) */}
                {scanInProgress || (showLoader && !scanData) ? (
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-3">
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 hidden sm:block leading-tight">
                        <p className="font-medium">{t('components.analyseWrapper.scanInProgress')}</p>
                        {/* One status line, from the same view model as the pipeline panel below. */}
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {pipelineView
                            ? t(pipelineView.headline.key, pipelineView.headline.params)
                            : t('components.loaderScan.stateInitializing')}
                        </p>
                      </div>
                      {scanCancellable && (
                        <button
                          onClick={handleCancelScan}
                          className={`relative inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-50 dark:border-as-line-strong dark:text-zinc-200 dark:hover:bg-white/[0.06] ${AS_FOCUS} ${AS_TOUCH}`}
                        >
                          <Ban className="w-3.5 h-3.5" />
                          {t('components.loaderScan.buttonCancel')}
                        </button>
                      )}
                      <LoaderIcon />
                    </div>
                  </div>
                ) : writesBlocked ? (
                  <div
                    className="relative group inline-flex"
                    data-testid="scan-button-blocked-wrapper"
                  >
                    <Button variant="secondary" disabled onClick={() => {}}>
                      {buttonText}
                    </Button>
                    <div
                      role="tooltip"
                      className={`absolute right-0 top-full mt-2 w-72 ${AS_TOOLTIP} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50`}
                    >
                      {t('billing.read_only_scan_disabled')}
                    </div>
                  </div>
                ) : importsOnly ? (
                  <ImportResultsButton onClick={handleStartScanClick} />
                ) : (
                  <>
                    <Button variant="secondary" onClick={handleStartScanClick}>
                      {buttonText}
                    </Button>
                    {isCommunity && onImportResultsClick && (
                      <ImportResultsButton onClick={onImportResultsClick} />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unified project navigation — identical underline tabs to the
            section pages (Overview, Code Graph, …). */}
        <ProjectSectionNav projectId={projectId} active="vulnerabilities" />

        {/* Vulnerabilities controls: branch selector + scan status banners. */}
        <div className="px-4 pt-4 sm:px-6">
          {branchRow === 'loading' && (
            <div className="flex items-center gap-2 flex-wrap" data-testid="branch-selector-loading">
              <span className="text-sm text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                {t('components.branchSelector.label')}:
              </span>
              <Skeleton type="block" height="32px" width="220px" rounded="xl" />
            </div>
          )}
          {/* Branch selector row - show if branches available (integration or from vulnerability detections) */}
          {branchRow === 'ready' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                {t('components.branchSelector.label')}:
              </span>
              <BranchSelector
                async
                branches={bl.branches}
                selectedBranch={selectedBranch || defaultBranch || null}
                onBranchChange={(val) => onBranchChange?.(val || defaultBranch || '')}
                onArchive={onArchive ? (name) => archiveThenReload(onArchive, name) : undefined}
                onUnarchive={onUnarchive ? (name) => archiveThenReload(onUnarchive, name) : undefined}
                onSearchChange={bl.setSearch}
                onLoadMore={bl.loadMore}
                hasMore={bl.hasMore}
                searching={bl.searching}
                loadingMore={bl.loadingMore}
                includeArchived={bl.includeArchived}
                onToggleArchived={bl.toggleArchived}
                showAllOption={false}
                compact
                loading={bl.loading}
              />
            </div>
          )}

          {/* Scan Status Display — the pipeline panel speaks for a scan in progress; a finished scan keeps its banner */}
          {scanInfo && !(showPipelinePanel && scanInProgress) && (
            <div className="mt-4 space-y-2">
              {/* Hairline rows, the status sentence written in its colour (no dot), in place of the tinted banners. */}
              {scanInfo.state === 'completed' && scanInfo.scanId && (
                <div className={`${AS_NOTICE} justify-between gap-x-4 max-md:flex-col max-md:items-start max-md:gap-1`}>
                  <div className="flex items-center gap-2">
                    <p className={`font-medium ${AS_WORD_TONE.good}`}>{t('components.analyseWrapper.scanStatus.completed')}</p>
                  </div>
                  <div className="text-right flex-shrink-0 max-md:text-left text-zinc-500 dark:text-zinc-400">
                    <p className="text-xs tabular-nums">
                      {t('components.analyseWrapper.scanStatus.lastScanDate')} {format(new Date(scanInfo.createAt), 'PPpp', { locale: i18n.language === 'fr' ? fr : undefined })}
                    </p>
                    {scanInfo.scanType && scanInfo.scanType.length > 0 && (
                      <p className="text-xs tabular-nums">
                        {t('components.analyseWrapper.scanStatus.scanTypes')} {Array.isArray(scanInfo.scanType) ? scanInfo.scanType.join(', ') : scanInfo.scanType}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {scanInfo.state === 'failed' && scanInfo.scanId && (
                <div className={`${AS_NOTICE} justify-between gap-x-4 max-md:flex-col max-md:items-start max-md:gap-1`}>
                  <div className="flex items-center gap-2">
                    <p className={`font-medium ${AS_WORD_TONE.bad}`}>
                      {t(getScanErrorI18nKey(scanData?.errorCode, scanData?.errorCategory, scanData?.errorMessage))}
                      {/* An archive refused on a limit names the limit this instance applies. */}
                      {isArchiveScanFailure(scanData?.errorCode, scanData?.errorCategory) &&
                        getScanErrorDetail(scanData?.errorCode, scanData?.errorCategory, scanData?.errorMessage) && (
                          <> {getScanErrorDetail(scanData?.errorCode, scanData?.errorCategory, scanData?.errorMessage)}.</>
                        )}
                      {/* Support cannot lift a plan refusal (a trial with no scan left). */}
                      {!isScanRefusedByPlan(scanData?.errorMessage) && (
                        <>
                          {' '}
                          <a href={supportUrl()} target="_blank" rel="noopener noreferrer" className="underline font-medium text-secondary hover:opacity-80 dark:text-secondary-light">{t('common.contactSupport')}</a>.
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 max-md:text-left text-zinc-500 dark:text-zinc-400">
                    <p className="text-xs tabular-nums">
                      {t('components.analyseWrapper.scanStatus.lastScanDate')} {format(new Date(scanInfo.createAt), 'PPpp', { locale: i18n.language === 'fr' ? fr : undefined })}
                    </p>
                    {scanInfo.scanType && scanInfo.scanType.length > 0 && (
                      <p className="text-xs tabular-nums">
                        {t('components.analyseWrapper.scanStatus.scanTypes')} {Array.isArray(scanInfo.scanType) ? scanInfo.scanType.join(', ') : scanInfo.scanType}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {scanInfo.state === 'completed_degraded' && scanInfo.scanId && (
                <div className={`${AS_NOTICE} justify-between gap-x-4 max-md:flex-col max-md:items-start max-md:gap-1`}>
                  <div className="flex items-center gap-2">
                    <p className={`font-medium ${AS_WORD_TONE.warning}`}>{t('components.analyseWrapper.scanStatus.degraded')}</p>
                  </div>
                  <div className="text-right flex-shrink-0 max-md:text-left text-zinc-500 dark:text-zinc-400">
                    <p className="text-xs tabular-nums">
                      {t('components.analyseWrapper.scanStatus.lastScanDate')} {format(new Date(scanInfo.createAt), 'PPpp', { locale: i18n.language === 'fr' ? fr : undefined })}
                    </p>
                    {scanInfo.scanType && scanInfo.scanType.length > 0 && (
                      <p className="text-xs tabular-nums">
                        {t('components.analyseWrapper.scanStatus.scanTypes')} {Array.isArray(scanInfo.scanType) ? scanInfo.scanType.join(', ') : scanInfo.scanType}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {scanInfo.state === 'cancelled' && scanInfo.scanId && (
                <div className={`${AS_NOTICE} justify-between gap-x-4 max-md:flex-col max-md:items-start max-md:gap-1`}>
                  <div className="flex items-center gap-2">
                    {/* A cancellation can carry a reason (a stalled
                        queue, say). Show it in this same neutral banner — never the
                        red "contact support" one, which is reserved for `failed`. */}
                    <p className="font-medium">{t(getCancelledScanI18nKey(scanData?.errorCode, scanData?.errorCategory))}</p>
                  </div>
                  <div className="text-right flex-shrink-0 max-md:text-left">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('components.analyseWrapper.scanStatus.lastScanDate')} {format(new Date(scanInfo.createAt), 'PPpp', { locale: i18n.language === 'fr' ? fr : undefined })}
                    </p>
                    {scanInfo.scanType && scanInfo.scanType.length > 0 && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t('components.analyseWrapper.scanStatus.scanTypes')} {Array.isArray(scanInfo.scanType) ? scanInfo.scanType.join(', ') : scanInfo.scanType}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* End Scan Status Display */}

          {/* What the upload filter left out of this scan's archive; the notice renders nothing when nothing was. */}
          {scanIsThisProjects && scanData.uploadFilterSummary && (
            <div className="mt-3 empty:hidden">
              <UploadFilterSummaryNotice summary={scanData.uploadFilterSummary} />
            </div>
          )}

          {afterStatusBanner && (
            <div className="mt-3">{afterStatusBanner}</div>
          )}

          {/* Scan pipeline: queue, scanners, AI lane — hidden while the LoaderScan modal is open */}
          {showPipelinePanel && pipelineView && <ScanPipelinePanel view={pipelineView} />}
        </div>

        <div className="empty:hidden mt-2">
          <SecurityContextBanner
            projectId={projectId || ""}
            isCustomized={isSecurityContextCustomized ?? true}
          />
        </div>

        <CustomTabs
          selectedTab={selectedTab}
          onSelectTab={onSelectTab}
          tabs={tabs}
          vulnCounts={vulnCounts}
          loading={loading}
        >
          {scannerSlotEntries.map((entry) => (
            <React.Fragment key={entry.id}>
              {entry.render({
                projectId,
                product: "appsec",
                tabs: {
                  active: selectedTab,
                  // A slot tab's value may differ from its URL segment
                  // (`aibom` vs `ai-bom`): selecting it opens its own segment.
                  select: () => {
                    const path = resultsPath(scannerTabSegment(entry.id));
                    if (path) navigate(path);
                  },
                  hidden: [],
                  hide: () => undefined,
                },
              })}
            </React.Fragment>
          ))}
        </CustomTabs>
      </div>

      <div className="p-4 sm:p-6">{children}</div>

      {showStartScanModal && selectedTab !== 'container' && !importsOnly && (
        <StartAnalysisModal
          content={modalContent}
          onClose={handleCloseStartScanModal}
          onSubmit={handleScanSubmit}
          errors={errors}
          setSelectedFile={setSelectedFile}
          manualBranchName={manualBranchName}
          onManualBranchNameChange={onManualBranchNameChange}
          branches={scanPickerBranches}
          selectedBranch={selectedBranch}
          defaultBranch={defaultBranch}
          onBranchChange={onBranchChange}
          loadingBranches={loadingBranches || bl.loading}
          branchSearch={scanPickerSearch}
          submitting={isStartOut(scanData)}
        />
      )}

      {showLoader && (
        <LoaderScan
          scanData={scanData}
          vulnCount={vulnCount}
          showPulse={showPulse}
          onClose={onCloseLoader}
          uploadProgress={uploadProgress}
          isUploading={isUploading}
          isContainerScan={selectedTab === 'container'}
          isGithubScan={linkedGithubRepo !== null && linkedGithubRepo !== undefined}
          isGitlabScan={linkedGitlabRepo !== null && linkedGitlabRepo !== undefined}
          agentPhase={agentPhase}
          agentAction={agentAction}
          agentMessage={agentMessage}
          agentProgress={agentProgress}
          onCancel={handleCancelScan}
        />
      )}

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm bg-black/60">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 w-full max-w-sm shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18)] dark:border-as-line-strong dark:bg-as-surface">
            <div className="flex items-start gap-3 mb-4">
              {/* The glyph keeps its box and loses its tinted tile; the red stays on the glyph. */}
              <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center">
                <Ban className="h-[18px] w-[18px] text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className={AS_PANEL_TITLE}>
                  {t('components.loaderScan.buttonCancel')}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                  {t('components.loaderScan.messageCancelled')}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className={`relative inline-flex h-8 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:bg-white/[0.09] ${AS_FOCUS} ${AS_TOUCH}`}
              >
                {t('components.loaderScan.buttonDismiss')}
              </button>
              <button
                onClick={handleCancelConfirm}
                className={`relative inline-flex h-8 items-center justify-center rounded-lg bg-red-600 px-3.5 text-sm font-medium text-white transition-colors duration-[120ms] hover:bg-red-700 ${AS_FOCUS} ${AS_TOUCH}`}
              >
                {t('components.loaderScan.buttonCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyseWrapper;