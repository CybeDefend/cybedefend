import { describe, it, expect, vi, beforeEach } from 'vitest';

import gatewayAPI from '@/server/api/gatewayAPI';

vi.mock('@/server/api/gatewayAPI', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import { getProjectBranchesList } from './resultService';

const mockedGet = gatewayAPI.get as unknown as ReturnType<typeof vi.fn>;

const answer = {
  branches: [{ name: 'main', isDefault: true, isProtected: false, archived: false }],
  pagination: { page: 1, pageSize: 100, total: 1, hasMore: false },
  defaultBranch: 'main',
  scanBranch: '',
};

/**
 * A results page asks for the same default branch view from its
 * page data and from its branch selector, in the same commit. Identical
 * requests in flight share one HTTP call.
 */
describe('resultService.getProjectBranchesList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends one request for two identical calls in flight', async () => {
    let resolve!: (value: { data: typeof answer }) => void;
    mockedGet.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const params = { search: '', page: 1, pageSize: 100, includeArchived: false };
    const first = getProjectBranchesList('p1', params);
    const second = getProjectBranchesList('p1', { ...params });
    resolve({ data: answer });

    await expect(first).resolves.toEqual(answer);
    await expect(second).resolves.toEqual(answer);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith('/project/p1/branches/list', {
      params: { search: undefined, page: 1, pageSize: 100, includeArchived: false },
    });
  });

  it('sends a new request once the previous one has answered', async () => {
    mockedGet.mockResolvedValue({ data: answer });
    const params = { page: 1, pageSize: 100 };

    await getProjectBranchesList('p1', params);
    await getProjectBranchesList('p1', params);

    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('keeps different searches, pages and projects apart', async () => {
    mockedGet.mockResolvedValue({ data: answer });

    await Promise.all([
      getProjectBranchesList('p1', { search: 'feat', page: 1 }),
      getProjectBranchesList('p1', { search: 'fix', page: 1 }),
      getProjectBranchesList('p1', { search: 'feat', page: 2 }),
      getProjectBranchesList('p2', { search: 'feat', page: 1 }),
      getProjectBranchesList('p1', { search: 'feat', page: 1, includeArchived: true }),
    ]);

    expect(mockedGet).toHaveBeenCalledTimes(5);
  });

  it('lets the next call retry after a failure', async () => {
    mockedGet.mockRejectedValueOnce({ response: { data: { message: 'boom' } } });
    mockedGet.mockResolvedValueOnce({ data: answer });

    await expect(getProjectBranchesList('p1', {})).rejects.toEqual({ message: 'boom' });
    await expect(getProjectBranchesList('p1', {})).resolves.toEqual(answer);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
