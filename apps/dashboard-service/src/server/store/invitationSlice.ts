import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface InvitationState {
  fromInvitation: boolean;
  pendingInviteUrl: string | null;
  newlyJoinedOrgId: string | null;
}

const STORAGE_KEY = "invitationContext";

const LEGACY_INVITATION_KEYS = [
  "fromInvitation",
  "newlyJoinedOrgId",
  "pendingRedirectUrl",
] as const;

/**
 * Remove legacy top-level localStorage keys that predate the Redux slice.
 * Exported so tests can exercise it; called once at module load below.
 */
export const cleanupLegacyInvitationKeys = (): void => {
  try {
    if (typeof localStorage === "undefined") return;
    for (const key of LEGACY_INVITATION_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Silent no-op when storage is unavailable (SSR, privacy mode)
  }
};

// Rehydrate across reloads. We persist only in the slice (never touch
// the legacy top-level flags). Kept in-sync via reducers below.
const readPersistedState = (): InvitationState => {
  const fallback: InvitationState = {
    fromInvitation: false,
    pendingInviteUrl: null,
    newlyJoinedOrgId: null,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      fromInvitation: Boolean(parsed?.fromInvitation),
      pendingInviteUrl:
        typeof parsed?.pendingInviteUrl === "string" ? parsed.pendingInviteUrl : null,
      newlyJoinedOrgId:
        typeof parsed?.newlyJoinedOrgId === "string" ? parsed.newlyJoinedOrgId : null,
    };
  } catch {
    return fallback;
  }
};

const writePersistedState = (state: InvitationState): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Silent no-op when storage is unavailable
  }
};

// One-shot cleanup of legacy top-level keys (pre-slice era) on every app
// boot. Safe to run repeatedly: removeItem is a no-op when the key is absent.
cleanupLegacyInvitationKeys();

const initialState: InvitationState = readPersistedState();

const invitationSlice = createSlice({
  name: "invitation",
  initialState,
  reducers: {
    setInvitationContext(
      state,
      action: PayloadAction<{ pendingInviteUrl: string }>
    ) {
      state.fromInvitation = true;
      state.pendingInviteUrl = action.payload.pendingInviteUrl;
      writePersistedState(state);
    },
    clearInvitationContext(state) {
      state.fromInvitation = false;
      state.pendingInviteUrl = null;
      writePersistedState(state);
    },
    setNewlyJoinedOrgId(state, action: PayloadAction<string>) {
      state.newlyJoinedOrgId = action.payload;
      writePersistedState(state);
    },
    clearNewlyJoinedOrgId(state) {
      state.newlyJoinedOrgId = null;
      writePersistedState(state);
    },
    resetInvitation(state) {
      state.fromInvitation = false;
      state.pendingInviteUrl = null;
      state.newlyJoinedOrgId = null;
      writePersistedState(state);
    },
  },
});

export const {
  setInvitationContext,
  clearInvitationContext,
  setNewlyJoinedOrgId,
  clearNewlyJoinedOrgId,
  resetInvitation,
} = invitationSlice.actions;

export default invitationSlice.reducer;
