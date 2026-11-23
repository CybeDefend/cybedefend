import React, { useState } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import Modal from "./Modal";

/**
 * A dialog is usable from the keyboard: Escape closes it (when the dialog may
 * be dismissed at all), focus moves into it when it opens, Tab and Shift+Tab
 * stay inside it, and focus goes back to what opened it when it closes.
 */
afterEach(cleanup);

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

describe("Modal keyboard", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <input aria-label="name" />
      </Modal>,
    );
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when it may not be dismissed", () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose} closeOnOverlayClick={false}>
        <input aria-label="name" />
      </Modal>,
    );
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("follows closeOnEscape when it is given", () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose} closeOnEscape={false}>
        <input aria-label="name" />
      </Modal>,
    );
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the topmost of two stacked modals", () => {
    const parent = vi.fn();
    const child = vi.fn();
    render(
      <>
        <Modal title="Parent" onClose={parent}>
          <p>p</p>
        </Modal>
        <Modal title="Child" onClose={child}>
          <p>c</p>
        </Modal>
      </>,
    );
    press("Escape");
    expect(child).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it("skips a stacked dialog whose element left the document", () => {
    const parent = vi.fn();
    const child = vi.fn();
    render(
      <>
        <Modal title="Parent" onClose={parent}>
          <p>p</p>
        </Modal>
        <Modal title="Child" onClose={child}>
          <p>c</p>
        </Modal>
      </>,
    );
    // The child's element is gone while its component is still mounted (a
    // removed portal container, for instance): it can no longer hold the keyboard.
    screen.getByRole("dialog", { name: "Child" }).remove();
    press("Escape");
    expect(child).not.toHaveBeenCalled();
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog when it opens", () => {
    render(
      <Modal title="T" onClose={vi.fn()} showCloseButton={false}>
        <input aria-label="first" />
        <button>last</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
  });

  it("keeps a field that focused itself", () => {
    render(
      <Modal title="T" onClose={vi.fn()}>
        <input aria-label="first" />
        <input aria-label="auto" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("auto"));
  });

  it("cycles Tab and Shift+Tab inside the dialog", () => {
    render(
      <Modal title="T" onClose={vi.fn()} showCloseButton={false}>
        <input aria-label="first" />
        <button>last</button>
      </Modal>,
    );
    const first = screen.getByLabelText("first");
    const last = screen.getByRole("button", { name: "last" });

    last.focus();
    press("Tab");
    expect(document.activeElement).toBe(first);

    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives focus back to the opener when it closes", () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && (
            <Modal title="T" onClose={() => setOpen(false)}>
              <input aria-label="name" />
            </Modal>
          )}
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    act(() => {
      fireEvent.click(opener);
    });
    expect(document.activeElement).not.toBe(opener);

    act(() => {
      press("Escape");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
