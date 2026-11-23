import { describe, it, expect } from 'vitest';
import enUpdateVulnerability from '@/i18n/locales/en/components/modal/updateVulnerability.json';
import frUpdateVulnerability from '@/i18n/locales/fr/components/modal/updateVulnerability.json';
import enBatchUpdate from '@/i18n/locales/en/components/modal/batchUpdate.json';
import frBatchUpdate from '@/i18n/locales/fr/components/modal/batchUpdate.json';

/**
 * The dismissal reason field is the only new UI surface of a
 * deliberate breaking change; shipping it English-only would leave French
 * users staring at a raw i18n key on the one control that now blocks their
 * submit. Repo rule: `en` and `fr` are updated together.
 */
describe('dismissal reason — EN/FR locale parity', () => {
  const singleKeys = [
    'dismissalReasonLabel',
    'dismissalReasonPlaceholder',
    'dismissalReasonRequired',
  ];
  const batchKeys = [
    'dismissalReasonLabel',
    'dismissalReasonPlaceholder',
    'dismissalReasonRequired',
    'dismissalReasonRequired_other',
  ];

  it('defines every single-update key in both locales, non-empty', () => {
    const en = (enUpdateVulnerability as any).components.modal.updateVulnerability;
    const fr = (frUpdateVulnerability as any).components.modal.updateVulnerability;
    for (const key of singleKeys) {
      expect(en, `EN missing ${key}`).toHaveProperty(key);
      expect(fr, `FR missing ${key}`).toHaveProperty(key);
      expect(String(en[key]).trim().length, `EN ${key} is blank`).toBeGreaterThan(0);
      expect(String(fr[key]).trim().length, `FR ${key} is blank`).toBeGreaterThan(0);
      // A copy-pasted English string in the French file is the usual failure
      // mode of "update both files"; catch it rather than tick a box.
      expect(fr[key], `FR ${key} is still the English string`).not.toBe(en[key]);
    }
  });

  it('defines every batch-update key in both locales, non-empty', () => {
    const en = enBatchUpdate as any;
    const fr = frBatchUpdate as any;
    for (const key of batchKeys) {
      expect(en, `EN missing ${key}`).toHaveProperty(key);
      expect(fr, `FR missing ${key}`).toHaveProperty(key);
      expect(String(en[key]).trim().length, `EN ${key} is blank`).toBeGreaterThan(0);
      expect(String(fr[key]).trim().length, `FR ${key} is blank`).toBeGreaterThan(0);
      expect(fr[key], `FR ${key} is still the English string`).not.toBe(en[key]);
    }
  });
});
