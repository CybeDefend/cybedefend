import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { AuthorizedContent } from "react-rebac";
import { useSelector } from "react-redux";

import { cn } from "@/utils/function/utils";
import { PageContainer } from "@/components/molecules/page-container";
import Card from "@/components/atoms/card/Card";
import OnboardingStep from "@/components/molecules/on-boarding/OnboardingStep";
import { FeatureGate } from "@/components/molecules/feature-gate/FeatureGate";
import Button from "../../../components/atoms/button/Button";
import SearchBox from "../../../components/atoms/search-box/SearchBox";
import { Skeleton } from "../../../components/atoms/skeleton/Skeleton";
import AddMemberTeamModal from "../../../components/molecules/modal/add-member-team-modal/AddMemberTeamModal";
import ConfirmationModal from "../../../components/molecules/modal/confirmation-modal/ConfirmationModal";
import CreateTeamModal from "../../../components/molecules/modal/create-team-modal/CreateTeamModal";
import ManageUserModal from "../../../components/molecules/modal/manage-user-modal/ManageUserModal";
import NotFoundElement from "../../../components/molecules/not-found-element/NotFoundElement";
import SidebarMenu from "../../../components/molecules/sidebar/sidebar-menu/SidebarMenu";
import SettingsWrapper from "../../../components/molecules/wrapper/SettingsWrapper";
import ProjectsTable from "../../../components/organismes/table/projects-table/ProjectsTable";
import UserTable from "../../../components/organismes/table/user-table/UserTable";
import { Project } from "../../../server/interfaces/Project";
import { Team } from "../../../server/interfaces/Team";
import { User } from "../../../server/interfaces/User";
import { useEditionEntitlements } from "@/edition/entitlements";
import { getTeamRoles } from "@/utils/data/roleData";
import { Bars, Plus, ProjectDiagram, Users } from '@/components/atoms/icon/icons';

import { AS_TOOLTIP, AS_PANEL_TITLE, AS_PAGE_TITLE } from '@/components/atoms/appsec/styles';
interface SettingsOrganizationTemplateProps {
  companyName: string;
  teams: Team[];
  selectedTeamId: string;
  users: User[];
  projects: Project[];
  totalUsers: number;
  totalProjects: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  showModal: boolean;
  selectedUser: User | null;
  onTeamChange: (teamId: string) => void;
  onManageUser: (user: User) => void;
  onDeleteUser: () => void;
  onDeleteTeam: () => void;
  onRoleChange: (newRole: string) => void;
  onCloseModal: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onAddTeam: (name: string, description: string) => void;
  onAddUser: (userId: string, role: string) => void;
  onManageProject: (projectId: string) => void;
  onUsersSearchChange: (query: string) => void;
  onProjectsSearchChange: (query: string) => void;
  loading: boolean;
  error: string | null;
  activeTab: "users" | "projects";
  onTabChange: (tab: "users" | "projects") => void;
  onOrganizationUsersSearchChange: (query: string) => void;
  usersOrganization: User[];
  wrapperLoading: boolean;
  /** Callback triggered when Add Member modal is about to open - used for lazy loading users */
  onOpenAddMemberModal?: () => void;
}

const SettingsOrganizationTemplate: React.FC<
  SettingsOrganizationTemplateProps
> = ({
  companyName,
  teams,
  selectedTeamId,
  users,
  projects,
  totalUsers,
  totalProjects,
  currentPage,
  totalPages,
  pageSize,
  showModal,
  selectedUser,
  onTeamChange,
  onManageUser,
  onDeleteUser,
  onDeleteTeam,
  onRoleChange,
  onCloseModal,
  onPageChange,
  onPageSizeChange,
  onAddTeam,
  onAddUser,
  onManageProject,
  onUsersSearchChange,
  onProjectsSearchChange,
  loading,
  error,
  activeTab,
  onTabChange,
  onOrganizationUsersSearchChange,
  usersOrganization,
  wrapperLoading,
  onOpenAddMemberModal,
}) => {
    const { t } = useTranslation();
    const [showAddMemberModal, setShowAddMemberModal] = React.useState(false);
    const [showConfirmationModal, setShowConfirmationModal] =
      React.useState(false);
    const [showCreateTeamModal, setShowCreateTeamModal] = React.useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
    const hasTeams = teams && teams.length > 0;

    const selectedOrganization = useSelector(
      (state: any) => state.organization.selectedOrganization
    );
    // Shared actions (create a team, manage its members) follow writable_any,
    // as Permify does: any active product keeps them open over a read-only AppSec.
    const writesBlocked = !useEditionEntitlements().writableAny;

    const [teamSearchQuery, setTeamSearchQuery] = React.useState("");
    const isOrgAdminOrCreator =
      selectedOrganization?.myRole === "administrator" ||
      selectedOrganization?.myRole === "creator";

    const filteredTeams = teams.filter((team) =>
      team.name.toLowerCase().includes(teamSearchQuery.toLowerCase())
    );

    const teamItems = filteredTeams.map((team) => ({
      id: team.id,
      label: team.name,
      icon: <Users className="h-4 w-4 mr-2"  />,
    }));

    const handleCreateTeam = () => {
      setShowCreateTeamModal(true);
    };

    const handleCreateTeamSubmit = (name: string, description: string) => {
      onAddTeam(name, description);
      setShowCreateTeamModal(false);
    };

    const toggleSidebar = () => {
      setIsSidebarOpen(!isSidebarOpen);
    };

    const handleConfirmDelete = () => {
      onDeleteTeam();
      setShowConfirmationModal(false);
      // Clear the search bar after a deletion
      setTeamSearchQuery("");
    };

    const handleCancelDelete = () => {
      setShowConfirmationModal(false);
    };

    useEffect(() => {
      if (!selectedTeamId && hasTeams) {
        onTeamChange(teams[0].id);
      } else if (!hasTeams) {
        onTeamChange("");
      }
    }, [selectedTeamId, teams, hasTeams, onTeamChange]);

    return (
      <SettingsWrapper selectedTab="teams" loading={wrapperLoading}>
        <FeatureGate feature="team_management" preview featureLabel="Team Management">
        <PageContainer background="transparent" padding="none">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <OnboardingStep
              title={t('pages.settingsTeams.onboarding.title')}
              subtitle={t('pages.settingsTeams.onboarding.subtitle')}
              stepId="teamsSettings"
            >
              {/*
                On a phone the teams sit above the team's card, in the page, not
                in a drawer over it: a drawer open by default would cover
                « Add Member » until its backdrop is tapped. The menu button of the header shows or hides them.
              */}
              <div className="flex flex-col gap-3 md:flex-row md:gap-0">
                <aside
                  id="settings-teams-list"
                  className={cn(
                    "w-full shrink-0 rounded-2xl md:w-64 md:rounded-r-none md:rounded-l-2xl",
                    "bg-white dark:bg-as-surface",
                    "border border-zinc-200 dark:border-as-line",
                    !isSidebarOpen && "max-md:hidden"
                  )}
                >
                  <div className="h-min-screen flex flex-col ">
                    <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-as-line">
                      <h2 className={AS_PANEL_TITLE}>
                        {t('components.settingsWrapper.tabs.teams')}
                      </h2>
                      <AuthorizedContent
                        entities={[
                          {
                            entityId: selectedTeamId,
                            entityType: "team",
                            relationship: ["team_manager"],
                          },
                          {
                            entityId: selectedOrganization?.id,
                            entityType: "organization",
                            relationship: ["administrator", "creator"],
                          },
                        ]}
                      >
                        {writesBlocked ? (
                          <div
                            className="relative group inline-flex"
                            data-testid="create-team-blocked-wrapper"
                          >
                            <Button
                              variant="white"
                              disabled
                              onClick={() => {}}
                              icon={<Plus className="h-4 w-4"  />}
                            />
                            <div
                              role="tooltip"
                              className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                            >
                              {t('billing.read_only_team_management_disabled')}
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="white"
                            onClick={handleCreateTeam}
                            icon={<Plus className="h-4 w-4"  />}
                          />
                        )}
                      </AuthorizedContent>
                    </div>

                    <div className="p-4">
                      <SearchBox
                        initialValue={teamSearchQuery}
                        onSearch={(query) => setTeamSearchQuery(query)}
                        placeholder={t('pages.settingsTeams.searchPlaceholder')}
                      />
                    </div>

                    {wrapperLoading ? (
                      <div className="p-4">
                        <Skeleton type="text" rows={3} />
                      </div>
                    ) : hasTeams ? (
                      <div className="flex-1 md:overflow-y-auto md:min-h-[calc(80vh-16rem)] md:max-h-[calc(80vh-4rem)]">
                        <SidebarMenu
                          items={teamItems}
                          selectedItemId={selectedTeamId}
                          onChange={onTeamChange}
                          alignment="left"
                        />
                      </div>
                    ) : (
                      <div className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-4 px-4">
                        <NotFoundElement
                          title={t('pages.settingsTeams.notFound.title')}
                          description={
                            isOrgAdminOrCreator
                              ? t('pages.settingsTeams.notFound.description')
                              : t('pages.settingsTeams.notFound.noAssignmentDescription')
                          }
                        />
                      </div>
                    )}
                  </div>
                </aside>

                <Card
                  variant="default"
                  padding="none"
                  className={cn(
                    "flex-1 flex flex-col overflow-auto custom-scrollbar",
                    "rounded-2xl md:rounded-l-none md:rounded-r-2xl",
                    "bg-white dark:bg-as-surface",
                    "border border-zinc-200 dark:border-as-line"
                  )}
                >
                  <header className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 border-b border-zinc-200 dark:border-as-line">
                    <div className="flex items-center mb-4 md:mb-0">
                      <Button
                        variant="ghost"
                        onClick={toggleSidebar}
                        icon={<Bars className="h-4 w-4"  />}
                        aria-label={t('components.settingsWrapper.tabs.teams')}
                        aria-expanded={isSidebarOpen}
                        aria-controls="settings-teams-list"
                        className="md:hidden mr-2"
                      />
                      {wrapperLoading ? (
                        <Skeleton type="text" rows={1} />
                      ) : (
                        <h1 className={cn(AS_PAGE_TITLE, "text-xl md:text-2xl")}>
                          {teams.find((team) => team.id === selectedTeamId)?.name ||
                            t('pages.settingsTeams.headerTitleDefault')}
                        </h1>
                      )}
                    </div>
                    <div className="flex flex-col md:flex-row items-stretch md:items-center space-y-2 md:space-y-0 md:space-x-2">
                      {(activeTab === "users" || activeTab === "projects") && (
                        <AuthorizedContent
                          entities={[
                            {
                              entityId: selectedTeamId,
                              entityType: "team",
                              relationship: ["team_manager"],
                            },
                            {
                              entityId: selectedOrganization?.id,
                              entityType: "organization",
                              relationship: ["administrator", "creator"],
                            },
                          ]}
                        >
                          {writesBlocked ? (
                            <div
                              className="relative group inline-flex"
                              data-testid="team-actions-blocked-wrapper"
                            >
                              <Button
                                variant="secondary"
                                disabled
                                onClick={() => {}}
                                icon={<Plus className="h-4 w-4"  />}
                                className="text-sm"
                              >
                                {t('pages.settingsTeams.buttons.addMember')}
                              </Button>
                              <div
                                role="tooltip"
                                className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                              >
                                {t('billing.read_only_team_management_disabled')}
                              </div>
                            </div>
                          ) : (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  onOpenAddMemberModal?.();
                                  setShowAddMemberModal(true);
                                }}
                                icon={<Plus className="h-4 w-4"  />}
                                className="text-sm"
                              >
                                {t('pages.settingsTeams.buttons.addMember')}
                              </Button>
                              {teams.length > 1 && (
                                <Button
                                  variant="destructive"
                                  onClick={() => setShowConfirmationModal(true)}
                                  className="text-sm"
                                >
                                  {t('pages.settingsTeams.buttons.deleteTeam')}
                                </Button>
                              )}
                            </>
                          )}
                        </AuthorizedContent>
                      )}
                    </div>
                  </header>
                  <nav className="flex items-center border-b border-zinc-200 dark:border-as-line">
                    <div
                      onClick={() => onTabChange("users")}
                      className={cn(
                        "flex-1 cursor-pointer -mb-px transition-colors duration-[120ms] h-full flex justify-center items-center",
                        activeTab === "users"
                          ? "border-b-2 border-secondary"
                          : "border-b-2 border-transparent hover:border-zinc-300 dark:hover:border-white/[0.2]"
                      )}
                    >
                      <Button
                        variant="ghost"
                        className={cn("w-full h-10 max-md:h-11 rounded-none text-[13px] hover:bg-transparent dark:hover:bg-transparent", activeTab === "users" && "text-zinc-900 dark:text-zinc-50")}
                      >
                        <Users className="h-4 w-4 mr-0.5"  />
                        {t('pages.settingsTeams.tabs.users')}
                      </Button>
                    </div>

                    <div
                      onClick={() => onTabChange("projects")}
                      className={cn(
                        "flex-1 cursor-pointer -mb-px transition-colors duration-[120ms] h-full flex justify-center items-center",
                        activeTab === "projects"
                          ? "border-b-2 border-secondary"
                          : "border-b-2 border-transparent hover:border-zinc-300 dark:hover:border-white/[0.2]"
                      )}
                    >
                      <Button
                        variant="ghost"
                        className={cn("w-full h-10 max-md:h-11 rounded-none text-[13px] hover:bg-transparent dark:hover:bg-transparent", activeTab === "projects" && "text-zinc-900 dark:text-zinc-50")}
                      >
                        <ProjectDiagram className="h-4 w-4 mr-0.5"  />
                        {t('pages.settingsTeams.tabs.projects')}
                      </Button>
                    </div>
                  </nav>
                  <div className="flex-1 overflow-auto custom-scrollbar p-4">
                    {activeTab === "users" ? (
                      <UserTable
                        users={users}
                        totalUsers={users.length}
                        totalItems={users.length}
                        currentPage={currentPage}
                        totalPages={totalPages}
                        pageSize={pageSize}
                        loading={loading}
                        showInvitationsButton={false}
                        onManageInvitations={() => { }}
                        onSearchChange={onUsersSearchChange}
                        onPageChange={onPageChange}
                        onPageSizeChange={onPageSizeChange}
                        onManageUser={onManageUser}
                      />
                    ) : (
                      <ProjectsTable
                        projects={projects}
                        onManageProject={onManageProject}
                        currentPage={currentPage}
                        totalPages={totalPages}
                        totalItems={totalProjects}
                        pageSize={pageSize}
                        loading={loading}
                        onPageChange={onPageChange}
                        onPageSizeChange={onPageSizeChange}
                        onProjectsSearchChange={onProjectsSearchChange}
                      />
                    )}
                  </div>
                </Card>

                {showCreateTeamModal && (
                  <CreateTeamModal
                    onClose={() => setShowCreateTeamModal(false)}
                    onCreateTeam={handleCreateTeamSubmit}
                  />
                )}

                {showAddMemberModal && (
                  <AddMemberTeamModal
                    teamName={
                      teams.find((team) => team.id === selectedTeamId)?.name ?? companyName
                    }
                    onClose={() => setShowAddMemberModal(false)}
                    onOrganizationUsersSearchChange={onOrganizationUsersSearchChange}
                    onAddMember={onAddUser}
                    usersOrganization={usersOrganization}
                    roles={getTeamRoles()}
                  />
                )}

                {showModal && selectedUser && (
                  <ManageUserModal
                    userRole={selectedUser.role}
                    onRoleChange={onRoleChange}
                    onClose={onCloseModal}
                    onDelete={onDeleteUser}
                    onUpdate={onCloseModal}
                    roles={getTeamRoles()}
                  />
                )}

                {showConfirmationModal && (
                  <ConfirmationModal
                    onConfirm={handleConfirmDelete}
                    onCancel={handleCancelDelete}
                    animationDirection="none"
                    text={t('pages.settingsTeams.modals.deleteConfirmation')}
                  />
                )}
              </div>
            </OnboardingStep>
          </motion.div>
        </PageContainer>
        </FeatureGate>
      </SettingsWrapper>
    );
  };

export default SettingsOrganizationTemplate;
