import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useIssueQuickView } from './useIssueQuickView';

const wrapperAt = (initialEntry: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };

// Companion hook so assertions can read the live location alongside the hook
// under test (renderHook only exposes a single result).
const useProbe = () => ({ quickView: useIssueQuickView(), location: useLocation() });

const V42 = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('useIssueQuickView', () => {
  it('returns null issueId when no ?issue param is present', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/project/p1/sast'),
    });
    expect(result.current.quickView.issueId).toBeNull();
  });

  it('reads issueId from the ?issue param', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt(`/project/p1/sast?issue=${V42}`),
    });
    expect(result.current.quickView.issueId).toBe(V42);
  });

  // The id is put in request paths: a value that is not a UUID opens no
  // drawer, whatever it holds.
  it.each([
    '../../../organization/x/report',
    '..%2F..%2Fx',
    'v-42',
    `${V42}/../x`,
    `${V42}?x`,
  ])('ignores an ?issue param that is not a UUID: %s', (value) => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt(`/project/p1/sast?issue=${encodeURIComponent(value)}`),
    });
    expect(result.current.quickView.issueId).toBeNull();
  });

  it('openIssue sets ?issue while preserving existing params', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/project/p1/sast?branch=main&severity=HIGH'),
    });
    act(() => result.current.quickView.openIssue('v-1'));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('issue')).toBe('v-1');
    expect(params.get('branch')).toBe('main');
    expect(params.get('severity')).toBe('HIGH');
  });

  it('navigateToIssue replaces the current issue param', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/project/p1/sast?issue=v-1&branch=main'),
    });
    act(() => result.current.quickView.navigateToIssue('v-2'));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('issue')).toBe('v-2');
    expect(params.get('branch')).toBe('main');
  });

  it('closeIssue removes only the issue param', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/project/p1/sast?issue=v-1&branch=main'),
    });
    act(() => result.current.quickView.closeIssue());
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('issue')).toBeNull();
    expect(params.get('branch')).toBe('main');
  });

  it('issueLinkTo builds a To preserving pathname and other params', () => {
    const { result } = renderHook(useProbe, {
      wrapper: wrapperAt('/project/p1/sast?branch=main'),
    });
    const to = result.current.quickView.issueLinkTo('v-9');
    const params = new URLSearchParams(to.search);
    expect(to.pathname).toBe('/project/p1/sast');
    expect(params.get('issue')).toBe('v-9');
    expect(params.get('branch')).toBe('main');
  });
});
