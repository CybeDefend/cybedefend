import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import Select from "../../../atoms/select/Select";
import ConfirmationModal from "../confirmation-modal/ConfirmationModal";
import type { RootState } from "../../../../server/store";
import {
  selectActiveProducts,
  selectCanManageBilling,
  selectMemberProductsSwitchedOff,
} from "../../../../server/store/selectors";
import { useEditionEntitlements } from "@/edition/entitlements";
import { getRolePermissions } from "../../../../utils/data/rolePermissions";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import type { AppsecSeatsCount as AppsecSeats, MemberProductsRefusalContext } from "@/edition/extensions";
import { PRODUCTS, type Product } from "../../../../utils/product";

/*
 * Per-member products and AppSec seats, as the edition serves them
 * (`ACTIVE_EXTENSIONS.memberProducts`). Without them (the Community Edition)
 * no role holds a product of its own, no seat is full, no refusal is a
 * products refusal, and the form has no products part.
 */
const memberProducts = ACTIVE_EXTENSIONS.memberProducts;
const MemberProductsField = memberProducts?.Field ?? null;
const heldProducts = (list: unknown): Product[] => (memberProducts?.heldProducts(list) ?? []) as Product[];
const isAdministratorRole = (role: string | null | undefined): boolean => memberProducts?.isAdministratorRole(role) ?? false;
const memberProductsRefusalOf = (error: unknown): string | null => memberProducts?.refusalOf(error) ?? null;
const memberProductsRefusalKey = (code: string, context: MemberProductsRefusalContext): string =>
  memberProducts?.refusalKey(code, context) ?? "";

import { AS_TOOLTIP } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface ManageUserModalProps {
  userRole: string;
  /**
   * The member's products, as the members list gives them (per-member
   * products). Absent from an older API: no product boxes.
   */
  userProducts?: string[];
  /**
   * Changes the role. A refusal of the closed list (`memberProductsRefusalOf`)
   * rejects, and the modal stays open with its sentence; anything else is the
   * page's to say, and the modal closes.
   */
  onRoleChange: (newRole: string) => Promise<void> | void;
  /** Sets the member's products (`PUT …/members/:userId/products`); rejects as `onRoleChange` does. */
  onProductsChange?: (products: Product[]) => Promise<void>;
  /** AppSec seats as billing counts them; null while unknown (never « full »). */
  appsecSeats?: AppsecSeats | null;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  animationDirection?: "up" | "down" | "none";
  /** The roles the current member may give (`invitableOrganizationRoles`). */
  roles?: { value: string; label: string }[];
  /**
   * Whether the current member may change this member's role: they hold
   * `update_user_role` and may give the member's current role. False: no role select, and Update sends no role.
   */
  canChangeRole?: boolean;
  /** Whether the current member may remove this member. False: no Delete. */
  canRemove?: boolean;
  /**
   * The label of a role this edition no longer offers but the member keeps
   * (the Community Edition's « Billing Manager »): named read-only, with no
   * role select.
   */
  keptRoleLabel?: string;
}

const sameProducts = (a: readonly Product[], b: readonly Product[]): boolean =>
  a.length === b.length && a.every((product) => b.includes(product));

const ManageUserModal: React.FC<ManageUserModalProps> = ({
  userRole,
  userProducts,
  onRoleChange,
  onProductsChange,
  appsecSeats = null,
  onClose,
  onDelete,
  onUpdate,
  animationDirection = "none",
  roles = [],
  canChangeRole = true,
  keptRoleLabel,
  canRemove = true,
}) => {
  const { t } = useTranslation();
  // A shared write (Permify `writable_any`): any active product is enough.
  const writesBlocked = !useEditionEntitlements().writableAny;
  const [selectedRole, setSelectedRole] = useState<string | undefined>(
    userRole
  );
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isValidRole, setIsValidRole] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The role the member holds now: a role change that went through before a
  // refused change of products is not sent again on the retry.
  const [appliedRole, setAppliedRole] = useState(userRole);

  // Per-member products: changed by whoever may change a role
  // (`update_user_role`: the creator and administrators), for the products
  // active in the organisation. A product the member holds that is not active
  // is kept as it is: the boxes only touch what they show.
  const editorRole = useSelector((state: RootState) => state.organization?.selectedOrganization?.myRole ?? "");
  const mayEditProducts = getRolePermissions("organization", editorRole).includes("update_user_role");
  const activeProducts = useSelector(selectActiveProducts);
  const canAddSeats = useSelector(selectCanManageBilling);
  const productsKnown = Array.isArray(userProducts);
  const initialProducts = heldProducts(userProducts);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const showProducts = !!onProductsChange && mayEditProducts && productsKnown && activeProducts.length > 0;
  // Switch off: every member holds both products, the boxes are read-only
  // and nothing is sent (the server would refuse MEMBER_PRODUCTS_OFF).
  const switchedOff = useSelector(selectMemberProductsSwitchedOff);
  const lockedBoth = isAdministratorRole(selectedRole);
  const inactiveHeld = initialProducts.filter((product) => !activeProducts.includes(product));
  const nextProducts = PRODUCTS.filter(
    (product) => inactiveHeld.includes(product) || (activeProducts.includes(product) && products.includes(product))
  );
  const productsChanged =
    showProducts && !switchedOff && !lockedBoth && !sameProducts(nextProducts, initialProducts);

  const selectDropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    // No role to choose: nothing to validate, the role is not sent.
    const isValid = !canChangeRole || roles.some((role) => role.value === selectedRole);
    setIsValidRole(isValid);
  }, [selectedRole, roles, canChangeRole]);

  // Nothing this member may change here: no Update at all.
  const showUpdate = canChangeRole || (showProducts && !switchedOff);

  const handleUpdate = async () => {
    if (!isValidRole || saving) return;
    const role = selectedRole || userRole;
    setSaving(true);
    setRefusal(null);
    let context: MemberProductsRefusalContext = "role";
    try {
      // The role first: a demoted administrator keeps both products, which
      // the boxes may then change; a promotion takes both on the server.
      if (canChangeRole && (role !== appliedRole || !productsChanged)) {
        await onRoleChange(role);
        setAppliedRole(role);
      }
      if (productsChanged && onProductsChange) {
        context = "products";
        await onProductsChange(nextProducts);
      }
      onUpdate();
    } catch (error: unknown) {
      const code = memberProductsRefusalOf(error);
      if (!code) {
        onUpdate();
        return;
      }
      // A fixed sentence, never the server's text; the modal stays to be corrected.
      setRefusal(t(memberProductsRefusalKey(code, context)));
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setIsConfirmingDelete(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
    setIsConfirmingDelete(false);
    onClose();
  };

  const handleCancelDelete = () => {
    setIsConfirmingDelete(false);
  };

  return (
    <>
      {!isConfirmingDelete ? (
        <Modal
          title={t('components.modal.manageUser.title')}
          onClose={onClose}
          animationDirection={animationDirection}
          additionalRefs={[selectDropdownRef]}
          footerButtons={
            <>
              {!showUpdate ? null : writesBlocked ? (
                <div
                  className="relative group inline-flex"
                  data-testid="manage-user-update-blocked-wrapper"
                >
                  <Button variant="secondary" disabled onClick={() => {}}>
                    {t('common.update')}
                  </Button>
                  <div
                    role="tooltip"
                    className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                  >
                    {t('billing.read_only_role_change_disabled')}
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void handleUpdate()}
                  disabled={!isValidRole || saving}
                >
                  {t('common.update')}
                </Button>
              )}
              {canRemove && (
                <Button variant="white" onClick={handleDeleteClick}>
                  {t('components.modal.manageUser.deleteUser')}
                </Button>
              )}
            </>
          }
        >
          {!canChangeRole && keptRoleLabel && (
            <p
              data-testid="manage-user-kept-role"
              className="text-sm text-zinc-700 dark:text-zinc-300"
            >
              {keptRoleLabel}
            </p>
          )}

          {canChangeRole && (
            <Select
              value={selectedRole}
              options={roles}
              placeholder={t('components.modal.manageUser.selectRole')}
              onChange={(value) => {
                setSelectedRole(value);
                setRefusal(null);
              }}
              width="w-full"
              dropdownRef={selectDropdownRef}
            />
          )}

          {!isValidRole && (
            <p className="mt-1.5 text-[13px] text-red-600 dark:text-red-400">
              {t('components.modal.manageUser.validRoleError')}
            </p>
          )}

          {showProducts && MemberProductsField && (
            <div className="mt-4">
              <MemberProductsField
                idPrefix="manage-user"
                offered={activeProducts}
                selected={products}
                onChange={(next) => {
                  setProducts(next as Product[]);
                  setRefusal(null);
                }}
                locked={lockedBoth}
                appsecSeats={appsecSeats}
                holdsAppsec={initialProducts.includes("appsec")}
                canAddSeats={canAddSeats}
                switchedOff={switchedOff}
              />
            </div>
          )}

          {refusal && (
            <p role="alert" className="mt-3 text-[13px] text-red-600 dark:text-red-400">
              {refusal}
            </p>
          )}
        </Modal>
      ) : (
        <ConfirmationModal
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          animationDirection="none"
          text={t('components.modal.manageUser.confirmDeleteUser')}
        />
      )}
    </>
  );
};

export default ManageUserModal;
