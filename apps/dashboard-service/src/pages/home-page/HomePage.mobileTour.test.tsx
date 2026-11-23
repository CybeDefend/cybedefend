import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// On a phone the page-by-page tour steps are inert, so the home page is the
// only place the tour can come from. If this mount disappears, phone users get
// the two persona questions and then nothing.
//
// The persona questions themselves are no longer hosted here: the shell asks
// them, so that an account landing in another product space is asked too (see
// Layout.product.test.tsx).

// One stable object: HomePage has an effect keyed on the user slice, so a
// fresh state per useSelector call would re-run it forever.
const state = vi.hoisted(() => ({
  organization: { selectedOrganization: { id: "org-1", name: "Acme" } },
  user: { isProfileLoaded: true, myOrganizations: [{ id: "org-1", myTeams: [] }] },
}));

vi.mock("react-redux", () => ({ useSelector: (fn: (s: any) => any) => fn(state) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("react-toastify", () => ({ toast: { error: vi.fn() } }));
vi.mock("../../server/hooks/useOrganizationProjects", () => ({
  default: () => ({
    projects: [], totalProjects: 0, totalPages: 1, currentPage: 1,
    loading: false, error: null, goToPage: vi.fn(), refresh: vi.fn(), hasActiveScans: false,
  }),
}));
vi.mock("../../server/hooks/useOrganizationMainStatistics", () => ({
  default: () => ({ mainStatistics: null, refresh: vi.fn() }),
}));
vi.mock("../../server/services/projectService", () => ({ createProject: vi.fn() }));
vi.mock("@/server/hooks/useOnboardingProgress", () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
vi.mock("./HomeTemplate", () => ({ default: () => <div data-testid="home-template" /> }));
vi.mock("@/ee/products/onboarding-persona/OnboardingPersonaModal", () => ({
  default: () => <div data-testid="persona-questions" />,
}));
vi.mock("@/components/molecules/on-boarding/MobileOnboardingTour", () => ({
  default: () => <div data-testid="mobile-tour" />,
}));

import HomePage from "./HomePage";

describe("HomePage — onboarding mounts", () => {
  it("hosts the phone tour", () => {
    render(<HomePage />);

    expect(screen.getByTestId("mobile-tour")).toBeInTheDocument();
    expect(screen.getByTestId("home-template")).toBeInTheDocument();
  });

  it("leaves the persona questions to the shell", () => {
    render(<HomePage />);

    expect(screen.queryByTestId("persona-questions")).toBeNull();
  });
});
