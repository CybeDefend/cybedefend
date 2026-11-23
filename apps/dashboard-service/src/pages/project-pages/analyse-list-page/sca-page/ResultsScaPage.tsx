import useProjectPackages from "@/server/hooks/useProjectPackages";
import useLicenseSummary from "@/server/hooks/useLicenseSummary";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useParams, useSearchParams } from "react-router-dom";
import BatchUpdateModal from "@/components/molecules/modal/batch-update-modal/BatchUpdateModal";
import SelectionActionBar from "@/components/molecules/selection-action-bar/SelectionActionBar";
import { BatchUpdateVulnerabilitiesRequest } from "@/server/interfaces/Vulnerability";
import { buildBatchUpdateItems, BatchUpdateFormData } from "@/utils/function/batchUpdateItems";
import { startBatchUpdate } from "@/server/store/backgroundTasksThunks";
import type { AppDispatch } from "@/server/store";
import { useBatchUpdateCompletion } from "@/server/hooks/useBatchUpdateCompletion";
import useProjectVulnerabilities from "../../../../server/hooks/useProjectVulnerabilities";
import { useProjectPageData } from "../../../../server/hooks/useProjectPageData";
import { useGroupedVulnerabilities } from "../../../../server/hooks/useGroupedVulnerabilities";
import { ViewMode } from "@/components/molecules/view-mode-toggle/ViewModeToggle";
import { ScanResponseDto } from "../../../../server/interfaces/Scan";
import scanService from "../../../../server/services/scanService";
import { RootState } from "../../../../server/store";
import {
  exploitabilityDefaultValues,
  orderOptions,
  priorityDefaultValues,
  severityDefaultValues,
  statusDefaultValues,
} from "../../../../utils/data/resultsVulnData";
import { sanitizeStatusFilter } from "../../../../utils/data/historyVulnData";
import ResultsScaTemplate, { CORE_SCA_VIEWS } from "./ResultsScaTemplate";
import { activeExtensions } from "@/edition/active";
import { EDITION } from "@/edition/edition";
import { useScansRun } from "@/edition/community/instanceCapabilities";
import type { ScaViewExtension } from "@/edition/extensions";
import { useResultColumns } from "@/server/hooks/useResultColumns";
import { shouldOfferFocusTop5 } from "@/components/molecules/focus-top5/focusTop5Logic";
import { useTranslation } from "react-i18next";
import { AnalysePageSkeleton } from "@/components/molecules/skeleton/AnalysePageSkeleton";
import { parseAgentStep, isAgentContainer } from "@/utils/function/agentParser";
import { useIssueTracking } from "@/server/hooks/useIssueTracking";
import { useScanRealtime, ScanStatusChangedPayload } from "@/server/hooks/useScanRealtime";
import { skipWhenHidden, useCatchUpWhenVisible } from "@/server/hooks/usePollingWhenVisible";
import { isScanGone } from "@/server/store/scanTask";
import { useStartAnalysis } from "@/server/hooks/useStartAnalysis";
import ImportResultsDialog from "@/components/molecules/import-results/ImportResultsDialog";
import {
  archiveStartErrorMessage,
  placeholderScan,
  repositoryStartErrorMessage,
} from "../startAnalysisLoader";

/** A SARIF import never fills a licence: the licences view is not offered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';
const isShownCoreView = (view: string): boolean =>
  (CORE_SCA_VIEWS as readonly string[]).includes(view) && !(SCANNER_ONLY_HIDDEN && view === 'licenses');

const ResultsScaPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const organization = useSelector((state: RootState) => state.organization);
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();

  // Use unified page data hook - loads integrations, branches in correct order
  const {
    isContentReady,
    isLoadingBranches,
    isBranchResolved,
    projectName: pageDataProjectName,
    integrationInfo,
    linkedGithubRepo,
    linkedGitlabRepo,
    isSecurityContextCustomized,
    isJiraLinked,
    isLinearLinked,
    branches,
    defaultBranch,
    selectedBranch,
    setSelectedBranch,
    refresh: refreshPageData,
    handleArchiveBranch,
    handleUnarchiveBranch,
  } = useProjectPageData(projectId!);

  // The Jira and Linear tickets of the project, and which tool can take one
  const issueTracking = useIssueTracking(projectId || "", { isJiraLinked, isLinearLinked });

  const storageKeys = {
    selectedSeverity: `selectedSeveritySca_${projectId}`,
    selectedStatus: `selectedStatusSca_${projectId}`,
    selectedPriority: `selectedPrioritySca_${projectId}`,
    selectedExploitability: `selectedExploitabilityScaV2_${projectId}`,
    selectedOrder: `selectedOrderSca_${projectId}`,
    selectedOrderDirection: `selectedOrderDirectionSca_${projectId}`,
    selectedPackageTypeVuln: `selectedPackageTypeVulnSca_${projectId}`,
    selectedPackageType: `selectedPackageTypeSca_${projectId}`,
    pageSize: `pageSizeSca_${projectId}`,
    currentPage: `currentPageSca_${projectId}`,
    triageMode: `triageModeSca_${projectId}`,
  };

  const [selectedSeverity, setSelectedSeverity] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedSeverity);
    return saved ? JSON.parse(saved) : severityDefaultValues;
  });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedSeverity,
      JSON.stringify(selectedSeverity)
    );
  }, [selectedSeverity]);

  const [selectedStatus, setSelectedStatus] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedStatus);
    const fromSaved = saved ? sanitizeStatusFilter(JSON.parse(saved)) : [];
    return fromSaved.length ? fromSaved : statusDefaultValues;
  });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedStatus,
      JSON.stringify(selectedStatus)
    );
  }, [selectedStatus]);

  const [selectedPriority, setSelectedPriority] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedPriority);
    return saved ? JSON.parse(saved) : priorityDefaultValues;
  });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedPriority,
      JSON.stringify(selectedPriority)
    );
  }, [selectedPriority]);

  // Exploitability verdict filter
  const [selectedExploitability, setSelectedExploitability] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedExploitability);
    return saved ? JSON.parse(saved) : exploitabilityDefaultValues;
  });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedExploitability,
      JSON.stringify(selectedExploitability)
    );
  }, [selectedExploitability]);

  // Triage mode is a sort-only toggle (priorityScore DESC). It does
  // not touch the exploitability filter — the user controls that independently.
  const [triageMode, setTriageMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKeys.triageMode);
    return saved ? JSON.parse(saved) : true;
  });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.triageMode,
      JSON.stringify(triageMode)
    );
  }, [triageMode]);

  // The columns the active edition adds to the vulnerabilities table, each
  // shown or hidden per project (the cloud's EPSS column).
  const resultColumns = useResultColumns("sca", projectId ?? "");

  const handleTriageModeChange = useCallback((value: boolean) => {
    setTriageMode(value);
  }, []);

  // Focus Top 5 overlay state (wired to <Top5Overlay>).
  const [showTop5, setShowTop5] = useState<boolean>(false);
  const handleFocusTop5 = useCallback(() => {
    setShowTop5((prev) => !prev);
  }, []);

  const [selectedPackageTypeVuln, setSelectedPackageTypeVuln] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedPackageTypeVuln);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Remove "all" from old saved values and ensure we have at least one valid option
          const filteredParsed = parsed.filter(value => value !== "all");
          return filteredParsed.length > 0 ? filteredParsed : ["direct", "dev", "transitive"];
        }
        // Handle old string values
        return saved !== "all" ? [saved] : ["direct", "dev", "transitive"];
      } catch {
        // If JSON.parse fails, treat it as a plain string
        return saved !== "all" ? [saved] : ["direct", "dev", "transitive"];
      }
    }
    return ["direct", "dev", "transitive"];
  });
  useEffect(() => {
    localStorage.setItem(storageKeys.selectedPackageTypeVuln, JSON.stringify(selectedPackageTypeVuln));
  }, [selectedPackageTypeVuln]);

  const [selectedPackageType, setSelectedPackageType] = useState<string[]>(() => {
    const saved = localStorage.getItem(storageKeys.selectedPackageType);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Remove "all" from old saved values and ensure we have at least one valid option
          const filteredParsed = parsed.filter(value => value !== "all");
          return filteredParsed.length > 0 ? filteredParsed : ["direct", "dev", "transitive"];
        }
        // Handle old string values
        return saved !== "all" ? [saved] : ["direct", "dev", "transitive"];
      } catch {
        // If JSON.parse fails, treat it as a plain string
        return saved !== "all" ? [saved] : ["direct", "dev", "transitive"];
      }
    }
    return ["direct", "dev", "transitive"];
  });
  useEffect(() => {
    localStorage.setItem(storageKeys.selectedPackageType, JSON.stringify(selectedPackageType));
  }, [selectedPackageType]);

  // Add toggle state for dev and test dependencies
  const [includeDevAndTest, setIncludeDevAndTest] = useState<boolean>(() => {
    const saved = localStorage.getItem(`includeDevAndTest_${projectId}`);
    return saved ? JSON.parse(saved) : true;
  });
  useEffect(() => {
    localStorage.setItem(`includeDevAndTest_${projectId}`, JSON.stringify(includeDevAndTest));
  }, [includeDevAndTest, projectId]);

  // Handle toggle change - automatically manage package type selections
  const handleIncludeDevAndTestChange = (enabled: boolean) => {
    setIncludeDevAndTest(enabled);

    if (enabled) {
      // When enabled, automatically select ALL package types
      setSelectedPackageTypeVuln(["direct", "dev", "transitive"]);
      setSelectedPackageType(["direct", "dev", "transitive"]);
    } else {
      // When disabled, select only direct (but selects will be hidden)
      setSelectedPackageTypeVuln(["direct"]);
      setSelectedPackageType(["direct"]);
    }

    // Reset both paginations to page 1
    goToPage(1);
  };

  const [selectedOrder, setSelectedOrder] = useState<string>(() => {
    const saved = localStorage.getItem(storageKeys.selectedOrder);
    return saved ? saved : "currentSeverity";
  });
  useEffect(() => {
    localStorage.setItem(storageKeys.selectedOrder, selectedOrder);
  }, [selectedOrder]);

  const orderDirectionOptions = [
    { label: t('common.ascending'), value: "asc" },
    { label: t('common.descending'), value: "desc" },
  ];
  const [selectedOrderDirection, setSelectedOrderDirection] = useState<string>(
    () => {
      const saved = localStorage.getItem(storageKeys.selectedOrderDirection);
      return saved ? saved : "desc";
    }
  );
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedOrderDirection,
      selectedOrderDirection
    );
  }, [selectedOrderDirection]);

  // View mode state (detailed or grouped)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`viewModeSca_${projectId}`);
    return (saved as ViewMode) || 'grouped';
  });

  useEffect(() => {
    localStorage.setItem(`viewModeSca_${projectId}`, viewMode);
  }, [viewMode, projectId]);

  // View state: the core's vulnerabilities, packages and licenses tabs, and
  // the views the active edition adds (the cloud's Malware tab). A deep link
  // to a view this edition does not have opens the vulnerabilities.
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [extensionViews] = useState<readonly ScaViewExtension[]>(() =>
    [...(activeExtensions().scaViews ?? [])].sort((a, b) => a.order - b.order),
  );
  const [view, setView] = useState<string>(() =>
    initialTab &&
    (isShownCoreView(initialTab) ||
      extensionViews.some((extension) => extension.id === initialTab))
      ? initialTab
      : 'vulnerabilities'
  );
  // What each added view asks the list routes for, merged into both hooks'
  // options for every view (the cloud's `malwareOnly`: only malware on its
  // tab, none on the others); nothing without an added view.
  const extensionFlags = extensionViews.reduce<Record<string, boolean>>(
    (flags, extension) => ({ ...flags, ...extension.requestFlags(view === extension.id) }),
    {},
  );

  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('search') || "");
  const pageSizeOptions = [10, 20, 50, 100];

  // Page size of the vulnerabilities
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem(storageKeys.pageSize);
    return saved ? Number(saved) : 10;
  });
  useEffect(() => {
    localStorage.setItem(storageKeys.pageSize, pageSize.toString());
  }, [pageSize]);

  // Separate page size for the packages
  const [packagesPageSize, setPackagesPageSize] = useState<number>(() => {
    const saved = localStorage.getItem(`pageSizeScaPackages_${projectId}`);
    return saved ? Number(saved) : 10;
  });
  useEffect(() => {
    localStorage.setItem(`pageSizeScaPackages_${projectId}`, packagesPageSize.toString());
  }, [packagesPageSize, projectId]);

  const [initialPageLoaded, setInitialPageLoaded] = useState<boolean>(false);
  const {
    vulnerabilities: issues,
    projectName: detailedProjectName,
    totalVulnerabilities,
    totalPages: detailedTotalPages,
    currentPage: detailedCurrentPage,
    vulnCountByType: detailedVulnCountByType,
    loading,
    scanInfo: detailedScanInfo,
    isProjectParsed: detailedIsProjectParsed,
    reachabilityIgnoredCount: detailedReachabilityIgnoredCount,
    malwareCount: detailedMalwareCount,
    error,
    goToPage: detailedGoToPage,
    refresh,
  } = useProjectVulnerabilities({
    projectId: projectId!,
    type: "sca",
    pageSize,
    severity: selectedSeverity,
    status: selectedStatus,
    priority: selectedPriority,
    exploitability: selectedExploitability,
    sort: triageMode ? 'priorityScore' : selectedOrder,
    order: triageMode ? 'desc' : selectedOrderDirection,
    searchQuery,
    packageType: selectedPackageTypeVuln,
    branch: selectedBranch || undefined,
    ...extensionFlags,
    initialPage: (() => {
      const saved = localStorage.getItem(storageKeys.currentPage);
      return saved ? Number(saved) : 1;
    })(),
    // Wait for page data to be ready before fetching vulnerabilities
    enabled: isBranchResolved && viewMode === 'detailed',
  });

  // Grouped vulnerabilities hook for SCA
  const {
    groups: groupedVulnerabilities,
    totalGroups,
    totalPages: groupedTotalPages,
    currentPage: groupedCurrentPage,
    loading: groupedLoading,
    projectName: groupedProjectName,
    scanInfo: groupedScanInfo,
    vulnCountByType: groupedVulnCountByType,
    isProjectParsed: groupedIsProjectParsed,
    reachabilityIgnoredCount: groupedReachabilityIgnoredCount,
    malwareCount: groupedMalwareCount,
    goToPage: groupedGoToPage,
    refresh: groupedRefresh,
    totalOccurrences: groupedTotalOccurrences,
  } = useGroupedVulnerabilities({
    projectId: projectId!,
    type: 'sca',
    page: (() => {
      const saved = localStorage.getItem(storageKeys.currentPage);
      return saved ? Number(saved) : 1;
    })(),
    perPage: pageSize,
    severityFilter: selectedSeverity,
    statusFilter: selectedStatus,
    priorityFilter: selectedPriority,
    exploitabilityFilter: selectedExploitability,
    searchQuery: searchQuery,
    sort: triageMode ? 'priorityScore' : selectedOrder,
    order: triageMode ? 'desc' : selectedOrderDirection,
    branch: selectedBranch || undefined,
    packageManagerFilter: selectedPackageTypeVuln,
    ...extensionFlags,
    enabled: isBranchResolved && viewMode === 'grouped',
  });

  // Compute values based on current view mode
  const totalPages = viewMode === 'grouped' ? groupedTotalPages : detailedTotalPages;
  const totalIssues = viewMode === 'grouped' ? totalGroups : totalVulnerabilities;
  const currentPage = viewMode === 'grouped' ? groupedCurrentPage : detailedCurrentPage;
  const goToPage = viewMode === 'grouped' ? groupedGoToPage : detailedGoToPage;

  // Use info from whichever mode is active
  const projectName = pageDataProjectName || (viewMode === 'grouped' ? groupedProjectName : detailedProjectName);
  const scanInfo = viewMode === 'grouped' ? groupedScanInfo : detailedScanInfo;
  const vulnCountByType = viewMode === 'grouped' ? groupedVulnCountByType : detailedVulnCountByType;
  const isProjectParsed = viewMode === 'grouped' ? groupedIsProjectParsed : detailedIsProjectParsed;
  const reachabilityIgnoredCount = viewMode === 'grouped' ? groupedReachabilityIgnoredCount : detailedReachabilityIgnoredCount;
  const malwareCount = viewMode === 'grouped' ? groupedMalwareCount : detailedMalwareCount;
  // Each added view's count, read from the active list hook's result.
  const extensionCounts = Object.fromEntries(
    extensionViews.map((extension) => [extension.id, extension.countOf({ malwareCount })]),
  );

  // An added view is always shown (like the other SCA tabs), so
  // selecting it must stay put even when its list is empty — the tab then
  // simply renders an empty list. (No auto-switch back to Vulnerabilities.)

  useEffect(() => {
    if (!initialPageLoaded && currentPage) {
      localStorage.setItem(storageKeys.currentPage, currentPage.toString());
      setInitialPageLoaded(true);
    } else if (initialPageLoaded) {
      localStorage.setItem(storageKeys.currentPage, currentPage.toString());
    }
  }, [currentPage, initialPageLoaded, storageKeys.currentPage]);

  const handleSearchChange = (query: string) => {
    // The list hooks go back to page 1 themselves once the debounced query
    // changes, in the same render: no request for the old query here.
    setSearchQuery(query);
  };
  const handlePageChange = (page: number) => {
    goToPage(page);
  };
  const handlePageSizeChange = (size: number) => {
    localStorage.removeItem(storageKeys.currentPage);
    setPageSize(size);
    goToPage(1);
  };

  const {
    packages: scaPackages,
    totalPackages: scaTotalPackages,
    totalPages: scaTotalPages,
    currentPage: scaCurrentPage,
    loading: scaPackagesLoading,
    error: scaPackagesError,
    goToPage: scaPackagesGoToPage,
    refresh: scaPackagesRefresh,
  } = useProjectPackages({
    projectId: projectId!,
    pageSize: packagesPageSize,
    searchQuery,
    packageType: selectedPackageType,
    branch: selectedBranch || undefined,
    initialPage: 1, // Always start at page 1, use goToPage to change
    enabled: isBranchResolved && view === "packages",
  });

  const {
    data: licenseSummary,
    loading: licenseSummaryLoading,
    error: licenseSummaryError,
    refresh: licenseSummaryRefresh,
  } = useLicenseSummary({
    projectId: projectId!,
    branch: selectedBranch || undefined,
    organizationId: organization.selectedOrganization?.id,
    packageType: selectedPackageType,
    enabled: !SCANNER_ONLY_HIDDEN && isBranchResolved && view === "licenses",
  });

  // Separate handlers for the packages (after the hook, to reach scaPackagesGoToPage)
  const handlePackagesPageSizeChange = (size: number) => {
    setPackagesPageSize(size);
    // The hook goes back to page 1 itself when pageSize changes
  };

  const handlePackageTypeChange = (types: string[]) => {
    setSelectedPackageType(types);
    // The hook goes back to page 1 itself when packageType changes
  };

  const [showLoader, setShowLoader] = useState(false);
  const [currentScanId, setCurrentScanId] = useState<string>("");
  const [scanData, setScanData] = useState<ScanResponseDto | null>(null);
  const [vulnCount, setVulnCount] = useState<number>(0);
  const [showPulse, setShowPulse] = useState(false);

  // Agent progress tracking
  const [classicScannersCompleted, setClassicScannersCompleted] = useState<boolean>(false);
  const classicDoneRefreshedRef = useRef<boolean>(false);
  // The running analysis this page already started following: a new copy of
  // the list's scanInfo for the same scan must not start it again.
  const initializedScanIdRef = useRef<string | null>(null);

  // Selection state for batch update
  const [selectedVulnerabilities, setSelectedVulnerabilities] = useState<Set<string>>(new Set());
  const [showBatchUpdateModal, setShowBatchUpdateModal] = useState(false);

  // Handle selection change for a single vulnerability
  const handleSelectionChange = useCallback((id: string) => {
    setSelectedVulnerabilities(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Select all vulnerabilities on current page
  const handleSelectAll = useCallback(() => {
    setSelectedVulnerabilities(prev => {
      const newSet = new Set(prev);
      issues.forEach(issue => newSet.add(issue.id));
      return newSet;
    });
  }, [issues]);

  // Deselect all vulnerabilities on current page
  const handleDeselectAll = useCallback(() => {
    setSelectedVulnerabilities(prev => {
      const newSet = new Set(prev);
      issues.forEach(issue => newSet.delete(issue.id));
      return newSet;
    });
  }, [issues]);

  // Clear all selections
  const handleClearAllSelections = useCallback(() => {
    setSelectedVulnerabilities(new Set());
  }, []);

  // Refetch when the async batch update actually completes (not at queue time).
  const handleBatchUpdateCompletion = useCallback(() => {
    if (viewMode === 'detailed') {
      refresh();
    } else {
      groupedRefresh();
    }
  }, [viewMode, refresh, groupedRefresh]);
  useBatchUpdateCompletion(projectId, handleBatchUpdateCompletion);

  // Handle batch update submission — fire-and-forget; BackgroundTasksPanel tracks progress
  const handleBatchUpdate = useCallback((data: BatchUpdateFormData): void => {
    if (!projectId) return;

    const request: BatchUpdateVulnerabilitiesRequest = {
      items: buildBatchUpdateItems(Array.from(selectedVulnerabilities), data),
    };

    // Dispatch the async task; refetch is deferred to useBatchUpdateCompletion above.
    dispatch(startBatchUpdate(projectId, request));
    handleClearAllSelections();
  }, [projectId, selectedVulnerabilities, handleClearAllSelections, dispatch]);

  const intervalId = useRef<NodeJS.Timeout | null>(null);
  const vulnCountRef = useRef<number>(0);
  // Flag to track if user initiated the scan in this session (not page reload)
  const userInitiatedScanRef = useRef<boolean>(false);

  // Starting an analysis is shared with the other results pages and with
  // the other spaces (`useStartAnalysis`). What follows the start — the loader and
  // the tracking below — is this page's own.
  const startAnalysis = useStartAnalysis(projectId, {
    repository: integrationInfo,
    branch: { available: branches?.length ?? 0, selected: selectedBranch || defaultBranch || '' },
    requireOrganization: true,
    onStart: (kind) => {
      // Mark that user initiated this scan
      userInitiatedScanRef.current = true;
      if (kind === 'repository') {
        setShowLoader(true);
        // Reset the counters so the previous results are not shown
        setVulnCount(0);
        vulnCountRef.current = 0;
      }
      // Reset scanData to initializing state immediately to clear any previous error
      setScanData(placeholderScan(projectId!, 'initializing'));
    },
    // Show the loader here, when the upload starts
    onUploadStart: () => setShowLoader(true),
    onStarted: (scanId) => {
      if (scanId) setCurrentScanId(scanId);
    },
    onError: ({ kind, error }) => {
      if (kind === 'archive') setShowLoader(true);
      setScanData(placeholderScan(
        projectId!,
        'failed',
        kind === 'repository'
          ? repositoryStartErrorMessage(error, t('common.error'))
          : archiveStartErrorMessage(error, {
              generic: t('common.error'),
              tooLarge: t('common.fileTooLargeError'),
            }),
      ));
      setTimeout(() => {
        setShowLoader(false);
      }, 5000);
    },
  });

  const fetchScanDataRef = useRef<(() => Promise<void>) | null>(null);

  // Reads at once when the tab comes back and the last read is one interval
  // old: the 10 s fallback skips its ticks in a hidden tab.
  const noteScanRead = useCatchUpWhenVisible(
    () => fetchScanDataRef.current?.(),
    !!currentScanId,
    10_000,
  );

  useEffect(() => {
    const fetchScanData = async () => {
      if (!projectId || !currentScanId) return;
      noteScanRead();
      try {
        const data = await scanService.getScanById(projectId, currentScanId);
        if (data) {
          setScanData(data);
          const newVulnCount = data.vulnerabilityDetected || 0;
          if (
            data.vulnerabilityDetected &&
            data.vulnerabilityDetected > vulnCountRef.current
          ) {
            setShowPulse(true);
            setTimeout(() => setShowPulse(false), 1000);
          }
          setVulnCount(newVulnCount);
          vulnCountRef.current = newVulnCount;

          // Detect when classic scanners finish (agent may still be running)
          const containers = data.containers || [];
          const classic = containers.filter((c: any) => !isAgentContainer(c));
          const allClassicDone = classic.length > 0 && classic.every((c: any) => c.status === 'completed' || c.status === 'failed');
          if (allClassicDone) {
            if (!classicScannersCompleted) {
              setShowLoader(false);
              setClassicScannersCompleted(true);
            }
            if (!classicDoneRefreshedRef.current) {
              classicDoneRefreshedRef.current = true;
              refresh(true);
              groupedRefresh(true);
            }
          }

          if (data.state === "completed" || data.state === "failed" || data.state === "completed_degraded") {
            if (intervalId.current) {
              clearInterval(intervalId.current);
              intervalId.current = null;
            }
            const timeoutDuration = data.state === "completed" || data.state === "completed_degraded" ? 3000 : 5000;
            setTimeout(() => {
              setShowLoader(false);
              setScanData(null);
              setVulnCount(0);
              vulnCountRef.current = 0;
              setCurrentScanId("");
              classicDoneRefreshedRef.current = false;
              initializedScanIdRef.current = null;
              setClassicScannersCompleted(false);
              // Silent refresh — the realtime stream has kept the list in
              // sync during the scan; this catches up any agent
              // VULNERABILITY_UPDATED events the list missed without flashing
              // a loader.
              refresh(true);
              groupedRefresh(true);
              // Silent — see SAST page for rationale.
              refreshPageData(true);
            }, timeoutDuration);
          }
        }
      } catch (error: any) {
        // A 404: the scan is not in this project (deleted, or the route moved to
        // another project while the page followed a scan of the previous one).
        // Stop and let go of it: the app-root tracker follows it.
        if (isScanGone(error)) {
          if (intervalId.current) {
            clearInterval(intervalId.current);
            intervalId.current = null;
          }
          setShowLoader(false);
          setScanData(null);
          setCurrentScanId("");
          return;
        }
        // Network errors (no response) and 5xx are transient — keep polling
        const status = error?.response?.status;
        if (status && status < 500) {
          throw error;
        }
      }
    };
    fetchScanDataRef.current = fetchScanData;
    if (currentScanId) {
      fetchScanData();
      if (intervalId.current) clearInterval(intervalId.current);
      // 10s fallback; SSE (useScanRealtime below) drives sub-second updates.
      // A hidden tab skips its ticks.
      intervalId.current = setInterval(skipWhenHidden(fetchScanData), 10_000);
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    };
  }, [projectId, currentScanId]);

  useScanRealtime(
    projectId,
    currentScanId,
    () => {
      void fetchScanDataRef.current?.();
      // SSE just refreshed — push the 10s fallback back to the right so we
      // don't issue a redundant /scan/:id GET 1-2s later.
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = setInterval(skipWhenHidden(() => {
          void fetchScanDataRef.current?.();
        }), 10_000);
      }
    },
    (payload: ScanStatusChangedPayload) => {
      // Optimistically surface the failure reason before the REST re-fetch
      // completes so LoaderScan / AnalyseWrapper can render it immediately.
      const isFailure =
        payload.currentState === 'failed' ||
        payload.currentState === 'completed_degraded';
      setScanData((prev) =>
        prev
          ? {
              ...prev,
              state: payload.currentState,
              ...(isFailure
                ? {
                    errorCode: payload.errorCode,
                    errorCategory: payload.errorCategory,
                    errorMessage: payload.errorMessage,
                  }
                : {}),
            }
          : prev,
      );
    },
  );

  useEffect(() => {
    const checkOngoingScan = () => {
      if (scanInfo && (scanInfo.state === "running" || scanInfo.state === "queued" || scanInfo.state === "waiting_for_file")) {
        const { scanId } = scanInfo;

        // Clear any retry polling interval if it exists
        if ((window as any).__scanPollInterval) {
          clearInterval((window as any).__scanPollInterval);
          (window as any).__scanPollInterval = null;
        }

        // Avoid re-initializing the same scan on every new scanInfo object
        if (initializedScanIdRef.current === scanId) return;
        initializedScanIdRef.current = scanId;

        // Never auto-show the loader when returning to the page (the info
        // button in AnalyseWrapper reopens it). Setting the id starts the scan
        // poll, whose first fetch fills scanData: no second GET here.
        setCurrentScanId(scanId);
      }
    };
    checkOngoingScan();
  }, [scanInfo]);

  // Community Edition: no scanner runs, so the start action imports a
  // SARIF file, and the tracker below follows the import scan.
  const [showImport, setShowImport] = useState<boolean>(false);
  // Community Edition: an import-only instance imports; one that runs
  // scans on a connected cluster starts them, with the import as a second action.
  const scansRun = useScansRun();
  const importsOnly = EDITION === 'community' && !scansRun;
  const handleImported = (scanId: string) => {
    userInitiatedScanRef.current = true;
    setShowLoader(true);
    setScanData(placeholderScan(projectId!, 'initializing'));
    setCurrentScanId(scanId);
  };

  // Always open the modal when clicking "Start Scan"
  // The modal will show BranchSelector for integrations or FileInput for manual uploads
  const handleStartScanClick = () => {
    if (importsOnly) setShowImport(true);
    else startAnalysis.open();
  };

  const onCloseLoader = () => {
    // Only close the loader popup, don't reset scanData
    // This keeps the scan status visible in AnalyseWrapper
    setShowLoader(false);
  };

  // Callback to reopen the loader manually
  const handleReopenLoader = () => {
    setShowLoader(true);
  };

  // Derive agent UI state from scanData containers
  const agentDerived = React.useMemo(() => {
    if (!scanData) return {} as { phase?: string; action?: string; message?: string; progress?: number };
    const containers = scanData.containers || [];
    const agentContainers = containers.filter((c: any) => isAgentContainer(c));
    if (agentContainers.length === 0) return {} as { phase?: string; action?: string; message?: string; progress?: number };
    const running = agentContainers.find((c: any) => c.status === 'running');
    const src = running || agentContainers[0];
    const parsed = parseAgentStep(src.step);
    let phase = parsed?.phase;
    let action = parsed?.action;
    if (typeof src.step === 'string') {
      const lower = src.step.toLowerCase();
      if (lower.includes('parsing')) {
        phase = 'parsing';
        action = (lower.includes('completed') || lower.includes('done') || lower.includes('finished')) ? 'done' : 'in_progress';
      }
    }
    return { phase, action, message: undefined, progress: parsed?.progress };
  }, [scanData]);

  // Show loading skeleton while waiting for page data to be ready
  if (!isContentReady) {
    return <AnalysePageSkeleton />;
  }

  return (
    <>
      <ResultsScaTemplate
        projectId={projectId}
        projectName={projectName}
        issues={issues}
        totalIssues={totalIssues}
        totalOccurrences={groupedTotalOccurrences}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        selectedSeverity={selectedSeverity}
        selectedStatus={selectedStatus}
        selectedPriority={selectedPriority}
        selectedPackageTypeVuln={selectedPackageTypeVuln}
        selectedExploitability={selectedExploitability}
        selectedOrder={selectedOrder}
        selectedOrderDirection={selectedOrderDirection}
        onSeverityChange={setSelectedSeverity}
        onStatusChange={setSelectedStatus}
        onPriorityChange={setSelectedPriority}
        onPackageTypeVulnChange={setSelectedPackageTypeVuln}
        onExploitabilityChange={setSelectedExploitability}
        onOrderChange={setSelectedOrder}
        onOrderDirectionChange={setSelectedOrderDirection}
        onSearchQueryChange={handleSearchChange}
        triageMode={triageMode}
        onTriageModeChange={handleTriageModeChange}
        onFocusTop5={shouldOfferFocusTop5(totalIssues) ? handleFocusTop5 : undefined}
        focusTop5Active={showTop5}
        resultColumns={resultColumns}
        showStartScanModal={startAnalysis.isOpen}
        handleStartScanClick={handleStartScanClick}
        onImportResultsClick={() => setShowImport(true)}
        handleCloseStartScanModal={startAnalysis.close}
        handleScanSubmit={startAnalysis.submit}
        errors={startAnalysis.errors}
        setSelectedFile={startAnalysis.setSelectedFile}
        showLoader={showLoader}
        scanData={scanData}
        vulnCount={vulnCount}
        showPulse={showPulse}
        onCloseLoader={onCloseLoader}
        uploadProgress={startAnalysis.uploadProgress}
        isUploading={startAnalysis.isUploading}
        vulnCounts={vulnCountByType}
        loading={viewMode === 'detailed' ? loading : groupedLoading}
        scaPackages={scaPackages}
        scaTotalPackages={scaTotalPackages}
        scaTotalPages={scaTotalPages}
        scaCurrentPage={scaCurrentPage}
        scaPackagesPageSize={packagesPageSize}
        scaPackagesLoading={scaPackagesLoading}
        scaPackagesError={scaPackagesError}
        scaPackagesGoToPage={scaPackagesGoToPage}
        scaPackagesRefresh={scaPackagesRefresh}
        scaPackagesOnPageSizeChange={handlePackagesPageSizeChange}
        scaSelectedPackageType={selectedPackageType}
        scaOnPackageTypeChange={handlePackageTypeChange}
        view={view}
        setView={setView}
        extensionViews={extensionViews}
        extensionCounts={extensionCounts}
        licenseSummary={licenseSummary}
        licenseSummaryLoading={licenseSummaryLoading}
        licenseSummaryError={licenseSummaryError}
        licenseSummaryRefresh={licenseSummaryRefresh}
        scanInfo={scanInfo}
        includeDevAndTest={includeDevAndTest}
        onIncludeDevAndTestChange={handleIncludeDevAndTestChange}
        linkedGithubRepo={linkedGithubRepo}
        integrationInfo={integrationInfo}
        isSecurityContextCustomized={isSecurityContextCustomized}
        branches={branches}
        selectedBranch={selectedBranch}
        defaultBranch={defaultBranch}
        loadingBranches={isLoadingBranches}
        onBranchChange={setSelectedBranch}
        onArchive={handleArchiveBranch}
        onUnarchive={handleUnarchiveBranch}
        manualBranchName={startAnalysis.manualBranchName}
        onManualBranchNameChange={startAnalysis.setManualBranchName}
        isProjectParsed={isProjectParsed}
        onReopenLoader={handleReopenLoader}
        agentPhase={agentDerived.phase}
        agentAction={agentDerived.action}
        agentMessage={agentDerived.message}
        agentProgress={agentDerived.progress}
        classicDone={classicScannersCompleted}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        groupedVulnerabilities={groupedVulnerabilities as any}
        totalGroups={totalGroups}
        groupedLoading={groupedLoading}
        reachabilityIgnoredCount={reachabilityIgnoredCount}
        issueTracking={issueTracking}
        selectedVulnerabilities={selectedVulnerabilities}
        onSelectionChange={handleSelectionChange}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        scanId={scanInfo?.scanId}
      />


      {showImport && projectId && (
        <ImportResultsDialog
          projectId={projectId}
          defaultType="sca"
          defaultBranch={selectedBranch || defaultBranch || ''}
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {/* Selection action bar - shows when items are selected */}
      <SelectionActionBar
        selectedCount={selectedVulnerabilities.size}
        onUpdate={() => setShowBatchUpdateModal(true)}
        onClearSelection={handleClearAllSelections}
        isVisible={viewMode === 'detailed'}
      />

      {/* Batch update modal */}
      {showBatchUpdateModal && (
        <BatchUpdateModal
          selectedCount={selectedVulnerabilities.size}
          onClose={() => setShowBatchUpdateModal(false)}
          onSubmit={handleBatchUpdate}
        />
      )}
    </>
  );
};

export default ResultsScaPage;
