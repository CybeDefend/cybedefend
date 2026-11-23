import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EXTENSIONS, type EeExtensions, type ResultColumnExtension } from '@/edition/extensions';

/**
 * The extra columns of a results table come from the active edition's
 * extensions (`resultColumns`), each shown or hidden per project under the
 * key its extension names, so a choice made before this hook existed survives.
 */
const { ext } = vi.hoisted(() => ({ ext: { current: null as unknown as EeExtensions } }));
vi.mock('@/edition/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/active')>()),
  activeExtensions: () => ext.current,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t:${key}` }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import { useResultColumns } from './useResultColumns';

const Cell = () => null;
const EPSS: ResultColumnExtension = {
  id: 'epss',
  vulnerabilityTypes: ['sca'],
  labelKey: 'components.resultsTable.epss',
  storageKey: (projectId) => `showEpssColumnSca_${projectId}`,
  defaultVisible: false,
  Cell,
};

beforeEach(() => {
  localStorage.clear();
  ext.current = { ...EMPTY_EXTENSIONS, resultColumns: [EPSS] };
});
afterEach(() => vi.restoreAllMocks());

describe('useResultColumns', () => {
  it('with no extension there is no column', () => {
    ext.current = EMPTY_EXTENSIONS;
    const { result } = renderHook(() => useResultColumns('sca', 'p'));
    expect(result.current).toEqual([]);
  });

  it('keeps only the columns of the table type', () => {
    const { result } = renderHook(() => useResultColumns('sast', 'p'));
    expect(result.current).toEqual([]);
  });

  it('reads the visibility stored under the extension key', () => {
    localStorage.setItem('showEpssColumnSca_p', 'true');
    const { result } = renderHook(() => useResultColumns('sca', 'p'));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: 'epss', label: 't:components.resultsTable.epss', visible: true, Cell });
  });

  it('is hidden by default when nothing is stored', () => {
    const { result } = renderHook(() => useResultColumns('sca', 'p'));
    expect(result.current[0].visible).toBe(false);
  });

  it('setVisible writes the key', () => {
    const { result } = renderHook(() => useResultColumns('sca', 'p'));
    act(() => result.current[0].setVisible(true));
    expect(localStorage.getItem('showEpssColumnSca_p')).toBe('true');
    expect(result.current[0].visible).toBe(true);
    act(() => result.current[0].setVisible(false));
    expect(localStorage.getItem('showEpssColumnSca_p')).toBe('false');
    expect(result.current[0].visible).toBe(false);
  });

  it('a throwing localStorage falls back to defaultVisible', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error('denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('denied');
      }),
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => throwing });
    try {
      const { result } = renderHook(() => useResultColumns('sca', 'p'));
      expect(result.current[0].visible).toBe(false);
      act(() => result.current[0].setVisible(true));
      expect(result.current[0].visible).toBe(true);
      expect(throwing.getItem).toHaveBeenCalled();
      expect(throwing.setItem).toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
