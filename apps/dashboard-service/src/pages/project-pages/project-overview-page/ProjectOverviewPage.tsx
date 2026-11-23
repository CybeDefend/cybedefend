import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { fetchProject } from "@/server/services/projectService";
import { useProjectOverview } from "@/server/hooks/useProjectOverview";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import { clearScannerStorage } from "@/utils/function/utils";
import { Project } from "@/server/interfaces/Project";
import ProjectOverviewTemplate from "./ProjectOverviewTemplate";
import { productHome } from "@/utils/product";

const ProjectOverviewPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [teamName, setTeamName] = useState<string>("");
  const { t } = useTranslation();
  const { complete } = useOnboardingProgress();

  const {
    data: overviewData,
    loading,
    error,
    branches,
    selectedBranch,
    setSelectedBranch,
    refresh,
    handleArchiveBranch,
    handleUnarchiveBranch,
  } = useProjectOverview(projectId);

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId)
        .then((data: Project) => {
          setProjectTitle(data.name);
          setTeamName(data.teamName);
        })
        .catch(() => {
          // An AppSec page: the root would hand the account to the landing rule.
          navigate(productHome("appsec"), { replace: true });
          toast.error(t("pages.projectOverview.errorFetchingProject"));
        });
    }
  }, [projectId, navigate, t]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  // Auto-detect first_scan_completed when project has overview data (scan has run)
  useEffect(() => {
    if (overviewData && !loading) {
      complete('first_scan_completed');
    }
  }, [overviewData, loading]);

  useEffect(() => {
    if (error) {
      toast.error(t("pages.projectOverview.errorFetchingOverview"));
    }
  }, [error, t]);

  return (
    <ProjectOverviewTemplate
      projectId={projectId}
      projectTitle={projectTitle}
      teamName={teamName}
      overviewData={overviewData}
      loading={loading}
      branches={branches}
      selectedBranch={selectedBranch}
      onBranchChange={setSelectedBranch}
      onRefresh={refresh}
      onArchive={handleArchiveBranch}
      onUnarchive={handleUnarchiveBranch}
    />
  );
};

export default ProjectOverviewPage;
