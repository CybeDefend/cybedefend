import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by empty-state/emptyStateCopy.community.test.tsx.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

// A brand-new account on a phone. The empty state used to live in a
// `<td colSpan={6}>` of a six-column table that is 601px wide on a 390px
// screen: "You have no project yet…" and its Add-project button were centred
// in that 601px cell, i.e. cut off at the right edge, inside a box that
// scrolls sideways. With no rows there is nothing for the columns to head.

let mockState: Record<string, any> = {};

vi.mock("react-redux", () => ({
  useSelector: (fn: (state: any) => any) => fn(mockState),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: any) => <a>{children}</a>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-toastify", () => ({ toast: { error: vi.fn() } }));

vi.mock("react-rebac", () => ({ useAuthorization: () => true }));

vi.mock("@/components/molecules/on-boarding/OnboardingStep", () => ({
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock("../../../molecules/modal/create-project-modal/CreateProjectModal", () => ({
  default: () => <div data-testid="create-project-modal" />,
}));

vi.mock("../../../molecules/project/ProjectRow", () => ({
  default: () => <tr data-testid="project-row" />,
}));

vi.mock("../../../molecules/project/ProjectDetailSidePanel", () => ({
  default: () => null,
}));

vi.mock("../../../molecules/pagination/Pagination", () => ({
  default: () => <div data-testid="pagination" />,
}));

vi.mock("../../../atoms/search-box/SearchBox", () => ({
  default: () => <div data-testid="search-box" />,
}));

vi.mock("@/components/atoms/cybe-avatar/CybeAvatar", () => ({
  CybeAvatar: () => <div />,
}));

// The wizard's « open from a link » hook has its own tests.
vi.mock("@/server/hooks/useNewProjectParam", () => ({ useNewProjectParam: () => undefined }));

import AnalysisTable from "./AnalysisTable";

const emptyAccount = {
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

const setViewport = (compact: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: compact,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState = { organization: { selectedOrganization: { id: "org-1" } } };
});

afterEach(() => {
  // @ts-expect-error restore jsdom's default (no matchMedia)
  delete window.matchMedia;
});

describe("AnalysisTable — no project yet, compact viewport", () => {
  it("shows the empty state on its own, not inside a six-column table", () => {
    setViewport(true);
    render(<AnalysisTable {...emptyAccount} />);

    expect(screen.getByText("components.cybe.emptyState.noProject")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens project creation from the empty state", () => {
    setViewport(true);
    render(<AnalysisTable {...emptyAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "components.cybe.chat.noProjectButton" }));

    expect(screen.getByTestId("create-project-modal")).toBeInTheDocument();
  });

  it("keeps the table while projects are still loading, so rows have somewhere to land", () => {
    setViewport(true);
    render(<AnalysisTable {...emptyAccount} loading />);

    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("keeps the table once there are projects", () => {
    setViewport(true);
    render(
      <AnalysisTable
        {...emptyAccount}
        totalItems={1}
        projects={[{ projectId: "p1" } as any]}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("project-row")).toBeInTheDocument();
  });
});

describe("AnalysisTable — no project yet, wide viewport (unchanged)", () => {
  it("keeps the empty state inside the table", () => {
    setViewport(false);
    render(<AnalysisTable {...emptyAccount} />);

    const table = screen.getByRole("table");
    expect(table).toContainElement(screen.getByText("components.cybe.emptyState.noProject"));
  });
});
