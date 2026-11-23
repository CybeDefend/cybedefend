import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/projectService', () => ({
  fetchProjectsForOrganization: vi.fn(),
}));

import useOrganizationProjectsCount from './useOrganizationProjectsCount';
import { fetchProjectsForOrganization } from '../services/projectService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

const mockedFetch = fetchProjectsForOrganization as ReturnType<typeof vi.fn>;

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOrganizationProjectsCount', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('issues a single page-1 request and returns totalProjects from the response', async () => {
    mockedFetch.mockResolvedValue({
      projects: new Array(10).fill(null),
      totalPages: 5,
      totalProjects: 47,
    });

    const { result } = renderHook(() =>
      useOrganizationProjectsCount('org-1'),
    );
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith('org-1', 1, 1, '');
    expect(result.current.count).toBe(47);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns 0 and stops loading when organizationId is empty', async () => {
    const { result } = renderHook(() => useOrganizationProjectsCount(''));
    await flushAsync();
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('exposes error state and falls back to count=0 on fetch failure', async () => {
    mockedFetch.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useOrganizationProjectsCount('org-1'),
    );
    await flushAsync();
    expect(result.current.count).toBe(0);
    expect(result.current.error).toBe(apiErrorText(new Error('boom'))); // a fixed sentence, never the raw text
    expect(result.current.loading).toBe(false);
  });

  it('refresh re-fetches the count', async () => {
    mockedFetch.mockResolvedValueOnce({
      projects: [],
      totalPages: 1,
      totalProjects: 3,
    });
    mockedFetch.mockResolvedValueOnce({
      projects: [],
      totalPages: 1,
      totalProjects: 5,
    });

    const { result } = renderHook(() =>
      useOrganizationProjectsCount('org-1'),
    );
    await flushAsync();
    expect(result.current.count).toBe(3);

    await act(async () => {
      result.current.refresh();
    });
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.current.count).toBe(5);
  });

  it('does NOT load every page just to count', async () => {
    mockedFetch.mockResolvedValue({
      projects: new Array(1).fill(null),
      totalPages: 100,
      totalProjects: 100,
    });

    renderHook(() => useOrganizationProjectsCount('org-1'));
    await flushAsync();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
