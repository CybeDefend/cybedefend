import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The analytics seam: the core reports its events through `track(event, props)`
 * and the closed tree registers the real tracker at boot (`registerTracker`).
 * Without one — and in the Community Edition, where no boot hook ever
 * registers one — `track` is a no-op, so no event ever leaves the browser.
 */
describe('track', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is a no-op by default', async () => {
    const { track } = await import('./analytics');
    expect(() => track('auth_callback_recovery', { reason: 'timeout' })).not.toThrow();
    expect(() => track('anything')).not.toThrow();
  });

  it('delegates to the registered tracker once registered', async () => {
    const { track, registerTracker } = await import('./analytics');
    const fn = vi.fn();
    registerTracker(fn);
    track('auth_callback_recovery', { reason: 'timeout' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('auth_callback_recovery', { reason: 'timeout' });
  });
});
