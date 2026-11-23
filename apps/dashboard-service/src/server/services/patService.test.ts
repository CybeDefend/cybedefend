import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Personal access tokens in both editions. The cloud keeps its
 * `/user/personal-access-tokens` routes (a token is known by its name); the
 * Community Edition calls the gateway's `/me/personal-access-tokens`
 * (ISO 8601 dates or null, a token known by its
 * id, the `cdp_…` secret in the creation answer only, no rename route).
 */

const state = vi.hoisted(() => ({ edition: 'cloud' as 'cloud' | 'community' }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));

vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return state.edition;
  },
}));
vi.mock('../api/gatewayAPI', () => ({ default: api }));

async function service(edition: 'cloud' | 'community') {
  state.edition = edition;
  vi.resetModules();
  return import('./patService');
}

const SECRET = `cdp_${'A'.repeat(43)}`;

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.patch.mockReset();
});

describe('patService in the Community Edition', () => {
  it('community lists through /me/personal-access-tokens and reads `tokens`', async () => {
    api.get.mockResolvedValue({
      data: {
        tokens: [
          { id: 'id-2', name: 'ci', lastFour: 'wxyz', createdAt: '2026-10-02T00:00:00.000Z', lastUsedAt: '2026-10-03T00:00:00.000Z', expiresAt: null },
          { id: 'id-1', name: 'old', lastFour: 'abcd', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, expiresAt: '2026-02-01T00:00:00.000Z' },
        ],
      },
    });
    const { listTokens, fetchTokenList } = await service('community');
    await expect(listTokens()).resolves.toEqual([
      { id: 'id-2', name: 'ci', lastFour: 'wxyz', createdAt: '2026-10-02T00:00:00.000Z', lastUsedAt: '2026-10-03T00:00:00.000Z', expiresAt: null },
      { id: 'id-1', name: 'old', lastFour: 'abcd', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, expiresAt: '2026-02-01T00:00:00.000Z' },
    ]);
    expect(api.get).toHaveBeenCalledWith('/me/personal-access-tokens');
    // The limit counts the active tokens only: an expired one does not take a place.
    const { usage } = await fetchTokenList();
    expect(usage).toEqual({ current: 1, max: 10 });
  });

  it('community keeps no field the contract does not name', async () => {
    api.get.mockResolvedValue({
      data: { tokens: [{ id: 'i', name: 'n', lastFour: 'abcd', createdAt: 'x', lastUsedAt: 7, expiresAt: '', token: SECRET }] },
    });
    const { listTokens } = await service('community');
    const [view] = await listTokens();
    expect(view).toEqual({ id: 'i', name: 'n', lastFour: 'abcd', createdAt: null, lastUsedAt: null, expiresAt: null });
    expect(JSON.stringify(view)).not.toContain('cdp_');
  });

  it('community revokes by id with DELETE', async () => {
    api.delete.mockResolvedValue({ status: 204 });
    const { revokeToken } = await service('community');
    await revokeToken({ id: '6f9a1c2e-0000-4000-8000-000000000001', name: 'ci', lastFour: null, createdAt: null, lastUsedAt: null, expiresAt: null });
    expect(api.delete).toHaveBeenCalledWith('/me/personal-access-tokens/6f9a1c2e-0000-4000-8000-000000000001');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('community create returns the `cdp_` token once', async () => {
    api.post.mockResolvedValue({
      data: { id: 'id-3', name: 'deploy', lastFour: 'AAAA', createdAt: '2026-11-03T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', token: SECRET },
    });
    const { createToken } = await service('community');
    const created = await createToken('deploy', '2027-01-01T00:00:00.000Z');
    expect(api.post).toHaveBeenCalledWith('/me/personal-access-tokens', { name: 'deploy', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(created.token).toBe(SECRET);
    expect(created.view).toEqual({ id: 'id-3', name: 'deploy', lastFour: 'AAAA', createdAt: '2026-11-03T00:00:00.000Z', lastUsedAt: null, expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(JSON.stringify(created.view)).not.toContain('cdp_');
  });

  it('community create without an expiry sends no expiresAt', async () => {
    api.post.mockResolvedValue({ data: { id: 'i', name: 'n', lastFour: 'AAAA', createdAt: '2026-11-03T00:00:00.000Z', expiresAt: null, token: SECRET } });
    const { createToken } = await service('community');
    await createToken('n');
    expect(api.post).toHaveBeenCalledWith('/me/personal-access-tokens', { name: 'n' });
  });

  it('community create refuses an answer without a secret', async () => {
    api.post.mockResolvedValue({ data: { id: 'i', name: 'n', lastFour: 'AAAA', createdAt: null, expiresAt: null } });
    const { createToken } = await service('community');
    await expect(createToken('n')).rejects.toThrow();
  });

  it('there is no rename in community', async () => {
    const { canRenameTokens } = await service('community');
    expect(canRenameTokens).toBe(false);
  });
});

describe('patService in the cloud', () => {
  it('cloud keeps /user/personal-access-tokens and POST /delete with the name', async () => {
    api.get.mockResolvedValue({
      data: { tokens: [{ name: 'ci', value: '', createdAt: '1700000000000', expiresAt: '0' }], usage: { current: 1, max: 10 } },
    });
    api.post.mockResolvedValue({ data: {} });
    const { listTokens, fetchTokenList, revokeToken, canRenameTokens } = await service('cloud');

    const views = await listTokens();
    expect(api.get).toHaveBeenCalledWith('/user/personal-access-tokens');
    expect(views).toEqual([
      { id: 'ci', name: 'ci', lastFour: null, createdAt: new Date(1_700_000_000_000).toISOString(), lastUsedAt: null, expiresAt: null },
    ]);
    await expect(fetchTokenList()).resolves.toMatchObject({ usage: { current: 1, max: 10 } });

    await revokeToken(views[0]);
    expect(api.post).toHaveBeenCalledWith('/user/personal-access-tokens/delete', { name: 'ci' });
    expect(api.delete).not.toHaveBeenCalled();
    expect(canRenameTokens).toBe(true);
  });

  it('cloud creates with an epoch-ms expiry and returns the value once', async () => {
    api.post.mockResolvedValue({ data: { name: 'ci', value: 'pat_secret', createdAt: 1_700_000_000_000, expiresAt: 1_800_000_000_000 } });
    const { createToken } = await service('cloud');
    const created = await createToken('ci', new Date(1_800_000_000_000).toISOString());
    expect(api.post).toHaveBeenCalledWith('/user/personal-access-tokens', { name: 'ci', expiresAt: 1_800_000_000_000 });
    expect(created).toEqual({
      view: { id: 'ci', name: 'ci', lastFour: null, createdAt: new Date(1_700_000_000_000).toISOString(), lastUsedAt: null, expiresAt: new Date(1_800_000_000_000).toISOString() },
      token: 'pat_secret',
    });
  });

  it('cloud creates without an expiry as before', async () => {
    api.post.mockResolvedValue({ data: { name: 'ci', value: 'pat_secret', createdAt: 1, expiresAt: 0 } });
    const { createToken } = await service('cloud');
    await createToken('ci');
    expect(api.post).toHaveBeenCalledWith('/user/personal-access-tokens', { name: 'ci', expiresAt: undefined });
  });

  it('cloud renames by name', async () => {
    api.patch.mockResolvedValue({ data: {} });
    const { updatePersonalAccessTokenName } = await service('cloud');
    await updatePersonalAccessTokenName('ci', 'ci-2');
    expect(api.patch).toHaveBeenCalledWith('/user/personal-access-tokens/name', { currentName: 'ci', newName: 'ci-2' });
  });
});
