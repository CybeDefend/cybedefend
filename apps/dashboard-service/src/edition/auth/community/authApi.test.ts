import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

/**
 * The Community Edition's REST client for `/auth/*`. Every call sends the credentials (the `cd_refresh` cookie lives
 * on the gateway's auth path) and goes around gatewayAPI, whose 401 retry
 * would loop on the refresh route itself. The refresh answer is classified so
 * that only a 401 ever ends a session.
 */

vi.mock('@/utils/function/region', () => ({
  getRegionConfig: () => ({ key: 'eu', label: '', appUrl: '', apiUrl: 'https://api.example.test/', badges: [] }),
}));

// The store's edition extensions: none here (the closed tree is not what this file tests).
vi.mock('@/edition/active', () => ({
  ACTIVE_EE_AUTH_CLIENT: null,
  ACTIVE_EXTENSIONS: { reducers: {}, responseInterceptors: [] },
}));

type Reply = { status: number; data?: unknown; headers?: Record<string, string> } | 'network';

const sent: InternalAxiosRequestConfig[] = [];
let replies: Reply[] = [];

function answer(config: InternalAxiosRequestConfig, reply: Reply): Promise<AxiosResponse> {
  if (reply === 'network') {
    return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
  }
  const response: AxiosResponse = {
    data: reply.data ?? '',
    status: reply.status,
    statusText: '',
    headers: reply.headers ?? {},
    config,
    request: {},
  };
  if (reply.status >= 200 && reply.status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, {}, response));
}

const adapter: AxiosAdapter = (config) => {
  sent.push(config);
  const reply = replies.shift();
  if (!reply) throw new Error(`unexpected request ${config.method} ${config.url}`);
  return answer(config, reply);
};

const originalAdapter = axios.defaults.adapter;

beforeEach(() => {
  sent.length = 0;
  replies = [];
  axios.defaults.adapter = adapter;
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
});

const reply = (...next: Reply[]) => {
  replies.push(...next);
};

async function api() {
  return import('./authApi');
}

const TOKEN_ANSWER = { accessToken: 'h.p.s', tokenType: 'Bearer', expiresIn: 900 };

describe('refresh()', () => {
  it('a 200 is ok with the new access token', async () => {
    reply({ status: 200, data: TOKEN_ANSWER });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'ok', accessToken: 'h.p.s', expiresIn: 900 });
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('https://api.example.test/auth/refresh');
    expect(sent[0].withCredentials).toBe(true);
    expect(sent[0].data).toBeUndefined();
  });

  it('a 200 without a usable expiresIn leaves it out', async () => {
    reply({ status: 200, data: { accessToken: 'h.p.s', expiresIn: 'soon' } }, { status: 200, data: { accessToken: 'h.p.s', expiresIn: -5 } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'ok', accessToken: 'h.p.s' });
    await expect(refresh()).resolves.toEqual({ kind: 'ok', accessToken: 'h.p.s' });
  });

  it('a 200 without an access token is transient', async () => {
    reply({ status: 200, data: { tokenType: 'Bearer' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });

  it('a 409 REFRESH_RACE is a race', async () => {
    reply({ status: 409, data: { code: 'REFRESH_RACE', message: 'REFRESH_RACE' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'race' });
  });

  it('a 409 with another code is transient', async () => {
    reply({ status: 409, data: { code: 'ACCOUNT_EXISTS' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });

  it('a 401 REFRESH_INVALID is signed out', async () => {
    reply({ status: 401, data: { code: 'REFRESH_INVALID' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'signed-out' });
  });

  it('a 401 without a code (no cookie) is signed out', async () => {
    reply({ status: 401 });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'signed-out' });
  });

  it('a 403 is transient', async () => {
    reply({ status: 403 });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });

  it('a 429 is transient', async () => {
    reply({ status: 429, headers: { 'retry-after': '30' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });

  it('a 500 is transient', async () => {
    reply({ status: 500, data: { code: 'AUTH_ERROR' } });
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });

  it('a network failure is transient', async () => {
    reply('network');
    const { refresh } = await api();
    await expect(refresh()).resolves.toEqual({ kind: 'transient' });
  });
});

describe('the other /auth routes', () => {
  it('reads setupOpen, signupMode and passwordResetByEmail from GET /auth/setup', async () => {
    reply({ status: 200, data: { setupOpen: false, signupMode: 'open', passwordResetByEmail: true, extra: 'x' } });
    const { getSetupStatus } = await api();
    await expect(getSetupStatus()).resolves.toEqual({ setupOpen: false, signupMode: 'open', passwordResetByEmail: true });
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('https://api.example.test/auth/setup');
    expect(sent[0].withCredentials).toBe(true);
  });

  it('a 503 AUTH_UNAVAILABLE on GET /auth/setup rejects with its code', async () => {
    reply({ status: 503, data: { code: 'AUTH_UNAVAILABLE', message: 'AUTH_UNAVAILABLE' } });
    const { getSetupStatus, AuthApiError } = await api();
    const err = await getSetupStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthApiError);
    expect(err).toMatchObject({ status: 503, code: 'AUTH_UNAVAILABLE' });
  });

  it('login posts the credentials and answers the token', async () => {
    reply({ status: 200, data: TOKEN_ANSWER });
    const { login } = await api();
    await expect(login('a@b.c', 'x'.repeat(12))).resolves.toEqual(TOKEN_ANSWER);
    expect(sent[0].url).toBe('https://api.example.test/auth/login');
    expect(JSON.parse(sent[0].data as string)).toEqual({ email: 'a@b.c', password: 'x'.repeat(12) });
    expect(sent[0].withCredentials).toBe(true);
  });

  it('a refused login carries the code and the Retry-After, never the server text', async () => {
    reply({ status: 429, data: { code: 'RATE_LIMITED', message: 'a sentence from the server' }, headers: { 'retry-after': '42' } });
    const { login, LOGIN_REFUSALS } = await api();
    const err = (await login('a@b.c', 'x'.repeat(12)).catch((e: unknown) => e)) as Error & Record<string, unknown>;
    expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 42 });
    expect(err.message).not.toContain('sentence');
    expect(LOGIN_REFUSALS).toEqual(['INVALID_CREDENTIALS', 'RATE_LIMITED']);
  });

  it('an unknown code or a DTO 400 has no code (GENERIC), and the password stays out of the error', async () => {
    reply({ status: 400, data: { message: ['password must be a string'] } });
    const { login } = await api();
    const err = await login('a@b.c', 'secret-password-1').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: null });
    expect(JSON.stringify(err)).not.toContain('secret-password-1');
    expect(String((err as Error).stack ?? '')).not.toContain('secret-password-1');
    expect((err as { cause?: unknown }).cause).toBeUndefined();
  });

  it('logout answers true on a 204', async () => {
    reply({ status: 204 });
    const { logout } = await api();
    await expect(logout()).resolves.toBe(true);
    expect(sent[0].url).toBe('https://api.example.test/auth/logout');
    expect(sent[0].withCredentials).toBe(true);
  });

  it('logout answers false on a failure and never throws', async () => {
    reply('network', { status: 503, data: { code: 'AUTH_UNAVAILABLE' } }, { status: 200 });
    const { logout } = await api();
    await expect(logout()).resolves.toBe(false);
    await expect(logout()).resolves.toBe(false);
    await expect(logout()).resolves.toBe(false);
  });

  it('setupInstance answers the token, the organization and the team', async () => {
    reply({ status: 201, data: { ...TOKEN_ANSWER, organizationId: 'o1', teamId: 't1' } });
    const { setupInstance } = await api();
    const body = { setupToken: 's', email: 'a@b.c', name: 'A', password: 'x'.repeat(12), organizationName: 'Org' };
    await expect(setupInstance(body)).resolves.toMatchObject({ accessToken: 'h.p.s', organizationId: 'o1', teamId: 't1' });
    expect(sent[0].url).toBe('https://api.example.test/auth/setup');
    expect(JSON.parse(sent[0].data as string)).toEqual(body);
  });

  it('signUp posts to /auth/signup', async () => {
    reply({ status: 201, data: TOKEN_ANSWER });
    const { signUp } = await api();
    await expect(signUp({ email: 'a@b.c', name: 'A', password: 'x'.repeat(12) })).resolves.toEqual(TOKEN_ANSWER);
    expect(sent[0].url).toBe('https://api.example.test/auth/signup');
  });

  it('changePassword sends the bearer and credentials', async () => {
    reply({ status: 200, data: TOKEN_ANSWER });
    const { changePassword, setAccessTokenSource } = await api();
    // The session client hands its own getAccessToken (which refreshes an expired token).
    const source = vi.fn(() => Promise.resolve('held.access.jwt'));
    setAccessTokenSource(source);
    await expect(changePassword('old-password-1', 'new-password-12')).resolves.toEqual(TOKEN_ANSWER);
    expect(sent[0].url).toBe('https://api.example.test/auth/password/change');
    expect(sent[0].withCredentials).toBe(true);
    expect(sent[0].headers.Authorization).toBe('Bearer held.access.jwt');
    expect(source).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent[0].data as string)).toEqual({ currentPassword: 'old-password-1', newPassword: 'new-password-12' });
  });

  it('requestPasswordReset and confirmPasswordReset post their bodies', async () => {
    reply({ status: 202, data: {} }, { status: 204 });
    const { requestPasswordReset, confirmPasswordReset } = await api();
    await expect(requestPasswordReset('a@b.c')).resolves.toBeUndefined();
    await expect(confirmPasswordReset('tok', 'new-password-12')).resolves.toBeUndefined();
    expect(sent[0].url).toBe('https://api.example.test/auth/password-reset/request');
    expect(JSON.parse(sent[0].data as string)).toEqual({ email: 'a@b.c' });
    expect(sent[1].url).toBe('https://api.example.test/auth/password-reset/confirm');
    expect(JSON.parse(sent[1].data as string)).toEqual({ token: 'tok', newPassword: 'new-password-12' });
  });

  it('acceptInvitation posts the token in the body, never in the path', async () => {
    const token = 'a'.repeat(64);
    reply({ status: 200, data: { ...TOKEN_ANSWER, organizationId: 'o1' } });
    const { acceptInvitation } = await api();
    await expect(acceptInvitation(token, { name: 'A', password: 'x'.repeat(12) })).resolves.toMatchObject({ organizationId: 'o1' });
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('https://api.example.test/auth/invitations/accept');
    expect(sent[0].url).not.toContain(token);
    expect(JSON.parse(sent[0].data as string)).toEqual({ token, name: 'A', password: 'x'.repeat(12) });
    expect(sent[0].withCredentials).toBe(true);
  });

  it('acceptInvitation keeps the refusal codes of the invitation', async () => {
    reply({ status: 410, data: { code: 'INVITATION_INVALID', message: 'a sentence from the server' } });
    const { acceptInvitation } = await api();
    const err = (await acceptInvitation('b'.repeat(64), { name: 'A', password: 'x'.repeat(12) }).catch((e: unknown) => e)) as Error;
    expect(err).toMatchObject({ status: 410, code: 'INVITATION_INVALID' });
    expect(err.message).not.toContain('sentence');
  });

  it('a malformed invitation token is refused with no request', async () => {
    const { acceptInvitation, INVITATION_TOKEN_PATTERN } = await api();
    for (const token of ['A'.repeat(64), 'a'.repeat(63), '../../auth/login', `${'a'.repeat(64)}/x`]) {
      const err = await acceptInvitation(token, { name: 'A', password: 'x'.repeat(12) }).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'INVITATION_INVALID', status: null });
    }
    expect(sent).toHaveLength(0);
    expect(INVITATION_TOKEN_PATTERN.test('0123456789abcdef'.repeat(4))).toBe(true);
  });
});

describe('the personal access token codes', () => {
  // The refusals the gateway's /me/personal-access-tokens and /auth/password/change answer
  // (gateway local-auth-errors.ts and personal-access-tokens.controller.ts).
  const PAT_CODES = [
    'PAT_INVALID',
    'PAT_NOT_FOUND',
    'PAT_NAME_INVALID',
    'PAT_EXPIRY_INVALID',
    'PAT_NAME_TAKEN',
    'PAT_LIMIT_REACHED',
    'PAT_NOT_ALLOWED',
    'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
  ] as const;

  it.each(PAT_CODES)('a refusal %s keeps its code', async (code) => {
    reply({ status: 409, data: { code, message: 'a sentence from the server' } });
    const { changePassword, AUTH_REFUSAL_CODES } = await api();
    expect(AUTH_REFUSAL_CODES).toContain(code);
    const err = (await changePassword('old-password-1', 'new-password-12').catch((e: unknown) => e)) as Error;
    expect(err).toMatchObject({ status: 409, code });
    expect(err.message).not.toContain('sentence');
  });

  it('holds the same list as the pages', async () => {
    const { AUTH_REFUSAL_CODES } = await api();
    const pages = await import('@/pages/community-auth/authRefusals');
    expect([...AUTH_REFUSAL_CODES].sort()).toEqual([...pages.AUTH_REFUSAL_CODES].sort());
  });
});
