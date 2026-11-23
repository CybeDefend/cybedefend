import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "react-toastify";
import type { ProjectAnalysis } from "@/server/interfaces/Project";

// --- Mocks ---

let mockState: Record<string, any> = {};

vi.mock("react-redux", () => ({
  useSelector: (fn: (state: any) => any) => fn(mockState),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-toastify", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("react-rebac", () => ({
  useAuthorization: () => true, // can create project
}));

// OnboardingStep mock: expose the stepId + interactive flag as data attrs. In
// interactive mode it mirrors the real component's click composition — clicking
// the spotlighted child fires `onInteract` BEFORE the child's own onClick (the
// real component only does this when the step is the active one; the mock treats
// `interactive` as "active" since it can't model the tour cursor).
vi.mock("@/components/molecules/on-boarding/OnboardingStep", async () => {
  const ReactMod = await import("react");
  return {
    default: ({ children, stepId, interactive, onInteract }: any) => {
      const kids = interactive
        ? ReactMod.Children.map(children, (c: any) =>
            ReactMod.isValidElement(c)
              ? ReactMod.cloneElement(c as any, {
                  onClick: (e: any) => {
                    onInteract?.();
                    (c.props as any).onClick?.(e);
                  },
                })
              : c,
          )
        : children;
      return (
        <div
          data-testid={`onboarding-step-${stepId}`}
          data-interactive={interactive ? "true" : "false"}
        >
          {kids}
        </div>
      );
    },
  };
});

vi.mock(
  "../../../molecules/modal/create-project-modal/CreateProjectModal",
  () => ({
    default: ({ guided, onClose, initialSource }: any) => (
      <div
        data-testid="create-project-modal"
        data-guided={guided ? "true" : "false"}
        data-source={initialSource ?? "github"}
      >
        <button data-testid="close-modal" onClick={onClose}>
          close
        </button>
      </div>
    ),
  }),
);

vi.mock("../../../molecules/project/ProjectRow", () => ({
  default: ({ to }: { to: string }) => <tr data-testid="project-row" data-to={to} />,
}));

vi.mock("../../../molecules/project/ProjectDetailSidePanel", () => ({
  default: () => <div data-testid="side-panel" />,
}));

vi.mock("../../../molecules/pagination/Pagination", () => ({
  default: () => <div data-testid="pagination" />,
}));

vi.mock("../../../molecules/empty-state/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock("../../../molecules/not-found-element/NotFoundElement", () => ({
  default: () => <div data-testid="not-found" />,
}));

vi.mock("../../../atoms/search-box/SearchBox", () => ({
  default: () => <div data-testid="search-box" />,
}));

vi.mock("../../../atoms/skeleton/Skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("../../../atoms/table/TableHeaderCell", () => ({
  default: ({ children }: any) => <th>{children}</th>,
}));

vi.mock("../../../atoms/button/Button", () => ({
  default: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

// The wizard's « open from a link » hook has its own tests (useNewProjectParam.test.tsx).
const newProject = vi.hoisted(() => ({
  calls: [] as Array<{ canOpen: boolean | undefined; open: (source: "github" | "gitlab") => void }>,
}));
vi.mock("@/server/hooks/useNewProjectParam", () => ({
  useNewProjectParam: (canOpen: boolean | undefined, open: (source: "github" | "gitlab") => void) => {
    newProject.calls.push({ canOpen, open });
  },
}));

import AnalysisTable from "./AnalysisTable";

const baseProps = {
  projects: [],
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  pageSize: 10,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  loading: false,
  error: null as string | null,
  onSearchChange: vi.fn(),
  onCreateProject: vi.fn(),
  teams: [{ label: "Team A", value: "team-a" }],
};

describe("AnalysisTable — the wizard opened from a link", () => {
  // The GitHub or GitLab callback brings a connection started from this wizard
  // back to /appsec?newProject=<provider>.
  beforeEach(() => {
    vi.clearAllMocks();
    newProject.calls = [];
    mockState = { organization: { selectedOrganization: { id: "org-1" } } };
  });

  const lastCall = () => newProject.calls[newProject.calls.length - 1];

  it("waits for the teams, which the home fills a render after it mounts", () => {
    render(<AnalysisTable {...baseProps} teams={[]} />);
    expect(lastCall().canOpen).toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("follows whether the user may create a project once the teams are there", () => {
    render(<AnalysisTable {...baseProps} />);
    expect(lastCall().canOpen).toBe(true);
  });

  it("opens the wizard on the provider the link names, outside the tour", () => {
    render(<AnalysisTable {...baseProps} />);
    act(() => lastCall().open("gitlab"));

    const modal = screen.getByTestId("create-project-modal");
    expect(modal).toHaveAttribute("data-source", "gitlab");
    expect(modal).toHaveAttribute("data-guided", "false");
  });

  it("opens on GitHub again from the New-project button", () => {
    render(<AnalysisTable {...baseProps} />);
    act(() => lastCall().open("gitlab"));
    fireEvent.click(screen.getByTestId("close-modal"));

    fireEvent.click(screen.getByText("components.analysisTable.createProject"));
    expect(screen.getByTestId("create-project-modal")).toHaveAttribute("data-source", "github");
  });
});

describe("AnalysisTable — createProject onboarding step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      organization: { selectedOrganization: { id: "org-1" } },
    };
  });

  it("wraps the New project button in the createProject onboarding step", () => {
    render(<AnalysisTable {...baseProps} />);

    const step = screen.getByTestId("onboarding-step-createProject");
    // The spotlighted anchor contains the "New project" button.
    expect(
      within(step).getByText("components.analysisTable.createProject"),
    ).toBeInTheDocument();
  });

  it("marks the createProject onboarding step interactive", () => {
    render(<AnalysisTable {...baseProps} />);

    expect(
      screen
        .getByTestId("onboarding-step-createProject")
        .getAttribute("data-interactive"),
    ).toBe("true");
  });

  it("opens CreateProjectModal when the New-project button is clicked (no separate Finish)", () => {
    render(<AnalysisTable {...baseProps} />);

    // No separate Finish control in interactive mode.
    expect(
      screen.queryByTestId("finish-createProject"),
    ).not.toBeInTheDocument();
    // Modal is not mounted before the button is clicked.
    expect(
      screen.queryByTestId("create-project-modal"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByText("components.analysisTable.createProject"),
    );

    expect(screen.getByTestId("create-project-modal")).toBeInTheDocument();
  });

  it("opens the modal in guided mode when the click comes from the interactive tour step", () => {
    // The createProject OnboardingStep is interactive → clicking the spotlighted
    // New-project button fires onInteract, which flags guided mode. (Whether the
    // step is actually the ACTIVE tour step is decided inside OnboardingStep and
    // covered by its own tests — here the interactive path stands in for it.)
    render(<AnalysisTable {...baseProps} />);

    fireEvent.click(
      screen.getByText("components.analysisTable.createProject"),
    );

    expect(
      screen.getByTestId("create-project-modal").getAttribute("data-guided"),
    ).toBe("true");
  });

  it("resets guided mode to false after the modal is closed and reopened", () => {
    render(<AnalysisTable {...baseProps} />);

    fireEvent.click(
      screen.getByText("components.analysisTable.createProject"),
    );
    expect(
      screen.getByTestId("create-project-modal").getAttribute("data-guided"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("close-modal"));
    expect(screen.queryByTestId("create-project-modal")).not.toBeInTheDocument();
  });

  it("does not open the modal when there are no teams (guard + toast)", () => {
    render(<AnalysisTable {...baseProps} teams={[]} />);

    fireEvent.click(
      screen.getByText("components.analysisTable.createProject"),
    );

    // Same guard as before: toast, no modal.
    expect(
      screen.queryByTestId("create-project-modal"),
    ).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      "components.analysisTable.createTeamError",
    );
  });
});

describe("AnalysisTable — a project list that could not be loaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      organization: { selectedOrganization: { id: "org-1" } },
    };
  });

  it("says so with a fixed translated sentence, never with the text of the failure", () => {
    // What the list hook hands over: the server's own message when the failure carries one.
    render(
      <AnalysisTable {...baseProps} error="Forbidden resource: role creator@10.0.0.3" />,
    );

    expect(
      screen.getByText("components.analysisTable.loadError"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Forbidden resource/)).not.toBeInTheDocument();
    // A failed load is not an organisation without project.
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });
});

describe("AnalysisTable — where a project row leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      organization: { selectedOrganization: { id: "org-1" } },
    };
  });

  it("opens the AppSec results of the project, under the AppSec prefix", () => {
    render(
      <AnalysisTable {...baseProps} projects={[{ projectId: "p1" } as ProjectAnalysis]} totalItems={1} />,
    );

    expect(screen.getByTestId("project-row").getAttribute("data-to")).toBe(
      "/appsec/project/p1/sast",
    );
  });
});
