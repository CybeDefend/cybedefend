import { describe, it, expect, vi, beforeEach } from 'vitest';
// Its first case imports the edition entry, which evaluates the closed tree
// (several seconds alone); under the full suite's load that passed 5 s.
vi.setConfig({ testTimeout: 30_000 });

// Mock react-toastify before importing the module under test
vi.mock('react-toastify', () => ({ toast: { warning: vi.fn() } }));

// Mock the store
vi.mock('../store', () => ({
  default: {
    getState: vi.fn(),
    dispatch: vi.fn(),
  },
}));

// Mock tokenManager to avoid side effects
vi.mock('./tokenManager', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(null),
  isSessionBroken: vi.fn().mockReturnValue(false),
}));

// Mock region util
vi.mock('@/utils/function/region', () => ({
  getRegionConfig: vi.fn().mockReturnValue({ apiUrl: 'http://localhost' }),
}));

import store from '../store';
import { clearAccessToken } from '../store/authSlice';

const mockedStore = store as unknown as { getState: ReturnType<typeof vi.fn> };

describe('gatewayAPI — 401 interceptor keeps the session recoverable', () => {
  const make401 = () => ({
    response: { status: 401 },
    config: { method: 'get', _retry: false, headers: {} },
    message: 'Unauthorized',
  });

  const getRejectedHandler = async () => {
    const { default: api } = await import('./gatewayAPI');
    const handlers = (api as any).interceptors.response.handlers;
    return handlers[handlers.length - 1].rejected as (err: unknown) => Promise<unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedStore.getState.mockReturnValue({
      organization: { selectedOrganization: { subscription: { writesBlocked: false } } },
      auth: { accessToken: 'stale-jwt' },
    });
  });

  it('keeps the current token in the store when the refresh fails transiently', async () => {
    const { refreshAccessToken, isSessionBroken } = await import('./tokenManager');
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);
    vi.mocked(isSessionBroken).mockReturnValue(false);
    const onRejected = await getRejectedHandler();

    await expect(onRejected(make401())).rejects.toMatchObject({ message: 'Unauthorized' });

    const dispatched = (store as unknown as { dispatch: ReturnType<typeof vi.fn> }).dispatch.mock.calls
      .map(([action]) => (action as { type: string }).type);
    expect(dispatched).not.toContain(clearAccessToken().type);
  });

  it('clears the token once the session is known to be broken', async () => {
    const { refreshAccessToken, isSessionBroken } = await import('./tokenManager');
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);
    vi.mocked(isSessionBroken).mockReturnValue(true);
    const onRejected = await getRejectedHandler();

    await expect(onRejected(make401())).rejects.toMatchObject({ message: 'Unauthorized' });

    const dispatched = (store as unknown as { dispatch: ReturnType<typeof vi.fn> }).dispatch.mock.calls
      .map(([action]) => (action as { type: string }).type);
    expect(dispatched).toContain(clearAccessToken().type);
  });

  it('names the refused bearer to the refresh, so a client cannot hand the same token back', async () => {
    const { refreshAccessToken, isSessionBroken } = await import('./tokenManager');
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);
    vi.mocked(isSessionBroken).mockReturnValue(false);
    const onRejected = await getRejectedHandler();
    const err = make401();
    (err.config.headers as Record<string, string>).Authorization = 'Bearer stale-jwt';

    await expect(onRejected(err)).rejects.toMatchObject({ message: 'Unauthorized' });
    expect(refreshAccessToken).toHaveBeenCalledWith({ refusedToken: 'stale-jwt' });
  });

  it('a 401 without a bearer refreshes as before', async () => {
    const { refreshAccessToken, isSessionBroken } = await import('./tokenManager');
    vi.mocked(refreshAccessToken).mockResolvedValueOnce(null);
    vi.mocked(isSessionBroken).mockReturnValue(false);
    const onRejected = await getRejectedHandler();

    await expect(onRejected(make401())).rejects.toMatchObject({ message: 'Unauthorized' });
    expect(vi.mocked(refreshAccessToken).mock.calls).toEqual([[]]);
  });
});
