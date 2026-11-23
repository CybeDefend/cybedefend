import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// These cases describe the cloud's wording; the Community Edition's is pinned
// by RoleExplanationPopover.community.test.tsx.
vi.mock("@/edition/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/edition/edition")>()),
  EDITION: "cloud",
}));
import RoleExplanationPopover from "./RoleExplanationPopover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("RoleExplanationPopover", () => {
  it("renders the info trigger button even when no role is selected", () => {
    render(<RoleExplanationPopover scope="organization" role="" />);
    expect(screen.getByTestId("role-explanation-trigger")).toBeInTheDocument();
  });

  it("does not show the popover content by default", () => {
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
  });

  it("opens the popover on mouse enter when a role is selected", () => {
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("role-explanation-content")).toBeInTheDocument();
  });

  it("closes the popover after the grace period when the mouse leaves the trigger", () => {
    vi.useFakeTimers();
    render(<RoleExplanationPopover scope="organization" role="administrator" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("role-explanation-content")).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByTestId("role-explanation-content")).toBeInTheDocument();
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
    vi.useRealTimers();
  });

  it("keeps the popover open when the mouse bridges from the trigger to the content", () => {
    vi.useFakeTimers();
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.mouseEnter(trigger);
    const content = screen.getByTestId("role-explanation-content");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(content);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByTestId("role-explanation-content")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("closes the popover after the grace period when the mouse leaves the content", () => {
    vi.useFakeTimers();
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.mouseEnter(trigger);
    const content = screen.getByTestId("role-explanation-content");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(content);
    fireEvent.mouseLeave(content);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
    vi.useRealTimers();
  });

  it("does not pin the popover open when the trigger is clicked", () => {
    vi.useFakeTimers();
    render(<RoleExplanationPopover scope="organization" role="manager" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.click(trigger);
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("role-explanation-content")).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
    vi.useRealTimers();
  });

  it("renders the role title and each organization role permission as list items", () => {
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    expect(
      screen.getByText("roles.explanations.creator.title")
    ).toBeInTheDocument();
    expect(
      screen.getByText("roles.permissions.billing")
    ).toBeInTheDocument();
    expect(
      screen.getByText("roles.permissions.manage_policy")
    ).toBeInTheDocument();
  });

  it("renders the correct team role permissions for team scope", () => {
    render(<RoleExplanationPopover scope="team" role="team_manager" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    expect(
      screen.getByText("roles.explanations.team_manager.title")
    ).toBeInTheDocument();
    expect(
      screen.getByText("roles.permissions.create_project")
    ).toBeInTheDocument();
    expect(
      screen.getByText("roles.permissions.archive_report")
    ).toBeInTheDocument();
  });

  it("renders the empty hint when role is not selected and trigger is hovered", () => {
    render(<RoleExplanationPopover scope="organization" role="" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    expect(screen.getByTestId("role-explanation-content")).toBeInTheDocument();
    expect(
      screen.getByText("roles.explanations.empty")
    ).toBeInTheDocument();
  });

  it("closes the popover when Escape is pressed", () => {
    render(<RoleExplanationPopover scope="organization" role="administrator" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId("role-explanation-content")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("role-explanation-content")).toBeNull();
  });

  it("exposes proper accessibility attributes on the trigger", () => {
    render(<RoleExplanationPopover scope="organization" role="member" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.mouseEnter(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the popover with a visible scrollbar so users can scroll long permission lists", () => {
    render(<RoleExplanationPopover scope="team" role="team_manager" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    const content = screen.getByTestId("role-explanation-content");
    expect(content.className).toMatch(/custom-scrollbar/);
    expect(content.style.overflowY).toBe("auto");
  });

  it("constrains popover top position so it never extends past the viewport bottom", () => {
    render(<RoleExplanationPopover scope="team" role="team_manager" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    const content = screen.getByTestId("role-explanation-content");
    const topPx = parseFloat(content.style.top);
    const maxHeightPx = parseFloat(content.style.maxHeight);
    expect(topPx + maxHeightPx).toBeLessThanOrEqual(window.innerHeight);
    expect(topPx).toBeGreaterThanOrEqual(0);
  });

  it("portal content carries data-select-dropdown attribute so modal outside-click handler does not close the modal when interacting with the popover", () => {
    render(<RoleExplanationPopover scope="organization" role="creator" />);
    fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
    const content = screen.getByTestId("role-explanation-content");
    expect(content.hasAttribute("data-select-dropdown")).toBe(true);
  });

  it("positions the popover near the trigger when content is short, instead of pinning it to the top of the viewport", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      writable: true,
      configurable: true,
    });

    render(<RoleExplanationPopover scope="organization" role="" />);
    const trigger = screen.getByTestId("role-explanation-trigger");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      top: 700,
      bottom: 720,
      left: 400,
      right: 430,
      width: 30,
      height: 30,
      x: 400,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseEnter(trigger);
    const content = screen.getByTestId("role-explanation-content");
    Object.defineProperty(content, "offsetHeight", {
      value: 60,
      configurable: true,
    });

    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const topPx = parseFloat(content.style.top);
    expect(topPx).toBeGreaterThan(500);
    expect(topPx).toBeLessThan(700);

    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      writable: true,
      configurable: true,
    });
  });
});
