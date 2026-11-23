import React, { useCallback, useEffect, useState } from "react";
import { useAuthorization, useRebac } from "react-rebac";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import useTeamProjects from "../../../server/hooks/useTeamProjects";
import useTeamUsers from "../../../server/hooks/useTeamUsers";
import { Team } from "../../../server/interfaces/Team";
import { User } from "../../../server/interfaces/User";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  fetchAllTeams,
  removeTeamMember,
  updateTeamMemberRole,
} from "../../../server/services/teamService";
import { fetchOrganizationUsers } from "../../../server/services/organizationService";
import { RootState, AppDispatch } from "../../../server/store";
import { clearScannerStorage } from "../../../utils/function/utils";
import { projectPath, useProduct } from "@/utils/product";
import SettingsTeamsTemplate from "./SettingsTeamsTemplate";
import { apiErrorKey } from '@/utils/function/apiErrorKey';

const SettingsTeamsPage: React.FC = () => {
  const navigate = useNavigate();
  const product = useProduct();
  const { t } = useTranslation();
  const { complete } = useOnboardingProgress();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;
  const [usersOrganizationSearchQuery, setUsersOrganizationSearchQuery] =
    useState("");

  // Lazy-loaded organization users - only fetched when Add Member modal opens
  const [usersOrganization, setUsersOrganization] = useState<User[]>([]);
  const [isOrgUsersLoading, setIsOrgUsersLoading] = useState(false);

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["creator", "administrator", "manager", "member"]
  );

  const organizationId = selectedOrganization?.id || "";

  const [activeTeamTab, setActiveTeamTab] = useState<"users" | "projects">(
    "users"
  );
  const [usersPageSize, setUsersPageSize] = useState<number>(5);
  const [projectPageSize, setProjectPageSize] = useState<number>(5);

  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        navigate("/");
      } else {
        if (selectedOrganization) {
          setWrapperLoading(false);
        }
      }
    }
  }, [
    isAuthorized,
    selectedOrganization,
    navigate,
    isProfileLoaded,
    areUserEntitiesLoaded,
    t,
  ]);

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  const [teamUsersSearchQuery, setTeamUsersSearchQuery] = useState("");
  const [teamProjectsSearchQuery, setTeamProjectsSearchQuery] = useState("");

  const {
    users: teamUsers,
    totalUsers: totalTeamUsers,
    totalPages: totalTeamUsersPages,
    currentPage: currentTeamUsersPage,
    loading: teamUsersLoading,
    error: teamUsersError,
    goToPage: handleTeamUsersPageChange,
    refresh: refreshTeamUsersList,
  } = useTeamUsers(selectedTeamId, usersPageSize, teamUsersSearchQuery);

  const {
    projects: teamProjects,
    totalProjects: totalTeamProjects,
    totalPages: totalTeamProjectsPages,
    currentPage: currentTeamProjectsPage,
    loading: teamProjectsLoading,
    error: teamProjectsError,
    goToPage: handleTeamProjectsPageChange,
    refresh: refreshTeamProjectsList,
  } = useTeamProjects(selectedTeamId, projectPageSize, teamProjectsSearchQuery, activeTeamTab === "projects");

  const [selectedTeamUser, setSelectedTeamUser] = useState<User | null>(null);
  const [showTeamUserModal, setShowTeamUserModal] = useState<boolean>(false);
  const [wrapperLoading, setWrapperLoading] = useState(true);

  // Reload the team list when the ORGANIZATION changes, i.e. on its id. The
  // trial profile poll (Layout, every 15 s) replaces the `selectedOrganization`
  // object to move the trial counters; keyed on that object, this effect reset
  // the selection and refetched the teams on every poll. With an empty
  // `myTeams` (an administrator in no team) the selection dropped to "" and
  // back, which refetched the members and reopened the teams SSE stream.
  useEffect(() => {
    if (organizationId && selectedOrganization?.myTeams) {
      const data = selectedOrganization.myTeams;
      if (data.length === 0) {
        setTeams([]);
        setSelectedTeamId("");
      } else {
        setTeams(data);
        setSelectedTeamId(data[0].id);
      }
      fetchTeams();
    } else {
      setTeams([]);
      setSelectedTeamId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const fetchTeams = async () => {
    try {
      const data = await fetchAllTeams(organizationId);
      if (data.length === 0) {
        setTeams([]);
        return;
      }
      setTeams(data);
      // Read the selection when the list arrives, not when this callback was
      // created: from the arrival effect it saw the first render's "", and
      // replaced the profile's first team with the list's, loading the
      // members twice and reopening the teams stream.
      setSelectedTeamId((current) => current || data[0].id);
    } catch (error: any) {
      if (error.response?.status === 404) {
        setTeams([]);
        return;
      }
      setTeams([]);
      toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.fetchError' }))
      );
      throw error;
    }
  };

  const handleAddTeam = async (name: string, description: string) => {
    try {
      const newTeam = await createTeam(organizationId, name, description);
      complete('team_created');
      toast.success(t('pages.settingsTeams.toast.createSuccess'));
      await fetchTeams();
      setSelectedTeamId(newTeam.teamId);
    } catch (error: any) {
      toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.createError' })));
      throw error;
    }
  };

  const handleTeamChange = (teamId: string) => {
    setSelectedTeamId(teamId);
  };

  const handleManageTeamUser = (user: User) => {
    setSelectedTeamUser(user);
    setShowTeamUserModal(true);
  };

  const handleDeleteTeamUser = async () => {
    if (selectedTeamUser) {
      try {
        await removeTeamMember(selectedTeamId, selectedTeamUser.id);
        toast.success(t('pages.settingsTeams.toast.deleteUserSuccess'));
        refreshTeamUsersList();
        handleCloseTeamUserModal();
      } catch (error: any) {
        toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.deleteUserError' }))
        );
        throw error;
      }
    }
  };

  const handleDeleteTeam = async () => {
    try {
      await deleteTeam(selectedTeamId, organizationId);
      toast.success(t('pages.settingsTeams.toast.deleteTeamSuccess'));

      const nextTeamIndex =
        teams.findIndex((team) => team.id === selectedTeamId) + 1;
      if (nextTeamIndex < teams.length) {
        setSelectedTeamId(teams[nextTeamIndex].id);
      } else if (teams.length > 0) {
        setSelectedTeamId(teams[0].id);
      } else {
        setSelectedTeamId("");
      }
      await fetchTeams();
    } catch (error: any) {
      toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.deleteTeamError' }))
      );
      throw error;
    }
  };

  const handleTeamUserRoleChange = async (newRole: string) => {
    if (selectedTeamUser) {
      try {
        await updateTeamMemberRole(selectedTeamId, selectedTeamUser.id, newRole);
        toast.success(t('pages.settingsTeams.toast.updateRoleSuccess'));
        refreshTeamUsersList();
        handleCloseTeamUserModal();
      } catch (error: any) {
        toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.updateRoleError' }))
        );
        throw error;
      }
    }
  };

  const handleCloseTeamUserModal = () => {
    setShowTeamUserModal(false);
    setSelectedTeamUser(null);
  };

  const handleTeamUsersSearchChange = (query: string) => {
    setTeamUsersSearchQuery(query);
    handleTeamUsersPageChange(1);
  };

  const teamsLoading =
    activeTeamTab === "users" ? teamUsersLoading : teamProjectsLoading;
  const teamsError =
    activeTeamTab === "users" ? teamUsersError : teamProjectsError;

  const handleAddTeamUser = (userId: string, role: string) => {
    if (selectedTeamId) {
      addTeamMember(selectedTeamId, userId, role)
        .then(() => {
          toast.success(t('pages.settingsTeams.toast.addUserSuccess'));
          refreshTeamUsersList();
          handleCloseTeamUserModal();
        })
        .catch((error: any) => {
          toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsTeams.toast.addUserError' }))
          );
          throw error;
        });
    }
  };

  const handleTeamProjectsSearchChange = (query: string) => {
    setTeamProjectsSearchQuery(query);
    handleTeamProjectsPageChange(1);
  };

  // This page is common to both products; the project settings exist in each.
  const handleManageProject = (projectId: string) => {
    navigate(projectPath(product, projectId, 'settings'));
  };

  const handleTeamTabChange = (tab: "users" | "projects") => {
    setActiveTeamTab(tab);
  };

  /**
   * Lazy fetch organization users - called only when Add Member modal opens.
   * Avoids unnecessary API calls on page load.
   */
  const fetchOrganizationUsersLazy = useCallback(async (searchQuery: string = "") => {
    if (!organizationId) return;

    setIsOrgUsersLoading(true);
    try {
      const data = await fetchOrganizationUsers(organizationId, 1, 20, searchQuery);
      setUsersOrganization(data.users);
    } catch (error: any) {
      setUsersOrganization([]);
      throw error;
    } finally {
      setIsOrgUsersLoading(false);
    }
  }, [organizationId]);

  /**
   * Handler called when Add Member modal opens - triggers lazy fetch.
   */
  const handleOpenAddMemberModal = useCallback(() => {
    fetchOrganizationUsersLazy(usersOrganizationSearchQuery);
  }, [fetchOrganizationUsersLazy, usersOrganizationSearchQuery]);

  /**
   * Handler for organization users search - fetches with new query.
   */
  const handleOrganizationUsersSearchChange = useCallback((query: string) => {
    setUsersOrganizationSearchQuery(query);
    fetchOrganizationUsersLazy(query);
  }, [fetchOrganizationUsersLazy]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  return (
    <SettingsTeamsTemplate
      companyName="Manage Teams"
      teams={teams || []}
      selectedTeamId={selectedTeamId}
      users={teamUsers || []}
      projects={teamProjects || []}
      totalUsers={totalTeamUsers}
      totalProjects={totalTeamProjects}
      currentPage={
        activeTeamTab === "users"
          ? currentTeamUsersPage
          : currentTeamProjectsPage
      }
      totalPages={
        activeTeamTab === "users" ? totalTeamUsersPages : totalTeamProjectsPages
      }
      pageSize={activeTeamTab === "users" ? usersPageSize : projectPageSize}
      showModal={showTeamUserModal}
      selectedUser={selectedTeamUser}
      onTeamChange={handleTeamChange}
      onManageUser={handleManageTeamUser}
      onDeleteUser={handleDeleteTeamUser}
      onDeleteTeam={handleDeleteTeam}
      onRoleChange={handleTeamUserRoleChange}
      onCloseModal={handleCloseTeamUserModal}
      onPageChange={
        activeTeamTab === "users"
          ? handleTeamUsersPageChange
          : handleTeamProjectsPageChange
      }
      onPageSizeChange={
        activeTeamTab === "users" ? setUsersPageSize : setProjectPageSize
      }
      onAddTeam={handleAddTeam}
      onAddUser={handleAddTeamUser}
      onManageProject={handleManageProject}
      onUsersSearchChange={handleTeamUsersSearchChange}
      onProjectsSearchChange={handleTeamProjectsSearchChange}
      loading={teamsLoading}
      error={teamsError}
      activeTab={activeTeamTab}
      onTabChange={handleTeamTabChange}
      onOrganizationUsersSearchChange={handleOrganizationUsersSearchChange}
      usersOrganization={usersOrganization}
      wrapperLoading={wrapperLoading}
      onOpenAddMemberModal={handleOpenAddMemberModal}
    />
  );
};

export default SettingsTeamsPage;
