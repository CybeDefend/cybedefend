import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { getRegionConfig } from '@/utils/function/region';

/**
 * The Community Edition's `/auth/*` routes.
 *
 * Every call carries the credentials: the refresh token is the HttpOnly
 * `cd_refresh` cookie on the gateway's auth path, which the dashboard never
 * reads or writes. The calls go around gatewayAPI on purpose: its 401
 * interceptor refreshes and retries, which on these routes would loop on the
 * refresh itself.
 *
 * A refusal rejects with an {@link AuthApiError} that carries the HTTP status
 * and a code of the closed list, never the server's text, and never the
 * request (its body holds a password).
 */

/** A session's answer: the access token in the body, the refresh token as the cookie. */
export interface TokenAnswer {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type RefreshOutcome =
  | { kind: 'ok'; accessToken: string; expiresIn?: number }
  | { kind: 'race' }
  | { kind: 'signed-out' }
  | { kind: 'transient' };

export interface SetupStatus {
  setupOpen: boolean;
  signupMode: 'invite_only' | 'open';
  passwordResetByEmail: boolean;
}

export interface SetupBody {
  setupToken: string;
  email: string;
  name: string;
  password: string;
  organizationName: string;
}

/** The token of an invitation link (`/invite#token=…`): anything else is INVITATION_INVALID, with no request. It travels in a request body, never in a URL path. */
export const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** What a refused login answers: 401, or 429 with `Retry-After`. */
export const LOGIN_REFUSALS = ['INVALID_CREDENTIALS', 'RATE_LIMITED'] as const;

/**
 * The closed list of codes the gateway answers on these routes and on the
 * personal-access-token routes (PAT_FORBIDDEN_FOR_PAT_MANAGEMENT is the
 * gateway's refusal of a token managed with a token).
 */
export const AUTH_REFUSAL_CODES = [
  'INVALID_CREDENTIALS',
  'RATE_LIMITED',
  'REFRESH_RACE',
  'REFRESH_INVALID',
  'SETUP_TOKEN_INVALID',
  'SETUP_CLOSED',
  'SETUP_REQUIRED',
  'SIGNUP_DISABLED',
  'ACCOUNT_EXISTS',
  'PASSWORD_POLICY',
  'CURRENT_PASSWORD_INVALID',
  'RESET_TOKEN_INVALID',
  'INVITATION_INVALID',
  'PAT_INVALID',
  'PAT_NOT_FOUND',
  'PAT_NAME_INVALID',
  'PAT_EXPIRY_INVALID',
  'PAT_NAME_TAKEN',
  'PAT_LIMIT_REACHED',
  'PAT_NOT_ALLOWED',
  'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
  'AUTH_UNAVAILABLE',
  'AUTH_ERROR',
] as const;

export type AuthRefusalCode = (typeof AUTH_REFUSAL_CODES)[number];

const isRefusalCode = (value: unknown): value is AuthRefusalCode =>
  typeof value === 'string' && (AUTH_REFUSAL_CODES as readonly string[]).includes(value);

/**
 * A refused or failed `/auth` call. `code` is null for an answer outside the
 * closed list (a DTO 400, a proxy page): the pages show it as GENERIC.
 * `status` is null when no answer came (network, timeout, a refusal decided
 * here).
 */
export class AuthApiError extends Error {
  readonly status: number | null;
  readonly code: AuthRefusalCode | null;
  readonly retryAfterSeconds: number | null;

  constructor(status: number | null, code: AuthRefusalCode | null, retryAfterSeconds: number | null = null) {
    super(code ?? 'AUTH_REQUEST_FAILED');
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Bounds each call; a refresh that waits longer is transient. */
const AUTH_CALL_TIMEOUT_MS = 10_000;

function authUrl(path: string): string {
  const base = (getRegionConfig().apiUrl ?? '').replace(/\/+$/, '');
  return `${base}/auth${path}`;
}

function parseRetryAfter(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** The error a failed call rejects with: built from the status, the code and Retry-After only. */
function toAuthApiError(err: unknown): AuthApiError {
  if (err instanceof AuthApiError) return err;
  if (axios.isAxiosError(err) && err.response) {
    const data: unknown = err.response.data;
    const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
    const headers = err.response.headers as Record<string, unknown> | undefined;
    return new AuthApiError(
      err.response.status,
      isRefusalCode(code) ? code : null,
      parseRetryAfter(headers?.['retry-after']),
    );
  }
  return new AuthApiError(null, null);
}

/**
 * Where changePassword takes its bearer: the session client's getAccessToken,
 * set by the client when it loads (it refreshes a token past its refresh
 * point). No source, no bearer: the gateway answers 401.
 */
let accessTokenSource: () => Promise<string | null> = () => Promise.resolve(null);

export function setAccessTokenSource(source: () => Promise<string | null>): void {
  accessTokenSource = source;
}

async function call<T>(method: 'get' | 'post', path: string, body?: unknown, extra: AxiosRequestConfig = {}): Promise<T> {
  return (await send<T>(method, path, body, extra)).data;
}

async function send<T>(method: 'get' | 'post', path: string, body?: unknown, extra: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
  try {
    return await axios.request<T>({
      ...extra,
      method,
      url: authUrl(path),
      data: body,
      withCredentials: true,
      timeout: AUTH_CALL_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', ...(extra.headers as Record<string, string> | undefined) },
    });
  } catch (err) {
    throw toAuthApiError(err);
  }
}

function asTokenAnswer<T extends object>(data: unknown): TokenAnswer & T {
  if (!data || typeof data !== 'object') throw new AuthApiError(null, null);
  const { accessToken } = data as { accessToken?: unknown };
  if (typeof accessToken !== 'string' || accessToken.length === 0) throw new AuthApiError(null, null);
  return data as TokenAnswer & T;
}

export async function login(email: string, password: string): Promise<TokenAnswer> {
  return asTokenAnswer(await call('post', '/login', { email, password }));
}

/**
 * Exchanges the refresh cookie. Only a 401 (`REFRESH_INVALID`, also a missing
 * cookie) ends the session; a lost race is `race`; everything else (429, any
 * other 4xx, 5xx, network, timeout, an answer without a token) is transient.
 */
export async function refresh(): Promise<RefreshOutcome> {
  try {
    const data = await call<unknown>('post', '/refresh');
    const { accessToken, expiresIn } = (data && typeof data === 'object' ? data : {}) as {
      accessToken?: unknown;
      expiresIn?: unknown;
    };
    if (typeof accessToken !== 'string' || accessToken.length === 0) return { kind: 'transient' };
    // The lifetime the server gave, counted by the client from the answer's arrival (never from its own clock).
    if (typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0) {
      return { kind: 'ok', accessToken, expiresIn };
    }
    return { kind: 'ok', accessToken };
  } catch (err) {
    const { status, code } = toAuthApiError(err);
    if (status === 401) return { kind: 'signed-out' };
    if (status === 409 && code === 'REFRESH_RACE') return { kind: 'race' };
    return { kind: 'transient' };
  }
}

/**
 * Revokes the session and clears the cookie. Resolves true on the 204 only,
 * false on any failure, and never throws: the caller drops the local session
 * either way, and tells the user when the cookie may have survived.
 */
export async function logout(): Promise<boolean> {
  try {
    const response = await send('post', '/logout');
    return response.status === 204;
  } catch {
    return false;
  }
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const data = await call<unknown>('get', '/setup');
  if (!data || typeof data !== 'object') throw new AuthApiError(null, null);
  const { setupOpen, signupMode, passwordResetByEmail } = data as Record<string, unknown>;
  return {
    setupOpen: setupOpen === true,
    signupMode: signupMode === 'open' ? 'open' : 'invite_only',
    passwordResetByEmail: passwordResetByEmail === true,
  };
}

export async function setupInstance(
  body: SetupBody,
): Promise<TokenAnswer & { organizationId: string; teamId: string }> {
  return asTokenAnswer<{ organizationId: string; teamId: string }>(await call('post', '/setup', body));
}

export async function signUp(body: { email: string; name: string; password: string }): Promise<TokenAnswer> {
  return asTokenAnswer(await call('post', '/signup', body));
}

/** The signed-in user's password; the gateway revokes every other session and rotates the cookie. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<TokenAnswer> {
  const token = await accessTokenSource();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return asTokenAnswer(await call('post', '/password/change', { currentPassword, newPassword }, { headers }));
}

/** Always 202, known e-mail or not. */
export async function requestPasswordReset(email: string): Promise<void> {
  await call('post', '/password-reset/request', { email });
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  await call('post', '/password-reset/confirm', { token, newPassword });
}

export async function acceptInvitation(
  token: string,
  body: { name: string; password: string },
): Promise<TokenAnswer & { organizationId: string }> {
  if (!INVITATION_TOKEN_PATTERN.test(token)) throw new AuthApiError(null, 'INVITATION_INVALID');
  return asTokenAnswer<{ organizationId: string }>(await call('post', '/invitations/accept', { token, name: body.name, password: body.password }));
}
