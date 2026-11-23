import { describe, it, expect } from 'vitest';
import enReports from '@/i18n/locales/en/pages/reportsPage.json';
import frReports from '@/i18n/locales/fr/pages/reportsPage.json';

/**
 * The stored-reports quota is one pool for the whole organisation: project
 * reports and organisation, team and selection reports all count in it. The
 * banner sits above lists that show only one of them (a project's Reports
 * tab lists that project's reports alone), so a bare « 3 / 500 stored
 * reports » above an empty list reads as a wrong count. The sentence says
 * whose reports it counts, and keeps both placeholders.
 * Repo rule: `en` and `fr` are updated together.
 */
describe('stored-reports quota banner — EN/FR', () => {
  const used = (locale: unknown): string =>
    (locale as { pages: { reportsPage: { storedReports: { quota: { used: string } } } } }).pages
      .reportsPage.storedReports.quota.used;

  it('names the organisation in English', () => {
    expect(used(enReports)).toMatch(/\borganization\b/);
  });

  it('names the organisation in French', () => {
    expect(used(frReports)).toMatch(/organisation/);
  });

  it('keeps the used and limit placeholders in both languages', () => {
    for (const sentence of [used(enReports), used(frReports)]) {
      expect(sentence).toContain('{{used}}');
      expect(sentence).toContain('{{limit}}');
    }
  });
});
