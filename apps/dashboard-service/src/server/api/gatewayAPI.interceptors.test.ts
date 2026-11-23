import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EXTENSIONS } from '@/edition/extensions';

/**
 * The core's response interceptor hands every failed call to the interceptors
 * the active edition registers (`ACTIVE_EXTENSIONS.responseInterceptors`), and
 * rejects the error to the caller whatever they did. It knows nothing of the
 * refusals a closed product answers: with no interceptor, a 402 is just
 * rejected.
 */
vi.mock('react-toastify', () => ({ toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../store', () => ({
  default: {
    getState: vi.fn(() => ({
      organization: { selectedOrganization: { subscription: { writesBlocked: false } } },
      auth: { accessToken: 'jwt' },
    })),
    dispatch: vi.fn(),
  },
}));
vi.mock('./tokenManager', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(null),
  isSessionBroken: vi.fn().mockReturnValue(false),
}));
vi.mock('@/utils/function/region', () => ({
  getRegionConfig: vi.fn().mockReturnValue({ apiUrl: 'http://localhost' }),
}));

const refusal = (data: unknown) =>
  Object.assign(new Error('x'), { isAxiosError: true, response: { status: 402, data }, config: {} });

describe('gatewayAPI — the edition response interceptors', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('@/edition/active');
  });

  it('runs each registered interceptor on an error and still rejects', async () => {
    const seen = vi.fn(() => true);
    vi.doMock('@/edition/active', () => ({
      ACTIVE_EXTENSIONS: { ...EMPTY_EXTENSIONS, responseInterceptors: [seen] },
    }));
    const { default: api } = await import('./gatewayAPI');
    const adapter = vi.fn().mockRejectedValue(refusal({}));
    await expect(api.get('/x', { adapter })).rejects.toBeTruthy();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('with no interceptor, a 402 is rejected without any notice', async () => {
    vi.doMock('@/edition/active', () => ({
      ACTIVE_EXTENSIONS: { ...EMPTY_EXTENSIONS, responseInterceptors: [] },
    }));
    const { toast } = await import('react-toastify');
    const { default: api } = await import('./gatewayAPI');
    const error = refusal({ code: 'USAGE_BLOCKED', reason: 'free_tier_exhausted', unit: 'injection' });
    const adapter = vi.fn().mockRejectedValue(error);
    await expect(api.get('/x', { adapter })).rejects.toBe(error);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});
