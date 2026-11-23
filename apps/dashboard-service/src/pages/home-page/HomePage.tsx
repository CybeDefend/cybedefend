import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import useOrganizationProjects from "../../server/hooks/useOrganizationProjects";
import useOrganizationMainStatistics from "../../server/hooks/useOrganizationMainStatistics";
import type { Project } from "../../server/interfaces/Project";
import { RootState } from "../../server/store";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import {
  clearScannerStorage
} from "../../utils/function/utils";
import { createProjectWithFeedback } from "@/utils/function/createProjectWithFeedback";
import HomeTemplate from "./HomeTemplate";
import MobileOnboardingTour from "@/components/molecules/on-boarding/MobileOnboardingTour";

const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const { complete } = useOnboardingProgress();
  const [pageSize, setPageSize] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [teams, setTeams] = useState<{ label: string; value: string }[]>([]);

  const organization = useSelector((state: RootState) => state.organization);
  const userProfile = useSelector((state: RootState) => state.user);

  const selectedOrganization = organization.selectedOrganization;
  const organizationId = selectedOrganization?.id || "";

  // Only enable the hook when we have a valid organization ID
  const isReady = Boolean(selectedOrganization && organizationId);

  // Org KPI cards load from their own endpoint so the project list (below)
  // is no longer blocked by the heavier org-wide stats computation.
  const { mainStatistics, refresh: refreshStats } =
    useOrganizationMainStatistics(organizationId, isReady);

  const {
    projects,
    totalProjects,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh,
    hasActiveScans,
  } = useOrganizationProjects(
    organizationId,
    pageSize,
    searchQuery,
    isReady,
    // Refresh the cards from the list's stream (one scoped SSE per page), on
    // the event that says the persisted KPI numbers changed.
    refreshStats,
  );

  const cardsLoading = mainStatistics === null;

  const handlePageChange = (page: number) => {
    goToPage(page);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    goToPage(1);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handleCreateProject = async (
    projectName: string,
    teamId: string,
    aiMergeRequestEnabled?: boolean,
    improvingResultsEnabled?: boolean,
    sortsVulnerabilitiesEnabled?: boolean,
    securityChampionEnabled?: boolean,
    securityContext?: Record<string, any>
  ): Promise<Project | null> => {
    const created = await createProjectWithFeedback({
      teamId,
      projectName,
      aiMergeRequestEnabled,
      improvingResultsEnabled,
      sortsVulnerabilitiesEnabled,
      securityChampionEnabled,
      securityContext,
      product: 'appsec',
    });
    complete('first_project');
    refresh();
    refreshStats();
    // Return the created project so CreateProjectModal can surface the
    // steps after the creation for the real project id.
    return created;
  };

  useEffect(() => {
    clearScannerStorage();
  }, []);

  // Auto-detect first_project if projects already exist
  useEffect(() => {
    if (projects && projects.length > 0) {
      complete('first_project');
    }
  }, [projects]);

  useEffect(() => {
    if (userProfile.isProfileLoaded && selectedOrganization) {
      const currentOrganization = userProfile.myOrganizations.find(
        (org: { id: any }) => org.id === selectedOrganization.id
      );
      if (currentOrganization) {
        const teamsOptions = currentOrganization.myTeams.map((team) => ({
          label: team.name,
          value: team.id,
        }));
        setTeams(teamsOptions);
      } else {
        setTeams([]);
      }
    }
  }, [userProfile, selectedOrganization]);

  // Wait for organization to be selected before rendering
  if (!selectedOrganization || !organizationId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary"></div>
      </div>
    );
  }

  return (
    <>
      {/* Phone-sized viewports only, and self-gating: it starts once the
          profile is recorded (by the layout's OnboardingPersonaModal, which no
          longer asks it). There the page-by-page spotlight tour
          (OnboardingStep) is inert, so this is the whole tour. */}
      <MobileOnboardingTour />
      <HomeTemplate
        projects={projects}
        mainStatistics={mainStatistics}
        currentPage={currentPage}
        totalPages={totalPages}
        totalProjects={totalProjects}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        loading={loading}
        error={error}
        onSearchChange={handleSearchChange}
        onCreateProject={handleCreateProject}
        teams={teams}
        cardsLoading={cardsLoading}
        hasActiveScans={hasActiveScans}
      />
    </>
  );
};

export default HomePage;
