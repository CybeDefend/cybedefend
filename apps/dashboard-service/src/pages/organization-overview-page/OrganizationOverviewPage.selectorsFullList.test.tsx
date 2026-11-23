import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Holder hoisted above the vi.mock factories so they can reference it safely.
const h = vi.hoisted(() => ({
  captured: null as any,
}));

const mockState = {
  organization: {
    selectedOrganization: { id: "org-1", name: "Org" },
  },
};

vi.mock("react-redux", () => ({
  useSelector: (fn: (s: any) => any) => fn(mockState),
}));

// The overview payload carries only the FIRST page of projectsSummary
// (paginated server-side, default 50). Here it intentionally contains a single
// project — a project beyond the page window must NOT come from here.
vi.mock("@/server/hooks/useOrganizationOverview", () => ({
  useOrganizationOverview: () => ({
    data: {
      totalProjects: 2,
      projectsSummary: [
        {
          projectId: "p1",
          projectName: "Project One",
          teamId: "t1",
          teamName: "Team A",
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          riskLevel: "low",
        },
      ],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    filters: {},
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    page: 1,
    setPage: vi.fn(),
  }),
  default: () => ({}),
}));

// The full org project list — the canonical source for the project + branch
// selectors. Contains a project ('p99') that is NOT in the paginated
// projectsSummary above; it MUST still reach the selectors.
vi.mock("@/server/hooks/useAllOrganizationProjects", () => ({
  default: () => ({
    projects: [
      {
        projectId: "p1",
        name: "Project One",
        teamId: "t1",
        teamName: "Team A",
      },
      {
        projectId: "p99",
        name: "Hidden Project",
        teamId: "t2",
        teamName: "Team B",
      },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// Stub the presentation component: capture the props it receives so the test
// can inspect the `projects` list handed to the selectors.
vi.mock("./OrganizationOverviewTemplate", () => ({
  default: (props: any) => {
    h.captured = props;
    return <div data-testid="tpl" />;
  },
}));

import OrganizationOverviewPage from "./OrganizationOverviewPage";

describe("OrganizationOverviewPage — selectors fed from the full project list", () => {
  beforeEach(() => {
    h.captured = null;
  });

  it("passes ALL org projects to the selectors, not just the paginated overview window", () => {
    render(<OrganizationOverviewPage />);

    const ids = (h.captured?.projects ?? []).map((p: any) => p.projectId);
    // The project beyond the overview page window must still be selectable.
    expect(ids).toContain("p99");
    expect(ids).toContain("p1");
  });
});
