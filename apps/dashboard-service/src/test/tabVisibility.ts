import { act } from '@testing-library/react';

/**
 * jsdom has no tab to hide. `mockTabVisibility()` shadows `document.hidden`
 * and `document.visibilityState` with a value the test drives (a browser
 * changes both together; usePollingWhenVisible reads the first, dev's
 * useVisibleInterval the second), and `hide()` / `show()` fire the
 * `visibilitychange` event the browser fires. Call `restore()` in `afterEach`.
 */
export function mockTabVisibility() {
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  const set = (value: boolean) => {
    hidden = value;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };
  return {
    /** Starts hidden, without firing the event (a tab opened in the background). */
    startHidden: () => {
      hidden = true;
    },
    hide: () => set(true),
    show: () => set(false),
    restore: () => {
      delete (document as unknown as { hidden?: boolean }).hidden;
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    },
  };
}
