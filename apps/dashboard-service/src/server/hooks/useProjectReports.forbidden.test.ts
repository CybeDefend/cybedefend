import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  generateOwaspReport: vi.fn(),
  generateCweReport: vi.fn(),
  streamHandlers: null as Record<string, (env?: unknown) => void> | null,
}));

vi.mock('../services/resultService', () => ({
  generateOwaspReport: h.generateOwaspReport,
  generateCweReport: h.generateCweReport,
  getGeneratedReport: vi.fn(),
}));
vi.mock('./useRealtimeStream', () => ({
  useRealtimeStream: (_url: string | null, handlers: Record<string, (env?: unknown) => void>) => {
    h.streamHandlers = handlers;
  },
}));
vi.mock('@/utils/function/region', () => ({ getRegionConfig: () => ({ apiUrl: 'http://localhost/api' }) }));

import { useProjectReports } from './useProjectReports';

const PROJECT = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const refused = { isAxiosError: true, response: { status: 403, data: {} } };

/**
 * A role without the report permissions is answered 403: the page says so
 * once, as a state, instead of an error per attempt.
 */
describe('useProjectReports, for a role the gateway refuses', () => {
  beforeEach(() => {
    h.generateOwaspReport.mockReset();
    h.generateCweReport.mockReset();
    h.streamHandlers = null;
  });

  it.each([
    ['generateOwasp', () => h.generateOwaspReport],
    ['generateCwe', () => h.generateCweReport],
  ] as const)('a 403 on %s marks the page forbidden, with no error', async (method, service) => {
    service().mockRejectedValue(refused);
    const { result } = renderHook(() => useProjectReports(PROJECT, 'main'));
    await act(async () => {
      await result.current[method]('pdf', false);
    });
    expect(result.current.forbidden).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.cweLoading).toBe(false);
  });

  it('a 403 on the report stream marks the page forbidden', () => {
    const { result } = renderHook(() => useProjectReports(PROJECT, 'main'));
    act(() => h.streamHandlers?.error?.({ type: 'error', fatal: true, status: 403 }));
    expect(result.current.forbidden).toBe(true);
  });

  it('another failure stays an error', async () => {
    h.generateOwaspReport.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    const { result } = renderHook(() => useProjectReports(PROJECT, 'main'));
    await act(async () => {
      await result.current.generateOwasp('pdf', false);
    });
    expect(result.current.forbidden).toBe(false);
    expect(result.current.error).not.toBeNull();
  });
});
