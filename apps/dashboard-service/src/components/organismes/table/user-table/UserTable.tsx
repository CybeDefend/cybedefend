import React from "react";
import { AuthorizedContent, useRebac } from "react-rebac";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { User } from "../../../../server/interfaces/User";
import { RootState } from "../../../../server/store";
import { useEditionEntitlements } from "@/edition/entitlements";
import Button from "../../../atoms/button/Button";
import SearchBox from "../../../atoms/search-box/SearchBox";
import NotFoundElement from "../../../molecules/not-found-element/NotFoundElement";
import Pagination from "../../../molecules/pagination/Pagination";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import Avatar from "../../../atoms/avatar/Avatar";
import { useTranslation } from "react-i18next";
import { getOrganizationRoles, getTeamRoles } from "../../../../utils/data/roleData";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import { EDITION } from "@/edition/edition";
import type { Product } from "@/utils/product";

/*
 * The products a member holds, as the edition serves them
 * (`ACTIVE_EXTENSIONS.memberProducts`); none in the Community Edition.
 */
const heldProducts = (list: unknown): Product[] =>
  (ACTIVE_EXTENSIONS.memberProducts?.heldProducts(list) ?? []) as Product[];
const memberProductsSwitchedOff = (organization: unknown): boolean =>
  ACTIVE_EXTENSIONS.memberProducts?.switchedOff(organization) ?? false;
import { PRODUCTS } from "../../../../utils/product";
import Badge from "@/components/atoms/badge/Badge";
import UnavailableValue from "@/components/atoms/unavailable-value/UnavailableValue";

import { AS_PANEL, AS_TH, AS_TD, AS_TD_STRONG, AS_TR, AS_THEAD, AS_DIVIDE, AS_TOOLTIP } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
/**
 * The products a member holds (per-member products), in
 * display order. A list the API did not send is said in words, never guessed.
 */
const MemberProductsCell: React.FC<{ products?: string[]; switchedOff: boolean }> = ({ products, switchedOff }) => {
  const { t } = useTranslation();
  // Switch off: every member holds both products, whatever is stored.
  if (switchedOff) products = [...PRODUCTS];
  if (!Array.isArray(products)) {
    return <UnavailableValue label={t('common.notAvailable')} className="text-zinc-500 dark:text-zinc-400" />;
  }
  const held = heldProducts(products);
  if (held.length === 0) {
    return <span className="text-zinc-500 dark:text-zinc-400">{t('components.memberProducts.none')}</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {held.map((product) => (
        <Badge key={product} appearance="tag" size="xs" label={t(`components.memberProducts.names.${product}`)} />
      ))}
    </span>
  );
};

interface UserTableRowProps {
  user: User;
  totalUsers: number;
  onManageUser: (user: User) => void;
  showProducts: boolean;
  /** False hides the row's Manage button (see `UserTableProps.canManageUser`). */
  manageable: boolean;
}

const UserTableRow: React.FC<UserTableRowProps> = ({
  user,
  totalUsers,
  onManageUser,
  showProducts,
  manageable,
}) => {
  const { t } = useTranslation();
  const userConnected = useSelector((state: RootState) => state.user);
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const { userEntities } = useRebac();

  // Determine the current user's role in the selected organization
  const currentUserOrgRole = userEntities?.find(
    (e: { id: string; type: string; relation: string }) =>
      e.id === selectedOrganization?.id && e.type === "organization"
  )?.relation;
  const isCreator = currentUserOrgRole === "creator";

  // No « last administrator » lock: the organization keeps its creator, who
  // cannot be removed, and the creator manages the administrators. The lock
  // read a count the members endpoint never sends.
  const isSingleUser = totalUsers === 1;

  const getRoleLabel = (roleValue: string) => {
    const orgRole = getOrganizationRoles().find(r => r.value === roleValue);
    if (orgRole) return orgRole.label;

    const teamRole = getTeamRoles().find(r => r.value === roleValue);
    if (teamRole) return teamRole.label;

    return roleValue;
  };

  const handleClick = () => {
    if (isSingleUser) {
      toast.error(
        t('components.userTable.singleUserError')
      );
    } else {
      onManageUser(user);
    }
  };

  return (
    <tr className={AS_TR}>
      <td className={cn(AS_TD, "whitespace-nowrap")}>
        <div className="flex items-center gap-x-3">
          <div className="w-9 h-9 flex-shrink-0">
            <Avatar
              src={user.picture}
              alt={`${user.firstName} ${user.lastName}`}
              size="w-9 h-9"
            />
          </div>
        </div>
      </td>
      <td className={cn(AS_TD, "whitespace-nowrap")}>
        <span className={cn("block", AS_TD_STRONG)}>
          {user.firstName} {user.lastName}
        </span>
      </td>
      <td className={cn(AS_TD, "whitespace-nowrap")}>
        <span className="block">
          {user.email}
        </span>
      </td>
      <td className={cn(AS_TD, "whitespace-nowrap")}>
        <span>
          {getRoleLabel(user.role)}
        </span>
      </td>
      {showProducts && (
        <td className={cn(AS_TD, "whitespace-nowrap")}>
          <MemberProductsCell products={user.products} switchedOff={memberProductsSwitchedOff(selectedOrganization)} />
        </td>
      )}
      <td className={cn(AS_TD, "py-1.5 whitespace-nowrap")}>
        {userConnected.id !== user.id &&
          manageable &&
          // Creator can never be managed; administrator can only be managed by creator
          user.role !== "creator" &&
          user.role !== "team_manager" &&
          (user.role !== "administrator" || isCreator) && (
            <AuthorizedContent
              entityId={selectedOrganization?.id}
              entityType="organization"
              relationship={user.role === "administrator" ? ["creator"] : ["administrator", "creator", "manager"]}
            >
              <Button
                variant="white"
                onClick={handleClick}
                disabled={isSingleUser}
              >
                {t('components.userTable.manage')}
              </Button>
            </AuthorizedContent>
          )}
      </td>
    </tr>
  );
};
interface UserTableProps {
  users: User[];
  totalUsers: number;
  totalItems: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  loading?: boolean;
  showInvitationsButton: boolean;
  onManageInvitations: () => void;
  onAddMember?: () => void;
  onSearchChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onManageUser: (user: User) => void;
  minHeigth?: string;
  /**
   * The members' products (per-member products): only the
   * organisation members page asks for it. The team members route carries
   * no products.
   */
  showProducts?: boolean;
  /**
   * Whether the current member may manage this member at all (the
   * organisation members page: they may give the member's role). Absent: every row keeps its Manage button, as on the
   * team members page.
   */
  canManageUser?: (user: User) => boolean;
}

const UserTable: React.FC<UserTableProps> = ({
  users,
  totalUsers,
  totalItems,
  currentPage,
  totalPages,
  pageSize,
  loading,
  showInvitationsButton,
  onManageInvitations,
  onAddMember,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
  onManageUser,
  minHeigth = "calc(100vh-450px)",
  showProducts: showProductsAsked = false,
  canManageUser,
}) => {
  const { t } = useTranslation();
  // The Community Edition has no per-member products: every member would read
  // « No product », so it shows no Products column at all.
  const showProducts = showProductsAsked && EDITION !== 'community';
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  // A shared write (Permify `writable_any`): any active product is enough.
  const writesBlocked = !useEditionEntitlements().writableAny;
  const hasUsers = users && users.length > 0;

  return (
    <div className={`min-h-[${minHeigth}] w-full max-w-full mx-auto flex flex-col`}>
      <div className={cn(AS_PANEL, "flex-1 flex flex-col overflow-hidden")}>
        <div className="px-4 py-3 sm:px-5 grid grid-cols-1 gap-3 md:flex md:justify-between md:items-center border-b border-zinc-200 dark:border-as-line">
          <div className="w-full md:w-1/3">
            <SearchBox onSearch={onSearchChange} placeholder={t('components.userTable.searchPlaceholder')} />
          </div>
          <div className="mt-0 flex gap-2">
            <div className="inline-flex flex-wrap gap-2">
              {showInvitationsButton && (
                <AuthorizedContent
                  entityId={selectedOrganization?.id}
                  entityType="organization"
                  relationship={["creator", "administrator", "manager"]}
                >
                  <Button variant="white" onClick={onManageInvitations}>
                    {t('components.userTable.managePendingInvitations')}
                  </Button>
                </AuthorizedContent>
              )}
              {onAddMember && (
                <AuthorizedContent
                  entityId={selectedOrganization?.id}
                  entityType="organization"
                  relationship={["creator", "administrator", "manager"]}
                >
                  {writesBlocked ? (
                    <div
                      className="relative group inline-flex"
                      data-testid="add-member-blocked-wrapper"
                    >
                      <Button variant="secondary" disabled onClick={() => {}}>
                        {t('components.userTable.addMember')}
                      </Button>
                      <div
                        role="tooltip"
                        className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                      >
                        {t('billing.read_only_member_management_disabled')}
                      </div>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={onAddMember}>
                      {t('components.userTable.addMember')}
                    </Button>
                  )}
                </AuthorizedContent>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading ? (
            <div className="p-4">
              <Skeleton type="table" rows={10} columns={1} />
            </div>
          ) : (
            <table className={cn("min-w-full", AS_DIVIDE)}>
              <thead className={AS_THEAD}>
                <tr>
                  {[
                    "",
                    t('components.userTable.name'),
                    t('components.userTable.email'),
                    t('components.userTable.role'),
                    ...(showProducts ? [t('components.memberProducts.title')] : []),
                    "",
                  ].map((header, index) => (
                    <th
                      key={index}
                      scope="col"
                      className={cn(AS_TH, "text-start")}
                    >
                      <span>
                        {header}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className={cn(AS_DIVIDE, "flex-1")}>
                {hasUsers ? (
                  users.map((user) => (
                    <UserTableRow
                      key={user.id}
                      user={user}
                      totalUsers={totalUsers}
                      onManageUser={onManageUser}
                      showProducts={showProducts}
                      manageable={canManageUser ? canManageUser(user) : true}
                    />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={showProducts ? 6 : 5}
                      className="px-4 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400"
                    >
                      <NotFoundElement
                        title={t('components.userTable.noUsersFound')}
                        description={t('components.userTable.noUsersDescription')}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {!loading && (
          <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:items-center md:justify-between border-t border-zinc-200 dark:border-as-line">
            <div className="flex-grow flex justify-center">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserTable;
