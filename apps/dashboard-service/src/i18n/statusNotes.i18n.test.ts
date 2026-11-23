import { describe, it, expect } from 'vitest';
import enUpdateVulnerability from '@/i18n/locales/en/components/modal/updateVulnerability.json';
import frUpdateVulnerability from '@/i18n/locales/fr/components/modal/updateVulnerability.json';
import enBatchUpdate from '@/i18n/locales/en/components/modal/batchUpdate.json';
import frBatchUpdate from '@/i18n/locales/fr/components/modal/batchUpdate.json';
import enStatus from '@/i18n/locales/en/components/analyseWrapper/status.json';
import frStatus from '@/i18n/locales/fr/components/analyseWrapper/status.json';

/**
 * The status notes of the update modals: the `resolved` warning and the
 * `ignored` note. A missing key shows French users a raw i18n key. The
 * warning also tells the user which status to pick instead through the
 * `{{ignoredStatus}}` placeholder, filled with the translated status label
 * `components.analyseWrapper.status.labels.ignored`; a translation that drops
 * or renames it would leave the advice pointing at nothing.
 * Repo rule: `en` and `fr` are updated together.
 */
describe('status notes of the update modals — EN/FR locale parity', () => {
  const cases = [
    {
      name: 'single update',
      en: (enUpdateVulnerability as any).components.modal.updateVulnerability,
      fr: (frUpdateVulnerability as any).components.modal.updateVulnerability,
      keys: ['resolvedWarning', 'ignoredInfo'],
    },
    {
      name: 'batch update',
      en: enBatchUpdate as any,
      fr: frBatchUpdate as any,
      keys: ['resolvedWarning', 'resolvedWarning_other', 'ignoredInfo', 'ignoredInfo_other'],
    },
  ];

  for (const { name, en, fr, keys } of cases) {
    it(`defines the ${name} notes in both locales`, () => {
      for (const key of keys) {
        expect(en, `EN missing ${key}`).toHaveProperty(key);
        expect(fr, `FR missing ${key}`).toHaveProperty(key);
        expect(String(en[key]).trim().length, `EN ${key} is blank`).toBeGreaterThan(0);
        expect(String(fr[key]).trim().length, `FR ${key} is blank`).toBeGreaterThan(0);
        expect(fr[key], `FR ${key} is still the English string`).not.toBe(en[key]);
      }
    });

    it(`names the status to pick instead in every ${name} resolved warning`, () => {
      for (const key of keys.filter((k) => k.startsWith('resolvedWarning'))) {
        expect(String(en[key]), `EN ${key} does not name the status`).toContain('{{ignoredStatus}}');
        expect(String(fr[key]), `FR ${key} does not name the status`).toContain('{{ignoredStatus}}');
      }
    });
  }

  it('fills the placeholder with a status label translated in both locales', () => {
    const en = (enStatus as any).components.analyseWrapper.status.labels.ignored;
    const fr = (frStatus as any).components.analyseWrapper.status.labels.ignored;
    expect(String(en ?? '').trim().length, 'EN ignored label is blank').toBeGreaterThan(0);
    expect(String(fr ?? '').trim().length, 'FR ignored label is blank').toBeGreaterThan(0);
    expect(fr, 'FR ignored label is still the English string').not.toBe(en);
  });
});
