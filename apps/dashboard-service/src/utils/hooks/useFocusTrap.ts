import { useEffect } from "react";

/**
 * Trap keyboard focus inside a container while it is active.
 *
 * Used by modals/dialogs so Tab cycles through the focusable elements
 * inside the container instead of escaping back to the page underneath.
 * Also restores focus to the previously focused element when the trap
 * deactivates, which is the WCAG 2.1.2 expectation for modal dialogs.
 *
 * The trap is intentionally minimal — it does not steal focus from
 * elements that are already visible, and it does not need an external
 * library. If the container is unmounted with `active` still true, the
 * cleanup runs and the listener is removed.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const node = containerRef.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));

    // Move focus into the container on activation. Pick the first focusable
    // element rather than the container itself to avoid a redundant Tab.
    const focusables = getFocusable();
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // No focusable inside — fall back to focusing the container itself
      // so Escape still works without focus being on the page underneath.
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (activeEl === first || !node.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !node.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", handleKeyDown);

    return () => {
      node.removeEventListener("keydown", handleKeyDown);
      // Restore focus to whatever was focused before the trap activated,
      // matching the WCAG modal-dialog expectation.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}
