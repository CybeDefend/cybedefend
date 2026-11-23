import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { AppDispatch } from "@/server/store";
import { refreshBackgroundTasks } from "@/server/store/backgroundTasksThunks";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { fetchProject } from "../../../server/services/projectService";
import { useProjectReports } from "../../../server/hooks/useProjectReports";
import ProjectReportsTemplate from "./ProjectReportsTemplate";
import { clearScannerStorage } from "../../../utils/function/utils";
import useDisabledFeatures from '@/server/hooks/useDisabledFeatures';
import { useEditionEntitlements } from "@/edition/entitlements";
import { useProjectBranchesList } from "@/server/hooks/useProjectBranchesList";
import { selectDefaultReportBranch } from "./selectDefaultReportBranch";
import { productHome } from "@/utils/product";
import { useReportDeepLink } from "@/components/organismes/stored-reports/useReportDeepLink";

const ProjectReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const dispatch = useDispatch<AppDispatch>();
  // A ?reportId=… deep-link (from the background-tasks widget) opens the
  // stored-reports drawer, on mount and on every later link to this page.
  const { reportId: highlightReportId, key: highlightKey } = useReportDeepLink();
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  // A report must target a single concrete branch — the selector offers no
  // "All branches" option. On first fetch we resolve the initial branch
  // (reference branch, else the first available branch). `null` only persists
  // for projects with no named branches at all (selector hidden).
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const { t } = useTranslation();
  const disabledFeatures = useDisabledFeatures();
  const isReportsDisabled = disabledFeatures.has('reports');
  const writesBlocked = useEditionEntitlements().writesBlocked;

  // Paginated / backend-search branch list (replaces the one-shot
  // getProjectBranches + getArchivedBranches fetch). Archived branches are
  // hidden by default; the "Show archived" toggle in the selector makes them
  // reachable.
  const bl = useProjectBranchesList(projectId ?? null);

  // The SBOM, EU AI Act and per-scanner cards are a closed extension
  // (rendered through the `project.reports.cards` slot); the
  // core hook keeps the OWASP and CWE reports.
  const {
    owaspReportData,
    cweReportData,
    loading,
    cweLoading,
    error,
    generateOwasp,
    generateCwe,
    clearOwaspReport,
    clearCweReport,
    downloadOwaspReport,
    downloadCweReport,
  } = useProjectReports(isReportsDisabled ? undefined : projectId, selectedBranch);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const project = await fetchProject(projectId);
        if (cancelled) return;
        setProjectTitle(project.name);
        setTeamName(project.teamName);
      } catch (e) {
        if (cancelled) return;
        // An AppSec page: the root would hand the account to the landing rule.
        navigate(productHome('appsec'), { replace: true });
        toast.error(t('pages.projectReports.errorFetchingProject'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate, t]);

  // Resolve the initial branch selection once the first page of branches has
  // loaded. The hook's `defaultBranch` is the project's reference branch
  // (returned by the backend). We don't override a branch the user has already
  // explicitly picked.
  useEffect(() => {
    if (bl.loading || bl.branches.length === 0) return;
    setSelectedBranch((prev) => {
      if (prev !== null) return prev;
      // bl.defaultBranch is the project reference branch; fall back through
      // selectDefaultReportBranch which also considers first non-archived.
      return selectDefaultReportBranch(bl.branches, bl.defaultBranch || null);
    });
  }, [bl.loading, bl.branches, bl.defaultBranch]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleGenerateOwaspReport = async (format: 'json' | 'html' | 'pdf', detailed: boolean) => {
    const result = await generateOwasp(format, detailed);
    if (result) {
      toast.success(t('pages.projectReports.reportGeneratedSuccess'));
      dispatch(refreshBackgroundTasks());
    }
  };

  const handleGenerateCweReport = async (format: 'json' | 'html' | 'pdf', detailed: boolean) => {
    const result = await generateCwe(format, detailed);
    if (result) {
      toast.success(t('pages.projectReports.reportGeneratedSuccess'));
      dispatch(refreshBackgroundTasks());
    }
  };

  const handleDownloadOwaspReport = () => {
    if (owaspReportData) {
      downloadOwaspReport(owaspReportData);
      toast.success(t('pages.projectReports.reportDownloadedSuccess'));
    }
  };

  const handleDownloadCweReport = () => {
    if (cweReportData) {
      downloadCweReport(cweReportData);
      toast.success(t('pages.projectReports.reportDownloadedSuccess'));
    }
  };

  return (
    <div>
      <ProjectReportsTemplate
        projectId={projectId}
        highlightReportId={highlightReportId}
        highlightKey={highlightKey}
        projectTitle={projectTitle}
        teamName={teamName}
        owaspReportData={owaspReportData}
        cweReportData={cweReportData}
        loading={loading}
        cweLoading={cweLoading}
        onGenerateOwaspReport={handleGenerateOwaspReport}
        onGenerateCweReport={handleGenerateCweReport}
        onDownloadOwaspReport={handleDownloadOwaspReport}
        onDownloadCweReport={handleDownloadCweReport}
        onClearOwaspReport={clearOwaspReport}
        onClearCweReport={clearCweReport}
        writesBlocked={writesBlocked}
        branches={bl.branches}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
        branchesLoading={bl.loading}
        branchesAsync
        onBranchSearchChange={bl.setSearch}
        onBranchLoadMore={bl.loadMore}
        branchesHasMore={bl.hasMore}
        branchesSearching={bl.searching}
        branchesLoadingMore={bl.loadingMore}
        branchesIncludeArchived={bl.includeArchived}
        onBranchToggleArchived={bl.toggleArchived}
      />
    </div>
  );
};

export default ProjectReportsPage;
