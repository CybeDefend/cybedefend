import { describe, expect, it } from 'vitest';
import { translate } from '@/test/i18n-mock';
import { ROLE_REFUSAL_KEY, roleRefusalOf } from './organizationRoleRefusal';

const httpError = (data: unknown) => ({ response: { status: 400, data } });

/**
 * The Community Edition gives nobody the billing manager role:
 * global-management refuses an invitation, an acceptance or a role change to
 * it `ROLE_NOT_AVAILABLE`, which the gateway answers with
 * `body.code`. The dashboard reads that exact code and shows a fixed
 * sentence, never the server's text.
 */
describe('roleRefusalOf', () => {
  it('reads ROLE_NOT_AVAILABLE from body.code', () => {
    expect(roleRefusalOf(httpError({ code: 'ROLE_NOT_AVAILABLE', message: 'ROLE_NOT_AVAILABLE' }))).toBe('ROLE_NOT_AVAILABLE');
  });

  it('reads it from a body message that is the whole code', () => {
    expect(roleRefusalOf(httpError({ message: 'ROLE_NOT_AVAILABLE' }))).toBe('ROLE_NOT_AVAILABLE');
  });

  it('reads nothing else', () => {
    expect(roleRefusalOf(httpError({ code: 'APPSEC_SEATS_FULL' }))).toBeNull();
    expect(roleRefusalOf(httpError({ message: 'Role ROLE_NOT_AVAILABLE here' }))).toBeNull();
    expect(roleRefusalOf(new Error('network'))).toBeNull();
    expect(roleRefusalOf(null)).toBeNull();
  });

  it('has a sentence in English and in French', async () => {
    expect(translate(ROLE_REFUSAL_KEY)).toBe('This role is not available in this edition.');
    const fr = (await import('@/i18n/locales/fr/components/organizationRoleRefusal.json')).default as {
      components: { organizationRoleRefusal: { ROLE_NOT_AVAILABLE: string } };
    };
    expect(fr.components.organizationRoleRefusal.ROLE_NOT_AVAILABLE).toBe("Ce rôle n'est pas disponible dans cette édition.");
  });
});
