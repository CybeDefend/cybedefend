import { useSyncExternalStore } from 'react';

/**
 * Whether this browser closed the Community rail's « CybeDefend Cloud » card.
 * A per-viewer convenience: kept in localStorage, every read and write wrapped,
 * since the storage can throw or come back empty (a private window, blocked site data). When it
 * refuses, the card still closes for this page load, and shows again at the next one. The
 * editions page, which links to the cloud, stays reached from the Get started page.
 *
 * One store, so the rail (which decides whether the card fits) and the card (which closes)
 * read the same answer.
 */
export const CLOUD_CARD_DISMISSED_KEY = 'cybedefend.community.cloudCardDismissed';

let dismissed: boolean | null = null;
const listeners = new Set<() => void>();

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(CLOUD_CARD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

const snapshot = (): boolean => {
  if (dismissed === null) dismissed = readStored();
  return dismissed;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Closes the card in this browser. Never throws. */
export function dismissCloudCard(): void {
  dismissed = true;
  try {
    window.localStorage.setItem(CLOUD_CARD_DISMISSED_KEY, '1');
  } catch {
    // The storage refused: closed for this page load only.
  }
  listeners.forEach((listener) => listener());
}

/** Whether the card was closed in this browser. */
export function useCloudCardDismissed(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Forgets what was read, so a test reads the storage again. */
export function resetCloudCardDismissalForTests(): void {
  dismissed = null;
}
