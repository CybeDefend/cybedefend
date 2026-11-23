import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ calm: false }));
vi.mock('@/components/molecules/kit/motion/useLivingMotion', () => {
  const useLivingMotion = () => ({ calm: motion.calm, setCalm: () => {}, reducedMotion: false });
  return { useLivingMotion, default: useLivingMotion };
});

import { useMotionAllowed } from './useMotionAllowed';

const matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }) as unknown as MediaQueryList;

/**
 * Whether a one-shot transition (a count-up, a meter growing, a row sliding
 * in) may play. It never plays where it cannot be seen to end: without
 * `matchMedia` (jsdom, SSR) or `requestAnimationFrame`, the final state is
 * drawn at once, so a test reads the final text and a reader never waits.
 */
describe('useMotionAllowed', () => {
  beforeEach(() => {
    motion.calm = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false without matchMedia, as in jsdom', () => {
    expect(typeof window.matchMedia).not.toBe('function');
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(false);
  });

  it('is true in a browser that accepts motion', () => {
    vi.stubGlobal('matchMedia', matchMedia);
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(true);
  });

  it('is false on a calm page (reduced motion, or the viewer chose Calm)', () => {
    vi.stubGlobal('matchMedia', matchMedia);
    motion.calm = true;
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(false);
  });

  it('is false without requestAnimationFrame', () => {
    vi.stubGlobal('matchMedia', matchMedia);
    vi.stubGlobal('requestAnimationFrame', undefined);
    const { result } = renderHook(() => useMotionAllowed());
    expect(result.current).toBe(false);
  });
});
