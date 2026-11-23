import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { LinkDiv } from "./LinkDiv";

const renderWithRouter = (ui: React.ReactNode, initialPath = "/") => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<div>{ui}</div>} />
        <Route
          path="/target"
          element={<div data-testid="target">Target</div>}
        />
        <Route
          path="/other"
          element={<div data-testid="other">Other</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
};

describe("LinkDiv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a real <a> with the resolved href (so right-click 'Open in new tab' works)", () => {
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div">
        Content
      </LinkDiv>,
    );
    const el = screen.getByTestId("div");
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("href", "/target");
  });

  it("navigates to the target on simple left click (router-driven, no reload)", () => {
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div">
        Content
      </LinkDiv>,
    );
    fireEvent.click(screen.getByTestId("div"), { button: 0 });
    expect(screen.getByTestId("target")).toBeInTheDocument();
  });

  it("does NOT navigate when click originates from a nested button", () => {
    const onChildClick = vi.fn();
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div">
        <button
          type="button"
          data-testid="child-button"
          onClick={onChildClick}
        >
          Action
        </button>
      </LinkDiv>,
    );
    fireEvent.click(screen.getByTestId("child-button"), { button: 0 });
    expect(onChildClick).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("does NOT navigate via the wrapper when click originates from a nested <a>", () => {
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div">
        <a href="/other" data-testid="nested-link" onClick={(e) => e.preventDefault()}>
          nested
        </a>
      </LinkDiv>,
    );
    fireEvent.click(screen.getByTestId("nested-link"), { button: 0 });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("preserves className passed as prop", () => {
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div" className="custom">
        Content
      </LinkDiv>,
    );
    expect(screen.getByTestId("div")).toHaveClass("custom");
  });

  it("accepts aria-label passed through", () => {
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div" aria-label="Open target">
        Content
      </LinkDiv>,
    );
    expect(screen.getByTestId("div")).toHaveAttribute("aria-label", "Open target");
  });

  it("calls passed onClick callback on click (for composability)", () => {
    const onClick = vi.fn();
    renderWithRouter(
      <LinkDiv to="/target" data-testid="div" onClick={onClick}>
        Content
      </LinkDiv>,
    );
    fireEvent.click(screen.getByTestId("div"), { button: 0 });
    expect(onClick).toHaveBeenCalledOnce();
  });
});
