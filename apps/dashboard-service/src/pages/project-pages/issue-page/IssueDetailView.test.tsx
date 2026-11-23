import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import IssueDetailView from "./IssueDetailView";

// ─── Hook spies shared across the test ──────────────────────────────
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
    isLinearLinked: true,
  }),
}));
vi.mock("../../../server/services/resultService", () => ({
  updateVulnerability: (...args: unknown[]) => updateVulnerability(...args),
}));
vi.mock("@/server/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
// The tickets of the project: the hook is checked to be called with the
// project's links, and what it returns to reach the template.
const issueTracking = {
  organizationId: "org-1",
  ticketsByVulnerability: new Map(),
  jira: { configured: false, allowedBranches: [] },
  linear: { connected: true, configured: false, allowedBranches: [] },
  anyConfigured: true,
  refresh: vi.fn(),
};
const useIssueTracking = vi.fn((..._args: unknown[]) => issueTracking);
vi.mock("@/server/hooks/useIssueTracking", () => ({
  useIssueTracking: (...args: unknown[]) => useIssueTracking(...args),
}));

// Trivial atom mocks (unused on the happy path, but keep the module tree light).
vi.mock("@/components/atoms/card/Card", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/atoms/skeleton/Skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/atoms/button/BackButton", () => ({ default: () => null }));
vi.mock("../../../components/molecules/not-found-element/NotFoundElement", () => ({ default: () => null }));

// The SAST/IAC template is where the update modal lives — mock it to a button
// that fires the parent's update handler, so we can observe the refresh path.
const templateProps = vi.fn();
vi.mock("./IssueSastIacTemplate", () => ({
  default: (props: any) => {
    templateProps(props);
    return (
      <button onClick={() => props.handleUpdateVulnerability({ status: "confirmed" })}>
        do-update
      </button>
    );
  },
}));
vi.mock("./IssueScaTemplate", () => ({ default: () => null }));
vi.mock("./IssueContainerTemplate", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IssueDetailView — keeps the modal mounted on update", () => {
  it("refreshes SILENTLY after an update (never the loading refresh that would unmount the template/modal)", async () => {
    render(<IssueDetailView projectId="p-1" issueId="v-1" type="sast" />);

    fireEvent.click(screen.getByText("do-update"));

    await waitFor(() => expect(updateVulnerability).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(silentRefresh).toHaveBeenCalledTimes(1));
    // The non-silent refresh flips `loading`, which renders the full-page
    // skeleton and unmounts the whole Issue*Template subtree (incl. the modal).
    // It must stay mounted, so refresh() must NOT be used here.
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("IssueDetailView — ticket tracking", () => {
  it("reads the tickets with the project's Jira and Linear links and hands them to the template", () => {
    render(<IssueDetailView projectId="p-1" issueId="v-1" type="sast" />);

    expect(useIssueTracking).toHaveBeenCalledWith("p-1", { isJiraLinked: false, isLinearLinked: true });
    expect(templateProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ issueTracking, organizationId: "org-1" }),
    );
  });
});
