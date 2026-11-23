import React, { useState } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { ProjectAnalysis } from "../../../../server/interfaces/Project";
import Button from "../../../atoms/button/Button";
import SearchBox from "../../../atoms/search-box/SearchBox";
import { Skeleton } from "../../../atoms/skeleton/Skeleton";
import TableHeaderCell from "../../../atoms/table/TableHeaderCell";
import CreateProjectModal from "../../../molecules/modal/create-project-modal/CreateProjectModal";
import { useNewProjectParam } from "@/server/hooks/useNewProjectParam";
import type { IntegrationProvider } from "@/server/interfaces/IntegrationProvider";
import NotFoundElement from "../../../molecules/not-found-element/NotFoundElement";
import { EmptyState } from "../../../molecules/empty-state/EmptyState";
import { EMPTY_STATE_COPY } from '@/components/molecules/empty-state/emptyStateCopy';
import Pagination from "../../../molecules/pagination/Pagination";
import ProjectRow from "../../../molecules/project/ProjectRow";
import ProjectDetailSidePanel from "../../../molecules/project/ProjectDetailSidePanel";
import OnboardingStep from "@/components/molecules/on-boarding/OnboardingStep";
import { useIsCompactViewport } from "@/utils/hooks/useIsCompactViewport";
import { useTranslation } from "react-i18next";
import { useAuthorization } from "react-rebac";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";
import { projectPath } from "@/utils/product";
import { AS_TH } from '@/components/atoms/appsec/styles';

interface AnalysisTableProps {
  projects: ProjectAnalysis[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading: boolean;
  error: string | null;
  onSearchChange: (query: string) => void;
  onCreateProject: (
    projectName: string,
    teamId: string,
    aiMergeRequestEnabled?: boolean,
    improvingResultsEnabled?: boolean,
    sortsVulnerabilitiesEnabled?: boolean,
    securityChampionEnabled?: boolean,
    securityContext?: Record<string, any>,
  ) => void;
  teams: { label: string; value: string }[];
  hasActiveScans?: boolean;
}

const AnalysisTable: React.FC<AnalysisTableProps> = ({
  projects,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  error,
  onSearchChange,
  onCreateProject,
  teams,
}) => {
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  // The source the modal opens on: GitHub, or the provider a callback brought the account back from.
  const [createSource, setCreateSource] = useState<IntegrationProvider>("github");
  // Whether the modal was opened FROM the onboarding tour (guided coach on).
  // Captured synchronously at click time (see handleOpenCreateProject).
  const [guidedCreate, setGuidedCreate] = useState(false);
  const [sidePanelProject, setSidePanelProject] =
    useState<ProjectAnalysis | null>(null);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );
  const canCreateProject = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["creator", "administrator", "manager"],
  );

  // Single guarded entry point to the create-project modal. Used by the
  // New-project button's own onClick; in the interactive tour step that same
  // click also completes onboarding (handled inside OnboardingStep).
  const handleOpenCreateProject = () => openCreateProjectOn("github");

  function openCreateProjectOn(source: IntegrationProvider) {
    if (teams.length === 0) {
      toast.error(t("components.analysisTable.createTeamError"));
      return;
    }
    setCreateSource(source);
    setShowCreateProjectModal(true);
  }

  // The GitHub or GitLab callback brings a connection started from the modal
  // back to /appsec?newProject=<provider>. The home fills the teams a render
  // after it mounts: until then the link waits (without a team the modal
  // cannot open, and the user cannot have left it).
  useNewProjectParam(teams.length > 0 ? canCreateProject : undefined, openCreateProjectOn);

  // The guided coach is shown ONLY when the modal was opened by clicking the
  // spotlighted button DURING the active createProject tour step. OnboardingStep
  // fires `onInteract` for exactly that case (never for an ordinary New-project
  // click, a skipped-persona user, or a mid-tour reload), and it runs before the
  // button's own onClick so both setState calls batch into the same render.
  const handleGuidedInteract = () => setGuidedCreate(true);

  // Phone-sized viewport, no project yet: the six-column table is 601px wide
  // on a 390px screen, so an empty state centred in its one cell was cut off at
  // the right edge inside a sideways scroller. With no rows there is nothing
  // for the columns to head — show the empty state on its own.
  const isCompact = useIsCompactViewport();
  const emptyOnPhone =
    isCompact && !loading && !error && projects.length === 0;

  const emptyState = (
    <EmptyState
      cybeMessage
      title={t(EMPTY_STATE_COPY.noProject)}
      action={
        canCreateProject ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowCreateProjectModal(true)}
          >
            {t("components.cybe.chat.noProjectButton")}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="min-h-[calc(100vh-220px)] w-full max-w-full mx-auto flex flex-col ">
      <OnboardingStep
        title={t("components.analysisTable.onboarding.title")}
        subtitle={t("components.analysisTable.onboarding.subtitle")}
        stepId="projects"
      >
        <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
          <div className="px-4 py-3 sm:px-5 grid gap-3 md:flex md:justify-between md:items-center border-b border-zinc-200 dark:border-as-line">
            {/* On a phone the count and the search box fought over one row and
                "1 Project" broke across two lines. They stack until there is
                room for both. */}
            <div className="flex flex-col gap-3 w-full md:flex-row md:items-center md:space-x-4 md:gap-0 md:w-1/2">
              <h2 className="whitespace-nowrap text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {totalItems}{" "}
                {totalItems > 1
                  ? t("components.analysisTable.projects")
                  : t("components.analysisTable.project")}
              </h2>
              <div className="w-full md:w-2/3">
                <SearchBox
                  onSearch={onSearchChange}
                  placeholder={t("components.analysisTable.searchPlaceholder")}
                />
              </div>
            </div>
            {canCreateProject && (
              // The interactive tour step clones its DIRECT child and composes
              // the onboarding-completion onto its onClick, so the child must be
              // the Button itself — not a wrapper div (a wide grid/flex wrapper
              // would let a tap on its blank area complete the tour without ever
              // opening the modal). The layout wrapper stays OUTSIDE the step.
              <div className="mt-4 md:mt-0 flex justify-end gap-x-2">
                <OnboardingStep
                  title={t(
                    "components.analysisTable.onboarding.createProject.title",
                  )}
                  subtitle={t(
                    "components.analysisTable.onboarding.createProject.subtitle",
                  )}
                  stepId="createProject"
                  interactive
                  onInteract={handleGuidedInteract}
                  interactiveHint={t("components.analysisTable.onboarding.createProject.clickHint")}
                >
                  <Button variant="secondary" onClick={handleOpenCreateProject}>
                    {t("components.analysisTable.createProject")}
                  </Button>
                </OnboardingStep>
              </div>
            )}
          </div>

          {emptyOnPhone ? (
            <div className="flex-1 px-4 py-6 text-center">{emptyState}</div>
          ) : (
          <div className="flex-1 overflow-auto custom-scrollbar">
            {/* Below `md` the rows stack (name, then the rest wrapped), as the
                zinc-kit projects lists do: no column hidden past the edge. */}
            <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line max-md:block">
              <thead className="max-md:hidden">
                <tr>
                  <TableHeaderCell>
                    {t("components.analysisTable.projectName")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("components.analysisTable.linkedTeam")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("components.analysisTable.cyberRiskLevel")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("components.analysisTable.issues")}
                  </TableHeaderCell>
                  <TableHeaderCell>
                    {t("components.analysisTable.lastSourceScan")}
                  </TableHeaderCell>
                  <th className={`${AS_TH} text-end bg-zinc-50/70 dark:bg-white/[0.02]`} />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-as-line max-md:block">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-4 text-center sm:px-5">
                      <Skeleton type="table" rows={10} columns={1} />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-[13px] text-red-600 dark:text-red-400 sm:px-5"
                    >
                      {/* `error` may be the server's own message: it says that
                          the list failed, and is never what the user reads. */}
                      {t("components.analysisTable.loadError")}
                    </td>
                  </tr>
                ) : projects.length > 0 ? (
                  projects.map((project) => (
                    <ProjectRow
                      key={project.projectId}
                      project={project}
                      to={projectPath("appsec", project.projectId, "sast")}
                      onInfoClick={() => setSidePanelProject(project)}
                    />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-4 text-center sm:px-5"
                    >
                      {emptyState}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          <div className="px-4 sm:px-5 py-2.5 grid gap-3 md:flex md:justify-between md:items-center border-t border-zinc-200 dark:border-as-line">
            <p className="text-[13px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {t("components.analysisTable.showing", {
                count: projects.length,
                total: totalItems,
              })}
            </p>
            <div className="flex-grow flex justify-center">
              {/* The line on the left already says « Showing 10 of 12 projects »: the pager does not say it again. */}
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={onPageChange}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageSizeChange={onPageSizeChange}
                showItemsCount={false}
              />
            </div>
          </div>
        </div>
      </OnboardingStep>

      {showCreateProjectModal && (
        <CreateProjectModal
          onClose={() => {
            setShowCreateProjectModal(false);
            setGuidedCreate(false);
            setCreateSource("github");
          }}
          onCreateProject={onCreateProject}
          teams={teams}
          guided={guidedCreate}
          initialSource={createSource}
        />
      )}

      <ProjectDetailSidePanel
        project={sidePanelProject}
        onClose={() => setSidePanelProject(null)}
      />
    </div>
  );
};

export default AnalysisTable;
