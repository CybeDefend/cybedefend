// `a[data-link-wrapper]` is the synthetic per-cell anchor that LinkRow
// injects to make right-click "Open in new tab" available on table rows;
// it shouldn't count as a "user-interactive descendant" for nav-skip logic.
const INTERACTIVE_SELECTOR =
  'a[href]:not([data-link-wrapper]), button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [contenteditable="true"]';

export const isInteractiveElementInPath = (
  target: EventTarget | null,
  currentTarget: Element,
): boolean => {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (!interactive) return false;
  if (interactive === currentTarget) return false;
  return currentTarget.contains(interactive);
};

export const shouldLetBrowserHandleClick = (event: {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): boolean => {
  if (event.defaultPrevented) return true;
  if (event.button !== undefined && event.button !== 0) return true;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return true;
  }
  return false;
};
