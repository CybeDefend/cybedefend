import {
  getMinFixedSemver,
  getMinFixedAbove,
  getMaxComparableVersion,
  capImportLocations,
  IMPORT_LOCATIONS_BUDGET_BYTES,
  isPyPiEcosystem,
  normalizeEcosystem,
  normalizePyPiPackageName,
} from './sca.utils';

describe('getMinFixedSemver', () => {
  it('returns the semver-lowest version, not the alphabetically-lowest one', () => {
    // Alphabetical MIN would return '1.10.0' < '1.2.3' (wrong).
    // Semver MIN must return '1.2.3'.
    expect(getMinFixedSemver(['1.10.0', '1.2.3', '2.0.0'])).toBe('1.2.3');
  });

  it('handles patch-version ordering correctly', () => {
    // Alphabetical MIN would return '1.0.0' (correct by luck) but also
    // mis-rank '1.0.10' vs '1.0.2'. Confirm the helper holds across the patch axis.
    expect(getMinFixedSemver(['2.0.0', '1.0.0', '1.0.10'])).toBe('1.0.0');
  });

  it('returns null for an empty input array (documents the contract)', () => {
    expect(getMinFixedSemver([])).toBeNull();
  });

  it('treats prereleases as lower than the corresponding stable release', () => {
    expect(getMinFixedSemver(['1.0.0-alpha', '1.0.0'])).toBe('1.0.0-alpha');
  });

  it('drops empty strings before computing the minimum', () => {
    expect(getMinFixedSemver(['', '1.2.3', ''])).toBe('1.2.3');
  });

  it('returns null when no input is a comparable version', () => {
    expect(getMinFixedSemver(['', '', ''])).toBeNull();
  });

  it('coerces non-strict semver inputs (e.g. "1.2") to do the comparison', () => {
    // Many real-world fixed versions come from OSV as "1.2", "v3.0", etc.
    // The helper should still pick the lowest one.
    expect(getMinFixedSemver(['1.2', '1.10', '2.0'])).toBe('1.2');
  });

  it('falls back to the raw string when versions are non-semver and equal', () => {
    // Pure non-semver inputs should not cause throws; the helper should still
    // return *something* deterministic (the lexicographically smallest non-empty input).
    const out = getMinFixedSemver(['abc', 'def']);
    expect(out).not.toBeNull();
  });
});

describe('getMinFixedAbove', () => {
  it('returns the smallest fixed version strictly greater than the installed version', () => {
    // tar 7.5.13 with fixes across branches -> the next real upgrade is 7.5.16,
    // NOT the global min 7.5.3 (which would be a downgrade).
    expect(getMinFixedAbove(['7.5.3', '7.5.16', '7.5.2'], '7.5.13')).toBe(
      '7.5.16',
    );
  });

  it('returns null when every fixed version is <= installed (already patched)', () => {
    expect(getMinFixedAbove(['7.5.3', '7.5.2'], '7.5.13')).toBeNull();
  });

  it('does not treat a numerically-larger patch as lower (no string compare)', () => {
    // "7.5.13" must be > "7.5.3" — a string compare would wrongly pick 7.5.3.
    expect(getMinFixedAbove(['7.5.3'], '7.5.13')).toBeNull();
  });

  it('returns the min fix above when installed is below all fixes', () => {
    expect(getMinFixedAbove(['7.5.16', '7.5.3'], '7.5.1')).toBe('7.5.3');
  });

  it('ignores empty entries and returns null for an empty list', () => {
    expect(getMinFixedAbove(['', ''], '1.0.0')).toBeNull();
    expect(getMinFixedAbove([], '1.0.0')).toBeNull();
  });

  it('returns null when the installed version is not comparable', () => {
    expect(getMinFixedAbove(['1.2.3'], 'not-a-version')).toBeNull();
  });
});

describe('getMaxComparableVersion', () => {
  it('returns the semver-highest version (not lexicographic)', () => {
    expect(getMaxComparableVersion(['7.5.3', '7.5.13', '7.5.2'])).toBe(
      '7.5.13',
    );
  });

  it('ignores empty / non-comparable entries', () => {
    expect(getMaxComparableVersion(['', '1.2.3', 'abc'])).toBe('1.2.3');
  });

  it('returns undefined for an empty or fully non-comparable list', () => {
    expect(getMaxComparableVersion([])).toBeUndefined();
  });
});

describe('capImportLocations', () => {
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

  it('returns an empty array for null/undefined', () => {
    expect(capImportLocations(null)).toEqual([]);
    expect(capImportLocations(undefined)).toEqual([]);
  });

  it('passes a small payload through untouched, content included', () => {
    const locations = [
      { file: 'src/index.ts', line: 3, content: "import x from 'y'" },
      { file: 'src/other.ts', line: 12 },
    ];
    expect(capImportLocations(locations)).toEqual(locations);
  });

  it('drops content first — it is cosmetic, the file/line pairs are not', () => {
    // 400 entries whose content alone blows the budget, but whose file/line
    // pairs fit comfortably. Every location must survive, without content.
    const locations = Array.from({ length: 400 }, (_, i) => ({
      file: `src/module-${i}/index.ts`,
      line: i,
      content: 'x'.repeat(500),
    }));
    expect(bytes(locations)).toBeGreaterThan(IMPORT_LOCATIONS_BUDGET_BYTES);

    const capped = capImportLocations(locations);

    expect(capped).toHaveLength(400);
    expect(capped.every((l) => l.content === undefined)).toBe(true);
    expect(capped[0]).toEqual({ file: 'src/module-0/index.ts', line: 0 });
    expect(bytes(capped)).toBeLessThanOrEqual(IMPORT_LOCATIONS_BUDGET_BYTES);
  });

  it('drops trailing entries when even content-free pairs overflow', () => {
    const locations = Array.from({ length: 20_000 }, (_, i) => ({
      file: `src/very/deeply/nested/path/number/${i}/index.ts`,
      line: i,
    }));

    const capped = capImportLocations(locations);

    expect(capped.length).toBeGreaterThan(0);
    expect(capped.length).toBeLessThan(locations.length);
    expect(bytes(capped)).toBeLessThanOrEqual(IMPORT_LOCATIONS_BUDGET_BYTES);
    // Keeps a prefix, so the first (most relevant) locations survive.
    expect(capped[0]).toEqual(locations[0]);
  });

  it('never returns a payload above the budget, even for one absurd entry', () => {
    const locations = [{ file: 'a'.repeat(200_000), line: 1 }];
    const capped = capImportLocations(locations);
    expect(bytes(capped)).toBeLessThanOrEqual(IMPORT_LOCATIONS_BUDGET_BYTES);
  });

  it('keeps the budget under the MySQL TEXT ceiling', () => {
    // TEXT holds 65535 BYTES. The budget must leave headroom, or the very
    // overflow this helper exists to prevent comes back.
    expect(IMPORT_LOCATIONS_BUDGET_BYTES).toBeLessThan(65_535);
  });

  it('counts bytes, not UTF-16 code units — multi-byte paths must not slip through', () => {
    // Each emoji is 4 UTF-8 bytes but 2 JS "characters": a length-based cap
    // would let this through at roughly half the real byte size.
    const locations = Array.from({ length: 4000 }, (_, i) => ({
      file: `src/${'🙂'.repeat(20)}/${i}.ts`,
      line: i,
    }));
    expect(bytes(capImportLocations(locations))).toBeLessThanOrEqual(
      IMPORT_LOCATIONS_BUDGET_BYTES,
    );
  });
});

describe('normalizeEcosystem', () => {
  it('maps scanner names to the canonical OSV form', () => {
    expect(normalizeEcosystem('pip')).toBe('PyPI');
    expect(normalizeEcosystem('poetry')).toBe('PyPI');
    expect(normalizeEcosystem('yarn')).toBe('npm');
  });

  // The PURL TYPE, not a scanner name: it arrives through `MCP_PACKAGE_TYPES`
  // (`mcp-advisory.service`, MCP servers started by `uvx`). Without an entry in
  // the table it came out as 'pypi' and matched the 'PyPI' column only through
  // the `ai_ci` collation — a match that held by the schema, not the code.
  it('also maps the purl type `pypi` (uvx / MCP_PACKAGE_TYPES)', () => {
    expect(normalizeEcosystem('pypi')).toBe('PyPI');
  });

  it('returns an unknown ecosystem lower-cased, without throwing', () => {
    expect(normalizeEcosystem('Inconnu')).toBe('inconnu');
    expect(normalizeEcosystem('')).toBe('');
  });
});

describe('isPyPiEcosystem', () => {
  it('recognises both forms `normalizeEcosystem` can return', () => {
    expect(isPyPiEcosystem('PyPI')).toBe(true);
    expect(isPyPiEcosystem('pypi')).toBe(true);
  });

  it('recognises nothing else — the PEP 503 folding is PyPI only', () => {
    expect(isPyPiEcosystem('npm')).toBe(false);
    expect(isPyPiEcosystem(undefined)).toBe(false);
    expect(isPyPiEcosystem('')).toBe(false);
  });
});

describe('normalizePyPiPackageName', () => {
  it('folds `_` and `.` into `-` and lower-cases (PEP 503)', () => {
    expect(normalizePyPiPackageName('python_dateutil')).toBe('python-dateutil');
    expect(normalizePyPiPackageName('ruamel.yaml')).toBe('ruamel-yaml');
    expect(normalizePyPiPackageName('Typing_Extensions')).toBe(
      'typing-extensions',
    );
  });

  // The PEP says `[-_.]+` — a RUN, not a character: `a__b` and `a-_-b`
  // name the same package as `a-b`.
  it('folds a RUN of separators into a single dash', () => {
    expect(normalizePyPiPackageName('a__b')).toBe('a-b');
    expect(normalizePyPiPackageName('a-_-b')).toBe('a-b');
  });

  it('leaves an already normalised name intact', () => {
    expect(normalizePyPiPackageName('django')).toBe('django');
    expect(normalizePyPiPackageName('more-itertools')).toBe('more-itertools');
  });
});
