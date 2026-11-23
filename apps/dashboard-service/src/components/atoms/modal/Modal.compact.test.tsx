import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Modal from "./Modal";

/**
 * On a phone the dialog was a centred card capped at 80vh. On a 390x664 screen
 * that left ~317px for the body: the onboarding persona question showed 2 of
 * its 3 choices (then 1 of 3), the create-project dialog cut its primary
 * button in half, and the rest scrolled inside a box the user had no reason to
 * suspect was scrollable. Below the `md` breakpoint the dialog is a sheet
 * anchored to the bottom edge that may use the whole screen height.
 */
const setViewport = (compact: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: compact,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  // @ts-expect-error restore jsdom's default (no matchMedia)
  delete window.matchMedia;
});

describe("Modal on a compact viewport", () => {
  it("anchors the dialog to the bottom edge", () => {
    setViewport(true);
    render(
      <Modal title="Pick one" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Pick one" });
    const overlay = dialog.closest("[data-modal-overlay]")!;
    expect(overlay.classList.contains("items-end")).toBe(true);
    expect(overlay.classList.contains("items-center")).toBe(false);
  });

  it("drops the 80vh cap that clipped the choices, even when a caller asks for one", () => {
    setViewport(true);
    render(
      <Modal title="Pick one" maxHeight="60vh" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Pick one" });
    expect(dialog.style.maxHeight).not.toBe("80vh");
    expect(dialog.style.maxHeight).not.toBe("60vh");
  });

  it("gives the close control a thumb-sized target", () => {
    setViewport(true);
    render(
      <Modal title="Pick one" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    // 32x32 on the desktop card; 44px is the floor on a touch screen.
    const close = screen.getByRole("button", { name: /close/i });
    expect(close.classList.contains("h-11")).toBe(true);
    expect(close.classList.contains("w-11")).toBe(true);
    expect(close.classList.contains("h-8")).toBe(false);
  });

  it("spans the screen width instead of keeping the desktop size cap", () => {
    setViewport(true);
    render(
      <Modal title="Pick one" size="md" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Pick one" });
    expect(dialog.style.maxWidth).not.toBe("28rem");
  });
});

describe("Modal on a wide viewport (unchanged)", () => {
  it("stays a centred card with the 80vh cap and its size cap", () => {
    setViewport(false);
    render(
      <Modal title="Pick one" size="md" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Pick one" });
    const overlay = dialog.closest("[data-modal-overlay]")!;
    expect(overlay.classList.contains("items-center")).toBe(true);
    expect(dialog.style.maxHeight).toBe("80vh");
    expect(dialog.style.maxWidth).toBe("28rem");
  });

  it("still honours a caller's maxHeight", () => {
    setViewport(false);
    render(
      <Modal title="Pick one" maxHeight="60vh" onClose={vi.fn()}>
        <p>content</p>
      </Modal>,
    );

    expect(screen.getByRole("dialog", { name: "Pick one" }).style.maxHeight).toBe("60vh");
  });
});
