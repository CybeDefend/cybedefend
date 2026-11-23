import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtRule, Root } from 'postcss';

import { compileAppCss } from '@/test/productAccentCss';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('@/utils/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => reduced.value,
  default: () => reduced.value,
}));

import { MOTION_STORAGE_KEY, useLivingMotion } from './useLivingMotion';

const html = () => document.documentElement;

describe('useLivingMotion', () => {
  beforeEach(() => {
    reduced.value = false;
    localStorage.clear();
    html().removeAttribute('data-calm');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is lively by default and says so on <html>', () => {
    const { result } = renderHook(() => useLivingMotion());
    expect(result.current.calm).toBe(false);
    expect(html()).toHaveAttribute('data-calm', 'false');
  });

  it('is calm when the system asks for reduced motion', () => {
    reduced.value = true;
    const { result } = renderHook(() => useLivingMotion());
    expect(result.current.calm).toBe(true);
    expect(result.current.reducedMotion).toBe(true);
    expect(html()).toHaveAttribute('data-calm', 'true');
  });

  it('is calm when the viewer chose Calm on an earlier visit', () => {
    localStorage.setItem(MOTION_STORAGE_KEY, 'calm');
    const { result } = renderHook(() => useLivingMotion());
    expect(MOTION_STORAGE_KEY).toBe('vibedefend.motion');
    expect(result.current.calm).toBe(true);
    expect(html()).toHaveAttribute('data-calm', 'true');
  });

  it('remembers the choice and tells every mounted consumer at once', () => {
    const first = renderHook(() => useLivingMotion());
    const second = renderHook(() => useLivingMotion());

    act(() => first.result.current.setCalm(true));
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('calm');
    expect(first.result.current.calm).toBe(true);
    expect(second.result.current.calm).toBe(true);
    expect(html()).toHaveAttribute('data-calm', 'true');

    act(() => second.result.current.setCalm(false));
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
    expect(first.result.current.calm).toBe(false);
    expect(html()).toHaveAttribute('data-calm', 'false');
  });

  it('stays calm under reduced motion whatever the stored choice', () => {
    reduced.value = true;
    const { result } = renderHook(() => useLivingMotion());
    act(() => result.current.setCalm(false));
    expect(result.current.calm).toBe(true);
  });

  it('follows a choice made in another tab', () => {
    const { result } = renderHook(() => useLivingMotion());
    act(() => {
      localStorage.setItem(MOTION_STORAGE_KEY, 'calm');
      window.dispatchEvent(new StorageEvent('storage', { key: MOTION_STORAGE_KEY, newValue: 'calm' }));
    });
    expect(result.current.calm).toBe(true);
  });

  it('is not calm when storage cannot be read (private window, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useLivingMotion());
    expect(result.current.calm).toBe(false);
  });

  it('still calms this visit when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { result } = renderHook(() => useLivingMotion());
    expect(() => act(() => result.current.setCalm(true))).not.toThrow();
    expect(result.current.calm).toBe(true);
    act(() => result.current.setCalm(false));
    expect(result.current.calm).toBe(false);
  });
});

describe('the stylesheet behind data-calm', () => {
  let app: Root;
  beforeAll(async () => {
    app = await compileAppCss(['motion-safe:animate-breathe']);
  }, 60_000);

  it('stops the breathing on a calm page, outside any layer so it is never purged', () => {
    const rules: { selector: string; body: string; parent: string }[] = [];
    app.walkRules((rule) => {
      rules.push({
        selector: rule.selector,
        body: rule.toString(),
        parent: rule.parent?.type === 'atrule' ? (rule.parent as AtRule).params : 'root',
      });
    });
    const hatch = rules.find((r) => r.selector === '[data-calm="true"] .motion-safe\\:animate-breathe');
    expect(hatch, 'the [data-calm] escape hatch is missing from index.css').toBeDefined();
    expect(hatch?.parent).toBe('root');
    expect(hatch?.body).toMatch(/animation:\s*none/);
  });
});
