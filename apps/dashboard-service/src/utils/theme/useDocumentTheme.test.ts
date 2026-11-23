import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { applyStoredTheme, useDocumentTheme } from './useDocumentTheme';

/**
 * The closed product space's shell offers the theme in two places (the rail footer and the
 * account menu). `useTheme` keeps a copy of the theme per caller, so after one
 * of them switched it the other would switch to the theme already shown. This
 * hook reads the theme where it lives — the `dark` class of `<html>` — and
 * writes it the way `useTheme` does (class, `localStorage.theme`, `themeChange`).
 */
const html = () => document.documentElement;

beforeEach(() => {
  html().classList.remove('dark');
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('useDocumentTheme', () => {
  it('reads the theme from <html>', () => {
    html().classList.add('dark');
    const { result } = renderHook(() => useDocumentTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('switches the theme as useTheme does: class, storage, event', () => {
    const heard = vi.fn();
    window.addEventListener('themeChange', heard);
    const { result } = renderHook(() => useDocumentTheme());

    act(() => result.current.toggle());

    expect(html()).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(result.current.isDark).toBe(true);

    act(() => result.current.toggle());
    expect(html()).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(result.current.isDark).toBe(false);
    window.removeEventListener('themeChange', heard);
  });

  it('follows a switch made elsewhere', () => {
    const { result } = renderHook(() => useDocumentTheme());
    const other = renderHook(() => useDocumentTheme());

    act(() => other.result.current.toggle());

    expect(result.current.isDark).toBe(true);
  });

  it('still switches when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useDocumentTheme());
    act(() => result.current.toggle());
    expect(html()).toHaveClass('dark');
    expect(result.current.isDark).toBe(true);
  });
});

describe('applyStoredTheme', () => {
  it('puts the remembered dark theme on <html> and tells the listeners', () => {
    const heard = vi.fn();
    window.addEventListener('themeChange', heard);
    localStorage.setItem('theme', 'dark');

    expect(applyStoredTheme()).toBe(true);

    expect(html()).toHaveClass('dark');
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('themeChange', heard);
  });

  it('removes a stale dark class when light is remembered, and does nothing when already in sync', () => {
    html().classList.add('dark');
    localStorage.setItem('theme', 'light');
    expect(applyStoredTheme()).toBe(false);
    expect(html()).not.toHaveClass('dark');

    const heard = vi.fn();
    window.addEventListener('themeChange', heard);
    applyStoredTheme();
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener('themeChange', heard);
  });
});
