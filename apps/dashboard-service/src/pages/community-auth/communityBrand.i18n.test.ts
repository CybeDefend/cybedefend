import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/pages/communityAuth.json';
import fr from '@/i18n/locales/fr/pages/communityAuth.json';

// The label next to the CybeDefend wordmark on the Community sign-in pages
// names the edition, under its open-source licence (AGPLv3): « Open Source »
// in every locale, and the logo's accessible name reads what the eye reads.
describe('the Community sign-in brand label', () => {
  it.each([
    ['en', en],
    ['fr', fr],
  ])('reads « Open Source » next to the wordmark in %s', (_locale, file) => {
    expect(file.pages.communityAuth.product).toBe('Open Source');
    expect(file.pages.communityAuth.brand).toBe('CybeDefend Open Source');
  });
});
