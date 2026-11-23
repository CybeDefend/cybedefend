import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { cn } from "@/utils/function/utils";
import { PageContainer } from "@/components/molecules/page-container";
import { PageHeader } from "@/components/molecules/page-header";
import Card from "@/components/atoms/card/Card";
import OnboardingStep from "@/components/molecules/on-boarding/OnboardingStep";
import { FeatureGate } from "@/components/molecules/feature-gate/FeatureGate";
import { OrganizationInviteResponseDto, TeamAssignment } from "@/server/interfaces/Organization";
import { Skeleton } from "../../../components/atoms/skeleton/Skeleton";
import InviteMemberOrganizationModal from "../../../components/molecules/modal/invite-member-organization-modal/InviteMemberOrganizationModal";
import ManageUserModal from "../../../components/molecules/modal/manage-user-modal/ManageUserModal";
import PendingInvitationsModal from "../../../components/molecules/modal/pending-invitation-modal/PendingInvitationsModal";
import SettingsWrapper from "../../../components/molecules/wrapper/SettingsWrapper";
import UserTable from "../../../components/organismes/table/user-table/UserTable";
import { User } from "../../../server/interfaces/User";
import { mayChangeOrganizationRole, mayGiveOrganizationRole } from "@/utils/data/invitableRoles";
import { getOrganizationRoles } from "@/utils/data/roleData";
import { getRolePermissions } from "@/utils/data/rolePermissions";
import { Building } from '@/components/atoms/icon/icons';
import type { AppsecSeatsCount as AppsecSeats } from '@/edition/extensions';
import type { Product } from '@/utils/product';

interface SettingsOragnizationTemplateProps {
  companyName: string;
  organizationId: string;
  users: User[];
  totalUsers: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  showModal: boolean;
  selectedUser: User | null;
  onSearchChange: (query: string) => void;
  onManageUser: (user: User) => void;
  onDeleteUser: () => void;
  onRoleChange: (newRole: string) => Promise<void> | void;
  /** Sets the selected member's products (per-member products, closed extension). */
  onProductsChange: (products: Product[]) => Promise<void>;
  /** AppSec seats as billing counts them; null while unknown. */
  appsecSeats: AppsecSeats | null;
  /** The organisation roles the current member may give in an invitation (`invitableOrganizationRoles`). */
  inviteRoles: { value: string; label: string }[];
  /**
   * The current member's own organisation role. A role change and a removal
   * are ranked like an invitation: offered
   * only on a member whose role this role may give, and a role change only
   * with `update_user_role`. The server stays the check.
   */
  actorRole?: string;
  onCloseModal: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Resolves to the invitation answer, whose token says no mail was sent. */
  onSendInvite: (
    email: string,
    role: string,
    teamAssignments?: TeamAssignment[],
    products?: Product[]
  ) => Promise<OrganizationInviteResponseDto | void> | OrganizationInviteResponseDto | void;
  loading: boolean;
  error: string | null;
  wrapperLoading: boolean;
  invitations?: OrganizationInviteResponseDto[];
  invitationsLoading?: boolean;
  invitationsError?: string | null;
  showInvitationsButton?: boolean;
  onCancelInvitation: (invitationId: string) => void;
}

const SettingsOragnizationTemplate: React.FC<
  SettingsOragnizationTemplateProps
> = ({
  companyName,
  organizationId,
  users,
  totalUsers,
  currentPage,
  totalPages,
  pageSize,
  showModal,
  selectedUser,
  onSearchChange,
  onManageUser,
  onDeleteUser,
  onRoleChange,
  onProductsChange,
  appsecSeats,
  inviteRoles,
  actorRole,
  onCloseModal,
  onPageChange,
  onPageSizeChange,
  onSendInvite,
  loading,
  error,
  wrapperLoading,
  invitations,
  invitationsLoading,
  invitationsError,
  showInvitationsButton,
  onCancelInvitation,
}) => {
    const { t } = useTranslation();
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    const [showInvitationsModal, setShowInvitationsModal] = useState(false);
    // Ranked like an invitation: the member's role must be one the
    // current member may give.
    const mayManage = (user: User) => mayGiveOrganizationRole(actorRole, user.role);
    const mayChangeRoles = getRolePermissions("organization", actorRole ?? "").includes("update_user_role");

    return (
      <SettingsWrapper selectedTab="organization" loading={wrapperLoading}>
        <FeatureGate feature="team_management" preview featureLabel="Team Management">
        <PageContainer background="transparent" padding="none">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <OnboardingStep
              title={t('pages.settingsOrganization.onboarding.title')}
              subtitle={t('pages.settingsOrganization.onboarding.subtitle')}
              stepId="organizationSettings"
            >
              <Card
                variant="default"
                padding="none"
                className={cn(
                  "rounded-2xl",
                  "bg-white dark:bg-as-surface",
                  "border border-zinc-200 dark:border-as-line"
                )}
              >
                <div className="flex-1 overflow-auto custom-scrollbar min-w-full">
                  <UserTable
                    users={users}
                    totalUsers={totalUsers}
                    totalItems={totalUsers}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    showInvitationsButton={Boolean(showInvitationsButton)}
                    onManageInvitations={() => setShowInvitationsModal(true)}
                    onAddMember={() => setShowAddMemberModal(true)}
                    onSearchChange={onSearchChange}
                    onPageChange={onPageChange}
                    onPageSizeChange={onPageSizeChange}
                    onManageUser={onManageUser}
                    loading={loading}
                    minHeigth="calc(100vh-280px)"
                    showProducts
                    canManageUser={mayManage}
                  />
                </div>
              </Card>
            </OnboardingStep>
          </motion.div>
        </PageContainer>

        {showAddMemberModal && (
          <InviteMemberOrganizationModal
            organizationId={organizationId}
            organizationName={companyName}
            onClose={() => setShowAddMemberModal(false)}
            onSendInvite={onSendInvite}
            roles={inviteRoles}
            appsecSeats={appsecSeats}
          />
        )}

        {showModal && selectedUser && (
          <ManageUserModal
            userRole={selectedUser.role}
            userProducts={selectedUser.products}
            onRoleChange={onRoleChange}
            onProductsChange={onProductsChange}
            appsecSeats={appsecSeats}
            onClose={onCloseModal}
            onDelete={onDeleteUser}
            onUpdate={onCloseModal}
            roles={inviteRoles}
            canChangeRole={mayChangeRoles && mayChangeOrganizationRole(actorRole, selectedUser.role)}
            keptRoleLabel={
              mayGiveOrganizationRole(actorRole, selectedUser.role) &&
              !mayChangeOrganizationRole(actorRole, selectedUser.role)
                ? getOrganizationRoles().find((role) => role.value === selectedUser.role)?.label
                : undefined
            }
            canRemove={mayManage(selectedUser)}
          />
        )}

        {showInvitationsModal && (
          <PendingInvitationsModal
            invitations={invitations || []}
            onClose={() => setShowInvitationsModal(false)}
            onCancelInvitation={onCancelInvitation}
            loading={invitationsLoading}
            error={invitationsError || undefined}
          />
        )}
        </FeatureGate>
      </SettingsWrapper>
    );
  };

export default SettingsOragnizationTemplate;