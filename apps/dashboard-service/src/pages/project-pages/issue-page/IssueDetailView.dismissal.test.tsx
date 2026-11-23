import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import IssueDetailView from "./IssueDetailView";

// ─── Hook spies ──────────────────────────────────────────────────────
const refresh = vi.fn();
const silentRefresh = vi.fn();
const updateVulnerability = vi.fn().mockResolvedValue({});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("react-redux", () => ({
  useSelector: (fn: any) =>
    fn({ organization: { selectedOrganization: { id: "org-1" } } }),
}));
vi.mock("react-toastify", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("../../../server/hooks/useVulnerability", () => ({
  default: () => ({
    vulnerability: {
      id: "v-1",
      vulnerabilityType: "sast",
      currentState: "to_verify",
      currentPriority: "normal",
      exploitabilityVerdict: null,
    },
    loading: false,
    error: null,
    refresh,
    silentRefresh,
    isProjectParsed: false,
  }),
}));
vi.mock("../../../server/hooks/useProject", () => ({
  default: () => ({
    isAiMergeRequestEnabled: false,
    isGithubLinked: false,
    isGitlabLinked: false,
    isJiraLinked: false,
  }),
}));
vi.mock("../../../server/services/resultService", () => ({
  updateVulnerability: (...args: unknown[]) => updateVulnerability(...args),
}));
vi.mock("@/server/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
vi.mock("@/server/hooks/useIssueTracking", () => ({
  useIssueTracking: () => ({
    organizationId: "org-1",
    ticketsByVulnerability: new Map(),
    jira: { configured: false, allowedBranches: [] },
    linear: { connected: false, configured: false, allowedBranches: [] },
    anyConfigured: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/atoms/card/Card", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/atoms/skeleton/Skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/atoms/button/BackButton", () => ({ default: () => null }));
vi.mock("../../../components/molecules/not-found-element/NotFoundElement", () => ({ default: () => null }));

// Stand in for the template that owns UpdateVulnerabilityModal: it fires the
// parent's handler with exactly the payload the real modal now produces.
vi.mock("./IssueSastIacTemplate", () => ({
  default: (props: any) => (
    <button
      onClick={() =>
        props.handleUpdateVulnerability({
          status: "ignored",
          dismissalReason: "accepted risk — CISO sign-off",
        })
      }
    >
      do-dismiss
    </button>
  ),
}));
vi.mock("./IssueScaTemplate", () => ({ default: () => null }));
vi.mock("./IssueContainerTemplate", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The modal producing `dismissalReason` is worth nothing if the page
 * that calls the API drops it on the floor: the request would still reach the
 * gateway without a reason and still be refused with a 400. This pins the
 * hand-off between the modal's `onSubmit` payload and the PATCH body.
 */
describe("IssueDetailView — dismissal reason reaches the API", () => {
  it("forwards dismissalReason in the update payload", async () => {
    render(<IssueDetailView projectId="p-1" issueId="v-1" type="sast" />);

    fireEvent.click(screen.getByText("do-dismiss"));

    await waitFor(() => expect(updateVulnerability).toHaveBeenCalledTimes(1));
    const [projectId, vulnerabilityId, body] = updateVulnerability.mock
      .calls[0] as [string, string, Record<string, unknown>];
    expect(projectId).toBe("p-1");
    expect(vulnerabilityId).toBe("v-1");
    expect(body).toMatchObject({
      status: "ignored",
      dismissalReason: "accepted risk — CISO sign-off",
    });
  });
});
