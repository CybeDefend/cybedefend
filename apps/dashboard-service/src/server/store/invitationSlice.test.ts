import { describe, it, expect, beforeEach } from "vitest";
import invitationReducer, {
  setInvitationContext,
  clearInvitationContext,
  setNewlyJoinedOrgId,
  clearNewlyJoinedOrgId,
  cleanupLegacyInvitationKeys,
  InvitationState,
} from "./invitationSlice";

const initialState: InvitationState = {
  fromInvitation: false,
  pendingInviteUrl: null,
  newlyJoinedOrgId: null,
};

describe("invitationSlice", () => {
  beforeEach(() => {
    // Ensure localStorage is clean so we assert actual slice behaviour
    try {
      window.localStorage.clear();
    } catch {
      // ignore in non-browser env
    }
  });

  it("returns the initial state by default", () => {
    expect(invitationReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores the pending invite URL and marks fromInvitation=true", () => {
    const next = invitationReducer(
      initialState,
      setInvitationContext({ pendingInviteUrl: "/invite/abc?organizationName=Acme" })
    );

    expect(next.fromInvitation).toBe(true);
    expect(next.pendingInviteUrl).toBe("/invite/abc?organizationName=Acme");
  });

  it("clears the invitation context but preserves newlyJoinedOrgId", () => {
    const seeded: InvitationState = {
      fromInvitation: true,
      pendingInviteUrl: "/invite/xyz",
      newlyJoinedOrgId: "org-1",
    };

    const next = invitationReducer(seeded, clearInvitationContext());

    expect(next.fromInvitation).toBe(false);
    expect(next.pendingInviteUrl).toBeNull();
    expect(next.newlyJoinedOrgId).toBe("org-1");
  });

  it("sets the newly joined organization id", () => {
    const next = invitationReducer(initialState, setNewlyJoinedOrgId("org-42"));
    expect(next.newlyJoinedOrgId).toBe("org-42");
  });

  it("clears the newly joined organization id", () => {
    const seeded: InvitationState = {
      fromInvitation: false,
      pendingInviteUrl: null,
      newlyJoinedOrgId: "org-42",
    };

    const next = invitationReducer(seeded, clearNewlyJoinedOrgId());
    expect(next.newlyJoinedOrgId).toBeNull();
  });

  describe("cleanupLegacyInvitationKeys", () => {
    it("removes the legacy top-level localStorage keys when present", () => {
      window.localStorage.setItem("fromInvitation", "true");
      window.localStorage.setItem("pendingRedirectUrl", "/invite/abc");
      window.localStorage.setItem("newlyJoinedOrgId", "org-1");

      cleanupLegacyInvitationKeys();

      expect(window.localStorage.getItem("fromInvitation")).toBeNull();
      expect(window.localStorage.getItem("pendingRedirectUrl")).toBeNull();
      expect(window.localStorage.getItem("newlyJoinedOrgId")).toBeNull();
    });

    it("does not throw when localStorage is unavailable", () => {
      const originalStorage = window.localStorage;
      try {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new Error("blocked");
          },
        });
        expect(() => cleanupLegacyInvitationKeys()).not.toThrow();
      } finally {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          writable: true,
          value: originalStorage,
        });
      }
    });

    it("preserves the current invitationContext persisted key", () => {
      window.localStorage.setItem("fromInvitation", "true");
      window.localStorage.setItem(
        "invitationContext",
        JSON.stringify({
          fromInvitation: true,
          pendingInviteUrl: "/invite/abc",
          newlyJoinedOrgId: null,
        })
      );

      cleanupLegacyInvitationKeys();

      expect(window.localStorage.getItem("fromInvitation")).toBeNull();
      expect(window.localStorage.getItem("invitationContext")).not.toBeNull();
    });
  });
});
