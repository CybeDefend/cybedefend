import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './index';
import type {
  OrganizationProductState,
  ProductActivationStatus,
} from '../interfaces/Organization';
import { PRODUCTS, type Product } from '../../utils/product';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { getRolePermissions } from '../../utils/data/rolePermissions';

/*
 * The edition's per-member products (`ACTIVE_EXTENSIONS`). Without them (the
 * Community Edition) whether a member holds a product is unknown, which keeps
 * the behaviour of before per-member products.
 */
const memberHasProduct = (organization: unknown, product: Product): boolean | null =>
  ACTIVE_EXTENSIONS.memberProducts?.memberHasProduct(organization, product) ?? null;
const memberProductsSwitchedOff = (organization: unknown): boolean =>
  ACTIVE_EXTENSIONS.memberProducts?.switchedOff(organization) ?? false;

// ─── Products of the selected organisation ──────────────────────────────

const NO_PRODUCTS: readonly OrganizationProductState[] = [];

const selectOrganizationProducts = (state: RootState): readonly OrganizationProductState[] =>
  state.organization?.selectedOrganization?.products ?? NO_PRODUCTS;

/**
 * `false` while the profile carries no product list. Billing answers both
 * products or nothing, so an empty list means « unknown » (billing
 * unavailable), never « no product active »: a screen that would ask for a
 * product, or send to an activation page, waits for this to be true.
 */
export const selectProductsKnown = (state: RootState): boolean =>
  selectOrganizationProducts(state).length > 0;

/**
 * The product's status, `null` while the list is unknown. The values come from
 * the API: only the literals of the closed lists count, anything else is read
 * as `inactive`.
 */
export const selectProductStatus =
  (product: Product) =>
  (state: RootState): ProductActivationStatus | null => {
    const products = selectOrganizationProducts(state);
    if (products.length === 0) return null;
    const status = products.find((entry) => entry.product === product)?.status;
    return status === 'active' || status === 'deactivated' ? status : 'inactive';
  };

/** True only when the list is known and says `active`. */
export const selectIsProductActive =
  (product: Product) =>
  (state: RootState): boolean =>
    selectProductStatus(product)(state) === 'active';

/** The active products, in display order. */
export const selectActiveProducts = createSelector(
  [selectOrganizationProducts],
  (products): Product[] =>
    PRODUCTS.filter((product) =>
      products.some((entry) => entry.product === product && entry.status === 'active'),
    ),
);

// ─── The member's own products ────────────────────────

const selectSelectedOrganization = (state: RootState) => state.organization?.selectedOrganization ?? null;

/** `memberHasProduct` for the selected organisation: null while unknown. */
export const selectMemberHasProduct =
  (product: Product) =>
  (state: RootState): boolean | null =>
    memberHasProduct(selectSelectedOrganization(state), product);

/** The products the member is known not to hold, in display order; none while unknown. */
export const selectDeniedProducts = createSelector([selectSelectedOrganization], (organization): Product[] =>
  PRODUCTS.filter((product) => memberHasProduct(organization, product) === false),
);

/**
 * What the member may give an invitation: the active products they hold
 * (the creator and administrators hold both). A product the member's list
 * does not say is not refused here: the server decides (`PRODUCT_NOT_GRANTABLE`).
 */
export const selectGrantableProducts = createSelector(
  [selectActiveProducts, selectSelectedOrganization],
  (active, organization): Product[] => active.filter((product) => memberHasProduct(organization, product) !== false),
);

/** The selected organisation's per-member products switch is known to be off. */
export const selectMemberProductsSwitchedOff = (state: RootState): boolean =>
  memberProductsSwitchedOff(selectSelectedOrganization(state));

/**
 * The user holds the organisation `billing` permission (creator,
 * administrator, billing manager): the one who activates and deactivates a
 * product. Mirrors Permify through `getRolePermissions`, never a role list.
 */
export const selectCanManageBilling = (state: RootState): boolean =>
  getRolePermissions(
    'organization',
    state.organization?.selectedOrganization?.myRole || '',
  ).includes('billing');

/** Known to have no active product. Unknown products are not « none ». */
export const selectHasNoActiveProduct = (state: RootState): boolean =>
  selectProductsKnown(state) && selectActiveProducts(state).length === 0;

/** The product question is to be asked: no active product, and the user can activate one. */
export const selectIsProductChoicePending = (state: RootState): boolean =>
  selectHasNoActiveProduct(state) && selectCanManageBilling(state);
