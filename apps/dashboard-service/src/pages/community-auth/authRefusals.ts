import { AuthApiError } from '@/edition/auth/community/authApi';

/**
 * The closed list of refusals of the Community Edition's `/auth/*` and
 * personal-access-token routes. A page shows the
 * fixed sentence of a code, never the server's text; anything outside the list
 * (a DTO 400 without `code`, a proxy page, a network failure) is GENERIC.
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

export type AuthRefusal = (typeof AUTH_REFUSAL_CODES)[number] | 'GENERIC';

export const AUTH_REFUSAL_KEYS = Object.fromEntries(
  [...AUTH_REFUSAL_CODES, 'GENERIC' as const].map((code) => [code, `pages.communityAuth.refusals.${code}`]),
) as Record<AuthRefusal, string>;

const isRefusal = (value: unknown): value is (typeof AUTH_REFUSAL_CODES)[number] =>
  typeof value === 'string' && (AUTH_REFUSAL_CODES as readonly string[]).includes(value);

/** The status and the `body.code` of a refusal: from an AuthApiError, or an axios-shaped answer. */
function statusAndCode(error: unknown): { status: number | null; code: unknown } {
  if (error instanceof AuthApiError) return { status: error.status, code: error.code };
  if (!error || typeof error !== 'object' || !('response' in error)) return { status: null, code: undefined };
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return { status: null, code: undefined };
  const { status, data } = response as { status?: unknown; data?: unknown };
  const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined;
  return { status: typeof status === 'number' ? status : null, code };
}

/** `body.code` when it is in the list, at any status; a 429 without code is RATE_LIMITED; anything else GENERIC. */
export function authRefusalOf(error: unknown): AuthRefusal {
  const { status, code } = statusAndCode(error);
  if (isRefusal(code)) return code;
  if (status === 429) return 'RATE_LIMITED';
  return 'GENERIC';
}

export function authRefusalKey(error: unknown): string {
  return AUTH_REFUSAL_KEYS[authRefusalOf(error)];
}
