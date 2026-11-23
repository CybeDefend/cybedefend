import { beforeEach, describe, expect, it, vi } from 'vitest';
// Its first case imports the edition entry, which evaluates the closed tree
// (several seconds alone); under the full suite's load that passed 5 s.
vi.setConfig({ testTimeout: 30_000 });
import type { Reducer } from '@reduxjs/toolkit';

const registered = vi.hoisted(() => ({ reducers: {} as Record<string, Reducer> }));

/**
 * The store reads the active edition's extensions at creation and spreads
 * `ACTIVE_EXTENSIONS.reducers` into the root reducer: a closed tree registers
 * its slices there (the Cybe chat's `globalChat`), and a community build —
 * where `ACTIVE_EXTENSIONS` is `EMPTY_EXTENSIONS` — holds none of them.
 */
vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return {
    ...actual,
    ACTIVE_EXTENSIONS: { ...actual.ACTIVE_EXTENSIONS, reducers: registered.reducers },
  };
});

const freshStore = async () => {
  vi.resetModules();
  const { default: store } = await import('./index');
  return store;
};

describe('the store and the registered reducers', () => {
  beforeEach(() => {
    for (const key of Object.keys(registered.reducers)) delete registered.reducers[key];
  });

  it('holds the registered reducers', async () => {
    registered.reducers.extra = ((s = 1) => s) as Reducer;
    const store = await freshStore();
    expect((store.getState() as Record<string, unknown>).extra).toBe(1);
  });

  it('without ee extensions the store has no globalChat', async () => {
    const store = await freshStore();
    expect('globalChat' in store.getState()).toBe(false);
  });
});
