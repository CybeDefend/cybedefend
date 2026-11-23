/**
 * Every module-level store of the dashboard's shared reads registers its
 * reset here (the rows, the live sessions, the overview, the proposals, the
 * newest events, the rate gate), so the test setup can forget them all after
 * each test. No import on purpose: the setup loads this file and nothing else.
 */
const resets = new Set<() => void>();

export function registerSharedStore(reset: () => void): void {
  resets.add(reset);
}

/** Forgets every shared store and stops their timers (tests). */
export function resetSharedStores(): void {
  for (const reset of resets) reset();
}
