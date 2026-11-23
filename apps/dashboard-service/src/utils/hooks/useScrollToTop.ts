import { useEffect } from "react";

/**
 * Scrolls the window back to the top every time `key` changes (and on mount).
 *
 * Used by detail pages so that opening an item from a scrolled list always
 * shows its content from the top, instead of inheriting the list's scroll
 * position. In this app the scroll container is the window itself —
 * the layout has no nested `overflow:auto` element — so a plain
 * `window.scrollTo(0, 0)` is enough.
 *
 * @param key A value uniquely identifying the displayed item (e.g. a route id).
 *            Changing it re-triggers the scroll reset; an unchanged value does
 *            not, so navigating between two distinct issues resets the scroll
 *            while incidental re-renders of the same issue do not.
 */
export function useScrollToTop(key?: unknown): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") {
      return;
    }
    window.scrollTo(0, 0);
  }, [key]);
}

export default useScrollToTop;
