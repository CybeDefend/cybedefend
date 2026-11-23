import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { LinkRow } from "./LinkRow";

const renderWithRouter = (ui: React.ReactNode, initialPath = "/") => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <table>
              <tbody>{ui}</tbody>
            </table>
          }
        />
        <Route path="/target" element={<div data-testid="target">Target</div>} />
        <Route
          path="/other"
          element={<div data-testid="other">Other</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
};

describe("LinkRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a tr with role=link and tabIndex=0", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("TR");
    expect(row).toHaveAttribute("role", "link");
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("navigates to the target on simple left click", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("row"), { button: 0 });
    expect(screen.getByTestId("target")).toBeInTheDocument();
  });

  it("opens in a new tab on ctrl+click instead of router nav", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("row"), {
      button: 0,
      ctrlKey: true,
    });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledWith(
      "/target",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("opens in a new tab on meta+click (macOS)", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("row"), {
      button: 0,
      metaKey: true,
    });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledWith(
      "/target",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("opens in a new tab on middle-click (aux click button 1)", () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    const row = screen.getByTestId("row");
    const auxEvent = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    row.dispatchEvent(auxEvent);
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledWith(
      "/target",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("does NOT navigate via router when shift+clicked (new window)", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("row"), {
      button: 0,
      shiftKey: true,
    });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("does NOT navigate when click originates from an interactive child (button)", () => {
    const onChildClick = vi.fn();
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>
          <button
            type="button"
            data-testid="child-button"
            onClick={onChildClick}
          >
            Action
          </button>
        </td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("child-button"), { button: 0 });
    expect(onChildClick).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("does NOT navigate when click originates from a nested <a>", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>
          <a href="/other" data-testid="nested-link">
            nested
          </a>
        </td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("nested-link"), { button: 0 });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("does NOT navigate when click originates from an <input>", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>
          <input type="checkbox" data-testid="child-input" />
        </td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("child-input"), { button: 0 });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("navigates on Enter key press", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Enter" });
    expect(screen.getByTestId("target")).toBeInTheDocument();
  });

  it("navigates on Space key press", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.keyDown(screen.getByTestId("row"), { key: " " });
    expect(screen.getByTestId("target")).toBeInTheDocument();
  });

  it("does NOT navigate on Enter when focus is on an interactive child", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>
          <button type="button" data-testid="child-button">
            Action
          </button>
        </td>
      </LinkRow>,
    );
    const child = screen.getByTestId("child-button");
    child.focus();
    fireEvent.keyDown(child, { key: "Enter" });
    expect(screen.queryByTestId("target")).not.toBeInTheDocument();
  });

  it("preserves className passed as prop", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row" className="custom">
        <td>cell</td>
      </LinkRow>,
    );
    expect(screen.getByTestId("row")).toHaveClass("custom");
  });

  it("exposes the destination via data-href for tooling", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    expect(screen.getByTestId("row")).toHaveAttribute("data-href", "/target");
  });

  it("calls passed onClick callback on click (for composability)", () => {
    const onClick = vi.fn();
    renderWithRouter(
      <LinkRow to="/target" data-testid="row" onClick={onClick}>
        <td>cell</td>
      </LinkRow>,
    );
    fireEvent.click(screen.getByTestId("row"), { button: 0 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("wraps each cell's content in a real <a href> so right-click 'Open in new tab' works", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td data-testid="c1">first</td>
        <td data-testid="c2">second</td>
      </LinkRow>,
    );
    const c1Link = screen.getByTestId("c1").querySelector("a[data-link-wrapper]");
    const c2Link = screen.getByTestId("c2").querySelector("a[data-link-wrapper]");
    expect(c1Link).toBeInTheDocument();
    expect(c2Link).toBeInTheDocument();
    expect(c1Link).toHaveAttribute("href", "/target");
    expect(c2Link).toHaveAttribute("href", "/target");
  });

  // Regression (dark mode): each cell's content is wrapped in an
  // <a style="color: inherit">, so the cell text colour comes from the row's
  // inherited colour. The row must carry a theme-aware text colour, otherwise
  // cells inherit the default black — illegible on a dark background.
  it("carries a dark-aware base text colour on the row (legible cells in dark mode)", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td>cell</td>
      </LinkRow>,
    );
    const row = screen.getByTestId("row");
    expect(row.className).toMatch(/\bdark:text-/);
  });

  it("skips wrapping cells flagged with data-no-link (action cells)", () => {
    renderWithRouter(
      <LinkRow to="/target" data-testid="row">
        <td data-testid="c1">wrapped</td>
        <td data-testid="c2" data-no-link={true}>
          <button>action</button>
        </td>
      </LinkRow>,
    );
    expect(
      screen.getByTestId("c1").querySelector("a[data-link-wrapper]"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("c2").querySelector("a[data-link-wrapper]"),
    ).not.toBeInTheDocument();
  });
});
