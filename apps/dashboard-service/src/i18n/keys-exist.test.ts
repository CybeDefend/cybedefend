import { describe, it, expect } from 'vitest';
import { SCAN_SOURCES } from '@/utils/scanSource';
import { LANGS, LOCALE_ROOTS, isLeaf, isNode, loadDict, nodeAt, scanKeys, sourceFiles } from '@/test/i18nKeys';
import { LINEAR_REFUSALS, linearRefusalKey } from '@/server/services/integrations/linearIntegrationsService';

/**
 * Every translation key the code can ask for exists in `en` AND in `fr`.
 *
 * `no-fallback.test.ts` already checks `t('literal')`, but only in single
 * quotes, and only the literal form. A key written `t("…")`, built from a
 * constant (`t(\`${KEY}.title\`)`), passed through a local helper
 * (`const k = (key) => t(\`components.x.${key}\`)`), picked by a ternary, or
 * fed by data (`t(\`components.scanSourceBadge.${source}\`)`) went unchecked:
 * a data-fed key such as « components.scanSourceBadge.vscode », or a key
 * written in double quotes, would render as its own dotted path.
 *
 * This test reads the sources with the TypeScript parser (no type checker, so
 * it stays fast) and checks:
 *  1. every literal key: `t()` / `i18n.t()` in any quote, `i18nKey`, arrays,
 *     ternaries of literals, keys built from a file's string constants, and the
 *     calls of a file's local `t` helpers;
 *  2. every literal anywhere in the code that names a full key
 *     (`labelKey: 'components.x.y'`), as a key or a key prefix;
 *  3. for a key built from a value at runtime, that its literal prefix exists;
 *  4. every value of the closed lists that feed such keys from the API (scan
 *     sources, verdicts, plans…), listed below with where they come from.
 *
 * The dictionary is every locale root of the tree (`LOCALE_ROOTS`): the
 * core's fragments, and the closed tree's when it is there. The collector is
 * `src/test/i18nKeys.ts`, shared with the edition's locale tests; the closed
 * lists of the closed tree are checked by its own test.
 */

const DICTS = { en: loadDict('en', LOCALE_ROOTS), fr: loadDict('fr', LOCALE_ROOTS) };
const NAMESPACES = new Set([...Object.keys(DICTS.en), ...Object.keys(DICTS.fr)]);

const scan = () => scanKeys(sourceFiles(), NAMESPACES);

const SCAN = scan();

describe('translation keys used by the code', () => {
  it('finds the keys it is meant to check', () => {
    // A parser change that silently finds nothing would pass every test below.
    // The core alone (the Community Edition) holds about 3,600 keys and 250
    // built ones; with the closed tree, past 5,000 and 100.
    const withClosedTree = LOCALE_ROOTS.length > 1;
    expect(SCAN.keys.length).toBeGreaterThan(withClosedTree ? 5000 : 3000);
    expect(SCAN.built.length).toBeGreaterThan(100);
  });

  it('exist in en and fr, for every key spelled in the code', () => {
    const missing: string[] = [];
    for (const use of SCAN.keys) {
      for (const lng of LANGS) {
        const ok = use.kind === 'objects' ? nodeAt(DICTS[lng], use.key) !== undefined : isLeaf(DICTS[lng], use.key);
        if (!ok) missing.push(`${lng} ${use.where} → ${use.key}`);
      }
    }
    expect([...new Set(missing)], `keys that render as their dotted path:\n${[...new Set(missing)].join('\n')}`).toEqual([]);
  });

  it('exist in en and fr, for every full key written as a value (labelKey: …)', () => {
    const missing: string[] = [];
    for (const use of SCAN.strays) {
      for (const lng of LANGS) {
        if (!isLeaf(DICTS[lng], use.key) && !isNode(DICTS[lng], use.key)) missing.push(`${lng} ${use.where} → ${use.key}`);
      }
    }
    expect([...new Set(missing)], `key-shaped values that name no key:\n${[...new Set(missing)].join('\n')}`).toEqual([]);
  });

  it('have their literal prefix in en and fr when the rest comes from a value', () => {
    const missing: string[] = [];
    for (const { where, parts } of SCAN.built) {
      const first = parts[0];
      if (!first || !('lit' in first) || !first.lit.includes('.')) continue;
      const prefix = first.lit.slice(0, first.lit.lastIndexOf('.'));
      if (!NAMESPACES.has(prefix.split('.')[0])) continue;
      for (const lng of LANGS) if (!isNode(DICTS[lng], prefix)) missing.push(`${lng} ${where} → ${prefix}.*`);
    }
    expect([...new Set(missing)], `key prefixes that exist nowhere:\n${[...new Set(missing)].join('\n')}`).toEqual([]);
  });
});

/**
 * Keys built from a value the API sends. Each list is what the backend can
 * send today (its source next to it); `scanSourceLabelKey`-style helpers map
 * anything else to a generic key.
 */
const KNOWN_VALUES: Array<{ name: string; keys: string[] }> = [
  {
    // global-management `ScanSourceType` (project.entity.ts), via utils/scanSource.ts.
    name: 'scan sources',
    keys: [...SCAN_SOURCES, 'other'].map((s) => `components.scanSourceBadge.${s}`),
  },
  {
    // `ExploitabilityVerdict` (server/interfaces/Vulnerability.ts).
    name: 'exploitability verdicts',
    keys: ['actively_exploited', 'proven', 'theoretical', 'not_exploitable', 'malicious'].flatMap((v) => [
      `components.exploitability.${v}`,
      `components.historyTimeline.verdict.description.${v}`,
    ]),
  },
  {
    // external-integrations refusals of the Linear routes, via linearIntegrationsService.ts: the sentence per code, never the server's text.
    name: 'linear refusals',
    keys: LINEAR_REFUSALS.map(linearRefusalKey),
  },
  {
    // analysis-reporting `LicenseRisk` (sca/license.utils.ts).
    name: 'licence risks',
    keys: ['NONE', 'MEDIUM', 'HIGH', 'UNKNOWN'].map((r) => `components.licenseDetailPage.risk.${r}`),
  },
  {
    // Severities the results lists, cards and badges print.
    name: 'severities',
    keys: ['critical', 'high', 'medium', 'low', 'info', 'none'].map((s) => `common.severity.${s}`),
  },
];

describe('keys fed by values the API sends', () => {
  it.each(KNOWN_VALUES)('exist in en and fr for every known value: $name', ({ keys }) => {
    const missing = keys.flatMap((key) => LANGS.filter((lng) => !isLeaf(DICTS[lng], key)).map((lng) => `${lng} ${key}`));
    expect(missing).toEqual([]);
  });
});
