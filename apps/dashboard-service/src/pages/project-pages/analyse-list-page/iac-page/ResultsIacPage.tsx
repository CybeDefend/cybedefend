import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useDispatch } from "react-redux";
import { useParams, useSearchParams } from "react-router-dom";
import useProjectVulnerabilities from "../../../../server/hooks/useProjectVulnerabilities";
import useDebouncedValue from "../../../../server/hooks/useDebouncedValue";
import { useProjectPageData } from "../../../../server/hooks/useProjectPageData";
import { useGroupedVulnerabilities } from "../../../../server/hooks/useGroupedVulnerabilities";
import { ViewMode } from "@/components/molecules/view-mode-toggle/ViewModeToggle";
import { ScanResponseDto } from "../../../../server/interfaces/Scan";
import scanService from "../../../../server/services/scanService";
import BatchUpdateModal from "@/components/molecules/modal/batch-update-modal/BatchUpdateModal";
import SelectionActionBar from "@/components/molecules/selection-action-bar/SelectionActionBar";
import { BatchUpdateVulnerabilitiesRequest } from "@/server/interfaces/Vulnerability";
import { buildBatchUpdateItems, BatchUpdateFormData } from "@/utils/function/batchUpdateItems";
import { startBatchUpdate } from "@/server/store/backgroundTasksThunks";
import type { AppDispatch } from "@/server/store";
import { useBatchUpdateCompletion } from "@/server/hooks/useBatchUpdateCompletion";
import { Slot } from "@/edition/slots";
import {
  exploitabilityDefaultValues,
  orderOptions,
  priorityDefaultValues,
  severityDefaultValues,
  statusDefaultValues,
  ScoringSourceFilterValue,
  scoringSourceToQueryParam,
} from "../../../../utils/data/resultsVulnData";
import { sanitizeStatusFilter } from "../../../../utils/data/historyVulnData";
import ResultsIacTemplate from "./ResultsIacTemplate";
import { shouldOfferFocusTop5 } from "@/components/molecules/focus-top5/focusTop5Logic";
import { useTranslation } from "react-i18next";
import { agentStatusMessage } from '../agentStatusMessage';
import { parseAgentStep, isAgentContainer } from "@/utils/function/agentParser";
import { AnalysePageSkeleton } from "@/components/molecules/skeleton/AnalysePageSkeleton";
import { useIssueTracking } from "@/server/hooks/useIssueTracking";
import { useScanRealtime, ScanStatusChangedPayload } from "@/server/hooks/useScanRealtime";
import { skipWhenHidden, useCatchUpWhenVisible } from "@/server/hooks/usePollingWhenVisible";
import { isScanGone } from "@/server/store/scanTask";
import { useStartAnalysis } from "@/server/hooks/useStartAnalysis";
import { EDITION } from "@/edition/edition";
import { useScansRun } from "@/edition/community/instanceCapabilities";
import ImportResultsDialog from "@/components/molecules/import-results/ImportResultsDialog";
import {
  archiveStartErrorMessage,
  placeholderScan,
  repositoryStartErrorMessage,
} from "../startAnalysisLoader";

const ResultsIacPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
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
    securityContextUpdatedAt,
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
    selectedSeverity: `selectedSeverityIac_${projectId}`,
    selectedStatus: `selectedStatusIac_${projectId}`,
    selectedPriority: `selectedPriorityIac_${projectId}`,
    selectedExploitability: `selectedExploitabilityIacV2_${projectId}`,
    selectedOrder: `selectedOrderIac_${projectId}`,
    selectedOrderDirection: `selectedOrderDirectionIac_${projectId}`,
    pageSize: `pageSizeIac_${projectId}`,
    currentPage: `currentPageIac_${projectId}`,
    triageMode: `triageModeIac_${projectId}`,
    selectedScoringSource: `selectedScoringSourceIac_${projectId}`,
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
  const [selectedExploitability, setSelectedExploitability] = useState<string[]>(
    () => {
      const saved = localStorage.getItem(storageKeys.selectedExploitability);
      return saved ? JSON.parse(saved) : exploitabilityDefaultValues;
    },
  );
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedExploitability,
      JSON.stringify(selectedExploitability),
    );
  }, [selectedExploitability]);

  // Triage mode
  const [triageMode, setTriageMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKeys.triageMode);
    return saved ? JSON.parse(saved) : true;
  });
  useEffect(() => {
    localStorage.setItem(storageKeys.triageMode, JSON.stringify(triageMode));
  }, [triageMode]);
  const handleTriageModeChange = useCallback((value: boolean) => {
    setTriageMode(value);
  }, []);

  // Focus Top 5 overlay state
  const [showTop5, setShowTop5] = useState<boolean>(false);
  const handleFocusTop5 = useCallback(() => {
    setShowTop5((prev) => !prev);
  }, []);

  // Scoring source filter (all/static/agent), persisted per project.
  const [selectedScoringSource, setSelectedScoringSource] =
    useState<ScoringSourceFilterValue>(() => {
      const saved = localStorage.getItem(storageKeys.selectedScoringSource);
      return (saved as ScoringSourceFilterValue) || 'all';
    });
  useEffect(() => {
    localStorage.setItem(
      storageKeys.selectedScoringSource,
      selectedScoringSource,
    );
  }, [selectedScoringSource]);

  const [selectedOrder, setSelectedOrder] = useState<string>(() => {
    const saved = localStorage.getItem(storageKeys.selectedOrder);
    return saved ? saved : orderOptions[0].value;
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
      return saved ? saved : "desc"; // Default to descending (most critical first)
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
    const saved = localStorage.getItem(`viewModeIac_${projectId}`);
    return (saved as ViewMode) || 'grouped';
  });

  useEffect(() => {
    localStorage.setItem(`viewModeIac_${projectId}`, viewMode);
  }, [viewMode, projectId]);

  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('search') || "");

  // Language (multi-select) + source path (debounced text) filters.
  const [selectedLanguage, setSelectedLanguage] = useState<string[]>([]);
  const [sourcePathInput, setSourcePathInput] = useState<string>("");
  const debouncedSourcePath = useDebouncedValue(sourcePathInput, 400);
  const pageSizeOptions = [10, 20, 50, 100];

  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = localStorage.getItem(storageKeys.pageSize);
    return saved ? Number(saved) : 10;
  });

  useEffect(() => {
    localStorage.setItem(storageKeys.pageSize, pageSize.toString());
  }, [pageSize]);

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
    availableLanguages: detailedAvailableLanguages,
    error,
    goToPage: detailedGoToPage,
    refresh,
  } = useProjectVulnerabilities({
    projectId: projectId!,
    type: "iac",
    pageSize,
    severity: selectedSeverity,
    status: selectedStatus,
    priority: selectedPriority,
    exploitability: selectedExploitability,
    scoringSource: scoringSourceToQueryParam(selectedScoringSource),
    sort: triageMode ? 'priorityScore' : selectedOrder,
    order: triageMode ? 'desc' : selectedOrderDirection,
    searchQuery,
    language: selectedLanguage,
    sourcePath: debouncedSourcePath,
    branch: selectedBranch || undefined,
    initialPage: (() => {
      const saved = localStorage.getItem(storageKeys.currentPage);
      return saved ? Number(saved) : 1;
    })(),
    // Wait for page data to be ready before fetching vulnerabilities
    enabled: isBranchResolved && viewMode === 'detailed',
  });

  // Grouped vulnerabilities hook
  const {
    groups: groupedVulnerabilities,
    totalGroups,
    totalOccurrences,
    totalPages: groupedTotalPages,
    currentPage: groupedCurrentPage,
    loading: groupedLoading,
    projectName: groupedProjectName,
    scanInfo: groupedScanInfo,
    vulnCountByType: groupedVulnCountByType,
    isProjectParsed: groupedIsProjectParsed,
    availableLanguages: groupedAvailableLanguages,
    goToPage: groupedGoToPage,
    refresh: groupedRefresh,
  } = useGroupedVulnerabilities({
    projectId: projectId!,
    type: 'iac',
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
    languageFilter: selectedLanguage,
    sourcePath: debouncedSourcePath,
    sort: triageMode ? 'priorityScore' : selectedOrder,
    order: triageMode ? 'desc' : selectedOrderDirection,
    branch: selectedBranch || undefined,
    scoringSource: scoringSourceToQueryParam(selectedScoringSource),
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

  // The Language filter options are embedded in the active list
  // response (detailed or grouped), so no dedicated languages round-trip is made.
  const availableLanguages = viewMode === 'grouped' ? groupedAvailableLanguages : detailedAvailableLanguages;
  const languageOptions = availableLanguages.map((l) => ({ label: l, value: l }));

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

  const [showLoader, setShowLoader] = useState(false);
  const [currentScanId, setCurrentScanId] = useState<string>("");
  const [scanData, setScanData] = useState<ScanResponseDto | null>(null);
  const [vulnCount, setVulnCount] = useState<number>(0);
  const [showPulse, setShowPulse] = useState(false);


  // What a finished « Re-run all » refetches: both views of the list.
  const refreshAfterReanalysis = useCallback(() => {
    refresh();
    groupedRefresh();
  }, [refresh, groupedRefresh]);

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

  // Handle batch update submission
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
  const [classicScannersCompleted, setClassicScannersCompleted] = useState<boolean>(false);
  // Track agent per-vulnerability animation state
  const processedIdsRef = useRef<Set<string>>(new Set());
  const [agentActiveIds, setAgentActiveIds] = useState<string[]>([]);
  const [agentPrioritizationActive, setAgentPrioritizationActive] = useState<boolean>(false);
  const lastAgentVulnIdRef = useRef<string | null>(null);
  const prioritizationRefreshedRef = useRef<boolean>(false);
  const classicDoneRefreshedRef = useRef<boolean>(false);
  const firstVulnRefreshDoneRef = useRef<boolean>(false);
  const initializedScanIdRef = useRef<string | null>(null);
  const lastAgentRawRef = useRef<string | null>(null);
  const arraysEqual = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((v, i) => v === b[i]);

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
      setShowLoader(true);
      if (kind === 'repository') {
        setClassicScannersCompleted(false);
        // Reset the counters so the previous results are not shown
        setVulnCount(0);
        vulnCountRef.current = 0;
      }
      // Reset scanData to initializing state immediately to clear any previous error
      setScanData(placeholderScan(projectId!, 'initializing'));
    },
    onStarted: (scanId) => {
      if (scanId) setCurrentScanId(scanId);
    },
    onError: ({ kind, error }) => {
      // Show the loader even on an error, to show the failed state
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

          // If all non-agent containers are completed, we may refresh list but do not close loader here
          const containers = data.containers || [];
          const classic = containers.filter((c: any) => !isAgentContainer(c));
          const allClassicDone = classic.length > 0 && classic.every((c: any) => c.status === 'completed' || c.status === 'failed');
          // Parse current agent step to drive row highlighting
          const agentContainers = containers.filter((c: any) => isAgentContainer(c));
          if (agentContainers.length > 0) {
            const running = agentContainers.find((c: any) => c.status === 'running') || agentContainers[0];
            const rawStep = running.step || '';
            const isSameStep = lastAgentRawRef.current === rawStep;
            const parsed = parseAgentStep(rawStep);
            if (!isSameStep) {
              lastAgentRawRef.current = rawStep;
            }
            if (parsed) {
              // Determine active IDs and processed IDs based on event type
              if (parsed.phase === 'vuln') {
                if (parsed.action === 'start' && parsed.vulnerabilityId) {
                  if (!arraysEqual(agentActiveIds, [parsed.vulnerabilityId])) {
                    setAgentActiveIds([parsed.vulnerabilityId]);
                  }
                  // Close loader as soon as agent starts focusing a vulnerability
                  setShowLoader(false);
                  if (!firstVulnRefreshDoneRef.current) {
                    firstVulnRefreshDoneRef.current = true;
                    refresh(true);
                    groupedRefresh(true);
                  }
                  lastAgentVulnIdRef.current = parsed.vulnerabilityId;
                } else if (parsed.action === 'result' && parsed.vulnerabilityId) {
                  processedIdsRef.current.add(parsed.vulnerabilityId);
                  if (!arraysEqual(agentActiveIds, [parsed.vulnerabilityId])) {
                    setAgentActiveIds([parsed.vulnerabilityId]);
                  }
                  setShowLoader(false);
                  if (!firstVulnRefreshDoneRef.current) {
                    firstVulnRefreshDoneRef.current = true;
                    refresh(true);
                    groupedRefresh(true);
                  }
                  lastAgentVulnIdRef.current = parsed.vulnerabilityId;
                } else if (parsed.action === 'error') {
                  // On error, clear active to avoid highlighting wrong row when id is unknown
                  if (!arraysEqual(agentActiveIds, [])) {
                    setAgentActiveIds([]);
                  }
                }
              } else if (parsed.phase === 'prioritization') {
                if (parsed.action === 'decided' && Array.isArray(parsed.assignments)) {
                  const ids = parsed.assignments.map(a => a.vulnerabilityId).filter(Boolean);
                  ids.forEach(id => processedIdsRef.current.add(id));
                  if (!arraysEqual(agentActiveIds, ids)) {
                    setAgentActiveIds(ids);
                  }
                  // Stop global prioritization animation shortly after decisions
                  setTimeout(() => setAgentPrioritizationActive(false), 1200);
                } else if (parsed.action === 'start') {
                  if (!arraysEqual(agentActiveIds, [])) {
                    setAgentActiveIds([]);
                  }
                  if (!agentPrioritizationActive) {
                    setAgentPrioritizationActive(true);
                  }
                  if (!prioritizationRefreshedRef.current && !isSameStep) {
                    prioritizationRefreshedRef.current = true;
                    refresh(true);
                    groupedRefresh(true);
                  }
                }
              } else if (parsed.phase === 'analysis') {
                // Close loader when analysis of vulnerabilities starts even if no specific vuln id is provided
                if (parsed.action !== 'done') {
                  setShowLoader(false);
                }
                if (parsed.action === 'done') {
                  if (!arraysEqual(agentActiveIds, [])) {
                    setAgentActiveIds([]);
                  }
                }
              }
            }
          }
          if (allClassicDone) {
            // Close the loader only once when classic scanners first complete
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
          // No longer refresh on vulnerabilityDetected increments to avoid full list reload jitter

          setVulnCount(newVulnCount);
          vulnCountRef.current = newVulnCount;

          if (
            data.state === "completed" ||
            data.state === "failed" ||
            data.state === "completed_degraded"
          ) {
            if (intervalId.current) {
              clearInterval(intervalId.current);
              intervalId.current = null;
            }
            const timeoutDuration =
              data.state === "completed" || data.state === "completed_degraded"
                ? 3000
                : 5000;
            setTimeout(() => {
              setShowLoader(false);
              setScanData(null);
              setVulnCount(0);
              vulnCountRef.current = 0;
              setCurrentScanId("");
              processedIdsRef.current = new Set();
              setAgentActiveIds([]);
              setAgentPrioritizationActive(false);
              lastAgentVulnIdRef.current = null;
              prioritizationRefreshedRef.current = false;
              classicDoneRefreshedRef.current = false;
              firstVulnRefreshDoneRef.current = false;
              initializedScanIdRef.current = null;
              lastAgentRawRef.current = null;
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
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
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
      if (
        scanInfo &&
        (scanInfo.state === "running" || scanInfo.state === "queued" || scanInfo.state === "waiting_for_file")
      ) {
        const { scanId } = scanInfo;

        // Clear the polling interval if it exists (from the fallback method)
        if ((window as any).__scanPollInterval) {
          clearInterval((window as any).__scanPollInterval);
          delete (window as any).__scanPollInterval;
        }

        // Avoid re-initializing the same scan repeatedly
        if (initializedScanIdRef.current !== scanId) {
          initializedScanIdRef.current = scanId;

          // Never auto-show the loader when returning to the page (the info
          // button in AnalyseWrapper reopens it). Setting the id starts the scan
          // poll, whose first fetch fills scanData: no second GET here.
          setCurrentScanId(scanId);
        }
      }
    };
    checkOngoingScan();
  }, [scanInfo, projectId]);

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
    // Reset agent state for new scan
    setClassicScannersCompleted(false);
    processedIdsRef.current = new Set();
    setAgentActiveIds([]);
    setAgentPrioritizationActive(false);
    lastAgentVulnIdRef.current = null;
    prioritizationRefreshedRef.current = false;
    classicDoneRefreshedRef.current = false;
    firstVulnRefreshDoneRef.current = false;
    initializedScanIdRef.current = null;
    lastAgentRawRef.current = null;

    if (importsOnly) setShowImport(true);
    else startAnalysis.open();
  };

  const onCloseLoader = () => {
    // Trigger refresh if classic scanners are done or if we've seen first vuln (user closing mid-agent-run)
    if (classicScannersCompleted && !classicDoneRefreshedRef.current) {
      classicDoneRefreshedRef.current = true;
      refresh(true);
      groupedRefresh(true);
    } else if (lastAgentVulnIdRef.current && !firstVulnRefreshDoneRef.current) {
      firstVulnRefreshDoneRef.current = true;
      refresh(true);
      groupedRefresh(true);
    }

    // Only close the loader popup, don't reset scanData
    // This keeps the scan status visible in AnalyseWrapper
    setShowLoader(false);
  };

  // Callback to reopen the loader manually
  const handleReopenLoader = () => {
    setShowLoader(true);
  };

  // Derive agent UI state from scanData
  const agentDerived = useMemo(() => {
    if (!scanData) return {} as { phase?: string; action?: string; message?: string; progress?: number; activeIds?: string[]; processedIds?: string[] };
    const containers = scanData.containers || [];
    const agentContainers = containers.filter(c => isAgentContainer(c));
    if (agentContainers.length === 0) return {} as { phase?: string; action?: string; message?: string; progress?: number; activeIds?: string[]; processedIds?: string[] };
    const running = agentContainers.find(c => c.status === 'running');
    const src = running || agentContainers[0];
    const parsed = parseAgentStep(src.step);
    // Detect explicit parsing wording in step
    let phase = parsed?.phase;
    let action = parsed?.action;
    if (typeof src.step === 'string') {
      const lower = src.step.toLowerCase();
      if (lower.includes('parsing')) {
        phase = 'parsing';
        action = (lower.includes('completed') || lower.includes('done') || lower.includes('finished')) ? 'done' : 'in_progress';
      }
    }
    // Build a friendly status line
    const friendly = agentStatusMessage(parsed, phase, action, t);
    return {
      phase,
      action,
      message: friendly,
      progress: parsed?.progress,
      activeIds: agentActiveIds,
      processedIds: Array.from(processedIdsRef.current),
    };
  }, [scanData, agentActiveIds, t]);

  // Show loading skeleton while waiting for page data to be ready
  if (!isContentReady) {
    return <AnalysePageSkeleton />;
  }

  return (
    <>
      <ResultsIacTemplate
        staleBanner={
          // The project-level « analyses older than the security context »
          // banner and its « Re-run all » are a `project.actions` registration
          // of the active edition.
          <Slot
            name="project.actions"
            context={{ projectId, host: "results-analysis", securityContextUpdatedAt, scanId: scanInfo?.scanId ?? null, onRefresh: refreshAfterReanalysis }}
          />
        }
        projectId={projectId}
        projectName={projectName}
        issues={issues}
        totalIssues={totalIssues}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        selectedSeverity={selectedSeverity}
        selectedStatus={selectedStatus}
        selectedPriority={selectedPriority}
        selectedExploitability={selectedExploitability}
        selectedOrder={selectedOrder}
        selectedOrderDirection={selectedOrderDirection}
        onSeverityChange={setSelectedSeverity}
        onStatusChange={setSelectedStatus}
        onPriorityChange={setSelectedPriority}
        onExploitabilityChange={setSelectedExploitability}
        triageMode={triageMode}
        onTriageModeChange={handleTriageModeChange}
        onFocusTop5={shouldOfferFocusTop5(totalIssues) ? handleFocusTop5 : undefined}
        focusTop5Active={showTop5}
        selectedScoringSource={selectedScoringSource}
        onScoringSourceChange={setSelectedScoringSource}
        onOrderChange={setSelectedOrder}
        onOrderDirectionChange={setSelectedOrderDirection}
        onSearchQueryChange={handleSearchChange}
        languageOptions={languageOptions}
        selectedLanguage={selectedLanguage}
        onLanguageChange={setSelectedLanguage}
        sourcePath={sourcePathInput}
        onSourcePathChange={setSourcePathInput}
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
        vulnCounts={vulnCountByType}
        loading={viewMode === 'detailed' ? loading : groupedLoading}
        scanInfo={scanInfo}
        uploadProgress={startAnalysis.uploadProgress}
        isUploading={startAnalysis.isStartingArchive}
        linkedGithubRepo={linkedGithubRepo}
        linkedGitlabRepo={linkedGitlabRepo}
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
        agentPhase={agentDerived.phase}
        agentAction={agentDerived.action}
        agentMessage={agentDerived.message}
        agentProgress={agentDerived.progress}
        agentActiveIds={agentDerived.activeIds}
        agentProcessedIds={agentDerived.processedIds}
        agentPrioritizationActive={agentPrioritizationActive}
        classicDone={classicScannersCompleted}
        isProjectParsed={isProjectParsed}
        onReopenLoader={handleReopenLoader}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        groupedVulnerabilities={groupedVulnerabilities as any}
        totalGroups={totalGroups}
        totalOccurrences={totalOccurrences}
        groupedLoading={groupedLoading}
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
          defaultType="iac"
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
export default ResultsIacPage;
