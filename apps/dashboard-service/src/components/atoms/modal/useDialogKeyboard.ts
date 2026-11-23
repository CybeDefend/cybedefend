import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keyboard behaviour of a modal dialog (WAI-ARIA dialog pattern):
 *  - Escape closes it, when `closeOnEscape` allows it;
 *  - focus moves into it when it opens (a field that focused itself keeps it);
 *  - Tab and Shift+Tab cycle inside it;
 *  - focus goes back to the element that opened it when it closes.
 *
 * Dialogs can be stacked (a confirmation over a form, rendered as siblings):
 * only the most recently opened one answers the keyboard. A dialog whose
 * element is no longer in the document is skipped, so it cannot keep the
 * keyboard from the one below it.
 */

interface OpenDialog {
  ref: RefObject<HTMLElement | null>;
}

const openDialogs: OpenDialog[] = [];

/** The most recently opened dialog still in the document. */
const topmostDialog = (): OpenDialog | undefined => {
  for (let i = openDialogs.length - 1; i >= 0; i -= 1) {
    if (openDialogs[i].ref.current?.isConnected) return openDialogs[i];
  }
  return undefined;
};

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const focusablesIn = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );

interface Options {
  onClose: () => void;
  closeOnEscape: boolean;
}

export function useDialogKeyboard(dialogRef: RefObject<HTMLElement | null>, { onClose, closeOnEscape }: Options): void {
  // What had focus when the dialog first rendered: read during the first
  // render, before a child field's autoFocus moves it.
  const openerRef = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);
  onCloseRef.current = onClose;
  closeOnEscapeRef.current = closeOnEscape;

  useLayoutEffect(() => {
    // One entry per opening, compared by identity.
    const id: OpenDialog = { ref: dialogRef };
    openDialogs.push(id);
    const opener = openerRef.current;

    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      // The first control of the content, the close button only when there is
      // nothing else, else the dialog itself.
      const all = focusablesIn(dialog);
      const target = all.find((el) => !el.hasAttribute("data-modal-close")) ?? all[0] ?? dialog;
      target.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (topmostDialog() !== id) return;
      const root = dialogRef.current;
      if (!root) return;

      if (event.key === "Escape") {
        // A control inside that used Escape itself (an open list) keeps it.
        if (event.defaultPrevented || !closeOnEscapeRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const items = focusablesIn(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active);
      if (event.shiftKey && (outside || active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = openDialogs.indexOf(id);
      if (at !== -1) openDialogs.splice(at, 1);
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      }
    };
    // Registered once per opening: the handlers read the latest props from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
