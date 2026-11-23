import {
  FINGERPRINT_VERSION,
  normalizePath,
  normalizeSnippet,
  normalizeOccurrenceLine,
  occurrenceTieBreak,
  assignOccurrenceIndexes,
  codeOccurrenceKey,
  computeCodeFingerprint,
  computeScaFingerprint,
  computeContainerFingerprint,
} from './fingerprint.util';

/**
 * The ASCII unit separator the first cut joined components with, written as an
 * escape. The old code claimed in a comment that this byte "cannot occur in a
 * path, a package name or a UUID" and that a test pinned it down; both claims
 * were false. It is kept here only so the forgery it enabled stays covered.
 */
const US = '\u001f';

describe('codeOccurrenceKey', () => {
  const snippet = [{ line: 9, content: 'eval(x);' }];
  const base = {
    catalogVulnId: 'cat-1',
    path: 'src/a.ts',
    snippetLines: snippet,
    vulnerableStartLine: 9,
    vulnerableEndLine: 9,
  };

  // The whole point of the occurrence index is to disambiguate rows that would
  // otherwise hash identically. It can only do that if its bucket key is built
  // from the SAME components computeCodeFingerprint consumes — the catalogue
  // vuln id and the NORMALISED path, never the raw scanner ruleId or the raw
  // path.
  it('collapses two raw paths that normalizePath makes equal', () => {
    expect(codeOccurrenceKey({ ...base, path: './src/a.ts' })).toBe(
      codeOccurrenceKey(base),
    );
  });

  it('collapses a reindented copy of the same vulnerable region', () => {
    expect(
      codeOccurrenceKey({
        ...base,
        snippetLines: [{ line: 9, content: '\t\teval(x);   ' }],
      }),
    ).toBe(codeOccurrenceKey(base));
  });

  it('separates two different catalogue vulnerabilities', () => {
    expect(codeOccurrenceKey({ ...base, catalogVulnId: 'cat-2' })).not.toBe(
      codeOccurrenceKey(base),
    );
  });

  it('is line-independent: the same code at another line shares one bucket', () => {
    expect(
      codeOccurrenceKey({
        ...base,
        snippetLines: [{ line: 49, content: 'eval(x);' }],
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
      }),
    ).toBe(codeOccurrenceKey(base));
  });

  // The bucket key must be injective for exactly the reason the digest must be:
  // a path may legally contain ANY byte but '/' and NUL, so a fixed separator
  // is not enough. Two findings differing only in where a boundary falls have
  // to land in two buckets, or the counter hands them both index 0 and the two
  // rows that were supposed to be disambiguated get one fingerprint.
  it('is injective when a component contains the old separator byte', () => {
    expect(
      codeOccurrenceKey({
        ...base,
        catalogVulnId: `cat${US}mid`,
        path: 'a.ts',
      }),
    ).not.toBe(
      codeOccurrenceKey({
        ...base,
        catalogVulnId: 'cat',
        path: `mid${US}a.ts`,
      }),
    );
  });

  it('is injective under a plain boundary shift', () => {
    expect(
      codeOccurrenceKey({ ...base, catalogVulnId: 'ab', path: '' }),
    ).not.toBe(codeOccurrenceKey({ ...base, catalogVulnId: 'a', path: 'b' }));
  });
});

describe('normalizePath', () => {
  it('strips a leading ./ and normalises backslashes', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizePath('src\\a.ts')).toBe('src/a.ts');
    expect(normalizePath('/src/a.ts')).toBe('src/a.ts');
  });

  it('is null-safe', () => {
    expect(normalizePath(undefined as unknown as string)).toBe('');
  });

  // Two scanners spelling the same file differently must not produce two
  // fingerprints. The first cut only stripped ONE leading './' with an anchored
  // regex, so an interior './' or any '..' segment survived untouched.
  it('collapses interior ./ and resolves ../ segments', () => {
    expect(normalizePath('././src/a.ts')).toBe('src/a.ts');
    expect(normalizePath('src/./a.ts')).toBe('src/a.ts');
    expect(normalizePath('a/b/../b.ts')).toBe('a/b.ts');
    expect(normalizePath('a//b.ts')).toBe('a/b.ts');
  });

  it('keeps a .. that cannot be resolved rather than inventing a root', () => {
    expect(normalizePath('../a.ts')).toBe('../a.ts');
    expect(normalizePath('a/../../b.ts')).toBe('../b.ts');
  });

  it('is idempotent', () => {
    const cases = [
      '././src/a.ts',
      'src/./a.ts',
      'a/b/../b.ts',
      './src/a.ts',
      '/src/a.ts',
      'src\\a.ts',
      'a//b.ts',
      '../a.ts',
      'a/../../b.ts',
      'src/a.ts/',
      '.',
      '',
    ];
    for (const p of cases) {
      const once = normalizePath(p);
      expect(normalizePath(once)).toBe(once);
    }
  });
});

describe('normalizeSnippet', () => {
  const lines = [
    { line: 8, content: '  // context above' },
    { line: 9, content: '  const q = "SELECT " + input;' },
    { line: 10, content: '      db.run(q);' },
    { line: 11, content: '  // context below' },
  ];

  it('keeps only the vulnerable region and collapses whitespace', () => {
    expect(normalizeSnippet(lines, 9, 10)).toBe(
      'const q = "SELECT " + input;\ndb.run(q);',
    );
  });

  it('is stable under reindentation', () => {
    const reindented = lines.map((l) => ({
      ...l,
      content: '\t\t' + l.content.trim(),
    }));
    expect(normalizeSnippet(reindented, 9, 10)).toBe(
      normalizeSnippet(lines, 9, 10),
    );
  });

  it('returns an empty string when the scanner sent no snippet', () => {
    expect(normalizeSnippet([], 9, 10)).toBe('');
  });

  // This runs on the ingestion hot path for every finding of every scan: a
  // malformed snippet must degrade to "no vulnerable region", never throw and
  // kill the whole batch.
  it('does not throw when the snippet is not an array', () => {
    expect(normalizeSnippet('exec(x)' as unknown as never, 9, 10)).toBe('');
    expect(normalizeSnippet(null as unknown as never, 9, 10)).toBe('');
  });

  it('ignores a null entry inside the snippet array', () => {
    expect(
      normalizeSnippet(
        [null as unknown as never, { line: 9, content: 'eval(x);' }],
        9,
        9,
      ),
    ).toBe('eval(x);');
  });
});

describe('occurrenceTieBreak', () => {
  /**
   * The failure mode this must detect is a RAW JOIN — `parts.join(SEP)` for any
   * single SEP — because that is the shape a caller reaches for by reflex.
   *
   * The previous test here compared (12, '3java') with (123, 'java') and was
   * VACUOUS: it rules out `join('')` and nothing else. `${a} ${b}` gives
   * '12 3java' and '123 java', which differ, so the test passed for the very
   * variant it was named after. A two-component join whose FIRST component is a
   * line number genuinely is injective — a decimal integer cannot contain a
   * space, so the first separator is the boundary. That argument is a property
   * of today's component LIST, not of the encoding: it dies the moment a caller
   * adds a third component or passes a component that can contain the
   * separator, and nothing in the signature stops either.
   *
   * So the case below is the one a raw join actually loses: both spellings
   * collapse onto 'a b c'. The length prefix makes injectivity unconditional —
   * true for any component values, any arity, no side conditions to re-audit.
   */
  it('cannot be forged by shifting a boundary, whatever separator a raw join would use', () => {
    expect(occurrenceTieBreak(['a b', 'c'])).not.toBe(
      occurrenceTieBreak(['a', 'b c']),
    );
    expect(occurrenceTieBreak(['a|b', 'c'])).not.toBe(
      occurrenceTieBreak(['a', 'b|c']),
    );
    expect(occurrenceTieBreak(['a', 'b', 'c'])).not.toBe(
      occurrenceTieBreak(['a b c']),
    );
  });

  // Kept from the first cut, correctly labelled this time: it rules out
  // `join('')` and only that.
  it('cannot be forged by a bare concatenation', () => {
    expect(occurrenceTieBreak([12, '3java'])).not.toBe(
      occurrenceTieBreak([123, 'java']),
    );
  });

  it('treats null, undefined and the empty string alike', () => {
    expect(occurrenceTieBreak([null, undefined])).toBe(
      occurrenceTieBreak(['', '']),
    );
  });

  it('keeps a 0 distinct from an empty component', () => {
    expect(occurrenceTieBreak([0])).not.toBe(occurrenceTieBreak(['']));
  });
});

describe('normalizeOccurrenceLine', () => {
  it('passes a finite line through, string or number', () => {
    expect(normalizeOccurrenceLine(10)).toBe(10);
    expect(normalizeOccurrenceLine('10')).toBe(10);
  });

  // NOT 0. `Number(x) || 0` is what ScanQueueService.allocateOccurrenceIndexes
  // used to do, which sorted a garbage line FIRST while this file sorted it
  // LAST — so a finding's identity depended on whether Redis answered, which is
  // precisely what the allocator's doc-comment promises it does not.
  it('sends a non-finite line to +Infinity so it sorts LAST', () => {
    expect(normalizeOccurrenceLine(NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(normalizeOccurrenceLine('not-a-line')).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(normalizeOccurrenceLine(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is idempotent, so a caller may normalise before handing the value on', () => {
    expect(normalizeOccurrenceLine(normalizeOccurrenceLine(NaN))).toBe(
      normalizeOccurrenceLine(NaN),
    );
  });
});

describe('assignOccurrenceIndexes', () => {
  it('numbers duplicates by ascending line, others at 0', () => {
    const items = [
      { k: 'a', line: 30 },
      { k: 'a', line: 10 },
      { k: 'b', line: 20 },
    ];
    expect(
      assignOccurrenceIndexes(
        items,
        (i) => i.k,
        (i) => i.line,
      ),
    ).toEqual([1, 0, 0]);
  });

  // Without a tie-break the rank of two same-line findings is their position in
  // the scanner's output. The index is hashed, so the two findings SWAP
  // fingerprints between scans and every per-fingerprint state — dismissal,
  // status, first-seen — follows the wrong finding. scan-queue.service.ts
  // documents that same-line pairs are routine for secret and cicd.
  it('does not depend on scanner output order when a tie-break is supplied', () => {
    const FIRST = { k: 'a', line: 10, tie: 'A' };
    const SECOND = { k: 'a', line: 10, tie: 'B' };

    expect(
      assignOccurrenceIndexes(
        [FIRST, SECOND],
        (i) => i.k,
        (i) => i.line,
        (i) => i.tie,
      ),
    ).toEqual([0, 1]);

    // Same two findings, opposite scanner order: FIRST must still rank 0.
    expect(
      assignOccurrenceIndexes(
        [SECOND, FIRST],
        (i) => i.k,
        (i) => i.line,
        (i) => i.tie,
      ),
    ).toEqual([1, 0]);
  });

  it('still falls back to array order when every supplied property is equal', () => {
    const twin = { k: 'a', line: 10, tie: 'A' };
    expect(
      assignOccurrenceIndexes(
        [{ ...twin }, { ...twin }],
        (i) => i.k,
        (i) => i.line,
        (i) => i.tie,
      ),
    ).toEqual([0, 1]);
  });

  // A NaN line makes `a.line - b.line` evaluate to NaN, which makes the
  // comparator intransitive: the permutation is then whatever V8's sort happens
  // to produce for that array length.
  it('is deterministic when a line is not a finite number', () => {
    const items = [
      { k: 'a', line: NaN, tie: 'B' },
      { k: 'a', line: 10, tie: 'A' },
      { k: 'a', line: NaN, tie: 'A' },
    ];
    expect(
      assignOccurrenceIndexes(
        items,
        (i) => i.k,
        (i) => i.line,
        (i) => i.tie,
      ),
    ).toEqual([2, 0, 1]);

    // Reordered input, same ranks per item: [items[2], items[1], items[0]]
    // -> tie 'A'/Inf ranks 1, line 10 ranks 0, tie 'B'/Inf ranks 2.
    expect(
      assignOccurrenceIndexes(
        [items[2], items[1], items[0]],
        (i) => i.k,
        (i) => i.line,
        (i) => i.tie,
      ),
    ).toEqual([1, 0, 2]);
  });
});

describe('computeCodeFingerprint', () => {
  const base = {
    projectId: 'p1',
    branch: 'main',
    scannerType: 'semgrep',
    catalogVulnId: 'cat-uuid-1',
    path: 'src/a.ts',
    snippetLines: [{ line: 9, content: 'eval(x);' }],
    vulnerableStartLine: 9,
    vulnerableEndLine: 9,
    occurrenceIndex: 0,
  };

  it('is a 64-char lowercase hex digest', () => {
    expect(computeCodeFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeCodeFingerprint(base)).toBe(
      computeCodeFingerprint({ ...base }),
    );
  });

  it('ignores the line number — the finding moved down 40 lines', () => {
    const moved = {
      ...base,
      snippetLines: [{ line: 49, content: 'eval(x);' }],
      vulnerableStartLine: 49,
      vulnerableEndLine: 49,
    };
    expect(computeCodeFingerprint(moved)).toBe(computeCodeFingerprint(base));
  });

  it('ignores a scanner-side rule rename (catalogue id is what is hashed)', () => {
    // Two scans, same catalogVulnId, different raw ruleId -> not an input at all.
    expect(computeCodeFingerprint(base)).toBe(
      computeCodeFingerprint({ ...base, catalogVulnId: 'cat-uuid-1' }),
    );
  });

  it('changes when the vulnerable code itself changes', () => {
    expect(
      computeCodeFingerprint({
        ...base,
        snippetLines: [{ line: 9, content: 'eval(y);' }],
      }),
    ).not.toBe(computeCodeFingerprint(base));
  });

  it('changes when the file moves (documented limitation)', () => {
    expect(computeCodeFingerprint({ ...base, path: 'src/b.ts' })).not.toBe(
      computeCodeFingerprint(base),
    );
  });

  it('separates two identical occurrences in one file', () => {
    expect(computeCodeFingerprint({ ...base, occurrenceIndex: 1 })).not.toBe(
      computeCodeFingerprint(base),
    );
  });

  it('separates branches and projects', () => {
    expect(computeCodeFingerprint({ ...base, branch: 'dev' })).not.toBe(
      computeCodeFingerprint(base),
    );
    expect(computeCodeFingerprint({ ...base, projectId: 'p2' })).not.toBe(
      computeCodeFingerprint(base),
    );
  });

  it('treats a null branch as the empty string', () => {
    expect(computeCodeFingerprint({ ...base, branch: null })).toBe(
      computeCodeFingerprint({ ...base, branch: '' }),
    );
  });

  // Occurrence index 0 must stringify to '0', never to '' — `?? ` not `||`.
  it('does not confuse occurrence index 0 with a missing index', () => {
    expect(computeCodeFingerprint(base)).not.toBe(
      computeCodeFingerprint({
        ...base,
        occurrenceIndex: undefined as unknown as number,
      }),
    );
  });
});

/**
 * A fixed-arity separator join is injective ONLY if no component can contain
 * the separator. The shipped 'v1' cut asserted that property in a comment; it
 * is false for a POSIX path (any byte but '/' and NUL is legal) and for a
 * scanner-parsed manifest string, and the forgery below was demonstrated
 * against the shipped module.
 *
 * The replacement length-prefixes every component, so no byte is forbidden and
 * no boundary between two adjacent components can shift.
 */
describe('digest injectivity', () => {
  const sca = {
    projectId: 'p1',
    branch: 'main',
    ecosystem: 'npm',
    osvId: 'GHSA-x',
  };

  it('is injective when a component contains the old separator byte', () => {
    expect(
      computeScaFingerprint({
        ...sca,
        packageName: `left${US}mid`,
        packageVersion: 'right',
      }),
    ).not.toBe(
      computeScaFingerprint({
        ...sca,
        packageName: 'left',
        packageVersion: `mid${US}right`,
      }),
    );
  });

  it('is injective under a plain boundary shift', () => {
    expect(
      computeScaFingerprint({ ...sca, packageName: 'ab', packageVersion: '' }),
    ).not.toBe(
      computeScaFingerprint({ ...sca, packageName: 'a', packageVersion: 'b' }),
    );
  });

  it('is injective for the code family', () => {
    const code = {
      projectId: 'p1',
      branch: 'main',
      scannerType: 'semgrep',
      snippetLines: [{ line: 9, content: 'eval(x);' }],
      vulnerableStartLine: 9,
      vulnerableEndLine: 9,
      occurrenceIndex: 0,
    };
    expect(
      computeCodeFingerprint({
        ...code,
        catalogVulnId: `x${US}mid`,
        path: 'a.ts',
      }),
    ).not.toBe(
      computeCodeFingerprint({
        ...code,
        catalogVulnId: 'x',
        path: `mid${US}a.ts`,
      }),
    );
  });

  it('is injective for the container family', () => {
    const c = {
      projectId: 'p1',
      branch: 'main',
      target: 'app/package-lock.json',
      class: 'lang-pkgs',
      arch: null,
      vulnerabilityIdentifier: 'CVE-2021-1234',
    };
    expect(
      computeContainerFingerprint({
        ...c,
        packageName: `a${US}mid`,
        packageVersion: 'b',
      }),
    ).not.toBe(
      computeContainerFingerprint({
        ...c,
        packageName: 'a',
        packageVersion: `mid${US}b`,
      }),
    );
  });
});

describe('computeScaFingerprint', () => {
  const base = {
    projectId: 'p1',
    branch: 'main',
    ecosystem: 'npm',
    packageName: 'lodash',
    packageVersion: '4.17.20',
    osvId: 'GHSA-xxxx',
  };

  it('is deterministic and 64 hex chars', () => {
    expect(computeScaFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeScaFingerprint(base)).toBe(
      computeScaFingerprint({ ...base }),
    );
  });

  it('treats a version bump as a new finding', () => {
    expect(
      computeScaFingerprint({ ...base, packageVersion: '4.17.21' }),
    ).not.toBe(computeScaFingerprint(base));
  });

  it('separates two advisories on the same package', () => {
    expect(computeScaFingerprint({ ...base, osvId: 'GHSA-yyyy' })).not.toBe(
      computeScaFingerprint(base),
    );
  });
});

describe('computeContainerFingerprint', () => {
  const base = {
    projectId: 'p1',
    branch: 'main',
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    target: 'registry/app:1.2.3 (debian 12.5)',
    class: 'os-pkgs',
    arch: 'x86_64',
    vulnerabilityIdentifier: 'CVE-2021-1234',
  };

  it('is deterministic and 64 hex chars', () => {
    expect(computeContainerFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContainerFingerprint({ ...base })).toBe(
      computeContainerFingerprint(base),
    );
  });

  /**
   * Two images in one project must produce different fingerprints, never
   * collapse onto one finding. The digest honours that through the components that
   * distinguish the two ROWS — for OS packages Trivy's `target` embeds the
   * image reference, so two images give two package rows and two detection
   * rows.
   *
   * The image NAME is not an input; see the ContainerFingerprintInput JSDoc for
   * why (the package and detection rows are not keyed on it, so hashing it
   * makes a shared row's digest depend on which scan last touched it). The
   * service-level proof that this produces no false FINGERPRINT_MISMATCH is in
   * container.fingerprint.spec.ts.
   */
  it('separates two images through the Trivy target that carries them', () => {
    expect(
      computeContainerFingerprint({
        ...base,
        target: 'registry/other:1.2.3 (debian 12.5)',
      }),
    ).not.toBe(computeContainerFingerprint(base));
  });

  // The OTHER half of that requirement — two images sharing a lang-pkgs target
  // collapse onto one finding — is not observable at this level: the input type
  // has no image field, so the two calls would be one call and the test would
  // assert determinism while claiming to assert a gap. It is pinned where it is
  // real, against the ingestion path, in container.fingerprint.spec.ts ("never
  // mismatches when two images share one detection row (and they share ONE
  // finding)").

  it('separates two package rows that differ only by target', () => {
    expect(
      computeContainerFingerprint({ ...base, target: 'app/package-lock.json' }),
    ).not.toBe(computeContainerFingerprint(base));
  });

  it('separates two package rows that differ only by class', () => {
    expect(
      computeContainerFingerprint({ ...base, class: 'lang-pkgs' }),
    ).not.toBe(computeContainerFingerprint(base));
  });

  it('separates two package rows that differ only by arch', () => {
    expect(computeContainerFingerprint({ ...base, arch: 'aarch64' })).not.toBe(
      computeContainerFingerprint(base),
    );
  });

  it('treats a missing arch as the empty component (null and undefined agree)', () => {
    expect(computeContainerFingerprint({ ...base, arch: null })).toBe(
      computeContainerFingerprint({ ...base, arch: undefined }),
    );
  });
});

/**
 * GOLDEN VECTORS — absolute, not relational.
 *
 * Every other assertion in this file compares one call to another call, so a
 * refactor that silently changes the component order, the 'v1' prefix, a family
 * literal or the encoding ships GREEN while orphaning every stored fingerprint.
 * These pin the wire format itself.
 *
 * CHANGING ANY OF THESE MEANS EVERY STORED FINGERPRINT IS ORPHANED; THAT IS A
 * MIGRATION, NOT A REFACTOR. If one fails, do not update the literal — find out
 * what changed the digest and decide, deliberately, whether the whole corpus is
 * being rewritten.
 */
describe('golden vectors', () => {
  it('pins the version prefix', () => {
    expect(FINGERPRINT_VERSION).toBe('v1');
  });

  it('pins the code-family digest', () => {
    expect(
      computeCodeFingerprint({
        projectId: '11111111-1111-1111-1111-111111111111',
        branch: 'main',
        scannerType: 'opengrep',
        catalogVulnId: '22222222-2222-2222-2222-222222222222',
        path: 'src/app/handler.ts',
        snippetLines: [{ line: 9, content: '  eval(req.query.q);' }],
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        occurrenceIndex: 0,
      }),
    ).toBe('836285d1146677af5fc87eed15fed9cabd13e19fd8378c9bc3083a546e6b9955');
  });

  it('pins the sca-family digest', () => {
    expect(
      computeScaFingerprint({
        projectId: '11111111-1111-1111-1111-111111111111',
        branch: 'main',
        ecosystem: 'npm',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        osvId: 'GHSA-35jh-r3h4-6jhm',
      }),
    ).toBe('380bce44b2ebee56608712c5934ab47da0bed0f5bfef8c30761803e5b1798b54');
  });

  it('pins the container-family digest', () => {
    expect(
      computeContainerFingerprint({
        projectId: '11111111-1111-1111-1111-111111111111',
        branch: 'main',
        packageName: 'openssl',
        packageVersion: '1.1.1k',
        target: 'registry.example.com/app:1.2.3 (debian 12.5)',
        class: 'os-pkgs',
        arch: 'x86_64',
        vulnerabilityIdentifier: 'CVE-2021-3711',
      }),
    ).toBe('93a2af7be30f8f9d78927ccfe7d0634fc7ed0eebb82782b3f163c7db19e2aae7');
  });
});
