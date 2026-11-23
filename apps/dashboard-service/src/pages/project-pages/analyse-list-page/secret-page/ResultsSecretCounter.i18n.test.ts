import { describe, it, expect, beforeAll } from 'vitest';
import i18next, { type i18n as I18nInstance } from 'i18next';
import enResultsTable from '@/i18n/locales/en/components/resultsTable.json';
import frResultsTable from '@/i18n/locales/fr/components/resultsTable.json';

// The Secrets results counter must go through i18n with correct
// pluralisation and EN/FR parity. These tests load the real locale fragments
// into an isolated i18next instance so we exercise the actual CLDR plural
// rules per language (no global state, no react-i18next mocking).

const makeI18n = async (lng: 'en' | 'fr'): Promise<I18nInstance> => {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: enResultsTable },
      fr: { translation: frResultsTable },
    },
    interpolation: { escapeValue: false },
  });
  return inst;
};

describe('Secrets counter i18n (vulnerabilityCount)', () => {
  let en: I18nInstance;
  let fr: I18nInstance;

  beforeAll(async () => {
    en = await makeI18n('en');
    fr = await makeI18n('fr');
  });

  it('renders the singular form in English for count = 1', () => {
    expect(en.t('components.resultsTable.vulnerabilityCount', { count: 1 })).toBe(
      '1 vulnerability',
    );
  });

  it('renders the plural form in English for count = 2', () => {
    expect(en.t('components.resultsTable.vulnerabilityCount', { count: 2 })).toBe(
      '2 vulnerabilities',
    );
  });

  it('renders the plural form in English for count = 0', () => {
    expect(en.t('components.resultsTable.vulnerabilityCount', { count: 0 })).toBe(
      '0 vulnerabilities',
    );
  });

  it('renders the singular form in French for count = 1', () => {
    expect(fr.t('components.resultsTable.vulnerabilityCount', { count: 1 })).toBe(
      '1 vulnérabilité',
    );
  });

  it('renders the plural form in French for count = 2', () => {
    expect(fr.t('components.resultsTable.vulnerabilityCount', { count: 2 })).toBe(
      '2 vulnérabilités',
    );
  });

  it('renders the singular form in French for count = 0 (French CLDR: 0 is singular)', () => {
    expect(fr.t('components.resultsTable.vulnerabilityCount', { count: 0 })).toBe(
      '0 vulnérabilité',
    );
  });
});

describe('Secrets grouped counter i18n (vulnerabilityGroupCount)', () => {
  let en: I18nInstance;
  let fr: I18nInstance;

  beforeAll(async () => {
    en = await makeI18n('en');
    fr = await makeI18n('fr');
  });

  it('renders the singular form in English for count = 1', () => {
    expect(en.t('components.resultsTable.vulnerabilityGroupCount', { count: 1 })).toBe(
      '1 group of vulnerabilities',
    );
  });

  it('renders the plural form in English for count = 3', () => {
    expect(en.t('components.resultsTable.vulnerabilityGroupCount', { count: 3 })).toBe(
      '3 groups of vulnerabilities',
    );
  });

  it('renders the singular form in French for count = 1', () => {
    expect(fr.t('components.resultsTable.vulnerabilityGroupCount', { count: 1 })).toBe(
      '1 groupe de vulnérabilités',
    );
  });

  it('renders the plural form in French for count = 3', () => {
    expect(fr.t('components.resultsTable.vulnerabilityGroupCount', { count: 3 })).toBe(
      '3 groupes de vulnérabilités',
    );
  });

  it('renders the singular form in French for count = 0 (French CLDR: 0 is singular)', () => {
    expect(fr.t('components.resultsTable.vulnerabilityGroupCount', { count: 0 })).toBe(
      '0 groupe de vulnérabilités',
    );
  });
});

describe('Secrets grouped table unknown-vulnerability fallback i18n', () => {
  it('provides a translated label in both locales', async () => {
    const en = await makeI18n('en');
    const fr = await makeI18n('fr');
    expect(en.t('components.resultsTable.unknownVulnerability')).toBe(
      'Unknown Vulnerability',
    );
    expect(fr.t('components.resultsTable.unknownVulnerability')).toBe(
      'Vulnérabilité inconnue',
    );
  });
});

describe('EN/FR locale parity for the new resultsTable keys', () => {
  const newKeys = [
    'vulnerabilityCount_one',
    'vulnerabilityCount_other',
    'vulnerabilityGroupCount_one',
    'vulnerabilityGroupCount_other',
    'unknownVulnerability',
  ];

  it('defines every new key in both English and French fragments', () => {
    const enTable = (enResultsTable as any).components.resultsTable;
    const frTable = (frResultsTable as any).components.resultsTable;
    for (const key of newKeys) {
      expect(enTable, `EN missing ${key}`).toHaveProperty(key);
      expect(frTable, `FR missing ${key}`).toHaveProperty(key);
    }
  });
});
