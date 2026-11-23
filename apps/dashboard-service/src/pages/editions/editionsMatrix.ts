export type EditionColumn = 'community' | 'cloud' | 'enterprise';

/**
 * One cell: whether the edition holds the row, and an optional short note
 * (`pages.editions.notes.<note>`) for a row that is only partly true there,
 * shown as small text next to the mark.
 */
export interface EditionCell {
  included: boolean;
  note?: string;
}

export interface EditionsRow {
  /** The row's label: `pages.editions.rows.<key>`. */
  key: string;
  community: EditionCell;
  cloud: EditionCell;
  enterprise: EditionCell;
}

/** The editions, in the order the comparison shows them. */
export const EDITION_COLUMNS: readonly EditionColumn[] = ['community', 'cloud', 'enterprise'];

const yes: EditionCell = { included: true };
const no: EditionCell = { included: false };
const note = (included: boolean, key: string): EditionCell => ({ included, note: key });
/** A feature the Team plan holds and the Pro plan does not. */
const teamPlan = note(true, 'teamPlan');

const row = (key: string, community: EditionCell, cloud: EditionCell, enterprise: EditionCell): EditionsRow => ({
  key,
  community,
  cloud,
  enterprise,
});

/**
 * What each edition holds: « community » is the self-hosted Open Source
 * edition, « cloud » the Pro and Team plans, « enterprise » every feature.
 */
export const EDITIONS_MATRIX: readonly EditionsRow[] = [
  // The SARIF import is a Community Edition feature only.
  row('sarifImport', yes, no, no),
  row('sastResults', yes, yes, yes),
  row('iacResults', yes, yes, yes),
  row('secretResults', yes, yes, yes),
  row('cicdResults', yes, yes, yes),
  row('scaResults', yes, yes, yes),
  row('containerResults', yes, yes, yes),
  row('codeScans', note(true, 'ownCluster'), note(true, 'managedScanners'), note(true, 'managedScanners')),
  row('pushScans', note(true, 'withCluster'), yes, yes),
  row('containerImageScans', note(false, 'importOnly'), yes, yes),
  row('containerRegistries', no, yes, yes),
  row('advisoryFeeds', no, yes, yes),
  row('triage', yes, yes, yes),
  row('policies', yes, teamPlan, yes),
  row('owaspReport', yes, teamPlan, yes),
  row('cweReport', yes, teamPlan, yes),
  row('aggregatedReport', yes, teamPlan, yes),
  row('licenseReport', no, teamPlan, yes),
  row('sbomReport', no, teamPlan, yes),
  row('aiBom', no, teamPlan, yes),
  row('euAiActReport', no, teamPlan, yes),
  row('scannerReport', no, no, yes),
  row('githubIntegration', yes, yes, yes),
  row('gitlabIntegration', yes, yes, yes),
  row('jiraIntegration', yes, teamPlan, yes),
  row('linearIntegration', yes, teamPlan, yes),
  row('slackIntegration', yes, yes, yes),
  row('mcpServer', note(true, 'patAuth'), yes, yes),
  row('grcExport', no, yes, yes),
  row('pats', yes, yes, yes),
  // Cloud SAST adds data-flow exploitability, false-positive triage and a larger rule
  // catalogue; Community runs the open-source rule sets.
  row('reachabilityAnalysis', no, yes, yes),
  row('falsePositiveReduction', no, yes, yes),
  row('proprietaryRules', no, note(true, 'proprietaryRuleCount'), note(true, 'proprietaryRuleCount')),
  row('cybeAnalysis', no, yes, yes),
  row('autofix', no, yes, yes),
  row('cybeChat', no, yes, yes),
  row('codeMap', no, yes, yes),
  // The cloud signs in with GitHub, GitLab, Microsoft or Google: no e-mail and password accounts.
  row('localAccounts', note(true, 'localInstance'), note(false, 'socialSignIn'), note(false, 'socialSignIn')),
  row('sso', no, no, yes),
  row('mfa', no, yes, yes),
  row('selfHosted', note(true, 'composePostgres'), no, no),
  row('support', no, yes, yes),
];

/**
 * The programming languages the proprietary SAST rules cover, as the « Why
 * Cloud » block lists them. Proper names, so not translated.
 */
export const PROPRIETARY_RULE_LANGUAGES: readonly string[] = [
  'Python',
  'JavaScript',
  'TypeScript',
  'Java',
  'Go',
  'C#',
  'PHP',
  'Ruby',
  'Rust',
  'Kotlin',
  'Scala',
  'Swift',
  'C',
  'Solidity',
  'OCaml',
  'Apex',
];
