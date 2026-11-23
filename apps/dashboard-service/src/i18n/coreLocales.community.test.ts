import { describe, expect, it } from 'vitest';
import { CORE_LOCALES, isClosedSource, loadDict, missingKeys, missingPrefixes, scanKeys, sourceFiles } from '@/test/i18nKeys';

/**
 * The Community Edition ships the core's locale fragments alone: the closed
 * tree's are not exported, and a private build in
 * community mode does not merge them (`ACTIVE_EXTENSIONS.locales` is empty).
 * So every key a core file can ask for must exist in the core's fragments,
 * or a Community user reads its dotted path. The collector is the one of
 * `keys-exist.test.ts` (`src/test/i18nKeys.ts`), run over the core's files only.
 */
const DICTS = { en: loadDict('en', [CORE_LOCALES]), fr: loadDict('fr', [CORE_LOCALES]) };
const NAMESPACES = new Set([...Object.keys(DICTS.en), ...Object.keys(DICTS.fr)]);
const CORE_FILES = sourceFiles().filter((file) => !isClosedSource(file));
const SCAN = scanKeys(CORE_FILES, NAMESPACES);

describe('the core locales, alone', () => {
  it('are read by a collector that finds the core keys', () => {
    // A parser change that silently finds nothing would pass the tests below.
    expect(CORE_FILES.length).toBeGreaterThan(500);
    expect(SCAN.keys.length).toBeGreaterThan(2000);
  });

  it('hold every key the core calls', () => {
    const missing = missingKeys(SCAN, DICTS);
    expect(missing, `core keys found only in the closed tree's locales:\n${missing.join('\n')}`).toEqual([]);
  });

  it('hold the literal prefix of every key the core builds from a value', () => {
    const missing = missingPrefixes(SCAN, DICTS, NAMESPACES);
    expect(missing, `core key prefixes found only in the closed tree's locales:\n${missing.join('\n')}`).toEqual([]);
  });
});
