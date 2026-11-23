import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchMyProfile } from "../services/userService";
import { setUserProfile } from "./userSlice";
import { patchSubscription, refreshSelectedOrganization } from "./organizationSlice";
import type { RootState } from "./index";
import type { ProfileOrganization } from "../interfaces/Organization";
import { apiErrorText } from '@/utils/function/apiErrorKey';

export const fetchProfileAsync = createAsyncThunk(
  "user/fetchProfile",
  async (_, { dispatch, getState, rejectWithValue }) => {
    try {
      const userProfile = await fetchMyProfile();
      dispatch(setUserProfile(userProfile));

      // Keep selectedOrganization.subscription in sync with the freshly
      // fetched profile so SSE-driven refreshes (USAGE_UPDATED, TRIAL_UPDATED,
      // SUBSCRIPTION_CHANGED) update the trial counters that
      // TrialStatusWidget/TrialQuotaBanner read from the organization slice.
      // Without this, callers needed a separate poll to backfill that slice.
      const selectedOrgId = (getState() as RootState).organization.selectedOrganization?.id;
      if (selectedOrgId) {
        const fresh = userProfile?.myOrganizations?.find(
          (o: ProfileOrganization) => o.id === selectedOrgId,
        );
        // Products, and the AppSec subscription a first activation creates.
        if (fresh) dispatch(refreshSelectedOrganization(fresh));
        // The whole subscription, not only the trial counters: a trial that
        // became a paid plan (its webhook lands after the Checkout return's
        // first read), a plan change or an add-on bought must reach the
        // readers of the selected organisation too. Every field is a
        // primitive, so `patchSubscription` keeps the object when nothing
        // changed.
        const sub = fresh?.subscription;
        if (sub) dispatch(patchSubscription(sub));
      }

      return userProfile;
    } catch (error: any) {
      console.error("Error fetching user profile:", error);
      return rejectWithValue(apiErrorText(error));
    }
  }
);
