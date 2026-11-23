import React from 'react';
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { useReportDeepLink } from './useReportDeepLink';

/** The hook, plus the router's navigate, both read from inside one router. */
const renderInRouter = (initial: string) => {
  let navigate: NavigateFunction = () => undefined;
  const view = renderHook(
    () => {
      navigate = useNavigate();
      return useReportDeepLink();
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
      ),
    },
  );
  return { ...view, navigate: (to: string) => navigate(to) };
};

describe('useReportDeepLink', () => {
  it('reads no report on a URL without reportId', () => {
    const { result } = renderInRouter('/appsec/reports');
    expect(result.current.reportId).toBeUndefined();
  });

  it('reads the report a link names, from the router location', () => {
    const { result, navigate } = renderInRouter('/appsec/reports');
    act(() => navigate('/appsec/reports?reportId=r1'));
    expect(result.current.reportId).toBe('r1');
  });

  it('gives each navigation its own key, even to the same URL', () => {
    const { result, navigate } = renderInRouter('/appsec/reports?reportId=r1');
    const first = result.current.key;
    act(() => navigate('/appsec/reports?reportId=r1'));
    expect(result.current.reportId).toBe('r1');
    expect(result.current.key).not.toBe(first);
  });
});
