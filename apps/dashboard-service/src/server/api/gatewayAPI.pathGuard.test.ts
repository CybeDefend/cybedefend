import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared API client refuses, before the request leaves, a path that a
 * value from the address bar could move to another route: the request never
 * reaches the network, so it never carries the user's bearer elsewhere.
 */
vi.mock('react-toastify', () => ({ toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../store', () => ({
  default: {
    getState: vi.fn(() => ({ auth: { accessToken: 'jwt' } })),
    dispatch: vi.fn(),
  },
}));
vi.mock('./tokenManager', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue(null),
  isSessionBroken: vi.fn().mockReturnValue(false),
}));
vi.mock('@/utils/function/region', () => ({
  getRegionConfig: vi.fn().mockReturnValue({ apiUrl: 'http://localhost/api' }),
}));

import api from './gatewayAPI';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('gatewayAPI — the path guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['delete', `/project/../policies/${ID}`],
    ['delete', `/project/..%2F..%2Fpolicies%2F${ID}`],
    ['get', `/project/${ID}/results/sast/../../../organization/${ID}/report`],
    ['get', `/project/${ID}/results/sast/%2e%2e/x`],
    ['patch', `/project/x\\y`],
    ['get', `//attacker.example/x`],
    ['delete', `/project/.\t./organization/${ID}/policies/${ID}`],
    ['get', `/project/.\n./.\r./organization/${ID}/report/owasp/json`],
    ['get', `https://attacker.example/project/${ID}`],
  ] as const)('refuses %s %s before any request', async (method, url) => {
    const adapter = vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {}, config: {} });
    await expect(api.request({ method, url, adapter })).rejects.toMatchObject({ code: 'UNSAFE_API_PATH' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('sends a normal path with the bearer', async () => {
    const adapter = vi.fn().mockImplementation(async (config) => ({ status: 200, data: {}, headers: {}, config }));
    await api.delete(`/project/${ID}`, { adapter });
    expect(adapter).toHaveBeenCalledTimes(1);
    const sent = adapter.mock.calls[0][0];
    expect(sent.url).toBe(`/project/${ID}`);
    expect(sent.headers.Authorization).toBe('Bearer jwt');
  });

  /**
   * A value that holds a `/` (a branch `feature/x`, an image `library/nginx`)
   * is sent as one encoded segment. It must reach the HTTP layer exactly as
   * the caller built it: decoded, it would hit another route; encoded twice,
   * the server would look up `feature%2Fx` instead of `feature/x`.
   */
  const branch = encodeURIComponent('feature/x');
  const image = encodeURIComponent('library/nginx');
  const spdx = encodeURIComponent('GPL-2.0+ WITH Classpath#1 50%');

  it.each([
    ['post', `/project/${ID}/branches/${branch}/archive`, `/project/${ID}/branches/feature%2Fx/archive`],
    ['delete', `/project/${ID}/branches/${branch}/archive`, `/project/${ID}/branches/feature%2Fx/archive`],
    [
      'get',
      `/integrations/dockerhub/container-registry/project/${ID}/images/${image}/tags?page=1&search=1.2`,
      `/integrations/dockerhub/container-registry/project/${ID}/images/library%2Fnginx/tags?page=1&search=1.2`,
    ],
    [
      'get',
      `/project/${ID}/results/sca/licenses/${spdx}/packages`,
      `/project/${ID}/results/sca/licenses/GPL-2.0%2B%20WITH%20Classpath%231%2050%25/packages`,
    ],
  ] as const)('sends %s %s unchanged, encoded characters included', async (method, url, expected) => {
    const adapter = vi.fn().mockImplementation(async (config) => ({ status: 200, data: {}, headers: {}, config }));
    await api.request({ method, url, adapter });
    expect(adapter).toHaveBeenCalledTimes(1);
    const sent = adapter.mock.calls[0][0];
    expect(sent.url).toBe(expected);
    expect(sent.headers.Authorization).toBe('Bearer jwt');
    // The full URL the transport builds, and the path the browser sends for it.
    const full = api.getUri(sent);
    expect(full).toBe(`http://localhost/api${expected}`);
    const parsed = new URL(full);
    expect(`${parsed.pathname}${parsed.search}`).toBe(`/api${expected}`);
  });

  it('sends an encoded value with its params serialized after the path', async () => {
    const adapter = vi.fn().mockImplementation(async (config) => ({ status: 200, data: {}, headers: {}, config }));
    await api.get(`/project/${ID}/results/sca/licenses/${spdx}/packages`, {
      adapter,
      params: { page: 2, packageType: ['npm', 'pypi'] },
    });
    const sent = adapter.mock.calls[0][0];
    expect(new URL(api.getUri(sent)).pathname).toBe(
      `/api/project/${ID}/results/sca/licenses/GPL-2.0%2B%20WITH%20Classpath%231%2050%25/packages`
    );
  });
});
