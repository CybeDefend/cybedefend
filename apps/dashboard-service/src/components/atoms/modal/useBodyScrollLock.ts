import { useEffect } from "react";

/**
 * Pins the page behind an open dialog.
 *
 * The count of open dialogs has to be ONE number, shared by every caller: with
 * two independent locks, closing the first restores the body while the second
 * is still open and the page starts scrolling behind it. That is why this lives
 * here rather than being copied into each dialog — `Modal` and
 * `DowngradeConfirmationModal` both go through this counter.
 *
 * `position:fixed` + `top:-scrollY` rather than `overflow:hidden` alone: the
 * latter clamps the scrollable height and snaps the page back to the top. The
 * saved offset is restored on close, so the background is exactly where it was.
 */
let openModalsCount = 0;
let savedScrollY = 0;
let originalBodyOverflow = "";
let originalBodyPosition = "";
let originalBodyTop = "";
let originalBodyWidth = "";

/**
 * @param enabled pass `false` for a dialog that stays mounted while closed —
 * it must not pin a page it is not covering. Callers that only mount when open
 * can omit it.
 */
export function useBodyScrollLock(enabled: boolean = true): void {
  // Otherwise mount/unmount only: an inline `onClose` or a fresh
  // `additionalRefs` array must not re-trigger the lock on every render.
  useEffect(() => {
    if (!enabled) return;
    if (openModalsCount === 0) {
      savedScrollY = window.scrollY;
      originalBodyOverflow = document.body.style.overflow;
      originalBodyPosition = document.body.style.position;
      originalBodyTop = document.body.style.top;
      originalBodyWidth = document.body.style.width;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = "100%";
    }
    openModalsCount++;

    return () => {
      openModalsCount--;
      if (openModalsCount === 0) {
        document.body.style.overflow = originalBodyOverflow;
        document.body.style.position = originalBodyPosition;
        document.body.style.top = originalBodyTop;
        document.body.style.width = originalBodyWidth;
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [enabled]);
}
