import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/pages/editions.json';
import fr from '@/i18n/locales/fr/pages/editions.json';
import {
  EDITION_COLUMNS,
  EDITIONS_MATRIX,
  PROPRIETARY_RULE_LANGUAGES,
  type EditionCell,
  type EditionsRow,
} from './editionsMatrix';

/*
 * Each row mirrors the public editions page. « Open Source » is the
 * self-hosted Community Edition, « Cloud » the Pro and Team plans (« Team plan »
 * when only Team holds a feature), « Enterprise » every feature.
 */
const yes: EditionCell = { included: true };
const no: EditionCell = { included: false };
const note = (included: boolean, key: string): EditionCell => ({ included, note: key });
const teamPlan = note(true, 'teamPlan');

const r = (key: string, community: EditionCell, cloud: EditionCell, enterprise: EditionCell): EditionsRow => ({
  key,
  community,
  cloud,
  enterprise,
});

const EXPECTED: EditionsRow[] = [
  r('sarifImport', yes, no, no),
  r('sastResults', yes, yes, yes),
  r('iacResults', yes, yes, yes),
  r('secretResults', yes, yes, yes),
  r('cicdResults', yes, yes, yes),
  r('scaResults', yes, yes, yes),
  r('containerResults', yes, yes, yes),
  r('codeScans', note(true, 'ownCluster'), note(true, 'managedScanners'), note(true, 'managedScanners')),
  r('pushScans', note(true, 'withCluster'), yes, yes),
  r('containerImageScans', note(false, 'importOnly'), yes, yes),
  r('containerRegistries', no, yes, yes),
  r('advisoryFeeds', no, yes, yes),
  r('triage', yes, yes, yes),
  r('policies', yes, teamPlan, yes),
  r('owaspReport', yes, teamPlan, yes),
  r('cweReport', yes, teamPlan, yes),
  r('aggregatedReport', yes, teamPlan, yes),
  r('licenseReport', no, teamPlan, yes),
  r('sbomReport', no, teamPlan, yes),
  r('aiBom', no, teamPlan, yes),
  r('euAiActReport', no, teamPlan, yes),
  r('scannerReport', no, no, yes),
  r('githubIntegration', yes, yes, yes),
  r('gitlabIntegration', yes, yes, yes),
  r('jiraIntegration', yes, teamPlan, yes),
  r('linearIntegration', yes, teamPlan, yes),
  r('slackIntegration', yes, yes, yes),
  r('mcpServer', note(true, 'patAuth'), yes, yes),
  r('grcExport', no, yes, yes),
  r('pats', yes, yes, yes),
  r('reachabilityAnalysis', no, yes, yes),
  r('falsePositiveReduction', no, yes, yes),
  r('proprietaryRules', no, note(true, 'proprietaryRuleCount'), note(true, 'proprietaryRuleCount')),
  r('cybeAnalysis', no, yes, yes),
  r('autofix', no, yes, yes),
  r('cybeChat', no, yes, yes),
  r('codeMap', no, yes, yes),
  r('localAccounts', note(true, 'localInstance'), note(false, 'socialSignIn'), note(false, 'socialSignIn')),
  r('sso', no, no, yes),
  r('mfa', no, yes, yes),
  r('selfHosted', note(true, 'composePostgres'), no, no),
  r('support', no, yes, yes),
];

const row = (key: string): EditionsRow => {
  const found = EDITIONS_MATRIX.find((x) => x.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
};

describe('EDITIONS_MATRIX', () => {
  it('pins every row, in order, with its three cells', () => {
    expect(EDITIONS_MATRIX).toEqual(EXPECTED);
  });

  it('shows no SCIM row and no « built-in scanners » row: neither exists as written', () => {
    expect(EDITIONS_MATRIX.map((x) => x.key)).not.toContain('scim');
    expect(EDITIONS_MATRIX.map((x) => x.key)).not.toContain('builtInScanners');
  });

  it('a feature the Team plan lacks is not included under Cloud', () => {
    expect(row('scannerReport').cloud.included).toBe(false);
    expect(row('scannerReport').enterprise.included).toBe(true);
  });

  it('Community runs scans only on its own cluster, and never scans an image', () => {
    expect(row('codeScans').community).toEqual({ included: true, note: 'ownCluster' });
    expect(row('containerImageScans').community.included).toBe(false);
  });

  it('the cloud offers no SARIF import', () => {
    expect(row('sarifImport').cloud).toEqual({ included: false });
    expect(row('sarifImport').enterprise).toEqual({ included: false });
  });

  it('the cloud has no e-mail and password accounts', () => {
    expect(row('localAccounts').cloud).toEqual({ included: false, note: 'socialSignIn' });
    expect(row('localAccounts').enterprise).toEqual({ included: false, note: 'socialSignIn' });
  });

  it('the SSO row reads « SSO / SAML » and is Enterprise only', () => {
    expect(en.pages.editions.rows.sso).toBe('SSO / SAML');
    expect(fr.pages.editions.rows.sso).toBe('SSO / SAML');
    expect(row('sso')).toEqual({ key: 'sso', community: no, cloud: no, enterprise: yes });
  });

  it('the proprietary rules note gives the figure « 5,000+ »', () => {
    expect(en.pages.editions.notes.proprietaryRuleCount).toBe('5,000+ rules');
    expect(fr.pages.editions.notes.proprietaryRuleCount).toBe('5 000+ règles');
  });

  it('the languages of the proprietary rules are a short, unique list that includes Rust', () => {
    expect(PROPRIETARY_RULE_LANGUAGES).toContain('Rust');
    expect(new Set(PROPRIETARY_RULE_LANGUAGES).size).toBe(PROPRIETARY_RULE_LANGUAGES.length);
    expect(PROPRIETARY_RULE_LANGUAGES.length).toBeLessThanOrEqual(16);
  });

  it('keys are unique', () => {
    expect(new Set(EDITIONS_MATRIX.map((x) => x.key)).size).toBe(EDITIONS_MATRIX.length);
  });

  it('every row and every note has an en and fr label', () => {
    const labels = (locale: typeof en) => ({
      rows: locale.pages.editions.rows as Record<string, string>,
      notes: locale.pages.editions.notes as Record<string, string>,
    });
    for (const [name, locale] of [['en', en], ['fr', fr]] as const) {
      const { rows, notes } = labels(locale);
      for (const x of EDITIONS_MATRIX) {
        expect(rows[x.key], `${name} row ${x.key}`).toEqual(expect.any(String));
        expect(rows[x.key].length).toBeGreaterThan(0);
        for (const column of EDITION_COLUMNS) {
          const key = x[column].note;
          if (key === undefined) continue;
          expect(notes[key], `${name} note ${key}`).toEqual(expect.any(String));
          expect(notes[key].length).toBeGreaterThan(0);
        }
      }
    }
  });
});
