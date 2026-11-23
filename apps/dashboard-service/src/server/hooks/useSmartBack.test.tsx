import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useSmartBack } from './useSmartBack';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe('useSmartBack', () => {
  const originalState = window.history.state;

  beforeEach(() => navigateSpy.mockClear());
  afterEach(() => {
    window.history.replaceState(originalState, '');
  });

  it('goes back in history when there is an in-app entry to return to', () => {
    window.history.replaceState({ idx: 3 }, '');
    const { result } = renderHook(() => useSmartBack('/project/p1/sast'), { wrapper });
    result.current();
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });

  it('falls back to the given route on a fresh deep link (idx 0)', () => {
    window.history.replaceState({ idx: 0 }, '');
    const { result } = renderHook(() => useSmartBack('/project/p1/sast'), { wrapper });
    result.current();
    expect(navigateSpy).toHaveBeenCalledWith('/project/p1/sast', { replace: true });
  });

  it('falls back when history state carries no idx', () => {
    window.history.replaceState(null, '');
    const { result } = renderHook(() => useSmartBack('/fallback'), { wrapper });
    result.current();
    expect(navigateSpy).toHaveBeenCalledWith('/fallback', { replace: true });
  });
});
