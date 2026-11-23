import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { useFocusTrap } from "./useFocusTrap";

function buildContainer(): {
  container: HTMLElement;
  buttons: HTMLButtonElement[];
} {
  const container = document.createElement("div");
  const b1 = document.createElement("button");
  b1.textContent = "first";
  const b2 = document.createElement("button");
  b2.textContent = "middle";
  const b3 = document.createElement("button");
  b3.textContent = "last";
  container.appendChild(b1);
  container.appendChild(b2);
  container.appendChild(b3);
  document.body.appendChild(container);
  return { container, buttons: [b1, b2, b3] };
}

function pressTab(target: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
    shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useFocusTrap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the first focusable element when activated", () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container };
    renderHook(() => useFocusTrap(true, ref as React.RefObject<HTMLElement>));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("cycles focus from last element to first on Tab", () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container };
    renderHook(() => useFocusTrap(true, ref as React.RefObject<HTMLElement>));
    buttons[2].focus();
    const event = pressTab(container);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("cycles focus from first to last on Shift+Tab", () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container };
    renderHook(() => useFocusTrap(true, ref as React.RefObject<HTMLElement>));
    buttons[0].focus();
    const event = pressTab(container, true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("does not interfere with Tab when active=false", () => {
    const { container, buttons } = buildContainer();
    const ref = { current: container };
    buttons[1].focus();
    renderHook(() => useFocusTrap(false, ref as React.RefObject<HTMLElement>));
    const event = pressTab(container);
    expect(event.defaultPrevented).toBe(false);
  });

  it("restores focus to the previously focused element on cleanup", () => {
    // External (outside the container) element that should regain focus.
    const outside = document.createElement("button");
    outside.textContent = "external";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const { container } = buildContainer();
    const ref = { current: container };
    const { unmount } = renderHook(() =>
      useFocusTrap(true, ref as React.RefObject<HTMLElement>),
    );
    // Focus moved into the container on activation.
    expect(document.activeElement).not.toBe(outside);
    unmount();
    expect(document.activeElement).toBe(outside);
  });
});
