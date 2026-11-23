import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/components/clusterScans.json';
import fr from '@/i18n/locales/fr/components/clusterScans.json';

/**
 * The Scanning tab's hint of an import-only Community instance: text only,
 * the fixed sentence verbatim in each locale.
 */
describe('components.clusterScans.hint', () => {
  it.each([
    [
      'en',
      en,
      'This instance imports results only. To run scans here, connect a Kubernetes cluster: see « Run scans on a Kubernetes cluster » in deploy/community/README.md.',
    ],
    [
      'fr',
      fr,
      'Cette instance importe seulement des résultats. Pour lancer des analyses ici, connectez un cluster Kubernetes : voir « Run scans on a Kubernetes cluster » dans deploy/community/README.md.',
    ],
  ])('%s holds the fixed sentence verbatim', (_lang, locale, sentence) => {
    expect(locale.components.clusterScans.hint).toBe(sentence);
  });
});
