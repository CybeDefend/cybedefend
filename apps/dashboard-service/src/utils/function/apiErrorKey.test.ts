import { describe, it, expect, vi } from 'vitest';
import en from '@/i18n/locales/en/errors/_self.json';
import fr from '@/i18n/locales/fr/errors/_self.json';
import i18n from '@/i18n';
import i18next from 'i18next';
import { API_ERROR_KEYS, LocalizedError, apiErrorKey, apiErrorText } from './apiErrorKey';
import { ROLE_REFUSAL_KEY } from '@/utils/organizationRoleRefusal';

const answer = (status: number, data: unknown = {}) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data },
});

describe('apiErrorKey', () => {
  it('reads a known body.code first, at any status', () => {
    expect(apiErrorKey(answer(400, { code: 'ROLE_NOT_AVAILABLE', message: 'raw' }))).toBe(ROLE_REFUSAL_KEY);
  });

  it('reads a code the caller names before the built-in ones', () => {
    expect(apiErrorKey(answer(409, { code: 'TEAM_NAME_TAKEN' }), { codes: { TEAM_NAME_TAKEN: 'x.y' } })).toBe('x.y');
  });

  it('ignores a code inherited from the prototype', () => {
    expect(apiErrorKey(answer(404, { code: 'toString' }))).toBe(API_ERROR_KEYS.notFound);
  });

  it.each([
    [400, API_ERROR_KEYS.badRequest],
    [422, API_ERROR_KEYS.badRequest],
    [401, API_ERROR_KEYS.notAllowed],
    [403, API_ERROR_KEYS.notAllowed],
    [404, API_ERROR_KEYS.notFound],
    [409, API_ERROR_KEYS.conflict],
    [429, API_ERROR_KEYS.tooManyRequests],
    [500, API_ERROR_KEYS.unavailable],
    [503, API_ERROR_KEYS.unavailable],
  ])('maps status %i to a fixed sentence, never the server text', (status, key) => {
    expect(apiErrorKey(answer(status, { message: ['name must be a string'] }))).toBe(key);
  });

  it('treats a request without answer (network failure) as unavailable', () => {
    expect(apiErrorKey({ message: 'Network Error', request: {} })).toBe(API_ERROR_KEYS.unavailable);
    expect(apiErrorKey({ message: 'Network Error', isAxiosError: true })).toBe(API_ERROR_KEYS.unavailable);
  });

  it('reads the key of an error the dashboard raised itself', () => {
    expect(apiErrorKey(new LocalizedError('pages.x.noOrganization'), { fallback: 'pages.x.failed' })).toBe('pages.x.noOrganization');
  });

  it('falls back to the caller sentence, else the generic one, for anything else', () => {
    expect(apiErrorKey(new Error('boom'), { fallback: 'pages.x.failed' })).toBe('pages.x.failed');
    expect(apiErrorKey(new Error('boom'))).toBe(API_ERROR_KEYS.generic);
    expect(apiErrorKey(answer(418), { fallback: 'pages.x.failed' })).toBe('pages.x.failed');
    expect(apiErrorKey(null)).toBe(API_ERROR_KEYS.generic);
    expect(apiErrorKey(undefined)).toBe(API_ERROR_KEYS.generic);
  });

  it('has every sentence in en and fr', () => {
    const at = (dict: unknown, key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
    for (const key of Object.values(API_ERROR_KEYS)) {
      expect(typeof at(en, key), `en ${key}`).toBe('string');
      expect(typeof at(fr, key), `fr ${key}`).toBe('string');
    }
  });
});

describe('apiErrorText', () => {
  it('translates the key, never returning the server text', async () => {
    await i18n.changeLanguage('fr');
    const text = apiErrorText({ message: 'Request failed with status code 403', response: { status: 403, data: { message: 'Forbidden resource' } } });
    expect(text).toBe(fr.errors.api.notAllowed);
    await i18n.changeLanguage('en');
    expect(apiErrorText(new Error('boom'), { fallback: 'errors.generic.operationFailed' })).toBe(en.errors.generic.operationFailed);
  });

  it('is translated as soon as the i18n module is imported, before any render', async () => {
    // The entry point imports the i18n module before rendering; its resources
    // are bundled, so i18next loads them synchronously during init and a hook
    // never stores the bare key.
    vi.resetModules();
    window.localStorage.setItem('language', 'en');
    try {
      const fresh = (await import('@/i18n')).default;
      const { apiErrorText: freshText } = await import('./apiErrorKey');
      expect(fresh.isInitialized).toBe(true);
      expect(freshText(new Error('boom'))).toBe(en.errors.api.generic);
    } finally {
      window.localStorage.removeItem('language');
    }
  });

  it('is never empty, even before the translations are loaded', () => {
    const t = vi.spyOn(i18next, 't').mockReturnValue(undefined as never);
    try {
      expect(apiErrorText(new Error('boom'))).toBe(API_ERROR_KEYS.generic);
    } finally {
      t.mockRestore();
    }
  });
});
