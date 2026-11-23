import {
  clampMcpPageSize,
  toSlimBaseFamilyItem,
  toSlimScaItem,
  toSlimContainerItem,
  truncateText,
  toSlimBaseFamilyDetail,
  toSlimScaDetail,
  toSlimContainerDetail,
  MCP_LIST_DEFAULT_PAGE_SIZE,
  MCP_LIST_MAX_PAGE_SIZE,
  MCP_DETAIL_TEXT_MAX,
  MCP_DETAIL_SNIPPET_MAX,
  MCP_DETAIL_DATAFLOW_MAX_STEPS,
  MCP_DETAIL_REFERENCES_MAX,
  MCP_DETAIL_DEPENDENCY_PATH_MAX,
} from './mcp-result.mapper';

describe('mcp-result.mapper', () => {
  // The whole point of the MCP surface is bounding response size; pin the cap VALUES by
  // literal so an accidental loosening (e.g. SNIPPET_MAX -> 99999) fails here
  // instead of silently shipping bloated payloads.
  describe('slim caps (literal values)', () => {
    it('pins every cap to its intended literal', () => {
      expect(MCP_LIST_DEFAULT_PAGE_SIZE).toBe(20);
      expect(MCP_LIST_MAX_PAGE_SIZE).toBe(50);
      expect(MCP_DETAIL_TEXT_MAX).toBe(800);
      expect(MCP_DETAIL_SNIPPET_MAX).toBe(1200);
      expect(MCP_DETAIL_DATAFLOW_MAX_STEPS).toBe(12);
      expect(MCP_DETAIL_REFERENCES_MAX).toBe(10);
      expect(MCP_DETAIL_DEPENDENCY_PATH_MAX).toBe(8);
    });
  });
  describe('clampMcpPageSize', () => {
    it('defaults falsy / out-of-range requests to the default page size', () => {
      expect(clampMcpPageSize(undefined)).toBe(MCP_LIST_DEFAULT_PAGE_SIZE);
      expect(clampMcpPageSize(0)).toBe(MCP_LIST_DEFAULT_PAGE_SIZE);
      expect(clampMcpPageSize(-5)).toBe(MCP_LIST_DEFAULT_PAGE_SIZE);
    });

    it('passes through a value within range', () => {
      expect(clampMcpPageSize(10)).toBe(10);
      expect(clampMcpPageSize(MCP_LIST_MAX_PAGE_SIZE)).toBe(
        MCP_LIST_MAX_PAGE_SIZE,
      );
    });

    it('caps an over-large request at the hard max', () => {
      expect(clampMcpPageSize(1000)).toBe(MCP_LIST_MAX_PAGE_SIZE);
    });
  });

  describe('toSlimBaseFamilyItem', () => {
    const base = {
      id: 'b1',
      projectId: 'p1',
      createdAt: '2026-06-03T08:57:17.000Z',
      updateAt: '2026-06-03T08:57:17.000Z',
      timeToFix: '',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentPriority: 'urgent',
      contextualExplanation:
        'A LONG per-finding explanation that bloats output',
      language: 'YAML',
      path: 'docker-compose.yml',
      vulnerableStartLine: 69,
      vulnerableEndLine: 69,
      vulnerability: {
        id: 'v1',
        name: 'Writable Root Filesystem',
        shortDescription: 'root fs is writable',
        description: 'A VERY LONG markdown description',
        howToPrevent: 'A VERY LONG remediation',
        cwe: ['CWE-732'],
        owaspTop10: ['A05:2021'],
        codeExamples: [{ filename: 'a', content: 'BIG CODE BLOCK' }],
        references: [],
        code: 'CD-IAC-0123',
      },
      historyItems: { items: [{ user: { id: 'u1', name: 'someone' } }] },
      codeSnippets: [{ code: [{ line: 1, content: 'secret = 1' }] }],
      autofixRecords: [{ diff: 'A HUGE UNIFIED DIFF', prBody: 'long pr body' }],
      hasCybeAnalysis: false,
      hasCybeAutofix: true,
      priorityScore: 67.9,
      exploitabilityVerdict: 'theoretical',
      exploitabilityReason: 'LONG llm reasoning markdown',
      exploitabilityScoreReason: 'LONG llm score reasoning',
      cvssExplanation: {
        base: { baseScore: 6.9 },
        environmental: { drivers: [] },
      },
    } as never;

    it('keeps only the allow-listed slim fields', () => {
      expect(toSlimBaseFamilyItem(base, 'sast')).toEqual({
        id: 'b1',
        scanner: 'sast',
        title: 'Writable Root Filesystem',
        shortDescription: 'root fs is writable',
        severity: 'high',
        priority: 'urgent',
        state: 'to_verify',
        priorityScore: 67.9,
        exploitabilityVerdict: 'theoretical',
        cwe: ['CWE-732'],
        language: 'YAML',
        hasAutofix: true,
        hasCybeAnalysis: false,
        path: 'docker-compose.yml',
        startLine: 69,
        endLine: 69,
        ruleCode: 'CD-IAC-0123',
      });
    });

    // `ruleCode` is the only id a `cybedefend-ignore[...]` directive
    // accepts. A catalogue row without one must not leak an empty `ruleCode`
    // an agent would paste between the brackets.
    it.each([
      ['no code', undefined],
      ['an empty code', ''],
    ])(
      'omits ruleCode from the JSON when the catalogue row has %s',
      (_label, code) => {
        const withoutCode = {
          ...(base as Record<string, unknown>),
          vulnerability: {
            ...((base as Record<string, unknown>).vulnerability as object),
            code,
          },
        } as never;
        const json = JSON.parse(
          JSON.stringify(toSlimBaseFamilyItem(withoutCode, 'iac')),
        );
        expect(json).not.toHaveProperty('ruleCode');
      },
    );

    it.each(['sast', 'iac', 'cicd'])(
      'carries the ruleCode of a %s finding',
      (family) => {
        expect(toSlimBaseFamilyItem(base, family)).toHaveProperty(
          'ruleCode',
          'CD-IAC-0123',
        );
      },
    );

    // A `cybedefend-ignore[CD-SECRET-…]` directive silences a secret finding
    // too, so its code is handed out like any other.
    it.each(['secret', 'SECRET'])(
      'carries the ruleCode of a secret finding (%s)',
      (family) => {
        const secret = {
          ...(base as Record<string, unknown>),
          vulnerability: {
            ...((base as Record<string, unknown>).vulnerability as object),
            code: 'CD-SECRET-0007',
          },
        } as never;
        expect(toSlimBaseFamilyItem(secret, family)).toHaveProperty(
          'ruleCode',
          'CD-SECRET-0007',
        );
      },
    );

    // An imported SARIF finding keeps the rule id of the tool that produced
    // it, so an agent can match the finding against its own SARIF file.
    it('carries the scanner rule id of an imported SARIF finding', () => {
      const imported = {
        ...(base as Record<string, unknown>),
        scannerRuleId: 'python.lang.security.audit.eval-detected',
      } as never;
      expect(toSlimBaseFamilyItem(imported, 'sast')).toHaveProperty(
        'scannerRuleId',
        'python.lang.security.audit.eval-detected',
      );
    });

    it.each([
      ['no scanner rule id', undefined],
      ['an empty scanner rule id', ''],
    ])('omits scannerRuleId when the finding has %s', (_label, value) => {
      const finding = {
        ...(base as Record<string, unknown>),
        scannerRuleId: value,
      } as never;
      const json = JSON.parse(
        JSON.stringify(toSlimBaseFamilyItem(finding, 'sast')),
      );
      expect(json).not.toHaveProperty('scannerRuleId');
    });

    it('drops every heavy field', () => {
      const slim = toSlimBaseFamilyItem(base, 'iac');
      expect(slim).not.toHaveProperty('autofixRecords');
      expect(slim).not.toHaveProperty('codeSnippets');
      expect(slim).not.toHaveProperty('contextualExplanation');
      expect(slim).not.toHaveProperty('exploitabilityReason');
      expect(slim).not.toHaveProperty('exploitabilityScoreReason');
      expect(slim).not.toHaveProperty('cvssExplanation');
      expect(slim).not.toHaveProperty('historyItems');
      expect(slim).not.toHaveProperty('vulnerability');
      expect(slim.scanner).toBe('iac');
    });

    it('is null-safe when base is undefined (proto declares base optional)', () => {
      // Must not throw: a base-less item would otherwise 500 the list endpoint
      // and defeat toSlimBaseFamilyDetail's own base? guards via the spread.
      expect(() => toSlimBaseFamilyItem(undefined, 'sast')).not.toThrow();
      const slim = toSlimBaseFamilyItem(undefined, 'sast');
      expect(slim.id).toBe('');
      expect(slim.scanner).toBe('sast');
      expect(slim.title).toBe('');
      expect(slim.severity).toBe('');
      expect(slim.state).toBe('');
      expect(slim.cwe).toEqual([]);
      expect(slim.hasAutofix).toBe(false);
      expect(slim.hasCybeAnalysis).toBe(false);
    });
  });

  describe('toSlimScaItem', () => {
    const sca = {
      base: {
        id: 's1',
        currentSeverity: 'critical',
        currentPriority: 'critical_urgent',
        currentState: 'to_verify',
        language: 'npm',
        contextualExplanation: 'LONG',
        priorityScore: 90,
      },
      library: {
        packageName: 'lodash',
        packageVersion: '4.17.20',
        fileName: 'package-lock.json',
        importLocations: [
          { file: 'a.ts', line: 1, content: 'import _ from lodash' },
        ],
      },
      metadata: {
        cve: 'CVE-2021-23337',
        summary: 'Command injection in lodash',
        details: 'A VERY LONG OSV advisory body',
        references: [{ url: 'https://x' }],
        cwes: [{ id: 'c1', cweId: 'CWE-78' }],
      },
      hasAutofix: true,
      hasCybeAnalysis: true,
      priorityScore: 90,
      exploitabilityVerdict: 'proven',
      exploitabilityReason: 'LONG',
    } as never;

    it('keeps only the allow-listed slim fields (with SCA package fields)', () => {
      expect(toSlimScaItem(sca)).toEqual({
        id: 's1',
        scanner: 'sca',
        title: 'Command injection in lodash',
        // shortDescription intentionally omitted for SCA (would duplicate title)
        shortDescription: undefined,
        severity: 'critical',
        priority: 'critical_urgent',
        state: 'to_verify',
        priorityScore: 90,
        exploitabilityVerdict: 'proven',
        cwe: ['CWE-78'],
        language: 'npm',
        hasAutofix: true,
        hasCybeAnalysis: true,
        packageName: 'lodash',
        packageVersion: '4.17.20',
        cve: 'CVE-2021-23337',
      });
    });

    it('drops the OSV advisory body, references and import locations', () => {
      const slim = toSlimScaItem(sca);
      expect(slim).not.toHaveProperty('metadata');
      expect(slim).not.toHaveProperty('library');
      expect(slim).not.toHaveProperty('details');
      expect(slim).not.toHaveProperty('importLocations');
      expect(slim).not.toHaveProperty('exploitabilityReason');
    });

    it('exposes recommendedFixVersion when an autofix record exists', () => {
      const withFix = {
        base: { id: 's9', currentSeverity: 'high', currentState: 'to_verify' },
        library: { packageName: 'mkdirp', packageVersion: '0.5.1' },
        metadata: { summary: 's', cwes: [] },
        autofixRecords: [{ recommendedProposedVersion: '0.5.5' }],
        hasAutofix: true,
      } as never;
      expect(toSlimScaItem(withFix).recommendedFixVersion).toBe('0.5.5');
    });

    it('omits recommendedFixVersion when there is no autofix record', () => {
      // `sca` sets hasAutofix:true but carries no autofixRecords[].
      expect(toSlimScaItem(sca).recommendedFixVersion).toBeUndefined();
    });

    // An advisory without a CVE (GHSA-only, PYSEC, RUSTSEC…) would otherwise
    // reach the list with no identifier at all.
    it('carries the advisory id of an advisory without a CVE', () => {
      const noCve = {
        ...(sca as Record<string, unknown>),
        metadata: {
          id: 'GHSA-29mw-wpgm-hmr9',
          ghsaId: 'GHSA-29mw-wpgm-hmr9',
          cve: '',
          summary: 'Prototype pollution',
          cwes: [],
        },
      } as never;
      const slim = toSlimScaItem(noCve);
      expect(slim.advisoryId).toBe('GHSA-29mw-wpgm-hmr9');
      expect(slim.cve).toBeUndefined();
    });

    it('falls back to the GHSA id when the advisory id is empty', () => {
      const ghsaOnly = {
        ...(sca as Record<string, unknown>),
        metadata: { id: '', ghsaId: 'GHSA-aaaa-bbbb-cccc', cwes: [] },
      } as never;
      expect(toSlimScaItem(ghsaOnly).advisoryId).toBe('GHSA-aaaa-bbbb-cccc');
    });

    it('carries the advisory id next to the CVE when they differ', () => {
      const both = {
        ...(sca as Record<string, unknown>),
        metadata: {
          ...((sca as Record<string, unknown>).metadata as object),
          id: 'GHSA-35jh-r3h4-6jhm',
        },
      } as never;
      const slim = toSlimScaItem(both);
      expect(slim.advisoryId).toBe('GHSA-35jh-r3h4-6jhm');
      expect(slim.cve).toBe('CVE-2021-23337');
    });

    it('omits the advisory id when it only repeats the CVE', () => {
      const same = {
        ...(sca as Record<string, unknown>),
        metadata: {
          ...((sca as Record<string, unknown>).metadata as object),
          id: 'CVE-2021-23337',
        },
      } as never;
      const json = JSON.parse(JSON.stringify(toSlimScaItem(same)));
      expect(json).not.toHaveProperty('advisoryId');
    });

    it('surfaces isMalware only when true', () => {
      expect(toSlimScaItem(sca).isMalware).toBeUndefined();
      const malware = { ...(sca as any), isMalware: true } as never;
      expect(toSlimScaItem(malware).isMalware).toBe(true);
    });
  });

  describe('toSlimContainerItem', () => {
    const detection = {
      id: 'c1',
      projectId: 'p1',
      vulnerabilityIdentifier: 'CVE-2024-1234',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentPriority: 'urgent',
      fixedVersion: '1.2.4',
      package: {
        id: 'pk',
        name: 'openssl',
        version: '1.2.3',
        licenses: ['MIT'],
      },
      vuln: {
        vulnerabilityId: 'CVE-2024-1234',
        title: 'OpenSSL buffer overflow',
        description: 'A VERY LONG OSV description body',
        cweIds: ['CWE-120'],
        references: ['https://a', 'https://b'],
        cvss: { nvd: { v3Score: 7.5 } },
      },
      historyItems: { items: [{ user: { id: 'u' } }] },
      priorityScore: 75,
      exploitabilityVerdict: 'theoretical',
      exploitabilityReason: 'LONG reasoning',
      exploitabilitySource: 'agent',
      cvssExplanation: { base: { baseScore: 7.5 } },
    } as never;

    it('keeps only the allow-listed slim fields', () => {
      expect(toSlimContainerItem(detection)).toEqual({
        id: 'c1',
        scanner: 'container',
        title: 'OpenSSL buffer overflow',
        severity: 'high',
        priority: 'urgent',
        state: 'to_verify',
        priorityScore: 75,
        exploitabilityVerdict: 'theoretical',
        cwe: ['CWE-120'],
        hasAutofix: false,
        hasCybeAnalysis: true,
        packageName: 'openssl',
        packageVersion: '1.2.3',
        cve: 'CVE-2024-1234',
      });
    });

    it('drops the OSV description, references, history and cvssExplanation', () => {
      const slim = toSlimContainerItem(detection);
      expect(slim).not.toHaveProperty('vuln');
      expect(slim).not.toHaveProperty('package');
      expect(slim).not.toHaveProperty('description');
      expect(slim).not.toHaveProperty('references');
      expect(slim).not.toHaveProperty('historyItems');
      expect(slim).not.toHaveProperty('cvssExplanation');
    });
  });

  describe('truncateText', () => {
    it('passes through a short string', () => {
      expect(truncateText('hello')).toBe('hello');
    });

    it('clips a long string with a marker', () => {
      const out = truncateText('a'.repeat(MCP_DETAIL_TEXT_MAX + 50));
      expect(out?.startsWith('a'.repeat(MCP_DETAIL_TEXT_MAX))).toBe(true);
      expect(out?.endsWith('… [truncated]')).toBe(true);
    });

    it('leaves a string of exactly max length untouched (boundary, strict >)', () => {
      const exact = 'a'.repeat(MCP_DETAIL_TEXT_MAX);
      expect(truncateText(exact)).toBe(exact);
    });

    it('truncates at max + 1 (the first character past the cap)', () => {
      const out = truncateText('a'.repeat(MCP_DETAIL_TEXT_MAX + 1));
      expect(out?.endsWith('… [truncated]')).toBe(true);
      expect(out).toBe(`${'a'.repeat(MCP_DETAIL_TEXT_MAX)}… [truncated]`);
    });

    it('does not split a surrogate pair when an emoji straddles the cap', () => {
      // 'a' * (max-1) then an emoji: the cap falls inside the surrogate pair.
      const out = truncateText('a'.repeat(MCP_DETAIL_TEXT_MAX - 1) + '😀X');
      // No lone surrogate: the kept slice must remain valid UTF-16.
      expect(out).toBeDefined();
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out as string)).toBe(
        false,
      );
      expect(out?.endsWith('… [truncated]')).toBe(true);
    });

    it('returns undefined for empty / undefined', () => {
      expect(truncateText('')).toBeUndefined();
      expect(truncateText(undefined)).toBeUndefined();
    });
  });

  describe('toSlimBaseFamilyDetail', () => {
    const vuln = {
      dataFlowItems: Array.from({ length: 15 }, (_, i) => ({
        path: `f${i}.ts`,
        line: i,
        order: i,
        code: [{ line: 1, content: 'CODE' }],
        language: 'ts',
        type: 't',
        nameHighlight: 'n',
      })),
      base: {
        id: 'b1',
        currentSeverity: 'high',
        currentPriority: 'urgent',
        currentState: 'to_verify',
        path: 'a.py',
        vulnerableStartLine: 5,
        vulnerableEndLine: 6,
        contextualExplanation: 'C'.repeat(2000),
        exploitabilityReason: 'E'.repeat(2000),
        exploitabilityVerdict: 'proven',
        priorityScore: 80,
        hasCybeAutofix: true,
        hasCybeAnalysis: true,
        vulnerability: {
          name: 'SQLi',
          shortDescription: 'sql injection',
          cwe: ['CWE-89'],
          description: 'D'.repeat(2000),
          howToPrevent: 'H'.repeat(2000),
          references: Array.from({ length: 15 }, (_, i) => ({
            id: `r${i}`,
            name: 'n',
            url: `https://ref/${i}`,
          })),
          codeExamples: [{ filename: 'ex', content: 'EX'.repeat(1000) }],
        },
        codeSnippets: [
          {
            code: [
              { line: 5, content: 'q = "SELECT"' },
              { line: 6, content: 'exec(q)' },
            ],
          },
        ],
        autofixRecords: [
          {
            prUrl: 'https://pr/1',
            status: 'open',
            diff: 'BIGDIFF',
            prBody: 'BIG',
          },
        ],
      },
    } as never;

    it('truncates markdown, caps dataflow/references, reduces autofix, inherits slim fields', () => {
      const d = toSlimBaseFamilyDetail(vuln, 'sast');
      expect(d.id).toBe('b1');
      expect(d.scanner).toBe('sast');
      expect(d.title).toBe('SQLi');
      expect(d.cwe).toEqual(['CWE-89']);
      expect(d.description?.endsWith('… [truncated]')).toBe(true);
      expect(d.howToPrevent?.endsWith('… [truncated]')).toBe(true);
      expect(d.contextualExplanation?.endsWith('… [truncated]')).toBe(true);
      expect(d.exploitabilityReason?.endsWith('… [truncated]')).toBe(true);
      expect(d.references).toHaveLength(MCP_DETAIL_REFERENCES_MAX);
      expect(d.references?.[0]).toBe('https://ref/0');
      expect(d.dataFlow).toHaveLength(MCP_DETAIL_DATAFLOW_MAX_STEPS);
      expect(d.dataFlow?.[0]).toEqual({ path: 'f0.ts', line: 0, order: 0 });
      expect(d.codeSnippet).toContain('SELECT');
      expect(d.autofix).toEqual({
        prUrl: 'https://pr/1',
        status: 'open',
        hasFullDiff: true,
      });
    });

    it('inherits the catalogue rule code from the slim item', () => {
      const detail = vuln as { base: Record<string, unknown> };
      const withCode = {
        ...detail,
        base: {
          ...detail.base,
          vulnerability: {
            ...(detail.base.vulnerability as object),
            code: 'CD-SAST-0042',
          },
        },
      } as never;
      expect(toSlimBaseFamilyDetail(withCode, 'sast')).toHaveProperty(
        'ruleCode',
        'CD-SAST-0042',
      );
    });

    it('carries the rule code of a secret finding (a directive silences one too)', () => {
      const detail = vuln as { base: Record<string, unknown> };
      const secret = {
        ...detail,
        base: {
          ...detail.base,
          vulnerability: {
            ...(detail.base.vulnerability as object),
            code: 'CD-SECRET-0007',
          },
        },
      } as never;
      expect(toSlimBaseFamilyDetail(secret, 'secret')).toHaveProperty(
        'ruleCode',
        'CD-SECRET-0007',
      );
    });

    it('drops the raw heavy fields', () => {
      const d = toSlimBaseFamilyDetail(vuln, 'sast');
      expect(d).not.toHaveProperty('autofixRecords');
      expect(d).not.toHaveProperty('codeSnippets');
      expect(d).not.toHaveProperty('codeExamples');
      expect(d).not.toHaveProperty('dataFlowItems');
      expect(d.dataFlow?.[0]).not.toHaveProperty('code');
    });

    it('truncates a large code snippet at the snippet cap (1200)', () => {
      const big = {
        dataFlowItems: [],
        base: {
          id: 'b1',
          currentSeverity: 'high',
          currentState: 'to_verify',
          vulnerability: { name: 'SQLi', cwe: ['CWE-89'], references: [] },
          codeSnippets: [
            {
              code: [
                { line: 1, content: 'x'.repeat(MCP_DETAIL_SNIPPET_MAX + 500) },
              ],
            },
          ],
        },
      } as never;
      const d = toSlimBaseFamilyDetail(big, 'sast');
      expect(d.codeSnippet?.endsWith('… [truncated]')).toBe(true);
      expect([...(d.codeSnippet as string)].length).toBe(
        MCP_DETAIL_SNIPPET_MAX + '… [truncated]'.length,
      );
    });

    it('emits undefined autofix / dataFlow when absent and hasFullDiff=false without a diff', () => {
      const bare = {
        dataFlowItems: [],
        base: {
          id: 'b2',
          currentSeverity: 'low',
          currentState: 'to_verify',
          vulnerability: { name: 'R', cwe: [], references: [] },
          autofixRecords: [{ prUrl: 'https://pr/2', status: 'open' }], // no diff
        },
      } as never;
      const d = toSlimBaseFamilyDetail(bare, 'sast');
      expect(d.dataFlow).toBeUndefined();
      expect(d.autofix).toEqual({
        prUrl: 'https://pr/2',
        status: 'open',
        hasFullDiff: false,
      });
    });

    it('emits undefined autofix when there are no autofix records', () => {
      const noFix = {
        dataFlowItems: [],
        base: {
          id: 'b3',
          currentSeverity: 'low',
          currentState: 'to_verify',
          vulnerability: { name: 'R', cwe: [], references: [] },
          autofixRecords: [],
        },
      } as never;
      expect(toSlimBaseFamilyDetail(noFix, 'sast').autofix).toBeUndefined();
    });
  });

  describe('toSlimScaDetail', () => {
    const v = {
      base: {
        id: 's1',
        currentSeverity: 'critical',
        currentState: 'to_verify',
      },
      library: { packageName: 'lodash', packageVersion: '1.0' },
      metadata: {
        cve: 'CVE-1',
        summary: 'sum',
        details: 'O'.repeat(2000),
        references: Array.from({ length: 15 }, (_, i) => ({
          id: `r${i}`,
          type: 'WEB',
          url: `https://a/${i}`,
        })),
        cwes: [{ id: 'c', cweId: 'CWE-78' }],
      },
      exploitabilityReason: 'R'.repeat(2000),
      autofixRecords: [{ prUrl: 'https://pr', status: 'open', diff: 'D' }],
      hasAutofix: true,
      hasCybeAnalysis: true,
    } as never;

    it('truncates the advisory body, caps references, reduces autofix', () => {
      const d = toSlimScaDetail(v);
      expect(d.packageName).toBe('lodash');
      expect(d.cve).toBe('CVE-1');
      expect(d.description?.endsWith('… [truncated]')).toBe(true);
      expect(d.references).toHaveLength(MCP_DETAIL_REFERENCES_MAX);
      expect(d.exploitabilityReason?.endsWith('… [truncated]')).toBe(true);
      expect(d.autofix).toEqual({
        prUrl: 'https://pr',
        status: 'open',
        hasFullDiff: true,
      });
      expect(d).not.toHaveProperty('metadata');
    });

    it('exposes the SCA autofix upgrade guidance + library context, capping the dependency path', () => {
      const vFix = {
        base: { id: 's2', currentSeverity: 'high', currentState: 'to_verify' },
        library: {
          packageName: 'minimist',
          packageVersion: '0.0.8',
          fileName: 'package-lock.json',
          ecosystem: 'npm',
          isTransitive: true,
          path: Array.from({ length: 20 }, (_, i) => `pkg-${i}@1.0.0`),
        },
        metadata: {
          cve: 'CVE-2',
          summary: 's',
          details: 'd',
          references: [],
          cwes: [],
        },
        autofixRecords: [
          {
            prUrl: 'https://pr/1',
            status: 'open',
            diff: 'D',
            recommendedProposedVersion: '0.5.5',
            recommendedParentPackage: 'mkdirp',
            recommendedCurrentVersion: '0.5.1',
            recommendedUpdateType: 'patch',
            installCommand: 'npm install mkdirp@0.5.5',
            hasFixAvailable: true,
          },
        ],
        hasAutofix: true,
      } as never;

      const d = toSlimScaDetail(vFix);
      expect(d.autofix).toEqual({
        prUrl: 'https://pr/1',
        status: 'open',
        hasFullDiff: true,
        recommendedVersion: '0.5.5',
        recommendedPackage: 'mkdirp',
        currentVersion: '0.5.1',
        updateType: 'patch',
        installCommand: 'npm install mkdirp@0.5.5',
        hasFixAvailable: true,
        isTransitive: true,
        ecosystem: 'npm',
        manifestFile: 'package-lock.json',
        dependencyPath: Array.from({ length: 8 }, (_, i) => `pkg-${i}@1.0.0`),
      });
    });

    it('leaves autofix undefined when there is no autofix record', () => {
      const vNoFix = {
        base: { id: 's3', currentSeverity: 'low', currentState: 'to_verify' },
        library: { packageName: 'x', packageVersion: '1.0' },
        metadata: { details: '', references: [], cwes: [] },
        autofixRecords: [],
        hasAutofix: false,
      } as never;
      expect(toSlimScaDetail(vNoFix).autofix).toBeUndefined();
    });
  });

  describe('toSlimContainerDetail', () => {
    const detection = {
      id: 'c1',
      vulnerabilityIdentifier: 'CVE-9',
      currentSeverity: 'high',
      currentState: 'to_verify',
      fixedVersion: '2.0',
      package: { name: 'openssl', version: '1.0' },
      vuln: {
        title: 'overflow',
        description: 'O'.repeat(2000),
        cweIds: ['CWE-120'],
        references: Array.from({ length: 15 }, (_, i) => `https://a/${i}`),
      },
      exploitabilityReason: 'R'.repeat(2000),
      exploitabilitySource: 'agent',
    } as never;

    it('truncates description, caps references, exposes fixedVersion', () => {
      const d = toSlimContainerDetail(detection);
      expect(d.title).toBe('overflow');
      expect(d.fixedVersion).toBe('2.0');
      expect(d.description?.endsWith('… [truncated]')).toBe(true);
      expect(d.references).toHaveLength(MCP_DETAIL_REFERENCES_MAX);
      expect(d.exploitabilityReason?.endsWith('… [truncated]')).toBe(true);
      expect(d).not.toHaveProperty('vuln');
    });
  });
});
