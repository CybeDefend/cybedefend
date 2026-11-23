import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { UserProfile } from "../interfaces/User";

interface UserState extends UserProfile {
  isProfileLoaded: boolean;
  onboardingStep: number;
  /** null = persona question not answered yet (the guided tour is gated on this). */
  onboardingPersona: string | null;
  /**
   * Multi-valued (usage allowlist entries). The API persists this as a
   * CSV string; `normalizeOnboardingUsage` below parses it into an array
   * here so every downstream consumer works with `string[] | null`.
   */
  onboardingUsage: string[] | null;
}

/**
 * Normalizes onboardingUsage from either the wire format (a CSV string, e.g.
 * "vibecoding,compliance" or "" when unset) or an already-parsed array into
 * a filtered `string[]`, collapsing to `null` when empty/missing so callers
 * can keep treating "no usage selected" as a single falsy value.
 */
function normalizeOnboardingUsage(value: unknown): string[] | null {
  let entries: string[];
  if (Array.isArray(value)) {
    entries = value.map((v) => String(v).trim());
  } else if (typeof value === 'string') {
    entries = value.split(',').map((s) => s.trim());
  } else {
    return null;
  }
  const filtered = entries.filter(Boolean);
  return filtered.length > 0 ? filtered : null;
}

const initialState: UserState = {
  id: "",
  firstName: "",
  lastName: "",
  email: "",
  picture: "",
  notification: false,
  isOnboardingCompleted: false,
  onboardingProgress: [],
  onboardingPersona: null,
  onboardingUsage: null,
  createdAt: "",
  updatedAt: "",
  myOrganizations: [],
  myAccessibleProjects: [],
  isProfileLoaded: false,
  onboardingStep: 1,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setUserProfile: (state, action: PayloadAction<UserProfile>) => {
      // Copy before normalizing so the action payload is never mutated.
      const profile: any = { ...action.payload };
      // Parse onboardingProgress if it's a string (from API)
      if (typeof profile.onboardingProgress === 'string') {
        try {
          profile.onboardingProgress = JSON.parse(profile.onboardingProgress);
        } catch {
          profile.onboardingProgress = [];
        }
      }
      // The API returns '' when persona/usage are unset — normalize to null
      // (missing fields from older gateways also become null).
      profile.onboardingPersona = profile.onboardingPersona
        ? profile.onboardingPersona
        : null;
      // onboardingUsage arrives as a CSV string from the API (or an array,
      // e.g. from a caller that already parsed it) — normalize both shapes
      // to `string[] | null`.
      profile.onboardingUsage = normalizeOnboardingUsage(profile.onboardingUsage);
      return { ...state, ...profile, isProfileLoaded: true };
    },
    updateUserNotification: (state, action: PayloadAction<boolean>) => {
      state.notification = action.payload;
    },
    setOnboardingStep: (state, action: PayloadAction<number>) => {
      state.onboardingStep = action.payload;
    },
    addOnboardingStep: (state, action: PayloadAction<string>) => {
      if (!state.onboardingProgress) state.onboardingProgress = [];
      if (!state.onboardingProgress.includes(action.payload)) {
        state.onboardingProgress = [...state.onboardingProgress, action.payload];
      }
    },
    setOnboardingPersona: (
      state,
      action: PayloadAction<{
        onboardingPersona: string;
        onboardingUsage: string | string[];
      }>
    ) => {
      state.onboardingPersona = action.payload.onboardingPersona;
      state.onboardingUsage = normalizeOnboardingUsage(action.payload.onboardingUsage);
    },
    /** The usages alone: what the product question of an existing account changes. */
    setOnboardingUsage: (state, action: PayloadAction<string[]>) => {
      state.onboardingUsage = normalizeOnboardingUsage(action.payload);
    },
    clearUserProfile: () => initialState,
  },
});

export const {
  setUserProfile,
  updateUserNotification,
  clearUserProfile,
  setOnboardingStep,
  addOnboardingStep,
  setOnboardingPersona,
  setOnboardingUsage,
} = userSlice.actions;

export default userSlice.reducer;
