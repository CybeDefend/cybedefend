import type { CSSProperties } from 'react';

/**
 * The room the open background-tasks dropdown takes at the top right of the
 * screen: its width (`w-80`, 20rem) at its offset from the edge (`right-4`,
 * 1rem), plus a 1rem gap.
 */
export const TASKS_PANEL_CLEARANCE = '22rem';

/**
 * The style of the app's toast container. The toasts sit at the top right,
 * above everything, exactly where the background-tasks dropdown opens, and a
 * hovered toast stays: after a few report generations their stack covered the
 * dropdown and a click on « View report » landed on a toast. While the
 * dropdown is shown, the toasts move to its left. On a phone the toasts span
 * the screen, so the offset has no effect there.
 */
export function appToastStyle(tasksPanelShown: boolean): CSSProperties {
  return {
    marginTop: '50px',
    zIndex: 99999,
    ...(tasksPanelShown
      ? ({ '--toastify-toast-right': TASKS_PANEL_CLEARANCE } as CSSProperties)
      : {}),
  };
}
