import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@/edition/auth/community/authApi';
import { buildDictionary } from '@/test/i18n-mock';
import { AUTH_REFUSAL_CODES, AUTH_REFUSAL_KEYS, authRefusalKey, authRefusalOf } from './authRefusals';

type LocaleModule = { default: Record<string, unknown> };
const dictionaryOf = (modules: Record<string, LocaleModule>, lang: 'en' | 'fr') =>
  buildDictionary(
    Object.entries(modules).map(([path, mod]) => [path.replace(`/locales/${lang}/`, '/locales/en/'), mod.default]),
  );
const en = dictionaryOf(import.meta.glob('../../i18n/locales/en/**/*.json', { eager: true }), 'en');
const fr = dictionaryOf(import.meta.glob('../../i18n/locales/fr/**/*.json', { eager: true }), 'fr');

const lookup = (dictionary: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    dictionary,
  );

/** An axios-shaped refusal, as the gateway answers it. */
const answered = (status: number, data: unknown) => ({
  isAxiosError: true,
  message: 'Request failed',
  response: { status, data, headers: {} },
});

describe('authRefusals', () => {
  it('holds the closed list of local-auth refusal codes', () => {
    expect(AUTH_REFUSAL_CODES).toEqual([
      'INVALID_CREDENTIALS', 'RATE_LIMITED', 'REFRESH_RACE', 'REFRESH_INVALID', 'SETUP_TOKEN_INVALID', 'SETUP_CLOSED',
      'SETUP_REQUIRED', 'SIGNUP_DISABLED', 'ACCOUNT_EXISTS', 'PASSWORD_POLICY', 'CURRENT_PASSWORD_INVALID',
      'RESET_TOKEN_INVALID', 'INVITATION_INVALID', 'PAT_INVALID', 'PAT_NOT_FOUND', 'PAT_NAME_INVALID',
      'PAT_EXPIRY_INVALID', 'PAT_NAME_TAKEN', 'PAT_LIMIT_REACHED', 'PAT_NOT_ALLOWED', 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
      'AUTH_UNAVAILABLE', 'AUTH_ERROR',
    ]);
  });

  it.each([...AUTH_REFUSAL_CODES, 'GENERIC' as const])('%s has its sentence in en and fr', (code) => {
    const key = AUTH_REFUSAL_KEYS[code];
    expect(key).toBe(`pages.communityAuth.refusals.${code}`);
    expect(typeof lookup(en, key)).toBe('string');
    expect(typeof lookup(fr, key)).toBe('string');
  });

  it.each(AUTH_REFUSAL_CODES)('%s in body.code maps to itself, at any status', (code) => {
    expect(authRefusalOf(answered(400, { code, message: code }))).toBe(code);
    expect(authRefusalOf(answered(500, { code }))).toBe(code);
    expect(authRefusalKey(answered(409, { code }))).toBe(`pages.communityAuth.refusals.${code}`);
  });

  it('reads the code an AuthApiError carries', () => {
    expect(authRefusalOf(new AuthApiError(401, 'INVALID_CREDENTIALS'))).toBe('INVALID_CREDENTIALS');
    expect(authRefusalOf(new AuthApiError(null, 'INVITATION_INVALID'))).toBe('INVITATION_INVALID');
  });

  it.each(['SIGNUP_CLOSED', 'PASSWORD_TOO_SHORT', 'SOMETHING_ELSE', 'boom'])('%s is GENERIC', (code) => {
    expect(authRefusalOf(answered(400, { code }))).toBe('GENERIC');
  });

  it('a 400 without code is GENERIC', () => {
    expect(authRefusalOf(answered(400, { message: ['email must be an email'] }))).toBe('GENERIC');
    expect(authRefusalOf(new AuthApiError(400, null))).toBe('GENERIC');
  });

  it('a 429 without code is RATE_LIMITED', () => {
    expect(authRefusalOf(answered(429, '<html>Too many</html>'))).toBe('RATE_LIMITED');
    expect(authRefusalOf(new AuthApiError(429, null, 30))).toBe('RATE_LIMITED');
  });

  it('anything else is GENERIC', () => {
    expect(authRefusalOf(new Error('INVALID_CREDENTIALS'))).toBe('GENERIC');
    expect(authRefusalOf({ code: 'INVALID_CREDENTIALS' })).toBe('GENERIC');
    expect(authRefusalOf(null)).toBe('GENERIC');
    expect(authRefusalOf(undefined)).toBe('GENERIC');
    expect(authRefusalOf('RATE_LIMITED')).toBe('GENERIC');
  });
});
