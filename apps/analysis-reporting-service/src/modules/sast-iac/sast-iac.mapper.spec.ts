import {
  mapSastDetectionEntityToInterface,
  mapIacDetectionEntityToInterface,
  mapCicdDetectionEntityToInterface,
  mapSecretDetectionEntityToInterface,
  mapVulnerabilityEntityToMetadata,
  mapVulnerabilityEntityToListMetadata,
  mapSastDetectionEntityToListInterface,
  mapIacDetectionEntityToListInterface,
  mapCicdDetectionEntityToListInterface,
  mapSecretDetectionEntityToListInterface,
} from './sast-iac.mapper';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';

describe('sast-iac.mapper – exploitability fields', () => {
  function makeSastEntity(
    overrides: Partial<SastVulnerabilityDetections> = {},
  ): SastVulnerabilityDetections {
    return {
      id: 'det-1',
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01'),
      updateAt: new Date('2026-01-02'),
      timeToFix: '2h',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentPriority: 'Urgent',
      contextualExplanation: '',
      language: 'javascript',
      path: 'src/index.ts',
      vulnerableStartLine: 10,
      vulnerableEndLine: 15,
      scannerType: 'semgrep',
      fileHash: 'abc123',
      branch: 'main',
      cvss4Vector: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      epssScore: null,
      epssPercentile: null,
      epssRefreshedAt: null,
      scoringSource: 'static',
      exploitabilityScore: null,
      exploitabilityVerdict: null,
      exploitabilityReason: null,
      exploitabilitySource: null,
      exploitabilityUpdatedAt: null,
      vulnerability: null,
      codeSnippets: [],
      historyItems: [],
      dataFlowItems: [],
      autofixRecords: [],
      ...overrides,
    } as any;
  }

  function makeIacEntity(
    overrides: Partial<IacVulnerabilityDetections> = {},
  ): IacVulnerabilityDetections {
    return {
      id: 'det-2',
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01'),
      updateAt: new Date('2026-01-02'),
      timeToFix: '1h',
      currentState: 'to_verify',
      currentSeverity: 'medium',
      currentPriority: 'Normal',
      contextualExplanation: '',
      language: 'hcl',
      path: 'main.tf',
      vulnerableStartLine: 5,
      vulnerableEndLine: 8,
      scannerType: 'kics',
      fileHash: 'def456',
      branch: 'main',
      cvss4Vector: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      epssScore: null,
      epssPercentile: null,
      epssRefreshedAt: null,
      scoringSource: 'static',
      exploitabilityScore: null,
      exploitabilityVerdict: null,
      exploitabilityReason: null,
      exploitabilitySource: null,
      exploitabilityUpdatedAt: null,
      vulnerability: null,
      codeSnippets: [],
      historyItems: [],
      autofixRecords: [],
      ...overrides,
    } as any;
  }

  describe('scannerRuleId (imported SARIF findings only)', () => {
    const MAPPERS = [
      ['sast', mapSastDetectionEntityToInterface],
      ['iac', mapIacDetectionEntityToInterface],
      ['cicd', mapCicdDetectionEntityToInterface],
      ['secret', mapSecretDetectionEntityToInterface],
      ['sast list', mapSastDetectionEntityToListInterface],
      ['iac list', mapIacDetectionEntityToListInterface],
      ['cicd list', mapCicdDetectionEntityToListInterface],
      ['secret list', mapSecretDetectionEntityToListInterface],
    ] as const;

    it.each(MAPPERS)(
      'carries the stored scanner rule id (%s)',
      (_label, map) => {
        const entity = makeSastEntity({
          scannerRuleId: 'CKV_AWS_20',
        } as any);
        expect((map as any)(entity).scannerRuleId).toBe('CKV_AWS_20');
      },
    );

    it.each(MAPPERS)(
      'leaves scannerRuleId unset when none is stored (%s)',
      (_label, map) => {
        const entity = makeSastEntity({ scannerRuleId: null } as any);
        expect((map as any)(entity).scannerRuleId).toBeUndefined();
      },
    );
  });

  describe('mapSastDetectionEntityToInterface', () => {
    it('should include cvss4EnvironmentalVector in the SAST mapping', () => {
      const entity = makeSastEntity({
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4EnvironmentalVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/MSC:H',
        cvss4BaseScore: 9.3,
        cvss4EnvironmentalScore: 9.7,
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.cvss4EnvironmentalVector).toBe(
        entity.cvss4EnvironmentalVector,
      );
    });

    it('maps exploitability fields when present', () => {
      const ts = new Date('2026-04-14T10:00:00Z');
      const entity = makeSastEntity({
        exploitabilityScore: 0.85,
        exploitabilityVerdict: 'proven',
        exploitabilityReason: 'Direct user input reaches SQL query',
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: ts,
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBe(0.85);
      expect(result.exploitabilityVerdict).toBe('proven');
      expect(result.exploitabilityReason).toBe(
        'Direct user input reaches SQL query',
      );
      expect(result.exploitabilitySource).toBe('agent');
      expect(result.exploitabilityUpdatedAt).toBe(ts.toISOString());
    });

    it('maps exploitability fields as undefined when null', () => {
      const entity = makeSastEntity();

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBeUndefined();
      expect(result.exploitabilityVerdict).toBeUndefined();
      expect(result.exploitabilityReason).toBeUndefined();
      expect(result.exploitabilitySource).toBeUndefined();
      expect(result.exploitabilityUpdatedAt).toBeUndefined();
    });

    // hasCybeAnalysis (the flag that drives the "Analyzed by Agent
    // Cybe" banner) keys off the 'system' sentinel userId. A history row
    // attributed to a real human (e.g. a recompute-derived priority_change
    // after a manual edit) must NOT flip it to true.
    describe('hasCybeAnalysis attribution', () => {
      it('is true when a history item is attributed to the system sentinel', () => {
        const entity = makeSastEntity({
          historyItems: [{ type: 'exploitability_change', userId: 'system' }],
        } as any);

        const result = mapSastDetectionEntityToInterface(entity);

        expect(result.hasCybeAnalysis).toBe(true);
      });

      it('is false when the only history item is a human-attributed priority_change', () => {
        const entity = makeSastEntity({
          historyItems: [{ type: 'priority_change', userId: 'human-7' }],
        } as any);

        const result = mapSastDetectionEntityToInterface(entity);

        expect(result.hasCybeAnalysis).toBe(false);
      });
    });
  });

  describe('currentSeverity resolution', () => {
    it('returns effectiveSeverity when present', () => {
      const entity = makeSastEntity({
        currentSeverity: 'high',
        effectiveSeverity: 'critical',
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.currentSeverity).toBe('critical');
    });

    it('falls back to currentSeverity when effectiveSeverity is null', () => {
      const entity = makeSastEntity({
        currentSeverity: 'high',
        effectiveSeverity: null,
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.currentSeverity).toBe('high');
    });

    it('recomputes from env score when stored effectiveSeverity is stale', () => {
      // Matches the IaC bug: env score says 'high' but effectiveSeverity
      // in DB is still the old 'medium' from when env was null.
      const entity = makeSastEntity({
        cvss4EnvironmentalScore: 7.2,
        cvss4BaseScore: 6.7,
        currentSeverity: 'medium',
        effectiveSeverity: 'medium',
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.currentSeverity).toBe('high');
    });
  });

  describe('mapIacDetectionEntityToInterface', () => {
    it('should include cvss4EnvironmentalVector in the IAC mapping', () => {
      const entity = makeIacEntity({
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4EnvironmentalVector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/MSC:H',
        cvss4BaseScore: 9.3,
        cvss4EnvironmentalScore: 9.7,
      } as any);

      const result = mapIacDetectionEntityToInterface(entity);

      expect(result.cvss4EnvironmentalVector).toBe(
        entity.cvss4EnvironmentalVector,
      );
    });

    it('maps exploitability fields when present', () => {
      const ts = new Date('2026-04-14T12:00:00Z');
      const entity = makeIacEntity({
        exploitabilityScore: 0.6,
        exploitabilityVerdict: 'theoretical',
        exploitabilityReason: 'Misconfigured IAM role',
        exploitabilitySource: 'manual',
        exploitabilityUpdatedAt: ts,
      } as any);

      const result = mapIacDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBe(0.6);
      expect(result.exploitabilityVerdict).toBe('theoretical');
      expect(result.exploitabilityReason).toBe('Misconfigured IAM role');
      expect(result.exploitabilitySource).toBe('manual');
      expect(result.exploitabilityUpdatedAt).toBe(ts.toISOString());
    });

    it('maps exploitability fields as undefined when null', () => {
      const entity = makeIacEntity();

      const result = mapIacDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBeUndefined();
      expect(result.exploitabilityVerdict).toBeUndefined();
      expect(result.exploitabilityReason).toBeUndefined();
      expect(result.exploitabilitySource).toBeUndefined();
      expect(result.exploitabilityUpdatedAt).toBeUndefined();
    });

    it('promotes severity to "high" when env score is 7.2 and stored effectiveSeverity is stale "medium"', () => {
      // Regression for "Missing CPU Limits in Docker Compose" (NodeGoat):
      // base=6.7, env=7.2, effectiveSeverity persisted as 'medium' — the
      // detail badge must resolve to 'high' so the UI no longer contradicts
      // the environmental CVSS score displayed on the same page.
      const entity = makeIacEntity({
        cvss4Vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        cvss4BaseScore: 6.7,
        cvss4EnvironmentalScore: 7.2,
        currentSeverity: 'medium',
        effectiveSeverity: 'medium',
      } as any);

      const result = mapIacDetectionEntityToInterface(entity);

      expect(result.currentSeverity).toBe('high');
    });
  });

  function makeCicdEntity(
    overrides: Partial<CicdVulnerabilityDetections> = {},
  ): CicdVulnerabilityDetections {
    return {
      id: 'det-cicd-1',
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01'),
      updateAt: new Date('2026-01-02'),
      timeToFix: '1h',
      currentState: 'to_verify',
      currentSeverity: 'medium',
      currentPriority: 'Normal',
      contextualExplanation: '',
      language: 'yaml',
      path: '.github/workflows/ci.yml',
      vulnerableStartLine: 1,
      vulnerableEndLine: 3,
      scannerType: 'checkov',
      fileHash: 'cicd-hash',
      branch: 'main',
      cvss4Vector: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      epssScore: null,
      epssPercentile: null,
      epssRefreshedAt: null,
      scoringSource: 'static',
      exploitabilityScore: null,
      exploitabilityVerdict: null,
      exploitabilityReason: null,
      exploitabilitySource: null,
      exploitabilityUpdatedAt: null,
      priorityScore: null,
      vulnerability: null,
      codeSnippets: [],
      historyItems: [],
      autofixRecords: [],
      ...overrides,
    } as any;
  }

  function makeSecretEntity(
    overrides: Partial<SecretVulnerabilityDetections> = {},
  ): SecretVulnerabilityDetections {
    return {
      id: 'det-secret-1',
      projectId: 'proj-1',
      createdAt: new Date('2026-01-01'),
      updateAt: new Date('2026-01-02'),
      timeToFix: '30m',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentPriority: 'Urgent',
      contextualExplanation: '',
      language: 'plaintext',
      path: '.env',
      vulnerableStartLine: 1,
      vulnerableEndLine: 1,
      scannerType: 'gitleaks',
      fileHash: 'secret-hash',
      branch: 'main',
      cvss4Vector: null,
      cvss4BaseScore: null,
      cvss4EnvironmentalScore: null,
      epssScore: null,
      epssPercentile: null,
      epssRefreshedAt: null,
      scoringSource: 'static',
      exploitabilityScore: null,
      exploitabilityVerdict: null,
      exploitabilityReason: null,
      exploitabilitySource: null,
      exploitabilityUpdatedAt: null,
      priorityScore: null,
      vulnerability: null,
      codeSnippets: [],
      historyItems: [],
      autofixRecords: [],
      commitSha: null,
      encryptedSecret: null,
      source: 'head',
      ...overrides,
    } as any;
  }

  describe('mapCicdDetectionEntityToInterface', () => {
    it('maps exploitability + priorityScore fields when present', () => {
      const ts = new Date('2026-04-14T09:00:00Z');
      const entity = makeCicdEntity({
        exploitabilityScore: 0.72,
        exploitabilityVerdict: 'proven',
        exploitabilityReason: 'Workflow executes untrusted input',
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: ts,
        priorityScore: 78.4,
      } as any);

      const result = mapCicdDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBe(0.72);
      expect(result.exploitabilityVerdict).toBe('proven');
      expect(result.exploitabilityReason).toBe(
        'Workflow executes untrusted input',
      );
      expect(result.exploitabilitySource).toBe('agent');
      expect(result.exploitabilityUpdatedAt).toBe(ts.toISOString());
      expect(result.priorityScore).toBe(78.4);
    });

    it('maps exploitability + priorityScore as undefined when null', () => {
      const entity = makeCicdEntity();

      const result = mapCicdDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBeUndefined();
      expect(result.exploitabilityVerdict).toBeUndefined();
      expect(result.exploitabilityReason).toBeUndefined();
      expect(result.exploitabilitySource).toBeUndefined();
      expect(result.exploitabilityUpdatedAt).toBeUndefined();
      expect(result.priorityScore).toBeUndefined();
    });
  });

  describe('mapSecretDetectionEntityToInterface', () => {
    it('maps exploitability + priorityScore fields when present', () => {
      const ts = new Date('2026-04-14T08:00:00Z');
      const entity = makeSecretEntity({
        exploitabilityScore: 0.95,
        exploitabilityVerdict: 'actively_exploited',
        exploitabilityReason: 'Secret committed to public repo',
        exploitabilitySource: 'manual',
        exploitabilityUpdatedAt: ts,
        priorityScore: 92.1,
      } as any);

      const result = mapSecretDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBe(0.95);
      expect(result.exploitabilityVerdict).toBe('actively_exploited');
      expect(result.exploitabilityReason).toBe(
        'Secret committed to public repo',
      );
      expect(result.exploitabilitySource).toBe('manual');
      expect(result.exploitabilityUpdatedAt).toBe(ts.toISOString());
      expect(result.priorityScore).toBe(92.1);
    });

    it('maps exploitability + priorityScore as undefined when null', () => {
      const entity = makeSecretEntity();

      const result = mapSecretDetectionEntityToInterface(entity);

      expect(result.exploitabilityScore).toBeUndefined();
      expect(result.exploitabilityVerdict).toBeUndefined();
      expect(result.exploitabilityReason).toBeUndefined();
      expect(result.exploitabilitySource).toBeUndefined();
      expect(result.exploitabilityUpdatedAt).toBeUndefined();
      expect(result.priorityScore).toBeUndefined();
    });
  });

  // ==========================================================================
  // Stale-agent-analysis flag
  // ==========================================================================

  describe('exploitabilityStale flag', () => {
    const olderAnalysis = new Date('2026-04-10T08:00:00Z');
    const newerContext = new Date('2026-04-20T08:00:00Z');
    const olderContext = new Date('2026-04-05T08:00:00Z');

    it('flags SAST agent verdict as stale when securityContext is newer', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapSastDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(true);
      expect(result.securityContextUpdatedAt).toBe(newerContext.toISOString());
    });

    it('does not flag SAST agent verdict as stale when context is older', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapSastDetectionEntityToInterface(
        entity,
        undefined,
        olderContext,
      );

      expect(result.exploitabilityStale).toBe(false);
    });

    it('does not flag manual override as stale even when context is newer', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'manual',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapSastDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(false);
    });

    it('does not flag static (code-based) verdict as stale', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'static',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapSastDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(false);
    });

    it('does not flag as stale when no agent analysis has run yet', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: null,
      } as any);

      const result = mapSastDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(false);
    });

    it('leaves stale and contextUpdatedAt undefined when no security context is supplied', () => {
      const entity = makeSastEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapSastDetectionEntityToInterface(entity);

      expect(result.exploitabilityStale).toBeUndefined();
      expect(result.securityContextUpdatedAt).toBeUndefined();
    });

    it('flags IAC agent verdict as stale', () => {
      const entity = makeIacEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapIacDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(true);
      expect(result.securityContextUpdatedAt).toBe(newerContext.toISOString());
    });

    it('flags CICD agent verdict as stale', () => {
      const entity = makeCicdEntity({
        exploitabilitySource: 'agent',
        exploitabilityUpdatedAt: olderAnalysis,
      } as any);

      const result = mapCicdDetectionEntityToInterface(
        entity,
        undefined,
        newerContext,
      );

      expect(result.exploitabilityStale).toBe(true);
      expect(result.securityContextUpdatedAt).toBe(newerContext.toISOString());
    });
  });
});

describe('mapVulnerabilityEntityToListMetadata', () => {
  const baseVuln = {
    id: 'v-1',
    name: 'SQL Injection',
    shortDescription: 'Tainted SQL',
    description: 'A VERY LONG MARKDOWN BODY '.repeat(2000),
    howToPrevent: 'Use parameterized queries. '.repeat(500),
    owaspTop10: ['A03:2021 - Injection '],
    severity: 'high',
    language: 'JavaScript',
    vulnerabilityType: 'sast',
    cwe: ['CWE-89'],
    references: [
      { id: 'r1', url: 'https://example.test/cwe-89', name: 'OWASP' },
      { id: 'r2', url: 'https://example.test/sql', name: 'Wiki' },
    ],
    cvss3: { baseScore: '7.5', vector: 'CVSS:3.1/...' },
    codeExamples: Array.from({ length: 30 }, (_, i) => ({
      filename: `example-${i}.js`,
      content: `// Large code snippet ${i}\n`.repeat(200),
    })),
    sourceMetadata: { category: 'security', technology: ['javascript'] },
  } as any;

  it('blanks out description / howToPrevent / references / codeExamples / sourceMetadata', () => {
    const out = mapVulnerabilityEntityToListMetadata(baseVuln);
    expect(out.description).toBe('');
    expect(out.howToPrevent).toBe('');
    expect(out.references).toEqual([]);
    expect(out.codeExamples).toEqual([]);
    expect(out.sourceMetadata).toBeUndefined();
  });

  it('preserves identity / cwe / severity / language / owasp / cvss3 used by the list table', () => {
    const out = mapVulnerabilityEntityToListMetadata(baseVuln);
    expect(out.id).toBe('v-1');
    expect(out.name).toBe('SQL Injection');
    expect(out.cwe).toEqual(['CWE-89']);
    expect(out.cweArray).toEqual(['CWE-89']);
    expect(out.severity).toBe('high');
    expect(out.language).toBe('JavaScript');
    expect(out.vulnerabilityType).toBe('sast');
    expect(out.owaspTop10).toEqual(['A03:2021 - Injection']);
    expect(out.cvss3).toEqual({ baseScore: '7.5', vector: 'CVSS:3.1/...' });
  });

  it('keeps shortDescription (small and shown in card tooltips)', () => {
    const out = mapVulnerabilityEntityToListMetadata(baseVuln);
    expect(out.shortDescription).toBe('Tainted SQL');
  });

  it('handles missing optional fields without throwing', () => {
    const sparse = { id: 'v-2', name: 'X', cwe: [], severity: 'low' } as any;
    const out = mapVulnerabilityEntityToListMetadata(sparse);
    expect(out.description).toBe('');
    expect(out.howToPrevent).toBe('');
    expect(out.references).toEqual([]);
    expect(out.codeExamples).toEqual([]);
    expect(out.cvss3).toBeUndefined();
    expect(out.owaspTop10).toEqual([]);
  });
});

// The catalogue rule code (`CD-<TYPE>-<NNNN>`) is the only id a
// `cybedefend-ignore[...]` directive accepts, so every view of a finding must
// carry it: the detail and grouped views (full metadata mapper) as much as the
// flat lists (whitelisting list mapper).
describe('catalogue rule code', () => {
  const ruleWithCode = {
    id: 'v-205',
    name: 'Cloud Storage Bucket Logging Not Enabled',
    shortDescription: 'bucket logging disabled',
    cwe: ['CWE-778'],
    severity: 'medium',
    language: 'Terraform',
    vulnerabilityType: 'iac',
    code: 'CD-IAC-0123',
  } as Partial<Vulnerability> as Vulnerability;

  it('mapVulnerabilityEntityToMetadata carries the code (detail and grouped views)', () => {
    expect(mapVulnerabilityEntityToMetadata(ruleWithCode).code).toBe(
      'CD-IAC-0123',
    );
  });

  it('mapVulnerabilityEntityToListMetadata carries the code (flat list whitelist)', () => {
    expect(mapVulnerabilityEntityToListMetadata(ruleWithCode).code).toBe(
      'CD-IAC-0123',
    );
  });

  it.each([
    ['sast', mapSastDetectionEntityToInterface],
    ['iac', mapIacDetectionEntityToInterface],
    ['cicd', mapCicdDetectionEntityToInterface],
  ] as const)(
    'the %s detail mapper exposes it on vulnerability.code',
    (kind, mapper) => {
      const detection = { ...makeDetection(kind), vulnerability: ruleWithCode };
      expect(mapper(detection).vulnerability?.code).toBe('CD-IAC-0123');
    },
  );
});

function makeFatVuln() {
  return {
    id: 'v-fat',
    name: 'Big',
    shortDescription: 'short',
    description: 'X'.repeat(50_000),
    howToPrevent: 'Y'.repeat(50_000),
    owaspTop10: [],
    severity: 'critical',
    language: 'JavaScript',
    vulnerabilityType: 'sast',
    cwe: ['CWE-1'],
    references: [
      { id: 'r1', url: 'https://e.test/' + 'p'.repeat(500), name: 'R1' },
    ],
    cvss3: { baseScore: '9.8', vector: 'CVSS:3.1/...' },
    codeExamples: [{ filename: 'a.js', content: 'Z'.repeat(80_000) }],
    sourceMetadata: { category: 'security' },
  } as any;
}

function makeDetection(type: 'sast' | 'iac' | 'cicd' | 'secret') {
  return {
    id: `det-${type}`,
    projectId: 'p1',
    createdAt: new Date('2025-02-01T00:00:00Z'),
    updatedAt: new Date('2025-02-02T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'critical',
    currentPriority: 'critical_urgent',
    branch: 'main',
    scoringSource: 'static',
    vulnerability: makeFatVuln(),
    codeSnippets: [],
    historyItems: [],
    autofixRecords: [],
    path: type === 'sast' ? 'src/app.js' : 'infra/x.yaml',
    vulnerableStartLine: 1,
    vulnerableEndLine: 1,
  } as any;
}

describe.each([
  ['sast', mapSastDetectionEntityToListInterface],
  ['iac', mapIacDetectionEntityToListInterface],
  ['cicd', mapCicdDetectionEntityToListInterface],
  ['secret', mapSecretDetectionEntityToListInterface],
] as const)('%s list mapper', (kind, mapper) => {
  it(`uses the light metadata mapper for ${kind} (no description/howToPrevent/codeExamples/references)`, () => {
    const det = makeDetection(kind as any);
    const out = mapper(det);
    expect(out.vulnerability?.description).toBe('');
    expect(out.vulnerability?.howToPrevent).toBe('');
    expect(out.vulnerability?.codeExamples).toEqual([]);
    expect(out.vulnerability?.references).toEqual([]);
    expect(out.vulnerability?.sourceMetadata).toBeUndefined();
  });

  it(`preserves identity / severity / path / cwe for ${kind} (used by the dashboard list)`, () => {
    const det = makeDetection(kind as any);
    const out = mapper(det);
    expect(out.id).toBe(`det-${kind}`);
    expect(out.currentSeverity).toBe('critical');
    expect(out.vulnerability?.name).toBe('Big');
    expect(out.vulnerability?.cwe).toEqual(['CWE-1']);
  });

  it(`payload stays small after light mapping for ${kind}`, () => {
    const det = makeDetection(kind as any);
    const out = mapper(det);
    const sizeKb = JSON.stringify(out).length / 1024;
    expect(sizeKb).toBeLessThan(20);
  });

  it(`keeps the catalogue rule code for ${kind}`, () => {
    const det = makeDetection(kind);
    det.vulnerability.code = 'CD-SAST-0042';
    const out = mapper(det);
    expect(out.vulnerability?.code).toBe('CD-SAST-0042');
  });
});
