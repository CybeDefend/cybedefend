import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HomeTemplate from "./HomeTemplate";
import type { ProjectStatistics } from "@/server/interfaces/Project";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "pages.homeTemplate.title": "Dashboard",
        "pages.homeTemplate.description": "Overview",
        "pages.homeTemplate.criticalRiskProjects": "Critical Risk Projects",
        "pages.homeTemplate.inLast7Days": "in last 7 days",
        "pages.homeTemplate.solvedIssues": "Solved Issues",
        "pages.homeTemplate.newIssues": "New Issues",
      };
      return map[key] || key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The edition's slots, as a probe of what the template hosts.
const slots = vi.hoisted(() => ({ calls: [] as Array<{ name: string; statistics?: unknown }> }));
vi.mock("@/edition/slots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/edition/slots")>()),
  Slot: ({ name, context }: { name: string; context?: { statistics?: unknown } }) => {
    slots.calls.push({ name, statistics: context?.statistics });
    return null;
  },
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, variants, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/molecules/page-container", () => ({
  PageContainer: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/molecules/page-header", () => ({
  PageHeader: () => null,
}));
vi.mock("@/components/atoms/card", () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/molecules/card/card-icon/CardIcon", () => ({
  default: ({ title, description }: { title: string; description: string }) => (
    <div>
      <span data-testid="card-icon-title">{title}</span>
      <span data-testid="card-icon-description">{description}</span>
    </div>
  ),
}));
vi.mock("@/components/molecules/card/card-vulnerabilities/CardVulnerabilities", () => ({
  default: () => <div data-testid="card-vulnerabilities" />,
}));
vi.mock("@/components/organismes/table/analysis-table/AnalysisTable", () => ({
  default: () => <div data-testid="analysis-table" />,
}));

const baseStatistics: ProjectStatistics = {
  criticalIssues: 1, highIssues: 2, mediumIssues: 3, lowIssues: 4,
  newIssues: 5, newIssuesInLast7Days: 6,
  solvedIssues: 7, solvedIssuesInLast7Days: 8,
  highRiskProjects: 9, highRiskProjectsInLast7Days: 10,
  criticalRiskProjects: 11, criticalRiskProjectsInLast7Days: 12,
  agentAnalysesCount: 0, agentAutofixCount: 0,
  agentTriageCount: 0, agentFalsePositiveCount: 0,
};

const defaultProps = {
  projects: [],
  mainStatistics: baseStatistics,
  currentPage: 1, totalPages: 1, totalProjects: 0,
  pageSize: 10, onPageChange: vi.fn(), onPageSizeChange: vi.fn(),
  loading: false, error: null, onSearchChange: vi.fn(),
  onCreateProject: vi.fn(), teams: [],
  cardsLoading: false, hasActiveScans: false,
};

// The "Critical Risk Projects" KPI card must read the backend's dedicated
// `criticalRiskProjects` / `criticalRiskProjectsInLast7Days` scalars (projects
// whose riskLevel === 'critical', score >= 80) — NOT the `highRiskProjects`
// scalar (score 50-79). The backend getMainStatistics
// computes both as distinct values; the card titled "critical" must show the
// critical count, matching the CRITICAL badge in the projects table below.
describe("HomeTemplate — Critical Risk Projects KPI", () => {
  it("renders the Critical Risk Projects label using the value of criticalRiskProjects from mainStatistics", () => {
    render(<HomeTemplate {...defaultProps} />);
    expect(
      screen.getByText(/11 Critical Risk Projects/i),
    ).toBeInTheDocument();
  });

  it("renders criticalRiskProjectsInLast7Days in the description under the Critical Risk Projects tile", () => {
    render(<HomeTemplate {...defaultProps} />);
    expect(
      screen.getByText(/12 in last 7 days/i),
    ).toBeInTheDocument();
  });

  it("does not surface the legacy High Risk Projects label", () => {
    render(<HomeTemplate {...defaultProps} />);
    expect(screen.queryByText(/High Risk Projects/i)).not.toBeInTheDocument();
  });

  it("counts CRITICAL-risk projects (screenshot regression: N critical, 0 high → card shows N, not 0)", () => {
    const stats = {
      ...baseStatistics,
      criticalRiskProjects: 3,
      highRiskProjects: 0,
    };
    render(<HomeTemplate {...defaultProps} mainStatistics={stats} />);
    expect(
      screen.getByText(/3 Critical Risk Projects/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/0 Critical Risk Projects/i),
    ).not.toBeInTheDocument();
  });

  it("never renders the highRiskProjects value under the critical card (0 critical, 7 high → shows 0)", () => {
    const stats = {
      ...baseStatistics,
      criticalRiskProjects: 0,
      highRiskProjects: 7,
    };
    render(<HomeTemplate {...defaultProps} mainStatistics={stats} />);
    expect(
      screen.getByText(/0 Critical Risk Projects/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/7 Critical Risk Projects/i),
    ).not.toBeInTheDocument();
  });
});

describe("HomeTemplate — the edition's home banners", () => {
  it("hosts the home.banners slot with the organisation statistics", () => {
    const stats = { ...baseStatistics, agentAnalysesCount: 58 };
    render(<HomeTemplate {...defaultProps} mainStatistics={stats} />);
    expect(slots.calls).toContainEqual({ name: "home.banners", statistics: stats });
  });

  it("draws no AI statistics of its own", () => {
    const stats = { ...baseStatistics, agentAnalysesCount: 58, agentAutofixCount: 3 };
    render(<HomeTemplate {...defaultProps} mainStatistics={stats} />);
    expect(screen.queryByText("58")).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-corrections/i)).not.toBeInTheDocument();
  });
});
