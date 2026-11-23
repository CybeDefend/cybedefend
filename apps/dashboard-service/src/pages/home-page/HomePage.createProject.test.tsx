import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "react-toastify";
import { createProject } from "../../server/services/projectService";

// What the home page does around a project creation: the wizard hands it the
// form values, and the page creates the project, refreshes its own data and
// gives the created project back so the wizard can show the link step.

type CreateHandler = (
  projectName: string,
  teamId: string,
  aiMergeRequestEnabled?: boolean,
  improvingResultsEnabled?: boolean,
  sortsVulnerabilitiesEnabled?: boolean,
  securityChampionEnabled?: boolean,
  securityContext?: Record<string, unknown>,
) => Promise<unknown>;

const spies = vi.hoisted(() => ({
  refresh: vi.fn(),
  refreshStats: vi.fn(),
  complete: vi.fn(),
  onCreateProject: null as CreateHandler | null,
}));

// One stable object: HomePage has an effect keyed on the user slice, so a
// fresh state per useSelector call would re-run it forever.
const state = vi.hoisted(() => ({
  organization: { selectedOrganization: { id: "org-1", name: "Acme" } },
  user: { isProfileLoaded: true, myOrganizations: [{ id: "org-1", myTeams: [] }] },
}));

vi.mock("react-redux", () => ({
  useSelector: (fn: (s: typeof state) => unknown) => fn(state),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("react-toastify", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../server/hooks/useOrganizationProjects", () => ({
  default: () => ({
    projects: [], totalProjects: 0, totalPages: 1, currentPage: 1,
    loading: false, error: null, goToPage: vi.fn(), refresh: spies.refresh, hasActiveScans: false,
  }),
}));
vi.mock("../../server/hooks/useOrganizationMainStatistics", () => ({
  default: () => ({ mainStatistics: null, refresh: spies.refreshStats }),
}));
vi.mock("../../server/services/projectService", () => ({ createProject: vi.fn() }));
vi.mock("@/server/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({ complete: spies.complete }),
}));
vi.mock("./HomeTemplate", () => ({
  default: (props: { onCreateProject: CreateHandler }) => {
    spies.onCreateProject = props.onCreateProject;
    return <div data-testid="home-template" />;
  },
}));
vi.mock("@/components/molecules/on-boarding/MobileOnboardingTour", () => ({
  default: () => null,
}));

import HomePage from "./HomePage";
import { apiErrorText } from "@/utils/function/apiErrorKey";

const create = (): Promise<unknown> => {
  render(<HomePage />);
  if (!spies.onCreateProject) throw new Error("HomeTemplate did not receive onCreateProject");
  return spies.onCreateProject("api-gateway", "t-1", true, false, true, false, { internetFacing: true });
};

beforeEach(() => {
  vi.clearAllMocks();
  spies.onCreateProject = null;
});

describe("HomePage — project creation", () => {
  it("creates the project, refreshes the page data and returns the created project", async () => {
    const project = { projectId: "p-1", name: "api-gateway" };
    vi.mocked(createProject).mockResolvedValue(project as never);

    await expect(create()).resolves.toBe(project);

    expect(createProject).toHaveBeenCalledWith(
      // Created from the AppSec home: an AppSec project.
      "t-1", "api-gateway", true, false, true, false, { internetFacing: true }, "appsec",
    );
    expect(spies.complete).toHaveBeenCalledWith("first_project");
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.refreshStats).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows a fixed sentence, never the server text, tags the error as handled and refreshes nothing", async () => {
    const error = { response: { status: 400, data: { message: "Name already used" } } };
    vi.mocked(createProject).mockRejectedValue(error);

    await expect(create()).rejects.toBe(error);

    expect(toast.error).toHaveBeenCalledWith(apiErrorText(error));
    expect(toast.error).not.toHaveBeenCalledWith("Name already used");
    expect((error as { __toastHandled?: boolean }).__toastHandled).toBe(true);
    expect(spies.complete).not.toHaveBeenCalled();
    expect(spies.refresh).not.toHaveBeenCalled();
    expect(spies.refreshStats).not.toHaveBeenCalled();
  });

  it("leaves a project-limit error to the wizard's localized message", async () => {
    const error = { response: { status: 429, data: { message: "Project limit reached" } } };
    vi.mocked(createProject).mockRejectedValue(error);

    await expect(create()).rejects.toBe(error);

    expect(toast.error).not.toHaveBeenCalled();
    expect((error as { __toastHandled?: boolean }).__toastHandled).toBeUndefined();
  });
});
