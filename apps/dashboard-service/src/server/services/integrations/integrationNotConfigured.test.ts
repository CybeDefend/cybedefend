import { describe, it, expect } from 'vitest';
import en from '@/i18n/locales/en/components/integrationNotConfigured.json';
import fr from '@/i18n/locales/fr/components/integrationNotConfigured.json';

import {
  INTEGRATION_NOT_CONFIGURED_CODES,
  integrationNotConfiguredKey,
  integrationNotConfiguredOf,
} from './integrationNotConfigured';

const httpError = (data: unknown, status = 400) => ({ response: { status, data } });

describe('integrationNotConfiguredOf', () => {
  it.each([
    ['GITHUB_APP_NOT_CONFIGURED', 'github'],
    ['GITLAB_NOT_CONFIGURED', 'gitlab'],
    ['JIRA_NOT_CONFIGURED', 'jira'],
    ['LINEAR_NOT_CONFIGURED', 'linear'],
  ])('reads %s from the error message as %s', (code, provider) => {
    expect(integrationNotConfiguredOf(httpError({ statusCode: 400, message: code }))).toBe(provider);
  });

  it('reads the code from a `code` field or a one-entry message list', () => {
    expect(integrationNotConfiguredOf(httpError({ code: 'JIRA_NOT_CONFIGURED', message: 'x' }))).toBe('jira');
    expect(integrationNotConfiguredOf(httpError({ message: ['GITLAB_NOT_CONFIGURED'] }))).toBe('gitlab');
  });

  it('is null for any other error', () => {
    expect(integrationNotConfiguredOf(httpError({ message: 'JIRA_NOT_CONFIGURED: and more' }))).toBeNull();
    expect(integrationNotConfiguredOf(httpError({ message: 'LINEAR_NOT_CONNECTED' }))).toBeNull();
    expect(integrationNotConfiguredOf(httpError({ message: 'GITLAB_NOT_CONFIGURED' }, 500))).toBeNull();
    expect(integrationNotConfiguredOf(new Error('GITLAB_NOT_CONFIGURED'))).toBeNull();
    expect(integrationNotConfiguredOf(undefined)).toBeNull();
  });
});

describe('the not-configured sentences', () => {
  it('exist in English and French for every provider (the guide is named by the link under them)', () => {
    const enSentences = en.components.integrationNotConfigured as Record<string, string>;
    const frSentences = fr.components.integrationNotConfigured as Record<string, string>;
    for (const provider of Object.values(INTEGRATION_NOT_CONFIGURED_CODES)) {
      expect(integrationNotConfiguredKey(provider)).toBe(`components.integrationNotConfigured.${provider}`);
      expect(enSentences[provider]).toMatch(/not configured on this instance/);
      expect(frSentences[provider]).toMatch(/n'est pas configurée? sur cette instance/);
    }
  });
});
