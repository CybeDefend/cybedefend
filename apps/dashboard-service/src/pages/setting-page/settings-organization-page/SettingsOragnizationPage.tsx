import React, { useEffect, useState } from "react";
import { useAuthorization, useRebac } from "react-rebac";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import useOrganizationUsers from "../../../server/hooks/useOrganizationUsers";
import { User } from "../../../server/interfaces/User";
import {
  addOrganizationMember,
  removeOrganizationMember,
  updateOrganizationMemberRole,
  cancelOrganizationInvitation,
} from "../../../server/services/organizationService";
import { OrganizationInviteResponseDto, TeamAssignment } from "../../../server/interfaces/Organization";
import { invitationLink } from "../../../components/molecules/modal/invite-member-organization-modal/InvitationLinkNotice";
import { RootState } from "../../../server/store";
import { selectIsProductActive } from "../../../server/store/selectors";
import { clearScannerStorage } from "../../../utils/function/utils";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import type { AppsecSeatsCount } from "@/edition/extensions";

/*
 * Per-member products and the AppSec seats, as the edition serves them
 * (`ACTIVE_EXTENSIONS.memberProducts`). Without them (the Community Edition)
 * no seat is counted and no refusal is a products refusal.
 */
const NO_SEATS = { seats: null as AppsecSeatsCount | null, refresh: () => undefined };
const useAppsecSeats = (organizationId: string, enabled: boolean) =>
  ACTIVE_EXTENSIONS.memberProducts?.useAppsecSeats(organizationId, enabled) ?? NO_SEATS;
const memberProductsRefusalOf = (error: unknown): string | null =>
  ACTIVE_EXTENSIONS.memberProducts?.refusalOf(error) ?? null;
import { invitableOrganizationRoles } from "../../../utils/data/invitableRoles";
import { ROLE_REFUSAL_KEY, roleRefusalOf } from "@/utils/organizationRoleRefusal";
import type { Product } from "../../../utils/product";
import SettingsOragnizationTemplate from "./SettingsOragnizationTemplate";
import { apiErrorKey } from '@/utils/function/apiErrorKey';

const SettingsOrganizationPage: React.FC = () => {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || "",
    "organization",
    ["creator", "administrator", "manager", "member"]
  );

  const organizationId = selectedOrganization?.id || "";
  const [usersSearchQuery, setUsersSearchQuery] = useState("");
  const [usersPageSize, setUsersPageSize] = useState<number>(5);

  const {
    users,
    totalUsers,
    totalPages,
    currentPage: currentUsersPage,
    loading,
    error,
    goToPage: handleUsersPageChange,
    refresh: refreshUsersList,
    invitations,
    invitationsLoading,
    invitationsError,
  } = useOrganizationUsers(organizationId, usersPageSize, usersSearchQuery);

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);

  const [cancelingInvitation, setCancelingInvitation] = useState(false);

  const [wrapperLoading, setWrapperLoading] = useState(true);

  // Per-member products (closed extension): the AppSec seats billing counts,
  // read by whoever may invite (creator, administrators, managers) while
  // AppSec is active. Anyone else reads them as unknown,
  // which never locks AppSec out: the server decides.
  const inviteRoles = invitableOrganizationRoles(selectedOrganization?.myRole);
  const appsecActive = useSelector(selectIsProductActive("appsec"));
  const { seats: appsecSeats, refresh: refreshAppsecSeats } = useAppsecSeats(
    organizationId,
    inviteRoles.length > 0 && appsecActive
  );

  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        navigate("/");
      }

      if (isAuthorized && selectedOrganization) {
        setWrapperLoading(false);
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

  useEffect(() => {
    clearScannerStorage();
  }, []);

  // The hook goes back to page 1 itself once the debounced query lands; going
  // there on the keystroke fetched page 1 of the previous query first.
  const handleOrganizationUsersSearchChange = (query: string) => {
    setUsersSearchQuery(query);
  };

  const handleManageUser = (user: User) => {
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const handleCloseUserModal = () => {
    setShowUserModal(false);
    setSelectedUser(null);
  };

  const handleDeleteUser = async () => {
    if (selectedUser) {
      try {
        await removeOrganizationMember(organizationId, selectedUser.id);
        toast.success(t('pages.settingsOrganization.toast.deleteUserSuccess'));
        refreshUsersList();
        handleCloseUserModal();
      } catch (error: any) {
        toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsOrganization.toast.deleteUserError' }))
        );
        throw error;
      }
    }
  };

  // The modal closes itself once every change it asked for went through, and
  // reads a refusal of the closed list (`memberProductsRefusalOf`) as its own
  // fixed sentence: such a refusal goes back to it, with no toast of the
  // server's text. Any other failure keeps its toast.
  const handleUserRoleChange = async (newRole: string) => {
    if (selectedUser) {
      try {
        await updateOrganizationMemberRole(organizationId, selectedUser.id, newRole);
        toast.success(t('pages.settingsOrganization.toast.updateRoleSuccess'));
        refreshUsersList();
        // A promotion to administrator takes an AppSec seat.
        refreshAppsecSeats();
      } catch (error: any) {
        if (roleRefusalOf(error)) {
          toast.error(t(ROLE_REFUSAL_KEY));
        } else if (!memberProductsRefusalOf(error)) {
          toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsOrganization.toast.updateRoleError' }))
          );
        }
        throw error;
      }
    }
  };

  const handleMemberProductsChange = async (products: Product[]) => {
    if (selectedUser) {
      try {
        if (!ACTIVE_EXTENSIONS.memberProducts) return;
        await ACTIVE_EXTENSIONS.memberProducts.updateProducts(organizationId, selectedUser.id, products);
        toast.success(t('components.memberProducts.updated'));
        refreshUsersList();
        refreshAppsecSeats();
      } catch (error: unknown) {
        if (!memberProductsRefusalOf(error)) {
          toast.error(t('components.memberProducts.updateFailed'));
        }
        throw error;
      }
    }
  };

  const handleSendInvite = async (
    email: string,
    role: string,
    teamAssignments?: TeamAssignment[],
    products?: Product[]
  ): Promise<OrganizationInviteResponseDto | void> => {
    if (selectedOrganization) {
      try {
        const answer: OrganizationInviteResponseDto | undefined = await addOrganizationMember(
          selectedOrganization.id, email, role, teamAssignments, products
        );
        // An answer carrying a token means no mail was sent: the modal shows
        // the link instead, and « sent » would not be true.
        if (invitationLink(answer?.token ?? '') === null) {
          toast.success(t('pages.settingsOrganization.toast.inviteSuccess'));
        }
        refreshUsersList();
        refreshAppsecSeats();
        return answer;
      } catch (error: any) {
        if (memberProductsRefusalOf(error)) throw error;
        // A role the edition gives nobody: a fixed sentence, never the server's text.
        if (roleRefusalOf(error)) {
          toast.error(t(ROLE_REFUSAL_KEY));
          return;
        }
        toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsOrganization.toast.inviteError' }))
        );
      }
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!organizationId || organizationId.trim() === "") return;
    setCancelingInvitation(true);
    try {
      await cancelOrganizationInvitation(organizationId, invitationId);
      toast.success(t('pages.settingsOrganization.toast.cancelInviteSuccess'));
      refreshUsersList();
    } catch (error: any) {
      toast.error(t(apiErrorKey(error, { fallback: 'pages.settingsOrganization.toast.cancelInviteError' }))
      );
      throw error;
    } finally {
      setCancelingInvitation(false);
    }
  };

  return (
    <SettingsOragnizationTemplate
      companyName={t('pages.settingsOrganization.title')}
      organizationId={organizationId}
      users={users}
      totalUsers={totalUsers}
      currentPage={currentUsersPage}
      totalPages={totalPages}
      pageSize={usersPageSize}
      showModal={showUserModal}
      selectedUser={selectedUser}
      onSearchChange={handleOrganizationUsersSearchChange}
      onManageUser={handleManageUser}
      onDeleteUser={handleDeleteUser}
      onRoleChange={handleUserRoleChange}
      onProductsChange={handleMemberProductsChange}
      appsecSeats={appsecSeats}
      inviteRoles={inviteRoles}
      actorRole={selectedOrganization?.myRole}
      onCloseModal={handleCloseUserModal}
      onPageChange={handleUsersPageChange}
      onPageSizeChange={setUsersPageSize}
      onSendInvite={handleSendInvite}
      loading={loading}
      error={error}
      wrapperLoading={wrapperLoading}
      invitations={invitations}
      invitationsLoading={invitationsLoading || cancelingInvitation}
      invitationsError={invitationsError}
      showInvitationsButton={invitations && invitations.length > 0}
      onCancelInvitation={handleCancelInvitation}
    />
  );
};

export default SettingsOrganizationPage;

