import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useScrollToTop } from "./useScrollToTop";

describe("useScrollToTop", () => {
  let scrollSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom ships a non-implemented window.scrollTo that logs noise; replace it
    // with a spy so we can assert calls cleanly.
    scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    scrollSpy.mockRestore();
  });

  it("scrolls the window to the top on mount", () => {
    renderHook(() => useScrollToTop("sast/abc"));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls again when the key changes (navigating to another issue)", () => {
    const { rerender } = renderHook(({ k }) => useScrollToTop(k), {
      initialProps: { k: "sast/abc" },
    });
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    rerender({ k: "sast/def" });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(scrollSpy).toHaveBeenLastCalledWith(0, 0);
  });

  it("does not scroll again when re-rendered with the same key", () => {
    const { rerender } = renderHook(({ k }) => useScrollToTop(k), {
      initialProps: { k: "sca/xyz" },
    });
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    rerender({ k: "sca/xyz" });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
