import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TeamRoleSelector from "./TeamRoleSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../utils/data/roleData", () => ({
  getTeamRoles: () => [
    { value: "team_manager", label: "Team Manager" },
    { value: "developer", label: "Developer" },
  ],
}));

describe("TeamRoleSelector", () => {
  const baseProps = {
    teamId: "team-1",
    teamName: "Default team",
    selectedRole: "",
    onRoleChange: vi.fn(),
  };

  it("renders the team name", () => {
    render(<TeamRoleSelector {...baseProps} />);
    expect(screen.getByText("Default team")).toBeInTheDocument();
  });

  it("renders the role explanation popover trigger so users can preview team role permissions", () => {
    render(<TeamRoleSelector {...baseProps} selectedRole="team_manager" />);
    expect(screen.getByTestId("role-explanation-trigger")).toBeInTheDocument();
  });

  it("renders the role explanation popover trigger even when no role is selected yet", () => {
    render(<TeamRoleSelector {...baseProps} selectedRole="" />);
    expect(screen.getByTestId("role-explanation-trigger")).toBeInTheDocument();
  });
});
