import { afterEach, describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';

import { syncDocumentLanguage } from './documentLanguage';

/**
 * `<html lang>` says which language the page is written in: screen readers pick their voice
 * from it, and browsers their hyphenation and translation offer. It follows the interface's.
 */
describe('syncDocumentLanguage', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'en'));

  it('sets the language the interface starts in, and follows every change', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'fr', resources: { en: { translation: {} }, fr: { translation: {} } } });
    const stop = syncDocumentLanguage(i18n);
    expect(document.documentElement.lang).toBe('fr');

    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    await i18n.changeLanguage('fr');
    expect(document.documentElement.lang).toBe('fr');

    stop();
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('keeps the primary language of a regional code', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'fr-CA', fallbackLng: 'en', resources: { en: { translation: {} } } });
    syncDocumentLanguage(i18n);
    expect(document.documentElement.lang).toBe('fr-CA');
  });

  it('is wired to the application\'s i18n', async () => {
    const { default: appI18n } = await import('./index');
    await appI18n.changeLanguage('fr');
    expect(document.documentElement.lang).toBe('fr');
    await appI18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    // Loading the application's i18n loads every locale fragment of the edition.
  }, 60_000);
});
