import { InlineIgnoreDirective } from '@grpc/analysis-reporting/result';
import {
  InlineIgnoreRule,
  inlineIgnoreNeedsCatalogRule,
  isNeutralizedByInlineIgnore,
  normalizeRuleCode,
} from './inline-ignore';

const bare = (line = 10): InlineIgnoreDirective => ({
  codes: [],
  allRules: true,
  reason: 'false positive',
  line,
});

const scoped = (codes: string[], line = 10): InlineIgnoreDirective => ({
  codes,
  allRules: false,
  reason: 'accepted risk',
  line,
});

/**
 * A `cybedefend-ignore[...]` directive names catalogue codes
 * `CD-<TYPE>-<NNNN>`; scanner rule ids are no longer honoured.
 */
describe('normalizeRuleCode', () => {
  it.each([
    ['CD-IAC-0123', 'CD-IAC-0123'],
    ['CD-SAST-0001', 'CD-SAST-0001'],
    ['CD-CICD-0042', 'CD-CICD-0042'],
    ['CD-SECRET-0007', 'CD-SECRET-0007'],
    // the number is zero-padded to 4 digits and may grow (local range)
    ['CD-IAC-90001', 'CD-IAC-90001'],
    // matching is case-insensitive and tolerant of surrounding whitespace
    ['cd-iac-0123', 'CD-IAC-0123'],
    ['  Cd-Iac-0123\t', 'CD-IAC-0123'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normalizeRuleCode(raw)).toBe(expected);
  });

  it.each([
    ['fewer than 4 digits', 'CD-IAC-123'],
    ['no type', 'CD--0123'],
    ['a digit in the type', 'CD-I4C-0123'],
    ['trailing text', 'CD-IAC-0123x'],
    ['leading text', 'xCD-IAC-0123'],
    ['two codes in one token', 'CD-IAC-0123 CD-IAC-0124'],
    ['another prefix', 'XD-IAC-0123'],
    ['a Checkov id', 'CKV_AWS_20'],
    ['a Checkov BC id', 'BC_GCP_GCS_3'],
    ['a KICS query id', 'a227ec01-f97a-4084-91a4-47b350c1db54'],
    ['a dotted Opengrep id', 'python.lang.security.audit.eval-detected'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    // `'ı'.toUpperCase()` is `'I'`: upper-casing before the check would turn
    // this look-alike into CD-IAC-0123. A code is ASCII.
    ['a non-ASCII look-alike', 'cd-ıac-0123'],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeRuleCode(raw)).toBeNull();
  });

  it('rejects null, undefined and non-string values', () => {
    expect(normalizeRuleCode(null)).toBeNull();
    expect(normalizeRuleCode(undefined)).toBeNull();
    expect(normalizeRuleCode(123 as unknown as string)).toBeNull();
  });

  it('accepts a 64-character code and rejects a longer one', () => {
    const at64 = `CD-IAC-${'1'.repeat(57)}`;
    const at65 = `CD-IAC-${'1'.repeat(58)}`;
    expect(at64).toHaveLength(64);
    expect(normalizeRuleCode(at64)).toBe(at64);
    expect(normalizeRuleCode(at65)).toBeNull();
  });
});

describe('isNeutralizedByInlineIgnore', () => {
  const RULE = 'CD-IAC-0123';

  /** A kics issue resolved to an IaC catalogue rule carrying `code`. */
  const decide = (
    directives: InlineIgnoreDirective[] | null | undefined,
    code: string | null,
  ) => isNeutralizedByInlineIgnore(directives, { code });

  it.each<[string, InlineIgnoreDirective[], string | null]>([
    ['the bare form', [bare()], RULE],
    ['the bare form, rule without a catalogue code', [bare()], null],
    ['a scoped directive listing the code', [scoped([RULE])], RULE],
    [
      'a scoped directive, case and whitespace aside',
      [scoped([' cd-iac-0123 '])],
      RULE,
    ],
    [
      'a scoped directive, rule code in another case',
      [scoped([RULE])],
      'cd-iac-0123',
    ],
    [
      'one of several listed codes',
      [scoped(['CD-SAST-0001', RULE, 'CD-SECRET-0002'])],
      RULE,
    ],
    [
      'the directive on the line above (second entry)',
      [scoped(['CD-IAC-0001'], 10), scoped([RULE], 9)],
      RULE,
    ],
    [
      'a bare directive next to a scoped one for another rule',
      [scoped(['CD-IAC-0001'], 10), bare(9)],
      RULE,
    ],
  ])('neutralises on %s', (_label, directives, ruleCode) => {
    expect(decide(directives, ruleCode)).toBe(true);
  });

  it.each<[string, InlineIgnoreDirective[] | null | undefined, string | null]>([
    ['no directive (undefined)', undefined, RULE],
    ['no directive (null)', null, RULE],
    ['no directive (empty list)', [], RULE],
    ['a scoped directive for another code', [scoped(['CD-IAC-0124'])], RULE],
    [
      'a scoped directive for the same number in another type',
      [scoped(['CD-SAST-0123'])],
      RULE,
    ],
    // Scanner ids are no longer honoured, even for the rule they identify.
    ['a Checkov id', [scoped(['CKV_AWS_20'])], RULE],
    ['a Checkov BC id', [scoped(['BC_GCP_GCS_3'])], RULE],
    [
      'a KICS query id',
      [scoped(['a227ec01-f97a-4084-91a4-47b350c1db54'])],
      RULE,
    ],
    [
      'a dotted Opengrep id',
      [scoped(['python.lang.security.audit.eval-detected'])],
      RULE,
    ],
    // Only the bare form covers a rule the catalogue has no code for.
    [
      'a scoped directive, rule without a catalogue code',
      [scoped([RULE])],
      null,
    ],
    ['a directive listing nothing', [scoped([])], RULE],
  ])('keeps the issue on %s', (_label, directives, ruleCode) => {
    expect(decide(directives, ruleCode)).toBe(false);
  });

  it('never matches two equal strings that are not codes', () => {
    expect(decide([scoped(['CKV_AWS_20'])], 'CKV_AWS_20')).toBe(false);
    expect(decide([scoped([''])], '')).toBe(false);
  });

  it('tolerates a directive whose codes are missing (malformed payload)', () => {
    const malformed = {
      allRules: false,
      reason: '',
      line: 3,
    } as unknown as InlineIgnoreDirective;
    expect(decide([malformed], RULE)).toBe(false);
  });

  // An issue whose rule id has no correspondance row keeps the semantics it
  // had: the bare form covers it, a listed code cannot match it.
  describe('an unmapped issue', () => {
    it.each<[string, InlineIgnoreRule | null | undefined]>([
      ['no resolution (null)', null],
      ['no resolution (undefined)', undefined],
    ])('is neutralised by the bare form: %s', (_label, rule) => {
      expect(isNeutralizedByInlineIgnore([bare()], rule)).toBe(true);
    });

    it('is kept under a scoped directive', () => {
      expect(isNeutralizedByInlineIgnore([scoped([RULE])], null)).toBe(false);
    });
  });

  /**
   * A secret finding follows the same rules as any other: the bare form
   * covers it, a scoped directive covers it when it lists its catalogue code
   * `CD-SECRET-…`, and a scanner rule id matches nothing.
   */
  describe('a secret finding', () => {
    const SECRET = 'CD-SECRET-0007';
    /** The catalogue rule as `resolveCatalogRules` gives it, type included. */
    const catalogueRule = (code: string | null, vulnerabilityType: string) => ({
      code,
      vulnerabilityType,
    });
    const gitleaksRule = catalogueRule(SECRET, 'secret');

    it.each<[string, InlineIgnoreDirective[]]>([
      ['the bare form', [bare()]],
      ['its CD-SECRET code', [scoped([SECRET])]],
      [
        'its CD-SECRET code, case and whitespace aside',
        [scoped([' cd-secret-0007 '])],
      ],
      [
        'its code among others, on the line above',
        [scoped(['CD-SAST-0001'], 10), scoped(['CD-IAC-0001', SECRET], 9)],
      ],
    ])('of gitleaks is neutralised by %s', (_label, directives) => {
      expect(isNeutralizedByInlineIgnore(directives, gitleaksRule)).toBe(true);
    });

    it.each<[string, InlineIgnoreDirective[]]>([
      ['another CD-SECRET code', [scoped(['CD-SECRET-0008'])]],
      ['the same number in another type', [scoped(['CD-SAST-0007'])]],
      ['the gitleaks rule id', [scoped(['aws-access-token'])]],
      ['the prefixed gitleaks rule id', [scoped(['gitleaks-generic-api-key'])]],
      ['a generic gitleaks rule id', [scoped(['generic-api-key'])]],
      ['a directive listing nothing', [scoped([])]],
    ])('of gitleaks is kept under %s', (_label, directives) => {
      expect(isNeutralizedByInlineIgnore(directives, gitleaksRule)).toBe(false);
    });

    // Some Gitleaks rules have no catalogue code: only the bare form covers
    // them, whether the correspondance row carries no code or is absent.
    it.each<[string, InlineIgnoreRule | null]>([
      ['a row without a code', catalogueRule(null, 'secret')],
      ['no correspondance row', null],
    ])('of a gitleaks rule with %s', (_label, rule) => {
      expect(isNeutralizedByInlineIgnore([bare()], rule)).toBe(true);
      expect(
        isNeutralizedByInlineIgnore(
          [scoped([SECRET, 'generic-api-key'])],
          rule,
        ),
      ).toBe(false);
    });

    it('of a gitleaks rule resolved to a code is never matched by the rule id', () => {
      expect(
        isNeutralizedByInlineIgnore(
          [scoped(['generic-api-key'])],
          catalogueRule('generic-api-key', 'secret'),
        ),
      ).toBe(false);
    });

    // Some SAST and IaC rules detect hard-coded credentials and are raised as
    // secrets (`correspondance_table.vulnerabilityType`).
    it.each<[string, InlineIgnoreDirective[], boolean]>([
      ['the bare form', [bare()], true],
      ['its CD-SECRET code', [scoped(['CD-SECRET-0042'])], true],
      ['another code', [scoped(['CD-SECRET-0007'])], false],
      ['its scanner rule id', [scoped(['hardcoded-aws-key'])], false],
    ])(
      'of an opengrep rule raised as a secret, under %s → %s',
      (_label, directives, expected) => {
        expect(
          isNeutralizedByInlineIgnore(
            directives,
            catalogueRule('CD-SECRET-0042', 'Secret'),
          ),
        ).toBe(expected);
      },
    );
  });
});

/**
 * When the catalogue cannot be read, ingestion may only go on for the issues
 * whose decision does not depend on the rule they resolve to. Only a listed
 * code needs it: the bare form covers every rule of its line, secrets
 * included, whatever the resolution.
 */
describe('inlineIgnoreNeedsCatalogRule', () => {
  const cases: Array<[string, InlineIgnoreDirective[] | undefined, boolean]> = [
    ['no directive', undefined, false],
    ['an empty list', [], false],
    // Neutralises every rule of the line: no resolution can change that.
    ['the bare form', [bare()], false],
    [
      'the bare form next to a scoped directive',
      [scoped(['CD-IAC-0123'], 10), bare(9)],
      false,
    ],
    ['scanner ids only', [scoped(['CKV_AWS_20', 'BC_GCP_GCS_3'])], false],
    ['a directive listing nothing', [scoped([])], false],
    ['a scoped directive listing a code', [scoped(['cd-iac-0123'])], true],
    [
      'a code next to a scanner id',
      [scoped(['CKV_AWS_20']), scoped(['CD-SAST-0001'], 9)],
      true,
    ],
  ];

  it.each(
    cases.map(
      ([label, directives, needs]): [
        string,
        boolean,
        InlineIgnoreDirective[] | undefined,
      ] => [label, needs, directives],
    ),
  )('%s → %s', (_label, expected, directives) => {
    expect(inlineIgnoreNeedsCatalogRule(directives)).toBe(expected);
  });

  // The secret scanner is decided like any other: its rule's code decides
  // whether a listed `CD-SECRET-…` code covers it.
  it('a scoped CD-SECRET code → true', () => {
    expect(inlineIgnoreNeedsCatalogRule([scoped(['CD-SECRET-0007'])])).toBe(
      true,
    );
  });

  it('whenever it answers false, the decision is the same whatever the resolution', () => {
    const resolutions: Array<InlineIgnoreRule | null> = [
      null,
      { code: null },
      { code: 'CD-IAC-0123' },
      { code: 'CD-SAST-0001' },
      { code: 'CD-SECRET-0007' },
    ];
    for (const [label, directives] of cases) {
      if (inlineIgnoreNeedsCatalogRule(directives)) continue;
      const decisions = resolutions.map((rule) =>
        isNeutralizedByInlineIgnore(directives, rule),
      );
      expect({ label, same: new Set(decisions).size === 1 }).toEqual({
        label,
        same: true,
      });
    }
  });
});
