import React from 'react';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditionEntitlements } from './extensions';

const h = vi.hoisted(() => ({
  billing: null as null | { entitlementsOf: (organization: unknown, known: readonly string[]) => EditionEntitlements },
}));

vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return {
    ...actual,
    get ACTIVE_EXTENSIONS() {
      return { ...actual.ACTIVE_EXTENSIONS, billing: h.billing };
    },
  };
});

import { NEUTRAL_ENTITLEMENTS, useEditionEntitlements } from './entitlements';

const storeWith = (organization: Record<string, unknown> | null) =>
  configureStore({ reducer: { organization: () => ({ selectedOrganization: organization }) } });

const render = (organization: Record<string, unknown> | null) => {
  const store = storeWith(organization);
  return renderHook(() => useEditionEntitlements(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });
};

const BLOCKED_ORG = { id: 'org-1', subscription: { writesBlocked: true, featuresDisabled: 'reports', plan: 'developer' } };

describe('useEditionEntitlements', () => {
  beforeEach(() => {
    h.billing = null;
  });

  it('answers the neutral entitlements without a billing extension, whatever the organisation carries', () => {
    const { result } = render(BLOCKED_ORG);
    expect(result.current).toBe(NEUTRAL_ENTITLEMENTS);
    expect(result.current.writesBlocked).toBe(false);
    expect(result.current.writableAny).toBe(true);
    expect(result.current.disabledFeatures.size).toBe(0);
    expect(result.current.planIncludes('enterprise')).toBe(true);
  });

  it("answers the billing extension's entitlements for the selected organisation and the known products", () => {
    const entitlementsOf = vi.fn((): EditionEntitlements => ({
      writesBlocked: true,
      writableAny: false,
      disabledFeatures: new Set(['reports']),
      planIncludes: () => false,
    }));
    h.billing = { entitlementsOf };
    const { result } = render(BLOCKED_ORG);
    expect(entitlementsOf).toHaveBeenCalledWith(BLOCKED_ORG, expect.arrayContaining(['appsec']));
    expect(result.current.writesBlocked).toBe(true);
    expect(result.current.writableAny).toBe(false);
    expect([...result.current.disabledFeatures]).toEqual(['reports']);
  });

  it('keeps one answer, its features included, while what it says does not change', () => {
    h.billing = {
      entitlementsOf: () => ({ writesBlocked: false, writableAny: true, disabledFeatures: new Set(['reports']), planIncludes: () => true }),
    };
    const { result, rerender } = render(BLOCKED_ORG);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current.disabledFeatures).toBe(first.disabledFeatures);
  });
});
