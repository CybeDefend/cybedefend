import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { SarifSource } from './import-limits';
import { forEachSarifResult, readSarifHeaders } from './sarif-stream';
import {
  MapOutcome,
  buildRuleIndex,
  mapSarifResult,
  ruleMetadataOf,
  sanitizeToolName,
  severityOf,
} from './sarif-mapper';
import { ImportType } from './result-kind';
import { SarifResult, SarifRunHeader } from './sarif.types';

const FIXTURES = join(__dirname, '../../../../../../libs/test-fixtures/sarif');

const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const sourceOf =
  (buf: Buffer): SarifSource =>
  async () =>
    Readable.from([buf]);

interface LoadedRun {
  header: SarifRunHeader;
  results: SarifResult[];
}

/** Reads a fixture through the stream reader, then groups results by run. */
const loadFixture = async (name: string): Promise<LoadedRun[]> => {
  const headers = await readSarifHeaders(sourceOf(fixture(name)));
  const byIndex = new Map<number, SarifResult[]>();
  await forEachSarifResult(
    sourceOf(fixture(name)),
    async (runIndex, result) => {
      const list = byIndex.get(runIndex) ?? [];
      list.push(result);
      byIndex.set(runIndex, list);
    },
  );
  return headers.map((header) => ({
    header,
    results: byIndex.get(header.index) ?? [],
  }));
};

const mapRun = (
  run: LoadedRun,
  category: ImportType = 'sast',
): MapOutcome[] => {
  const rules = buildRuleIndex(run.header.tool);
  const toolName = sanitizeToolName(run.header.tool.driver.name);
  return run.results.map((result) =>
    mapSarifResult(result, run.header, rules, toolName, category),
  );
};

const reasonOf = (o: MapOutcome): string =>
  o.kind === 'skipped' ? `${o.kind}:${o.reason}` : o.kind;

describe('sarif-mapper', () => {
  it('sanitizes tool names', () => {
    expect(sanitizeToolName('Semgrep')).toBe('semgrep');
    expect(sanitizeToolName('CodeQL')).toBe('codeql');
    expect(sanitizeToolName('My Tool!! v2')).toBe('my-tool-v2');
    expect(sanitizeToolName('a/b\\c:d')).toBe('a-b-c-d');
    expect(sanitizeToolName('---weird---')).toBe('weird');
    expect(sanitizeToolName('gitleaks.vault')).toBe('gitleaks.vault');
    expect(sanitizeToolName('')).toBe('sarif');
    expect(sanitizeToolName(undefined)).toBe('sarif');
    expect(sanitizeToolName('   ')).toBe('sarif');
    expect(sanitizeToolName('x'.repeat(100))).toBe('x'.repeat(64));
    expect(sanitizeToolName(`${'a'.repeat(70)}!!!`)).toBe('a'.repeat(64));
  });

  it('finds a rule only in tool.extensions', async () => {
    const [run] = await loadFixture('extensions-rules.sarif');
    const [outcome] = mapRun(run);
    expect(outcome.kind).toBe('mapped');
    if (outcome.kind !== 'mapped') return;
    const { dto } = outcome;
    expect(dto.ruleId).toBe('js/sql-injection');
    expect(dto.ruleMetadata?.cwe).toEqual(['CWE-89']);
    expect(dto.cwe).toEqual(['CWE-89']);
    expect(dto.severity).toBe('high');
    expect(dto.path).toBe('src/db/users.js');
    expect(dto.codeSnippet?.vulnerableStartLine).toBe(44);
    expect(dto.codeSnippet?.vulnerableEndLine).toBe(44);
    expect(dto.codeSnippet?.code).toEqual([]);
    expect(dto.ruleMetadata?.name).toBe('js/sql-injection');
    expect(dto.language).toBe('generic');
    expect(dto.dataFlow).toEqual([]);
    expect(dto.inlineIgnores).toEqual([]);
  });

  it('takes the rule id from ruleIndex when ruleId is absent', async () => {
    const [run] = await loadFixture('rule-index-only.sarif');
    const outcomes = mapRun(run);
    expect(outcomes.map(reasonOf)).toEqual([
      'mapped',
      'mapped',
      'skipped:no_rule_id',
    ]);
    const [first, second] = outcomes;
    if (first.kind === 'mapped') {
      expect(first.dto.ruleId).toBe('B602');
      expect(first.dto.ruleMetadata?.cwe).toEqual(['CWE-78']);
      expect(first.dto.severity).toBe('high');
      expect(first.dto.path).toBe('tools/run.py');
      expect(first.dto.codeSnippet?.vulnerableStartLine).toBe(8);
      expect(first.dto.codeSnippet?.vulnerableEndLine).toBe(8);
    }
    if (second.kind === 'mapped') {
      expect(second.dto.ruleId).toBe('B301');
      expect(second.dto.ruleMetadata?.cwe).toEqual(['CWE-502']);
      expect(second.dto.severity).toBe('low');
      expect(second.dto.path).toBe('tools/cache.py');
      expect(second.dto.codeSnippet?.vulnerableStartLine).toBe(21);
      expect(second.dto.codeSnippet?.vulnerableEndLine).toBe(22);
    }
  });

  it('resolves uriBaseId through originalUriBaseIds and never prepends an absolute base', async () => {
    const [run] = await loadFixture('uri-base-id.sarif');
    const paths = mapRun(run).map((o) =>
      o.kind === 'mapped' ? o.dto.path : null,
    );
    expect(paths).toEqual([
      'src/main.go',
      'web/index.js',
      'src/lib/util.go',
      'cmd/server.go',
    ]);
  });

  it('refuses a path with ..', async () => {
    const [run] = await loadFixture('path-traversal.sarif');
    const outcomes = mapRun(run);
    expect(outcomes.slice(0, 4).map(reasonOf)).toEqual([
      'skipped:invalid_path',
      'skipped:invalid_path',
      'skipped:invalid_path',
      'skipped:invalid_path',
    ]);
    expect(reasonOf(outcomes[4])).toBe('mapped');
    if (outcomes[4].kind === 'mapped')
      expect(outcomes[4].dto.path).toBe('src/ok.py');
  });

  it('imports a result without region at lines 1–1', async () => {
    const [run] = await loadFixture('no-region.sarif');
    const outcomes = mapRun(run, 'iac');
    expect(outcomes).toHaveLength(2);
    const [a, b] = outcomes;
    expect(a.kind).toBe('mapped');
    if (a.kind === 'mapped') {
      expect(a.dto.path).toBe('Dockerfile');
      expect(a.dto.codeSnippet?.vulnerableStartLine).toBe(1);
      expect(a.dto.codeSnippet?.vulnerableEndLine).toBe(1);
      expect(a.dto.codeSnippet?.startLine).toBe(1);
      expect(a.dto.codeSnippet?.endLine).toBe(1);
      expect(a.dto.codeSnippet?.code).toEqual([]);
    }
    expect(b.kind).toBe('mapped');
    if (b.kind === 'mapped') {
      expect(b.dto.path).toBe('deploy/Dockerfile');
      expect(b.dto.codeSnippet?.vulnerableStartLine).toBe(5);
      expect(b.dto.codeSnippet?.vulnerableEndLine).toBe(5);
    }
  });

  it('caps a 1 MB snippet to 50 lines of 1000 characters', async () => {
    const [run] = await loadFixture('large-snippet.sarif');
    const [outcome] = mapRun(run);
    expect(outcome.kind).toBe('mapped');
    if (outcome.kind === 'mapped') {
      const code = outcome.dto.codeSnippet?.code ?? [];
      expect(code).toHaveLength(1);
      expect(code[0].line).toBe(12);
      expect(code[0].content).toHaveLength(1000);
      expect(outcome.dto.codeSnippet?.endLine).toBe(12);
    }

    const snippet = Array.from(
      { length: 60 },
      (_, i) => `${i}:${'y'.repeat(1500)}`,
    ).join('\n');
    const header: SarifRunHeader = {
      index: 0,
      tool: { driver: { name: 'gen', rules: [{ id: 'r' }] } },
      originalUriBaseIds: {},
      artifacts: [],
      resultCount: 1,
    };
    const synthetic: SarifResult = {
      ruleId: 'r',
      level: 'error',
      message: { text: 'm' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'a.py' },
            region: { startLine: 3, snippet: { text: snippet } },
          },
        },
      ],
    };
    const out = mapSarifResult(
      synthetic,
      header,
      buildRuleIndex(header.tool),
      'gen',
      'sast',
    );
    expect(out.kind).toBe('mapped');
    if (out.kind === 'mapped') {
      const code = out.dto.codeSnippet?.code ?? [];
      expect(code).toHaveLength(50);
      expect(code[0].line).toBe(3);
      expect(code[49].line).toBe(52);
      expect(code.every((l) => l.content.length <= 1000)).toBe(true);
      expect(code[0].content).toBe(`0:${'y'.repeat(998)}`);
      expect(out.dto.codeSnippet?.endLine).toBe(52);
    }
  });

  it('skips an accepted suppression and a kind other than fail, keeps a rejected one', async () => {
    const [run] = await loadFixture('suppressed.sarif');
    const outcomes = mapRun(run);
    expect(outcomes.map(reasonOf)).toEqual([
      'skipped:suppressed',
      'skipped:suppressed',
      'mapped',
      'mapped',
      'skipped:not_a_failure',
    ]);
  });

  it('maps every row of severity-mapping.sarif to its expected severity', async () => {
    expect(severityOf({ 'security-severity': 9 }, undefined)).toBe('critical');
    expect(severityOf({ 'security-severity': '0' }, 'error')).toBe('high');
    expect(severityOf({ 'security-severity': -1 }, 'warning')).toBe('medium');
    expect(severityOf({ 'security-severity': 'abc' }, 'note')).toBe('low');
    expect(severityOf(undefined, undefined)).toBe('medium');
    expect(severityOf(undefined, 'none')).toBe('low');
    expect(severityOf(undefined, 'error')).toBe('high');

    const [run] = await loadFixture('severity-mapping.sarif');
    const expected = [
      'critical',
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
      'high',
      'medium',
      'low',
      'low',
      'low',
      'critical',
      'medium',
      'high',
      'high',
    ];
    const outcomes = mapRun(run);
    expect(outcomes).toHaveLength(16);
    expect(
      outcomes.map((o) => (o.kind === 'mapped' ? o.dto.severity : 'skipped')),
    ).toEqual(expected);
  });

  it('keeps https help URIs only', async () => {
    const [run] = await loadFixture('minimal.sarif');
    const [a, b] = mapRun(run);
    if (a.kind === 'mapped') {
      expect(a.dto.ruleMetadata?.helpUri).toBe(
        'https://semgrep.dev/r/python.lang.security.audit.eval-detected',
      );
    }
    if (b.kind === 'mapped') expect(b.dto.ruleMetadata?.helpUri).toBe('');
    expect(
      ruleMetadataOf(
        { id: 'r', helpUri: 'http://x.example/r' },
        'r',
        't',
        'low',
      ).helpUri,
    ).toBe('');
    expect(
      ruleMetadataOf({ id: 'r', helpUri: 'not a url' }, 'r', 't', 'low')
        .helpUri,
    ).toBe('');
    expect(
      ruleMetadataOf(
        { id: 'r', helpUri: 'https://x.example/r' },
        'r',
        't',
        'low',
      ).helpUri,
    ).toBe('https://x.example/r');
  });

  it('reads CWE tags in both forms, at most 10', () => {
    const tags = [
      'CWE-79',
      'external/cwe/cwe-089',
      'cwe-1',
      'CWE-79',
      'security',
      'external/cwe/cwe-002',
      'CWE-3',
      'CWE-4',
      'CWE-5',
      'CWE-6',
      'CWE-7',
      'CWE-8',
      'CWE-9',
      'CWE-10',
      'CWE-11',
    ];
    const meta = ruleMetadataOf(
      { id: 'r', properties: { tags } },
      'r',
      't',
      'low',
    );
    expect(meta.cwe).toEqual([
      'CWE-79',
      'CWE-89',
      'CWE-1',
      'CWE-2',
      'CWE-3',
      'CWE-4',
      'CWE-5',
      'CWE-6',
      'CWE-7',
      'CWE-8',
    ]);

    // result tags are merged after the rule's tags
    const header: SarifRunHeader = {
      index: 0,
      tool: {
        driver: {
          name: 't',
          rules: [{ id: 'r', properties: { tags: ['CWE-1'] } }],
        },
      },
      originalUriBaseIds: {},
      artifacts: [],
      resultCount: 1,
    };
    const result: SarifResult = {
      ruleId: 'r',
      level: 'error',
      message: { text: 'm' },
      properties: { tags: ['external/cwe/cwe-500'] },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'a.py' },
            region: { startLine: 1 },
          },
        },
      ],
    };
    const out = mapSarifResult(
      result,
      header,
      buildRuleIndex(header.tool),
      't',
      'sast',
    );
    expect(out.kind).toBe('mapped');
    if (out.kind === 'mapped') {
      expect(out.dto.ruleMetadata?.cwe).toEqual(['CWE-1', 'CWE-500']);
      expect(out.dto.cwe).toEqual(['CWE-1', 'CWE-500']);
    }
  });

  it("reads Semgrep's long CWE tags, never a longer number nor a prose mention", () => {
    const meta = ruleMetadataOf(
      {
        id: 'r',
        properties: {
          tags: [
            "CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
            'CWE-078 Improper Neutralization',
            'CWE-79x',
            'see CWE-22',
          ],
        },
      },
      'r',
      't',
      'low',
    );
    expect(meta.cwe).toEqual(['CWE-89', 'CWE-78']);
  });

  it('reads properties.cwe of the rule and the result, after the tags', () => {
    const header: SarifRunHeader = {
      index: 0,
      tool: {
        driver: {
          name: 't',
          rules: [
            {
              id: 'r',
              properties: { tags: ['CWE-1'], cwe: ['CWE-79', 'CWE-1', 42] },
            },
          ],
        },
      },
      originalUriBaseIds: {},
      artifacts: [],
      resultCount: 1,
    };
    const result: SarifResult = {
      ruleId: 'r',
      level: 'error',
      message: { text: 'm' },
      properties: { cwe: 'CWE-352' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'a.py' },
            region: { startLine: 1 },
          },
        },
      ],
    };
    const out = mapSarifResult(
      result,
      header,
      buildRuleIndex(header.tool),
      't',
      'sast',
    );
    expect(out.kind).toBe('mapped');
    if (out.kind === 'mapped') {
      expect(out.dto.ruleMetadata?.cwe).toEqual(['CWE-1', 'CWE-79', 'CWE-352']);
      expect(out.dto.cwe).toEqual(['CWE-1', 'CWE-79', 'CWE-352']);
    }
  });

  it('reads the OWASP 2021 label of minimal.sarif rule 1 as A03:2021', async () => {
    const [run] = await loadFixture('minimal.sarif');
    const [a, b] = mapRun(run);
    if (a.kind === 'mapped') {
      expect(a.dto.ruleMetadata?.owaspTop10).toEqual(['A03:2021']);
      expect(a.dto.owaspTop10).toEqual(['A03:2021']);
    }
    if (b.kind === 'mapped') expect(b.dto.ruleMetadata?.owaspTop10).toEqual([]);
  });

  it('normalises OWASP tags, ignores other years and duplicates', () => {
    const tags = [
      'OWASP-A03:2021 - Injection',
      'a10:2021',
      'A03:2017',
      ...Array.from(
        { length: 10 },
        (_, i) => `A${String(i + 1).padStart(2, '0')}:2021`,
      ),
    ];
    const meta = ruleMetadataOf(
      { id: 'r', properties: { tags } },
      'r',
      't',
      'low',
    );
    expect(meta.owaspTop10).toHaveLength(10);
    expect(meta.owaspTop10[0]).toBe('A03:2021');
    expect(meta.owaspTop10[1]).toBe('A10:2021');
    expect(meta.owaspTop10).not.toContain('A03:2017');
    expect(new Set(meta.owaspTop10).size).toBe(meta.owaspTop10.length);
  });

  it('stores no snippet for secrets', async () => {
    const [run] = await loadFixture('minimal.sarif');
    const outcomes = mapRun(run, 'secret');
    expect(outcomes).toHaveLength(2);
    for (const o of outcomes) {
      expect(o.kind).toBe('mapped');
      if (o.kind === 'mapped') {
        expect(o.dto.codeSnippet?.code).toEqual([]);
        expect(o.dto.fileHash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('routes each Trivy kind of trivy-mixed-kinds.sarif to its type only', async () => {
    const [run] = await loadFixture('trivy-mixed-kinds.sarif');
    const kindsOf = (category: ImportType): string[] =>
      mapRun(run, category).map((o) => {
        if (o.kind === 'mapped') return `mapped:${o.dto.ruleId}`;
        return o.reason === 'kind_mismatch'
          ? `kind_mismatch:${o.resultKind}`
          : `${o.kind}:${o.reason}`;
      });

    expect(kindsOf('iac')).toEqual([
      'kind_mismatch:vulnerability',
      'mapped:AVD-DS-0002',
      'kind_mismatch:secret',
      'kind_mismatch:license',
    ]);
    expect(kindsOf('secret')).toEqual([
      'kind_mismatch:vulnerability',
      'kind_mismatch:misconfiguration',
      'mapped:aws-access-key-id',
      'kind_mismatch:license',
    ]);
    expect(kindsOf('sca')).toEqual([
      'mapped:CVE-2021-23337',
      'kind_mismatch:misconfiguration',
      'kind_mismatch:secret',
      'kind_mismatch:license',
    ]);
    expect(kindsOf('container')).toEqual([
      'mapped:CVE-2021-23337',
      'kind_mismatch:misconfiguration',
      'kind_mismatch:secret',
      'kind_mismatch:license',
    ]);
    expect(kindsOf('sast')).toEqual([
      'kind_mismatch:vulnerability',
      'kind_mismatch:misconfiguration',
      'kind_mismatch:secret',
      'kind_mismatch:license',
    ]);
    expect(kindsOf('cicd')).toEqual([
      'kind_mismatch:vulnerability',
      'kind_mismatch:misconfiguration',
      'kind_mismatch:secret',
      'kind_mismatch:license',
    ]);
  });

  it('maps every result of every run of multi-run.sarif with its own tool name', async () => {
    const runs = await loadFixture('multi-run.sarif');
    expect(runs).toHaveLength(4);
    expect(
      runs.map((r) => sanitizeToolName(r.header.tool.driver.name)),
    ).toEqual(['semgrep', 'codeql', 'bandit', 'njsscan']);
    const mapped: { tool: string; ruleId: string }[] = [];
    for (const run of runs) {
      for (const o of mapRun(run)) {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          mapped.push({
            tool: o.dto.ruleMetadata?.toolName ?? '',
            ruleId: o.dto.ruleId,
          });
        }
      }
    }
    expect(mapped).toEqual([
      { tool: 'semgrep', ruleId: 'sql-injection' },
      { tool: 'codeql', ruleId: 'sql-injection' },
      { tool: 'bandit', ruleId: 'B608' },
    ]);
  });
});
