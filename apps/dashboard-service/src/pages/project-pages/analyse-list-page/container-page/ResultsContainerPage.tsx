import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { shouldResolveImageDeepLink } from './container-image-deep-link';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import scanService from '../../../../server/services/scanService';
import ResultsContainerTemplate from './ResultsContainerTemplate';
import { shouldOfferFocusTop5 } from '@/components/molecules/focus-top5/focusTop5Logic';
import useProjectContainerVulnerabilities from '../../../../server/hooks/useProjectContainerVulnerabilities';
import useGroupedVulnerabilities from '../../../../server/hooks/useGroupedVulnerabilities';
import { GroupedContainerVulnerability } from '../../../../server/interfaces/Vulnerability';
import useProjectContainerPackages from '../../../../server/hooks/useProjectContainerPackages';
import useProjectContainerImages from '../../../../server/hooks/useProjectContainerImages';
import useProjectContainerGroupedImages from '../../../../server/hooks/useProjectContainerGroupedImages';
import { useProjectPageData } from '../../../../server/hooks/useProjectPageData';
import {
  severityDefaultValues,
  statusDefaultValues,
  priorityDefaultValues,
  exploitabilityDefaultValues,
} from '@/utils/data/resultsVulnData';
import { ScanResponseDto } from '@/server/interfaces/Scan';
import { parseAgentStep, isAgentContainer } from '@/utils/function/agentParser';
import {
  deleteContainerImage,
  fetchContainerResultsForProject,
} from '@/server/services/resultService';
import { ContainerImage } from '@/server/interfaces/Packages';
import ResultsContainerImagesTable from '@/components/organismes/table/container-table/ResultsContainerImagesTable';
import ResultsContainerGroupedImagesTable from '@/components/organismes/table/container-table/ResultsContainerGroupedImagesTable';
import AnalyseWrapper from '@/components/molecules/wrapper/AnalyseWrapper';
import ImportResultsDialog from '@/components/molecules/import-results/ImportResultsDialog';
import { EDITION } from '@/edition/edition';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import ConfirmationModal from '@/components/molecules/modal/confirmation-modal/ConfirmationModal';
import BatchUpdateModal from '@/components/molecules/modal/batch-update-modal/BatchUpdateModal';
import SelectionActionBar from '@/components/molecules/selection-action-bar/SelectionActionBar';
import { BatchUpdateVulnerabilitiesRequest } from '@/server/interfaces/Vulnerability';
import { buildBatchUpdateItems, BatchUpdateFormData } from '@/utils/function/batchUpdateItems';
import { startBatchUpdate } from '@/server/store/backgroundTasksThunks';
import { useBatchUpdateCompletion } from '@/server/hooks/useBatchUpdateCompletion';
import type { ContainerScanStartAnswer } from '@/edition/extensions';
import { RootState } from '@/server/store';
import type { AppDispatch } from '@/server/store';
import { ViewMode } from '@/components/molecules/view-mode-toggle/ViewModeToggle';
import { FeatureGate } from '@/components/molecules/feature-gate';
import { useProject } from '@/server/hooks/useProject';
import useDisabledFeatures from '@/server/hooks/useDisabledFeatures';
import { useIssueTracking } from '@/server/hooks/useIssueTracking';
import { useScanRealtime, ScanStatusChangedPayload } from '@/server/hooks/useScanRealtime';
import { skipWhenHidden, useCatchUpWhenVisible } from '@/server/hooks/usePollingWhenVisible';
import { isScanGone } from '@/server/store/scanTask';
import { API_ERROR_KEYS, apiErrorKey } from '@/utils/function/apiErrorKey';
import { isForbidden } from '@/utils/function/isForbidden';
import { IMAGE_DELETE_ROLES, useProjectRoleAccess } from "@/server/hooks/useProjectRoleAccess";

const ResultsContainerPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { projectId } = useParams<{ projectId: string }>();
  // Deleting an image needs the project delete and triage roles; the action
  // is left out once the member is known to lack them (a 403 stays handled).
  const canDeleteImages = useProjectRoleAccess(projectId, IMAGE_DELETE_ROLES) !== false;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const organization = useSelector((state: RootState) => state.organization);
  const selectedOrganization = organization.selectedOrganization;
  const organizationId = selectedOrganization?.id || "";
  const disabledFeatures = useDisabledFeatures();
  const isDeveloper = disabledFeatures.has('container_scanning');
  const [searchParams, setSearchParams] = useSearchParams();
  // Selected image survives navigation (issue detail → back): the id lives in
  // the URL (?imageId=…) and the full object in sessionStorage, because this
  // page fully remounts on back-navigation and a bare useState(null) dropped
  // the selection — users landed on the image list instead of the vuln list.
  const selectedImageStorageKey = `containerSelectedImage_${projectId}`;

  // Use unified page data hook for branches
  const {
    isLoadingBranches,
    projectName: pageDataProjectName,
    loadedProjectId,
    isSecurityContextCustomized,
    isJiraLinked,
    isLinearLinked,
    branches,
    defaultBranch,
    selectedBranch,
    setSelectedBranch,
    refresh: refreshPageData,
  } = useProjectPageData(projectId!);

  // The Jira and Linear tickets of the project, and which tool can take one
  const issueTracking = useIssueTracking(projectId || "", { isJiraLinked, isLinearLinked });

  // Always fetch project details so the project name is available even when gated
  const { project } = useProject(projectId);

  const [selectedImage, setSelectedImage] = useState<ContainerImage | null>(
    () => {
      const imageId = searchParams.get('imageId');
      if (!imageId) return null;
      try {
        const saved = sessionStorage.getItem(selectedImageStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as ContainerImage;
          if (parsed?.id === imageId) return parsed;
        }
      } catch {
        // Corrupted storage — fall back to the image list.
      }
      return null;
    }
  );

  // The id the user dismissed with Back. The URL still carries it for one
  // render after `setSearchParams`, and the deep-link effect below must not
  // re-select it in that window (see container-image-deep-link.ts).
  const dismissedImageIdRef = useRef<string | null>(null);

  const handleImageSelect = useCallback(
    (image: ContainerImage) => {
      dismissedImageIdRef.current = null;
      setSelectedImage(image);
      try {
        sessionStorage.setItem(selectedImageStorageKey, JSON.stringify(image));
      } catch {
        // Storage full/unavailable — selection still works for this mount.
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('imageId', image.id);
          return next;
        },
        { replace: true },
      );
    },
    [selectedImageStorageKey, setSearchParams],
  );

  // Pagination state for images
  const [imagesPageSize, setImagesPageSize] = useState<number>(5);

  // Images view mode state (detailed or grouped)
  const [imagesViewMode, setImagesViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`viewModeContainerImages_${projectId}`);
    return (saved as ViewMode) || 'detailed';
  });

  // Persist images view mode to localStorage
  useEffect(() => {
    localStorage.setItem(`viewModeContainerImages_${projectId}`, imagesViewMode);
  }, [imagesViewMode, projectId]);

  // Use the hook for paginated images with branch filter
  const {
    images,
    projectName: detailedProjectName,
    totalImages,
    totalPages: imagesTotalPages,
    currentPage: imagesCurrentPage,
    loading: imagesLoading,
    error: imagesError,
    goToPage: goToImagesPage,
    refresh: refreshImages,
  } = useProjectContainerImages({
    projectId: projectId!,
    pageSize: imagesPageSize,
    branch: selectedBranch || undefined,
    enabled: imagesViewMode === 'detailed' && !isDeveloper,
  });

  // Use the hook for grouped images with branch filter
  const {
    groupedImages,
    projectName: groupedProjectName,
    totalRepositories: groupedTotalRepositories,
    totalPages: groupedImagesTotalPages,
    currentPage: groupedImagesCurrentPage,
    loading: groupedImagesLoading,
    error: groupedImagesError,
    goToPage: goToGroupedImagesPage,
    refresh: refreshGroupedImages,
  } = useProjectContainerGroupedImages({
    projectId: projectId!,
    pageSize: imagesPageSize,
    branch: selectedBranch || undefined,
    enabled: imagesViewMode === 'grouped' && !isDeveloper,
  });

  // Use the project name: prefer the name from the project details hook (always available),
  // then fall back to the names returned by the image hooks (available when not gated)
  const projectName = pageDataProjectName || project?.name || detailedProjectName || groupedProjectName || '';

  // State for deletion modal
  const [imageToDelete, setImageToDelete] = useState<ContainerImage | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const [view, setView] = useState<'vulnerabilities' | 'packages'>(
    'vulnerabilities'
  );
  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('search') || "");
  const [selectedClassType, setSelectedClassType] = useState<string[]>([
    'os-pkgs',
    'lang-pkgs',
  ]);

  const [vulnSeverity, setVulnSeverity] = useState<string[]>(
    severityDefaultValues
  );
  const [vulnStatus, setVulnStatus] = useState<string[]>(statusDefaultValues);
  const [vulnPriority, setVulnPriority] = useState<string[]>(
    priorityDefaultValues
  );
  // Exploitability verdict filter (container)
  const [vulnExploitability, setVulnExploitability] = useState<string[]>(
    exploitabilityDefaultValues,
  );
  // Triage mode + Focus Top 5
  const [triageMode, setTriageMode] = useState<boolean>(true);
  const handleTriageModeChange = useCallback((value: boolean) => {
    setTriageMode(value);
  }, []);
  const [showTop5, setShowTop5] = useState<boolean>(false);
  const handleFocusTop5 = useCallback(() => {
    setShowTop5((prev) => !prev);
  }, []);

  const [vulnSort, setVulnSort] = useState<string>('cvssScore');
  const [vulnOrder, setVulnOrder] = useState<string>('desc');
  const [vulnPageSize, setVulnPageSize] = useState(10);

  // Vulnerabilities view mode (detailed or grouped-by-package) — default grouped
  // to match the other vulnerability lists (SAST/SCA/IaC/Secret).
  const [vulnViewMode, setVulnViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`viewModeContainer_${projectId}`);
    return (saved as ViewMode) || 'grouped';
  });
  useEffect(() => {
    localStorage.setItem(`viewModeContainer_${projectId}`, vulnViewMode);
  }, [vulnViewMode, projectId]);

  const {
    vulnerabilities,
    totalVulnerabilities,
    loading: vulnLoading,
    error: vulnError,
    refresh: refreshVulns,
    totalPages: vulnTotalPages,
    goToPage: goToVulnPage,
    currentPage: vulnCurrentPage,
    scanInfo,
    vulnCountByType,
  } = useProjectContainerVulnerabilities({
    projectId: projectId!,
    imageId: selectedImage?.id ?? null,
    pageSize: vulnPageSize,
    searchQuery,
    severity: vulnSeverity,
    status: vulnStatus,
    priority: vulnPriority,
    exploitability: vulnExploitability,
    classType: selectedClassType,
    sort: triageMode ? 'priorityScore' : vulnSort,
    order: triageMode ? 'desc' : vulnOrder,
    branch: selectedBranch || undefined,
    enabled: !isDeveloper && vulnViewMode === 'detailed',
  });

  // Grouped-by-package container vulnerabilities (only fetched in grouped mode).
  const {
    groups: groupedContainerVulns,
    totalGroups: groupedTotalGroups,
    totalPages: groupedVulnTotalPages,
    currentPage: groupedVulnCurrentPage,
    loading: groupedVulnLoading,
    scanInfo: groupedScanInfo,
    vulnCountByType: groupedVulnCountByType,
    goToPage: goToGroupedVulnPage,
  } = useGroupedVulnerabilities({
    projectId: projectId!,
    type: 'container',
    imageId: selectedImage?.id ?? undefined,
    perPage: vulnPageSize,
    severityFilter: vulnSeverity,
    statusFilter: vulnStatus,
    priorityFilter: vulnPriority,
    exploitabilityFilter: vulnExploitability,
    classTypeFilter: selectedClassType,
    searchQuery,
    sort: triageMode ? 'priorityScore' : vulnSort,
    order: triageMode ? 'desc' : vulnOrder,
    branch: selectedBranch || undefined,
    enabled: !isDeveloper && !!selectedImage && vulnViewMode === 'grouped',
  });

  // In grouped mode the detailed hook is disabled, so the per-image scan info and
  // vuln counts come from the grouped hook instead.
  const effectiveScanInfo =
    vulnViewMode === 'grouped' ? groupedScanInfo ?? scanInfo : scanInfo;
  const effectiveVulnCountByType =
    vulnViewMode === 'grouped'
      ? groupedVulnCountByType ?? vulnCountByType
      : vulnCountByType;

  const [pkgPageSize, setPkgPageSize] = useState(10);
  const {
    packages,
    totalPackages,
    totalPages: pkgTotalPages,
    currentPage: pkgCurrentPage,
    loading: pkgLoading,
    error: pkgError,
    goToPage: goToPkgPage,
  } = useProjectContainerPackages({
    projectId: projectId!,
    imageId: selectedImage?.id ?? null,
    pageSize: pkgPageSize,
    searchQuery,
    classType: selectedClassType,
    enabled: !isDeveloper,
  });

  const fetchGlobalVulnCounts = async () => {
    if (!projectId) return;
    try {
      const response = await fetchContainerResultsForProject(projectId, {
        page: 1,
        limit: 1, // We just want the counts, not the data
        branch: selectedBranch || undefined,
      });
      setGlobalVulnCounts(
        response.vulnCountByType || { sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 }
      );
    } catch (error) {
      console.error('Failed to fetch global vulnerability counts', error);
      setGlobalVulnCounts({ sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });
    }
  };

  useEffect(() => {
    fetchGlobalVulnCounts();
  }, [projectId, selectedBranch]);

  /**
   * Initiates the image deletion process by opening the confirmation modal.
   * @param image - The container image to be deleted.
   */
  const handleDeleteClick = (image: ContainerImage) => {
    setImageToDelete(image);
  };

  /**
   * Handles the final confirmation of the image deletion.
   * Calls the service, shows feedback to the user, and refreshes the data.
   */
  const handleConfirmDelete = async () => {
    if (!imageToDelete || !projectId) return;

    setIsDeleting(true);
    try {
      await deleteContainerImage(projectId, imageToDelete.id);
      toast.success(t('container.images.deleteSuccess'));
      setImageToDelete(null); // Close the modal
      refreshImages(); // Refresh the list of images
      refreshGroupedImages(); // Refresh grouped images too
      fetchGlobalVulnCounts(); // Also refresh global counts
    } catch (error) {
      if (isForbidden(error)) {
        // The role may not delete an image of this project: say so, and close
        // the confirmation, instead of reporting a failure.
        setImageToDelete(null);
        toast.info(t(API_ERROR_KEYS.notAllowed));
        return;
      }
      toast.error(
        t('container.images.deleteError')
      );
      console.error('Failed to delete image', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const [showLoader, setShowLoader] = useState(false);
  const [currentScanId, setCurrentScanId] = useState<string>('');
  const [scanData, setScanData] = useState<ScanResponseDto | null>(null);
  const [vulnCount, setVulnCount] = useState<number>(0);
  const [showPulse, setShowPulse] = useState(false);
  const intervalId = useRef<NodeJS.Timeout | null>(null);
  const vulnCountRef = useRef<number>(0);
  const [showAddImageModal, setShowAddImageModal] = useState(false);
  // Community Edition: no image is scanned here; the start action
  // imports a SARIF file, and the tracker below follows the import scan.
  const [showImport, setShowImport] = useState(false);
  const handleImported = (scanId: string) => {
    setShowLoader(true);
    setScanData(null);
    setVulnCount(0);
    vulnCountRef.current = 0;
    setCurrentScanId(scanId);
  };

  // Agent progress tracking
  const [classicScannersCompleted, setClassicScannersCompleted] = useState<boolean>(false);
  const classicDoneRefreshedRef = useRef<boolean>(false);
  // The running analysis this page already started following: a new copy of
  // the list's scanInfo for the same scan must not start it again.
  const initializedScanIdRef = useRef<string | null>(null);

  const [globalVulnCounts, setGlobalVulnCounts] = useState<{
    sast: number;
    iac: number;
    cicd: number;
    secret: number;
    sca: number;
    container: number;
  }>({ sast: 0, iac: 0, cicd: 0, secret: 0, sca: 0, container: 0 });

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
      vulnerabilities.forEach(issue => newSet.add(issue.id));
      return newSet;
    });
  }, [vulnerabilities]);

  // Deselect all vulnerabilities on current page
  const handleDeselectAll = useCallback(() => {
    setSelectedVulnerabilities(prev => {
      const newSet = new Set(prev);
      vulnerabilities.forEach(issue => newSet.delete(issue.id));
      return newSet;
    });
  }, [vulnerabilities]);

  // Clear all selections
  const handleClearAllSelections = useCallback(() => {
    setSelectedVulnerabilities(new Set());
  }, []);

  // Refetch when the async batch update actually completes (not at queue time).
  useBatchUpdateCompletion(projectId, refreshVulns);

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

  // Handle public Docker Hub image scan
  const handleAddImage = async (imageToAdd: string) => {
    setShowAddImageModal(false);

    // Show the loader at once in the "initializing" state
    setShowLoader(true);
    setScanData(null);
    setVulnCount(0);
    vulnCountRef.current = 0;

    try {
      const result = await scanService.startPublicContainerScan(
        projectId!,
        imageToAdd,
        {
          branch: selectedBranch || undefined,
        }
      );

      if (result?.success && result?.scanId) {
        setCurrentScanId(result.scanId);
        toast.success(t('scans.scanStarted'));
      } else {
        setShowLoader(false);
      }

      setTimeout(() => {
        refreshImages();
        refreshGroupedImages();
        fetchGlobalVulnCounts();
      }, 2000);
    } catch (error: any) {
      setShowLoader(false);
      toast.error(`${t('scans.failedFor')} ${imageToAdd} - ${t(apiErrorKey(error))}`);
      // cybedefend-ignore[CD-SAST-1269]: a developer console message in the user's own browser, about the image name that user typed
      console.error(`Error starting public container scan for ${imageToAdd}:`, error);
    }
  };

  // A scan the closed extension's Add Container Image modal starts (a
  // registry image): the modal closes, the loader shows at once in its
  // « initializing » state, and the page follows the scan the start names.
  const runRegistryScan = async (
    image: string,
    start: () => Promise<ContainerScanStartAnswer | null | undefined>
  ) => {
    setShowAddImageModal(false);
    setShowLoader(true);
    setScanData(null);
    // Reset the counters so the previous results are not shown
    setVulnCount(0);
    vulnCountRef.current = 0;

    try {
      const result = await start();
      if (result?.success) {
        if (result.scanId) {
          setCurrentScanId(result.scanId);
        }
        toast.success(t('scans.scanStarted'));
      } else {
        setShowLoader(false);
      }

      setTimeout(() => {
        refreshImages();
        refreshGroupedImages();
        fetchGlobalVulnCounts();
      }, 2000);
    } catch (error: any) {
      setShowLoader(false);
      toast.error(`${t('scans.failedFor')} ${image} - ${t(apiErrorKey(error))}`);
      // cybedefend-ignore[CD-SAST-1269]: a developer console message in the user's own browser, about the image name that user typed
      console.error(`Error starting container scan for ${image}:`, error);
    }
  };

  // Handle GitHub OAuth connect redirect
  const handleConnectGitHub = () => {
    // Close the modal and navigate to GitHub integration settings
    setShowAddImageModal(false);
    navigate('/organization/settings/integrations?category=repository');
  };

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
          if (newVulnCount > vulnCountRef.current) {
            setShowPulse(true);
            setTimeout(() => setShowPulse(false), 1000);
          }
          setVulnCount(newVulnCount);
          vulnCountRef.current = newVulnCount;

          // Detect when classic scanners finish
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
              refreshImages();
              refreshGroupedImages();
            }
          }

          if (
            ['completed', 'failed', 'completed_degraded'].includes(data.state)
          ) {
            if (intervalId.current) clearInterval(intervalId.current);
            intervalId.current = null;
            const timeout = data.state === 'failed' ? 5000 : 3000;
            setTimeout(() => {
              setShowLoader(false);
              setScanData(null);
              setCurrentScanId('');
              classicDoneRefreshedRef.current = false;
              initializedScanIdRef.current = null;
              setClassicScannersCompleted(false);
              refreshImages();
              refreshGroupedImages();
              fetchGlobalVulnCounts();
              // Silent page data refresh — see SAST page for rationale.
              refreshPageData(true);
            }, timeout);
          }
        }
      } catch (error) {
        console.error('Error fetching scan data:', error);
        // A 404: the scan is not in this project (deleted, or the route moved to
        // another project while the page followed a scan of the previous one).
        // Stop and let go of it: the app-root tracker follows it.
        // Any other failure keeps polling, as on the other results pages: the
        // tracker leaves this scan to the page, so giving up while still
        // holding it would freeze it until a reload.
        if (isScanGone(error)) {
          if (intervalId.current) {
            clearInterval(intervalId.current);
            intervalId.current = null;
          }
          setShowLoader(false);
          setScanData(null);
          setCurrentScanId('');
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
      if (intervalId.current) clearInterval(intervalId.current);
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
        effectiveScanInfo &&
        (effectiveScanInfo.state === 'running' || effectiveScanInfo.state === 'queued' || effectiveScanInfo.state === 'waiting_for_file')
      ) {
        const { scanId } = effectiveScanInfo;

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
  }, [effectiveScanInfo, projectId]);

  const handleBackToImages = () => {
    dismissedImageIdRef.current = selectedImage?.id ?? null;
    setSelectedImage(null);
    try {
      sessionStorage.removeItem(selectedImageStorageKey);
    } catch {
      // Storage unavailable — nothing to clean.
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('imageId');
        return next;
      },
      { replace: true },
    );
  };

  // Deep link / lost storage: resolve ?imageId=… from the loaded image list.
  const urlImageId = searchParams.get('imageId');
  useEffect(() => {
    if (
      !shouldResolveImageDeepLink({
        urlImageId,
        hasSelection: !!selectedImage,
        dismissedImageId: dismissedImageIdRef.current,
      })
    ) {
      return;
    }
    const found = images?.find((img) => img.id === urlImageId);
    if (found) handleImageSelect(found);
  }, [urlImageId, selectedImage, images, handleImageSelect]);

  const currentVulnCounts = useMemo(() => {
    if (selectedImage) {
      return effectiveVulnCountByType;
    } else {
      return globalVulnCounts;
    }
  }, [selectedImage, effectiveVulnCountByType, globalVulnCounts]);

  // Main render logic
  const renderContent = () => {
    if (!selectedImage) {
      if (imagesViewMode === 'grouped') {
        return (
          <ResultsContainerGroupedImagesTable
            groupedImages={groupedImages}
            loading={groupedImagesLoading}
            error={groupedImagesError}
            onImageSelect={handleImageSelect}
            onDeleteClick={canDeleteImages ? handleDeleteClick : undefined}
            totalImages={groupedTotalRepositories}
            currentPage={groupedImagesCurrentPage}
            totalPages={groupedImagesTotalPages}
            pageSize={imagesPageSize}
            onPageChange={goToGroupedImagesPage}
            onPageSizeChange={setImagesPageSize}
            viewMode={imagesViewMode}
            onViewModeChange={setImagesViewMode}
          />
        );
      }

      return (
        <ResultsContainerImagesTable
          images={images}
          loading={imagesLoading}
          error={imagesError}
          onImageSelect={handleImageSelect}
          onDeleteClick={canDeleteImages ? handleDeleteClick : undefined}
          totalImages={totalImages}
          currentPage={imagesCurrentPage}
          totalPages={imagesTotalPages}
          pageSize={imagesPageSize}
          onPageChange={goToImagesPage}
          onPageSizeChange={setImagesPageSize}
          viewMode={imagesViewMode}
          onViewModeChange={setImagesViewMode}
        />
      );
    }

    return (
      <ResultsContainerTemplate
        projectId={projectId!}
        selectedImage={selectedImage}
        onBackToImages={handleBackToImages}
        view={view}
        setView={setView}
        onSearchQueryChange={setSearchQuery}
        selectedClassType={selectedClassType}
        onClassTypeChange={setSelectedClassType}
        pageSizeOptions={[10, 20, 50, 100]}
        scanInfo={effectiveScanInfo}
        vulnViewMode={vulnViewMode}
        onVulnViewModeChange={setVulnViewMode}
        groupedVulnerabilities={groupedContainerVulns as GroupedContainerVulnerability[]}
        totalGroups={groupedTotalGroups}
        groupedLoading={groupedVulnLoading}
        groupedCurrentPage={groupedVulnCurrentPage}
        groupedTotalPages={groupedVulnTotalPages}
        onGroupedPageChange={goToGroupedVulnPage}
        vulnerabilities={vulnerabilities}
        totalVulnerabilities={totalVulnerabilities}
        vulnLoading={vulnLoading}
        vulnCurrentPage={vulnCurrentPage}
        vulnTotalPages={vulnTotalPages}
        vulnPageSize={vulnPageSize}
        onVulnPageChange={goToVulnPage}
        onVulnPageSizeChange={setVulnPageSize}
        selectedSeverity={vulnSeverity}
        onSeverityChange={setVulnSeverity}
        selectedStatus={vulnStatus}
        onStatusChange={setVulnStatus}
        selectedPriority={vulnPriority}
        onPriorityChange={setVulnPriority}
        selectedExploitability={vulnExploitability}
        onExploitabilityChange={setVulnExploitability}
        triageMode={triageMode}
        onTriageModeChange={handleTriageModeChange}
        selectedOrder={vulnSort}
        onOrderChange={setVulnSort}
        selectedOrderDirection={vulnOrder}
        onOrderDirectionChange={setVulnOrder}
        packages={packages}
        totalPackages={totalPackages}
        pkgLoading={pkgLoading}
        pkgCurrentPage={pkgCurrentPage}
        pkgTotalPages={pkgTotalPages}
        pkgPageSize={pkgPageSize}
        onPkgPageChange={goToPkgPage}
        onPkgPageSizeChange={setPkgPageSize}
        issueTracking={issueTracking}
        selectedVulnerabilities={selectedVulnerabilities}
        onSelectionChange={handleSelectionChange}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
      />
    );
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

  return (
    <>
      <AnalyseWrapper
        projectId={projectId}
        projectName={projectName}
        selectedTab='container'
        vulnCounts={currentVulnCounts}
        scanInfo={effectiveScanInfo}
        loading={(imagesViewMode === 'grouped' ? groupedImagesLoading : imagesLoading) && !selectedImage}
        handleStartScanClick={EDITION === 'community' ? () => setShowImport(true) : () => setShowAddImageModal(true)}
        showLoader={showLoader}
        scanData={scanData}
        vulnCount={vulnCount}
        showPulse={showPulse}
        onCloseLoader={() => setShowLoader(false)}
        showStartScanModal={false}
        handleCloseStartScanModal={() => { }}
        handleScanSubmit={() => { }}
        errors={{}}
        setSelectedFile={() => { }}
        isSecurityContextCustomized={isSecurityContextCustomized}
        // Branch selection props
        branches={branches}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
        loadingBranches={isLoadingBranches}
        defaultBranch={defaultBranch}
        agentPhase={agentDerived.phase}
        agentAction={agentDerived.action}
        agentMessage={agentDerived.message}
        agentProgress={agentDerived.progress}
        classicDone={classicScannersCompleted}
        onFocusTop5={shouldOfferFocusTop5(globalVulnCounts.container) ? handleFocusTop5 : undefined}
        focusTop5Active={showTop5}
      >
        <FeatureGate feature="container_scanning" preview featureLabel="Container Scanning">
          {renderContent()}
        </FeatureGate>
      </AnalyseWrapper>

      {showImport && projectId && (
        <ImportResultsDialog
          projectId={loadedProjectId ?? ""}
          defaultType="container"
          defaultBranch={selectedBranch || defaultBranch || ''}
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {/* The Add Container Image modal is handed by the edition layer (cloud
          only): its registries are closed code. The Community Edition
          opens the import dialog instead. */}
      {EDITION !== 'community' && !isDeveloper && showAddImageModal && ACTIVE_EXTENSIONS.containerRegistries && (
        <ACTIVE_EXTENSIONS.containerRegistries.AddImageModal
          onClose={() => setShowAddImageModal(false)}
          onAddImage={handleAddImage}
          runScan={runRegistryScan}
          onConnectGitHub={handleConnectGitHub}
          projectId={projectId}
          branch={selectedBranch || undefined}
        />
      )}

      {/* Render the confirmation modal */}
      {imageToDelete && (
        <ConfirmationModal
          onConfirm={handleConfirmDelete}
          onCancel={() => setImageToDelete(null)}
          isLoading={isDeleting}
          text={t('container.images.confirmDelete', {
            imageName: imageToDelete.artifactName,
          })}
        />
      )}


      {/* Selection action bar - shows when items are selected */}
      <SelectionActionBar
        selectedCount={selectedVulnerabilities.size}
        onUpdate={() => setShowBatchUpdateModal(true)}
        onClearSelection={handleClearAllSelections}
        isVisible={view === 'vulnerabilities' && !!selectedImage}
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

export default ResultsContainerPage;
