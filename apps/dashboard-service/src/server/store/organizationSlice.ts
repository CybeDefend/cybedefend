
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  OrganizationProductState,
  ProfileOrganization,
  Subscription,
} from '../interfaces/Organization';

const sameProducts = (
  a: readonly OrganizationProductState[] | undefined,
  b: readonly OrganizationProductState[],
): boolean =>
  !!a &&
  a.length === b.length &&
  a.every(
    (entry, i) =>
      entry.product === b[i].product &&
      entry.status === b[i].status &&
      entry.trialUsed === b[i].trialUsed,
  );

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  !!a && a.length === b.length && a.every((entry, i) => entry === b[i]);

interface OrganizationState {
  selectedOrganization: ProfileOrganization | null;
}

/**
 * The selected organisation kept in this browser, restored at boot before the
 * profile is read. The member's own products it holds may be stale (an
 * administrator gave a product since), so their pair is never trusted from
 * here: it reads as unknown until the profile answers (`setSelectedOrganization`
 * and `refreshSelectedOrganization` take the fresh pair), and a deep link opened
 * at boot is never sent to a « no access » page on the strength of the old copy.
 */
const restoredOrganization = (): ProfileOrganization | null => {
  try {
    const storedOrganization = localStorage.getItem('selectedOrganization');
    if (!storedOrganization) return null;
    const restored = JSON.parse(storedOrganization);
    if (restored && typeof restored === 'object') delete restored.myProductsKnown;
    return restored;
  } catch {
    return null;
  }
};

const initialState: OrganizationState = {
  selectedOrganization: restoredOrganization(),
};

const organizationSlice = createSlice({
  name: 'organization',
  initialState,
  reducers: {
    setSelectedOrganization: (state, action: PayloadAction<ProfileOrganization>) => {
      const previous = state.selectedOrganization;
      const next = { ...action.payload };
      // A profile read while billing was unavailable carries no products
      // (unknown). For the organisation already selected, the last known list
      // stays: an empty one would read as « no product » and open the modal.
      if (!next.products?.length && previous?.id === next.id && previous.products?.length) {
        next.products = previous.products;
      }
      // The member's own products travel as one pair with their flag: an
      // unknown pair (the flag not true) keeps the last known one.
      if (next.myProductsKnown !== true && previous?.id === next.id && previous.myProductsKnown === true) {
        next.myProducts = previous.myProducts;
        next.myProductsKnown = true;
      }
      state.selectedOrganization = next;
      localStorage.setItem('selectedOrganization', JSON.stringify(next));
    },
    /**
     * Brings a freshly read profile entry into the selected organisation: its
     * products, the member's own products once known (an administrator
     * changed them), the per-member products switch once sent, and the AppSec subscription when it has just appeared
     * (first activation). Counters of an existing subscription stay with
     * `patchSubscription`. An empty product list, or a pair of own products
     * not known, changes nothing. Keeps the object when nothing changed.
     */
    refreshSelectedOrganization: (state, action: PayloadAction<ProfileOrganization>) => {
      const current = state.selectedOrganization;
      const fresh = action.payload;
      if (!current || current.id !== fresh.id) return;
      let changed = false;
      if (fresh.products?.length && !sameProducts(current.products, fresh.products)) {
        current.products = fresh.products;
        changed = true;
      }
      // A fresh known pair wins, an empty list included (no product); an unknown one changes nothing.
      const freshProducts = Array.isArray(fresh.myProducts) ? fresh.myProducts : [];
      if (
        fresh.myProductsKnown === true &&
        (current.myProductsKnown !== true || !sameList(current.myProducts, freshProducts))
      ) {
        current.myProducts = freshProducts;
        current.myProductsKnown = true;
        changed = true;
      }
      if (!current.subscription && fresh.subscription) {
        current.subscription = fresh.subscription;
        changed = true;
      }
      // The per-member products switch, once the profile says it: an
      // absent one (an older gateway) changes nothing.
      if (typeof fresh.memberProducts === 'boolean' && current.memberProducts !== fresh.memberProducts) {
        current.memberProducts = fresh.memberProducts;
        changed = true;
      }
      if (changed) localStorage.setItem('selectedOrganization', JSON.stringify(current));
    },
    patchSubscription: (state, action: PayloadAction<Partial<Subscription>>) => {
      if (!state.selectedOrganization?.subscription) return;
      // The trial poll patches the same values every 15 s. Leave the state
      // untouched then, so `selectedOrganization` keeps its identity and the
      // effects keyed on it do not re-run.
      const current = state.selectedOrganization.subscription;
      const changed = Object.entries(action.payload).some(
        ([key, value]) => current[key as keyof Subscription] !== value,
      );
      if (!changed) return;
      state.selectedOrganization.subscription = {
        ...state.selectedOrganization.subscription,
        ...action.payload,
      };
      localStorage.setItem('selectedOrganization', JSON.stringify(state.selectedOrganization));
    },
  },
});

export const { setSelectedOrganization, patchSubscription, refreshSelectedOrganization } =
  organizationSlice.actions;
export default organizationSlice.reducer;
