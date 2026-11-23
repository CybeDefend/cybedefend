import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The profiler seam: the core's services wrap their calls with
 * `profiler('name')(fn)` and read it from here, so the closed tree can plug
 * its own profiler in at boot (`registerProfiler`) without the core importing
 * it. Until one is registered — and in the Community Edition, where no boot
 * hook ever registers one — the wrap is the identity.
 */
describe('profiler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('is the identity by default', async () => {
    const { profiler } = await import('./profiler');
    const f = () => 42;
    expect(profiler('x')(f)).toBe(f);
  });

  it('delegates to the registered profiler once registered', async () => {
    const { profiler, registerProfiler } = await import('./profiler');
    const seen: string[] = [];
    const replacement = () => 'wrapped';
    registerProfiler((name) => (fn) => {
      seen.push(name);
      void fn;
      return replacement as never;
    });
    const f = () => 42;
    expect(profiler('x')(f)).toBe(replacement);
    expect(seen).toEqual(['x']);
  });

  it('keeps the wrapped function callable when the registered profiler returns it', async () => {
    const { profiler, registerProfiler } = await import('./profiler');
    registerProfiler(() => (fn) => fn);
    const f = vi.fn(() => 42);
    expect(profiler('y')(f)).toBe(f);
    expect(profiler('y')(f)()).toBe(42);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
