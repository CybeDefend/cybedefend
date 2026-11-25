import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { SastIacService } from './sast-iac.service';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { Logger } from 'nestjs-pino';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import {
  computeCodeFingerprint,
  computeSecretValueFingerprint,
} from '../findings-export/fingerprint.util';

/**
 * The "Produces" contract of Task 3: EVERY newly created code-family detection
 * carries a non-null fingerprint, and every path that re-detects an existing
 * one emits shadow-mode evidence (FINGERPRINT_MISMATCH) and backfills a NULL
 * without ever overwriting a stored value.
 *
 * These assertions are the regression net that makes the shadow release
 * meaningful: without them, deleting the fingerprint assignment leaves the
 * whole suite green and the next release flips matching onto a column that
 * stopped being written.
 */
describe('SastIacUtilsService — fingerprint at ingestion (shadow mode)', () => {
  let utils: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let cicdRepo: any;
  let secretRepo: any;
  let correspondanceRepo: any;
  let codeSnippetRepo: any;
  let dataFlowRepo: any;
  let logger: ReturnType<typeof createLoggerMock>;

  const snippetLines = [{ line: 9, content: 'eval(userInput);' }];

  const makeDto = (over: Record<string, unknown> = {}) =>
    ({
      ruleId: 'javascript.lang.security.rule-a',
      path: 'src/a.ts',
      language: 'typescript',
      fileHash: 'hash-1',
      codeSnippet: {
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        startLine: 7,
        endLine: 11,
        code: snippetLines,
      },
      dataFlow: [],
      ...over,
    }) as any;

  const makeCorrespondance = (vulnerabilityType: string) =>
    ({
      ruleId: 'rule-a',
      scanner: 'semgrep',
      vulnerabilityType,
      vulnerability: { id: 'cat-1', severity: 'high' },
    }) as any;

  const expected = (over: Record<string, unknown> = {}) =>
    computeCodeFingerprint({
      projectId: 'p1',
      branch: 'main',
      scannerType: 'semgrep',
      catalogVulnId: 'cat-1',
      path: 'src/a.ts',
      snippetLines,
      vulnerableStartLine: 9,
      vulnerableEndLine: 9,
      occurrenceIndex: 0,
      ...over,
    } as any);

  // A secret reported with its value is identified by its value: the code
  // digest with the keyed value hash in place of the snippet, index 0.
  const expectedForSecretValue = () =>
    computeSecretValueFingerprint({
      projectId: 'p1',
      branch: 'main',
      scannerType: 'semgrep',
      catalogVulnId: 'cat-1',
      path: 'src/a.ts',
      secretValueHash: 'h:AKIAIOSFODNN7EXAMPLE',
    });
  const expectedFor = (type: string) =>
    type === 'secret' ? expectedForSecretValue() : expected();

  beforeEach(async () => {
    const emptyFind = () => ({
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (e: any) => e),
    });
    sastRepo = emptyFind();
    iacRepo = emptyFind();
    cicdRepo = emptyFind();
    secretRepo = emptyFind();
    correspondanceRepo = createMockRepository();
    codeSnippetRepo = createMockRepository();
    dataFlowRepo = createMockRepository();
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        { provide: getRepositoryToken(CodeSnippet), useValue: codeSnippetRepo },
        { provide: getRepositoryToken(DataFlowItem), useValue: dataFlowRepo },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: correspondanceRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: iacRepo,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: cicdRepo,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: secretRepo,
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', priorityScore: 0.5 }),
            addHistoryItem: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: IssueIntegrationService, useValue: {} },
        { provide: Logger, useValue: logger },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'v1:iv:ct:tag'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 9.3 }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    utils = module.get(SastIacUtilsService);
    jest
      .spyOn(utils as any, 'addVulnerabilityDetectionHistory')
      .mockResolvedValue(undefined);
    jest
      .spyOn(utils as any, 'addCodeSnippetToDetection')
      .mockResolvedValue(undefined);
    jest
      .spyOn(utils as any, 'addDataFlowItemsToDetection')
      .mockResolvedValue(undefined);
  });

  const warnedMessages = () =>
    logger.warn.mock.calls.map((c: any[]) => String(c[0]));

  // ── createNewVulnerability: the "Produces" contract, all four families ──

  it.each([
    ['sast', () => sastRepo],
    ['iac', () => iacRepo],
    ['cicd', () => cicdRepo],
    ['secret', () => secretRepo],
  ])('stamps the fingerprint on a new %s detection', async (type, repoOf) => {
    await utils.createNewVulnerability(
      makeDto(type === 'secret' ? { secretValue: 'AKIAIOSFODNN7EXAMPLE' } : {}),
      makeCorrespondance(type),
      'scan-1',
      'p1',
      'semgrep',
      'main',
      0,
    );

    const saved = repoOf().save.mock.calls[0][0];
    expect(saved.fingerprint).toBe(expectedFor(type));
  });

  it('threads the occurrence index into the digest of a new detection', async () => {
    await utils.createNewVulnerability(
      makeDto(),
      makeCorrespondance('sast'),
      'scan-1',
      'p1',
      'semgrep',
      'main',
      2,
    );

    expect(sastRepo.save.mock.calls[0][0].fingerprint).toBe(
      expected({ occurrenceIndex: 2 }),
    );
  });

  // ── scannerRuleId: only an imported SARIF finding keeps its tool's id ──

  // The import ingests a finding under its catalogue key (`imported-…`);
  // the rule id as written in the file stays in `ruleMetadata.ruleId`.
  const CATALOGUE_KEY = 'imported-0123456789abcdef0123456789abcdef01234567';
  const sarifMetadata = {
    toolName: 'semgrep',
    ruleId: 'javascript.lang.security.rule-a',
    name: 'Rule A',
    shortDescription: '',
    fullDescription: '',
    helpMarkdown: '',
    cwe: [],
    severity: 'high',
    helpUri: '',
    owaspTop10: [],
  };

  it.each([
    ['sast', () => sastRepo],
    ['iac', () => iacRepo],
    ['cicd', () => cicdRepo],
    ['secret', () => secretRepo],
  ])(
    'stores the SARIF rule id, as written, on a new imported %s detection',
    async (type, repoOf) => {
      await utils.createNewVulnerability(
        makeDto({
          ruleId: CATALOGUE_KEY,
          ruleMetadata: sarifMetadata,
          ...(type === 'secret' ? { secretValue: 'AKIAIOSFODNN7EXAMPLE' } : {}),
        }),
        makeCorrespondance(type),
        'scan-1',
        'p1',
        'semgrep',
        'main',
        0,
      );

      expect(repoOf().save.mock.calls[0][0].scannerRuleId).toBe(
        'javascript.lang.security.rule-a',
      );
    },
  );

  it("never stores a built-in scanner's rule id", async () => {
    await utils.createNewVulnerability(
      makeDto(),
      makeCorrespondance('sast'),
      'scan-1',
      'p1',
      'semgrep',
      'main',
      0,
    );

    expect(sastRepo.save.mock.calls[0][0].scannerRuleId).toBeNull();
  });

  it('backfills the SARIF rule id of a re-imported detection that has none', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: expected(),
      scannerRuleId: null,
    });

    await utils.updateExistingVulnerability(
      existing,
      'scan-1',
      makeDto({ ruleId: CATALOGUE_KEY, ruleMetadata: sarifMetadata }),
      makeCorrespondance('sast'),
      0,
    );

    expect(sastRepo.save.mock.calls[0][0].scannerRuleId).toBe(
      'javascript.lang.security.rule-a',
    );
  });

  // ── the unrankable batch: no index means no digest, never index 0 ──────

  /**
   * `SastIacService.computeOccurrenceIndexes` returns `null` for a batch whose
   * catalogue ids could not be resolved. A null index is NOT "index 0": ranking
   * such a batch at 0 while a sibling batch of the same scan legitimately
   * ranked its twin at 0 persists ONE fingerprint on TWO rows. A NULL
   * fingerprint costs one scan of shadow evidence and is what the entire
   * pre-existing corpus already carries.
   */
  it('writes NO fingerprint when the batch could not be ranked', async () => {
    await utils.createNewVulnerability(
      makeDto(),
      makeCorrespondance('sast'),
      'scan-1',
      'p1',
      'semgrep',
      'main',
      null,
    );

    expect(sastRepo.save.mock.calls[0][0].fingerprint).toBeNull();
  });

  it('emits no FINGERPRINT_MISMATCH for an unrankable batch', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: 'a-perfectly-good-digest',
    });

    await utils.updateExistingVulnerability(
      existing,
      'scan-1',
      makeDto(),
      makeCorrespondance('sast'),
      null,
    );

    // The stored value is correct; only the recomputation is unavailable.
    // Warning here would be a false alarm on every finding of the batch.
    expect(existing.fingerprint).toBe('a-perfectly-good-digest');
    expect(
      warnedMessages().some((m) => m.includes('FINGERPRINT_MISMATCH')),
    ).toBe(false);
  });

  it('does not backfill a NULL fingerprint from an unrankable batch', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-2',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: null,
    });

    await utils.updateExistingVulnerability(
      existing,
      'scan-1',
      makeDto(),
      makeCorrespondance('sast'),
      null,
    );

    expect(existing.fingerprint).toBeNull();
  });

  // ── the backfill must never MINT the duplicate the NULL avoided ────────

  /**
   * The all-null return of an unrankable batch is only safe if the backfill
   * that later fills those NULLs cannot itself create the duplicate identity
   * the NULL was chosen to avoid. It can:
   *
   * Scan S1, group G with twins at lines 10 and 400 split across batches. The
   * healthy batch gets index 0 for the line-400 twin, so R400 = FP(G,0). The
   * other batch hits the Redis blip, so R10 = NULL. Scan S2 is healthy and both
   * twins land in ONE batch: ascending line gives R10 index 0 and R400 index 1.
   * R10's NULL is backfilled to FP(G,0) — which R400 already holds — while R400
   * only logs a FINGERPRINT_MISMATCH and is deliberately never overwritten.
   * Two rows, one identity, permanently: a hard ER_DUP_ENTRY when
   * `UNIQUE (projectId, branch, fingerprint)` is added, and two distinct
   * findings merged after the matching switch-over.
   *
   * So a NULL is backfilled only with a digest NO OTHER row of the project
   * holds. The check is order-independent, which the mismatch signal is not:
   * the two twins are processed by concurrent workers in an arbitrary order.
   */
  describe('backfill refuses a digest another row already holds', () => {
    const nullRow = (over: Record<string, unknown> = {}) =>
      Object.assign(new SastVulnerabilityDetections(), {
        id: 'det-10',
        projectId: 'p1',
        scannerType: 'semgrep',
        branch: 'main',
        currentState: 'to_verify',
        fingerprint: null,
        ...over,
      });

    it('leaves the row NULL when a sibling detection holds the expected digest', async () => {
      const existing = nullRow();
      sastRepo.findOne.mockResolvedValue({ id: 'det-400' });

      await utils.updateExistingVulnerability(
        existing,
        'scan-1',
        makeDto(),
        makeCorrespondance('sast'),
        0,
      );

      expect(existing.fingerprint).toBeNull();
    });

    it('reports the refusal so the mis-stamped group is repairable', async () => {
      sastRepo.findOne.mockResolvedValue({ id: 'det-400' });

      await utils.updateExistingVulnerability(
        nullRow(),
        'scan-1',
        makeDto(),
        makeCorrespondance('sast'),
        0,
      );

      expect(
        warnedMessages().some(
          (m) =>
            m.includes('FINGERPRINT_COLLISION') &&
            m.includes('det-10') &&
            m.includes('det-400'),
        ),
      ).toBe(true);
    });

    it('looks the digest up scoped to the project, on the indexed column', async () => {
      sastRepo.findOne.mockResolvedValue(null);

      await utils.updateExistingVulnerability(
        nullRow(),
        'scan-1',
        makeDto(),
        makeCorrespondance('sast'),
        0,
      );

      expect(sastRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'p1',
            fingerprint: expected(),
          }),
        }),
      );
    });

    it('still backfills when the only holder is the row itself', async () => {
      // A stale in-memory copy of the very row being written must not block its
      // own backfill — that would make the whole corpus unbackfillable.
      const existing = nullRow({ id: 'det-self' });
      sastRepo.findOne.mockResolvedValue({ id: 'det-self' });

      await utils.updateExistingVulnerability(
        existing,
        'scan-1',
        makeDto(),
        makeCorrespondance('sast'),
        0,
      );

      expect(existing.fingerprint).toBe(expected());
    });

    it('never produces one digest on two rows, in either processing order', async () => {
      // The full scenario. R400 carries S1's FP(G,0); R10 is the NULL S1 left.
      // S2 ranks them 0 and 1 and the two are handled by concurrent workers, so
      // neither order may end with r10.fingerprint === r400.fingerprint.
      const run = async (reverse: boolean) => {
        const r10 = nullRow({ id: 'det-10' });
        const r400 = Object.assign(new SastVulnerabilityDetections(), {
          id: 'det-400',
          projectId: 'p1',
          scannerType: 'semgrep',
          branch: 'main',
          currentState: 'to_verify',
          fingerprint: expected(),
        });
        // Stands in for MySQL: the digest lookup sees whatever is stored.
        sastRepo.findOne.mockImplementation(async (opts: any) => {
          const fp = opts?.where?.fingerprint;
          return [r10, r400].find((r) => r.fingerprint === fp) ?? null;
        });

        const work = [
          () =>
            utils.updateExistingVulnerability(
              r10,
              'scan-2',
              makeDto(),
              makeCorrespondance('sast'),
              0,
            ),
          () =>
            utils.updateExistingVulnerability(
              r400,
              'scan-2',
              makeDto(),
              makeCorrespondance('sast'),
              1,
            ),
        ];
        for (const step of reverse ? work.reverse() : work) await step();
        return { r10, r400 };
      };

      for (const reverse of [false, true]) {
        const { r10, r400 } = await run(reverse);
        expect(r10.fingerprint).toBeNull();
        expect(r400.fingerprint).toBe(expected());
      }
    });

    it('applies to the fileHash-changed branch too', async () => {
      const existing = Object.assign(new SastVulnerabilityDetections(), {
        id: 'det-10',
        projectId: 'p1',
        scannerType: 'semgrep',
        branch: 'main',
        path: 'src/a.ts',
        language: 'typescript',
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        currentState: 'to_verify',
        fileHash: 'OLD-hash',
        fingerprint: null,
        vulnerability: { id: 'cat-1' },
      });
      correspondanceRepo.findOne.mockResolvedValue(makeCorrespondance('sast'));
      sastRepo.findOne.mockResolvedValue({ id: 'det-400' });
      const map = new Map<string, any[]>([['semgrep:rule-a', [existing]]]);

      await utils.processVulnerability(
        makeDto({ fileHash: 'NEW-hash' }),
        map as any,
        [],
        [],
        'scan-1',
        'p1',
        'semgrep',
        'high',
        'main',
        0,
      );

      expect(existing.fingerprint).toBeNull();
    });

    it.each([
      ['secret', () => secretRepo],
      ['cicd', () => cicdRepo],
    ])(
      'applies to the %s alreadyExists short-circuit too',
      async (type, repoOf) => {
        const duplicate = {
          id: `det-${type}`,
          fingerprint: null,
          fileHash: 'hash-1',
          projectId: 'p1',
          scannerType: 'semgrep',
          branch: 'main',
          vulnerability: { id: 'cat-1' },
          vulnerabilityDetectionHistory: [{ scanId: 'scan-1' }],
          currentState: 'to_verify',
        };
        repoOf().find.mockResolvedValue([duplicate]);
        // The digest is held by another row. A secret's value lookup (keyed
        // on its value hash) finds nothing: the duplicate predates hashes.
        repoOf().findOne.mockImplementation(async ({ where }: any) =>
          where?.secretValueHash ? null : { id: 'someone-else' },
        );

        await utils.createNewVulnerability(
          makeDto(
            type === 'secret' ? { secretValue: 'AKIAIOSFODNN7EXAMPLE' } : {},
          ),
          makeCorrespondance(type),
          'scan-1',
          'p1',
          'semgrep',
          'main',
          0,
        );

        expect(duplicate.fingerprint).toBeNull();
        // Nothing was backfilled, so nothing must be written.
        expect(repoOf().save).not.toHaveBeenCalled();
      },
    );
  });

  // ── updateExistingVulnerability: divergence evidence ───────────────────

  it('warns FINGERPRINT_MISMATCH and never overwrites on a re-detected SAST row', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: 'stale-digest',
    });

    await utils.updateExistingVulnerability(
      existing,
      'scan-1',
      makeDto(),
      makeCorrespondance('sast'),
      0,
    );

    expect(existing.fingerprint).toBe('stale-digest');
    expect(
      warnedMessages().some(
        (m) =>
          m.includes('FINGERPRINT_MISMATCH') &&
          m.includes('det-1') &&
          m.includes(expected()),
      ),
    ).toBe(true);
  });

  it('backfills a NULL fingerprint on a re-detected SAST row without warning', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      currentState: 'to_verify',
      fingerprint: null,
    });

    await utils.updateExistingVulnerability(
      existing,
      'scan-1',
      makeDto(),
      makeCorrespondance('sast'),
      0,
    );

    expect(existing.fingerprint).toBe(expected());
    expect(
      warnedMessages().some((m) => m.includes('FINGERPRINT_MISMATCH')),
    ).toBe(false);
  });

  // ── the fileHash-changed branch: the guaranteed-divergence path ────────

  it('emits divergence evidence when the vulnerable code changed (fileHash branch)', async () => {
    // This branch fires exactly when the code changed, i.e. when
    // computeCodeFingerprint is designed to move. It saved the row directly,
    // bypassing updateExistingVulnerability, so it produced no evidence at all
    // — the single highest-value signal of the shadow release.
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      path: 'src/a.ts',
      language: 'typescript',
      vulnerableStartLine: 9,
      vulnerableEndLine: 9,
      currentState: 'to_verify',
      fileHash: 'OLD-hash',
      fingerprint: 'digest-of-the-old-code',
      vulnerability: { id: 'cat-1' },
    });

    correspondanceRepo.findOne.mockResolvedValue(makeCorrespondance('sast'));
    const map = new Map<string, any[]>([['semgrep:rule-a', [existing]]]);

    await utils.processVulnerability(
      makeDto({ fileHash: 'NEW-hash' }),
      map as any,
      [],
      [],
      'scan-1',
      'p1',
      'semgrep',
      'high',
      'main',
      0,
    );

    expect(existing.fileHash).toBe('NEW-hash');
    expect(
      warnedMessages().some(
        (m) => m.includes('FINGERPRINT_MISMATCH') && m.includes('det-1'),
      ),
    ).toBe(true);
    // Never overwritten — the drift is what we are measuring.
    expect(existing.fingerprint).toBe('digest-of-the-old-code');
  });

  it('backfills a NULL fingerprint on the fileHash-changed branch', async () => {
    const existing = Object.assign(new SastVulnerabilityDetections(), {
      id: 'det-2',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      path: 'src/a.ts',
      language: 'typescript',
      vulnerableStartLine: 9,
      vulnerableEndLine: 9,
      currentState: 'to_verify',
      fileHash: 'OLD-hash',
      fingerprint: null,
      vulnerability: { id: 'cat-1' },
    });

    correspondanceRepo.findOne.mockResolvedValue(makeCorrespondance('sast'));
    const map = new Map<string, any[]>([['semgrep:rule-a', [existing]]]);

    await utils.processVulnerability(
      makeDto({ fileHash: 'NEW-hash' }),
      map as any,
      [],
      [],
      'scan-1',
      'p1',
      'semgrep',
      'high',
      'main',
      0,
    );

    expect(existing.fingerprint).toBe(expected());
  });

  // ── secret / cicd re-detections: they never reach updateExistingVulnerability ──

  it.each([
    ['secret', () => secretRepo],
    ['cicd', () => cicdRepo],
  ])(
    'backfills a NULL fingerprint on a re-detected %s finding (alreadyExists path)',
    async (type, repoOf) => {
      // getExistingVulnerabilities only maps sast + iac, so a re-detected
      // secret/cicd falls through to createNewVulnerability and hits the
      // duplicate short-circuit. Without this, two of the six families produce
      // no shadow-mode data at all.
      const duplicate = {
        id: `det-${type}`,
        fingerprint: null,
        fileHash: 'hash-1',
        projectId: 'p1',
        scannerType: 'semgrep',
        branch: 'main',
        vulnerability: { id: 'cat-1' },
        vulnerabilityDetectionHistory: [{ scanId: 'scan-1' }],
        currentState: 'to_verify',
      };
      repoOf().find.mockResolvedValue([duplicate]);

      await utils.createNewVulnerability(
        makeDto(
          type === 'secret' ? { secretValue: 'AKIAIOSFODNN7EXAMPLE' } : {},
        ),
        makeCorrespondance(type),
        'scan-1',
        'p1',
        'semgrep',
        'main',
        0,
      );

      expect(duplicate.fingerprint).toBe(expectedFor(type));
      // The in-memory mutation is worthless unless it is PERSISTED. This is
      // the only write of a fingerprint onto a re-detected secret/cicd row —
      // deleting the save must turn this suite red, not leave it green.
      expect(repoOf().save).toHaveBeenCalledWith(duplicate);
    },
  );

  // A secret reported with its value is not in this list: its stored digest
  // is the snippet one when the row predates value hashes, so a mismatch is
  // expected and says nothing (next test).
  it.each([['cicd', () => cicdRepo]])(
    'warns FINGERPRINT_MISMATCH on a re-detected %s finding whose digest drifted',
    async (type, repoOf) => {
      const duplicate = {
        id: `det-${type}`,
        fingerprint: 'stale-digest',
        fileHash: 'hash-1',
        projectId: 'p1',
        scannerType: 'semgrep',
        branch: 'main',
        vulnerability: { id: 'cat-1' },
        vulnerabilityDetectionHistory: [{ scanId: 'scan-1' }],
        currentState: 'to_verify',
      };
      repoOf().find.mockResolvedValue([duplicate]);

      await utils.createNewVulnerability(
        makeDto(
          type === 'secret' ? { secretValue: 'AKIAIOSFODNN7EXAMPLE' } : {},
        ),
        makeCorrespondance(type),
        'scan-1',
        'p1',
        'semgrep',
        'main',
        0,
      );

      expect(duplicate.fingerprint).toBe('stale-digest');
      expect(
        warnedMessages().some(
          (m) =>
            m.includes('FINGERPRINT_MISMATCH') && m.includes(`det-${type}`),
        ),
      ).toBe(true);
      // Nothing was backfilled, so nothing must be written: a mismatch is
      // evidence to read, not a row to touch.
      expect(repoOf().save).not.toHaveBeenCalled();
    },
  );

  it('keeps the stored fingerprint of a re-detected secret reported with its value, without a mismatch warning', async () => {
    const duplicate = {
      id: 'det-secret',
      fingerprint: 'snippet-digest',
      fileHash: 'hash-1',
      projectId: 'p1',
      scannerType: 'semgrep',
      branch: 'main',
      vulnerability: { id: 'cat-1' },
      vulnerabilityDetectionHistory: [{ scanId: 'scan-1' }],
      currentState: 'to_verify',
    };
    secretRepo.find.mockResolvedValue([duplicate]);

    await utils.createNewVulnerability(
      makeDto({ secretValue: 'AKIAIOSFODNN7EXAMPLE' }),
      makeCorrespondance('secret'),
      'scan-1',
      'p1',
      'semgrep',
      'main',
      0,
    );

    expect(duplicate.fingerprint).toBe('snippet-digest');
    expect(
      warnedMessages().some((m) => m.includes('FINGERPRINT_MISMATCH')),
    ).toBe(false);
    expect(secretRepo.save).not.toHaveBeenCalled();
  });

  // ── resolveCatalogVulnIds: the occurrence bucket's catalogue resolver ───

  /**
   * The bucket key must be built from the CATALOGUE vulnerability id, which
   * means the batch resolver has to extract the rule id exactly the way
   * `processVulnerability` does — otherwise the ranking buckets findings the
   * digest does not, and hands two colliding rows the same index.
   */
  describe('resolveCatalogVulnIds', () => {
    const whereOf = (call: any[]) => call[0].where;

    it('matches on the last dotted segment, exactly like processVulnerability', async () => {
      correspondanceRepo.find.mockResolvedValue([]);

      await utils.resolveCatalogVulnIds(
        ['javascript.lang.security.rule-a', 'rule-b'],
        'semgrep',
      );

      const where = whereOf(correspondanceRepo.find.mock.calls[0]);
      expect(where.ruleId.value).toEqual(['rule-a', 'rule-b']);
      expect(where.scanner).toBe('semgrep');
      expect(where.enabled).toBe(true);
    });

    it('is many-to-one: several ruleIds resolve onto one catalogue vulnerability', async () => {
      correspondanceRepo.find.mockResolvedValue([
        { ruleId: 'r1', vulnerability: { id: 'V' } },
        { ruleId: 'r2', vulnerability: { id: 'V' } },
      ]);

      const map = await utils.resolveCatalogVulnIds(['r1', 'r2'], 'kics');

      expect(map.get('r1')).toBe('V');
      expect(map.get('r2')).toBe('V');
    });

    /**
     * `correspondance_table` carried duplicates pointing at DIFFERENT
     * catalogue vulnerabilities — `opengrep / unchecked-subprocess-call` had
     * 16 rows and 16 distinct vulnerabilityIds, several kics rules 5-7 —
     * until migration 1835000000001-UniqueCorrespondanceScannerRule deleted
     * them and made (scanner, ruleId) unique. The migration skips the index
     * when duplicates remain, so an environment can still hold some.
     *
     * The bucket resolver (`find`) and the digest resolver (`findOne` in
     * `processVulnerability`) are two differently-planned queries over that
     * table. Unordered, they need not return the same row, and then the bucket
     * is keyed on one catalogue vuln while the digest hashes another: two
     * findings that hash identically land in two buckets, are both ranked 0,
     * and are persisted with ONE fingerprint. Both queries therefore order by
     * `id` and take the first row.
     */
    it('agrees with processVulnerability on a DUPLICATED (scanner, ruleId)', async () => {
      const rows = [
        {
          id: 'b',
          ruleId: 'rule-a',
          scanner: 'semgrep',
          enabled: true,
          vulnerabilityType: 'sast',
          vulnerability: { id: 'cat-B', severity: 'high' },
        },
        {
          id: 'a',
          ruleId: 'rule-a',
          scanner: 'semgrep',
          enabled: true,
          vulnerabilityType: 'sast',
          vulnerability: { id: 'cat-A', severity: 'high' },
        },
      ];
      // Stands in for MySQL: rows come back in whatever order the plan yields
      // unless an ORDER BY pins them. The two call sites get opposite orders,
      // which is exactly the production hazard.
      const ordered = (opts: any) =>
        opts?.order?.id === 'ASC'
          ? [...rows].sort((x, y) => x.id.localeCompare(y.id))
          : rows;
      correspondanceRepo.find.mockImplementation(async (o: any) => ordered(o));
      correspondanceRepo.findOne.mockImplementation(
        async (o: any) => ordered(o)[0],
      );

      const bucketCatalogId = (
        await utils.resolveCatalogVulnIds(['rule-a'], 'semgrep')
      ).get('rule-a');

      await utils.processVulnerability(
        makeDto(),
        new Map() as any,
        [],
        [],
        'scan-1',
        'p1',
        'semgrep',
        'high',
        'main',
        0,
      );
      const digestCatalogId = sastRepo.save.mock.calls[0][0].vulnerability.id;

      expect(bucketCatalogId).toBe(digestCatalogId);
    });

    it('chunks the IN list so a large batch cannot fail as one oversized query', async () => {
      // A deterministic failure on big scans would silently degrade EVERY
      // large batch's bucket key — far worse than the transient blip the catch
      // block exists for.
      correspondanceRepo.find.mockResolvedValue([]);
      const ruleIds = Array.from({ length: 1201 }, (_, i) => `rule-${i}`);

      await utils.resolveCatalogVulnIds(ruleIds, 'kics');

      const sizes = correspondanceRepo.find.mock.calls.map(
        (c: any[]) => whereOf(c).ruleId.value.length,
      );
      expect(sizes.length).toBeGreaterThan(1);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
      expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(1201);
    });
  });

  // ── processVulnerability: the scan's severities, read on the catalogue ──

  /**
   * The diff scan keeps a finding with this very rule
   * (`isCatalogSeverityRequested`), so a diff scan never reports what the
   * full scan would not.
   */
  describe('processVulnerability — the severities the scan asked for', () => {
    const processWith = (severities: string) =>
      utils.processVulnerability(
        makeDto(),
        new Map(),
        [],
        [],
        'scan-1',
        'p1',
        'semgrep',
        severities,
        'main',
        0,
      );

    it('raises nothing when the catalogue severity is not one the scan asked for', async () => {
      correspondanceRepo.findOne.mockResolvedValue(makeCorrespondance('sast'));

      await processWith('CRITICAL,MEDIUM');

      expect(sastRepo.save).not.toHaveBeenCalled();
    });

    it('raises the finding when the scan asked for its catalogue severity, whatever the case', async () => {
      correspondanceRepo.findOne.mockResolvedValue(makeCorrespondance('sast'));

      await processWith('CRITICAL, HIGH');

      expect(sastRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // ── resolveCatalogRules: catalogue id AND code, for the ignore decision ─

  /**
   * A `cybedefend-ignore[CD-…]` directive is decided against the
   * code of the catalogue rule the issue resolves to, so the batch resolver
   * must pick the very row `processVulnerability` would create the finding
   * against: same predicate, same order, first row wins.
   */
  describe('resolveCatalogRules', () => {
    type FindOptions = {
      where: { ruleId: { value: string[] }; scanner: string; enabled: boolean };
      relations?: string[];
      order?: { id?: string };
    };
    const findCalls = (): FindOptions[] =>
      correspondanceRepo.find.mock.calls.map((c: [FindOptions]) => c[0]);

    it('queries on the last dotted segment, the scanner and enabled rows, ordered by id', async () => {
      correspondanceRepo.find.mockResolvedValue([]);

      await utils.resolveCatalogRules(
        ['javascript.lang.security.rule-a', 'rule-b', 'x.rule-b'],
        'semgrep',
      );

      expect(correspondanceRepo.find).toHaveBeenCalledTimes(1);
      const opts = findCalls()[0];
      expect(opts.where.ruleId.value).toEqual(['rule-a', 'rule-b']);
      expect(opts.where.scanner).toBe('semgrep');
      expect(opts.where.enabled).toBe(true);
      expect(opts.relations).toEqual(['vulnerability']);
      expect(opts.order).toEqual({ id: 'ASC' });
    });

    it('returns the catalogue vulnerability id, code and routing type per extracted rule id', async () => {
      correspondanceRepo.find.mockResolvedValue([
        {
          ruleId: 'r1',
          vulnerabilityType: 'iac',
          vulnerability: { id: 'V1', code: 'CD-IAC-0123' },
        },
        {
          ruleId: 'r2',
          vulnerabilityType: 'iac',
          vulnerability: { id: 'V2', code: 'CD-IAC-0456' },
        },
      ]);

      const rules = await utils.resolveCatalogRules(['a.r1', 'r2'], 'kics');

      expect(rules.get('r1')).toEqual({
        vulnerabilityId: 'V1',
        code: 'CD-IAC-0123',
        vulnerabilityType: 'iac',
        name: null,
        severity: null,
        cwe: [],
      });
      expect(rules.get('r2')).toEqual({
        vulnerabilityId: 'V2',
        code: 'CD-IAC-0456',
        vulnerabilityType: 'iac',
        name: null,
        severity: null,
        cwe: [],
      });
    });

    // A diff finding is named, graded and classified by the
    // catalogue, as the full scan raises it, never by the scanner.
    it('returns the catalogue name, severity and CWEs of each rule', async () => {
      correspondanceRepo.find.mockResolvedValue([
        {
          ruleId: 'eval-detected',
          vulnerabilityType: 'sast',
          vulnerability: {
            id: 'V1',
            code: 'CD-SAST-1108',
            name: 'Uncontrolled Eval Execution',
            severity: 'HIGH',
            cwe: ['CWE-79'],
          },
        },
        {
          ruleId: 'bare-row',
          vulnerabilityType: 'sast',
          vulnerability: { id: 'V2', code: 'CD-SAST-0002' },
        },
      ]);

      const rules = await utils.resolveCatalogRules(
        ['python.lang.security.audit.eval-detected', 'bare-row'],
        'opengrep',
      );

      expect(rules.get('eval-detected')).toMatchObject({
        name: 'Uncontrolled Eval Execution',
        severity: 'HIGH',
        cwe: ['CWE-79'],
      });
      expect(rules.get('bare-row')).toMatchObject({
        name: null,
        severity: null,
        cwe: [],
      });
    });

    // The type `createNewVulnerability` routes the finding on: a directive
    // never silences a rule raised as a secret, whatever its scanner.
    it('reports the routing type lower-cased, null when the row carries none', async () => {
      correspondanceRepo.find.mockResolvedValue([
        {
          ruleId: 'hardcoded-key',
          vulnerabilityType: 'Secret',
          vulnerability: { id: 'V1', code: 'CD-SECRET-0007' },
        },
        { ruleId: 'untyped', vulnerability: { id: 'V2', code: null } },
      ]);

      const rules = await utils.resolveCatalogRules(
        ['hardcoded-key', 'untyped'],
        'opengrep',
      );

      expect(rules.get('hardcoded-key')?.vulnerabilityType).toBe('secret');
      expect(rules.get('untyped')?.vulnerabilityType).toBeNull();
    });

    it('reports a null code when the catalogue row carries none', async () => {
      correspondanceRepo.find.mockResolvedValue([
        { ruleId: 'r1', vulnerabilityType: 'iac', vulnerability: { id: 'V1' } },
        {
          ruleId: 'r2',
          vulnerabilityType: 'iac',
          vulnerability: { id: 'V2', code: null },
        },
        {
          ruleId: 'r3',
          vulnerabilityType: 'iac',
          vulnerability: { id: 'V3', code: '' },
        },
      ]);

      const rules = await utils.resolveCatalogRules(['r1', 'r2', 'r3'], 'kics');

      for (const [ruleId, vulnerabilityId] of [
        ['r1', 'V1'],
        ['r2', 'V2'],
        ['r3', 'V3'],
      ]) {
        expect(rules.get(ruleId)).toEqual({
          vulnerabilityId,
          code: null,
          vulnerabilityType: 'iac',
          name: null,
          severity: null,
          cwe: [],
        });
      }
    });

    it('omits rule ids without an enabled correspondance row', async () => {
      correspondanceRepo.find.mockResolvedValue([
        { ruleId: 'r1', vulnerability: { id: 'V1', code: 'CD-SAST-0001' } },
      ]);

      const rules = await utils.resolveCatalogRules(
        ['r1', 'unknown'],
        'bearer',
      );

      expect(rules.has('unknown')).toBe(false);
      expect(rules.size).toBe(1);
    });

    it('agrees with processVulnerability on a DUPLICATED (scanner, ruleId): first row wins', async () => {
      const rows = [
        {
          id: 'b',
          ruleId: 'rule-a',
          scanner: 'semgrep',
          enabled: true,
          // Another family than the row that wins: the type must come from
          // the very row the code comes from.
          vulnerabilityType: 'secret',
          vulnerability: {
            id: 'cat-B',
            severity: 'high',
            code: 'CD-SAST-0002',
          },
        },
        {
          id: 'a',
          ruleId: 'rule-a',
          scanner: 'semgrep',
          enabled: true,
          vulnerabilityType: 'sast',
          vulnerability: {
            id: 'cat-A',
            severity: 'high',
            code: 'CD-SAST-0001',
          },
        },
      ];
      // Stands in for MySQL: without ORDER BY the rows come back in plan order.
      const ordered = (opts?: FindOptions) =>
        opts?.order?.id === 'ASC'
          ? [...rows].sort((x, y) => x.id.localeCompare(y.id))
          : rows;
      correspondanceRepo.find.mockImplementation(async (o: FindOptions) =>
        ordered(o),
      );
      correspondanceRepo.findOne.mockImplementation(
        async (o: FindOptions) => ordered(o)[0],
      );

      const decided = (
        await utils.resolveCatalogRules(['rule-a'], 'semgrep')
      ).get('rule-a');

      await utils.processVulnerability(
        makeDto(),
        new Map(),
        [],
        [],
        'scan-1',
        'p1',
        'semgrep',
        'high',
        'main',
        0,
      );
      const created = sastRepo.save.mock.calls[0][0].vulnerability;

      // The directive is checked against the code (and routing type) of the
      // rule the finding would be raised for — never a sibling row's. A diff
      // finding takes its severity from that same row.
      expect(decided).toEqual({
        vulnerabilityId: created.id,
        code: created.code,
        vulnerabilityType: 'sast',
        name: null,
        severity: created.severity,
        cwe: [],
      });
      expect(decided.code).toBe('CD-SAST-0001');
    });

    it('chunks the IN list at 500 ids', async () => {
      correspondanceRepo.find.mockResolvedValue([]);
      const ruleIds = Array.from({ length: 1201 }, (_, i) => `rule-${i}`);

      await utils.resolveCatalogRules(ruleIds, 'kics');

      const sizes = findCalls().map((o) => o.where.ruleId.value.length);
      expect(sizes).toEqual([500, 500, 201]);
    });

    it('does not query for a batch without rule ids', async () => {
      const rules = await utils.resolveCatalogRules(
        ['', undefined as unknown as string],
        'kics',
      );

      expect(rules.size).toBe(0);
      expect(correspondanceRepo.find).not.toHaveBeenCalled();
    });
  });

  // ── finalizeOldScanVulnerabilities: the line-drift repair pass ─────────

  /**
   * `updateAndRemove` merges a freshly-created row into an older one and then
   * DELETES the new row — which is the row that carries the correct,
   * freshly-computed fingerprint. Without carrying it over:
   *
   * (a) an older row whose fingerprint is NULL and which survives across scans
   *     purely through this repair path is never backfilled by ingestion, so it
   *     is silently excluded from the export forever;
   * (b) `areVulnsSimilar` strips comments before comparing and `normalizeSnippet`
   *     does not, so a comment-only edit inside the vulnerable region matches
   *     here while genuinely changing the digest — divergence that must be
   *     reported, since it is the one class this pass hides by construction.
   */
  describe('the line-drift repair pass (updateAndRemove)', () => {
    const snippet = (line: number, content: string) => ({
      code: JSON.stringify([{ line, content }]),
      vulnerableStartLine: line,
      vulnerableEndLine: line,
      startLine: line,
      endLine: line,
      remove: jest.fn().mockResolvedValue(undefined),
    });

    const mkSast = (over: Record<string, unknown>) =>
      Object.assign(new SastVulnerabilityDetections(), {
        projectId: 'p1',
        scannerType: 'semgrep',
        branch: 'main',
        path: 'src/a.ts',
        language: 'typescript',
        currentState: 'to_verify',
        vulnerability: { id: 'cat-1' },
        codeSnippets: [],
        dataFlowItems: [],
        ...over,
      });

    /**
     * The EntityManager a transaction hands its callback. Its repositories are
     * the very mocks the module was built with, so every assertion on
     * `sastRepo.remove` / `iacRepo.save` observes a transactional write too.
     */
    const transactionalManager = () => ({
      getRepository: (target: unknown) =>
        new Map<unknown, unknown>([
          [SastVulnerabilityDetections, sastRepo],
          [IacVulnerabilityDetections, iacRepo],
          [CicdVulnerabilityDetections, cicdRepo],
          [CodeSnippet, codeSnippetRepo],
          [DataFlowItem, dataFlowRepo],
        ]).get(target),
    });

    beforeEach(() => {
      const transaction = jest.fn(
        async (
          work: (manager: ReturnType<typeof transactionalManager>) => unknown,
        ) => work(transactionalManager()),
      );
      for (const repo of [sastRepo, iacRepo, cicdRepo]) {
        repo.manager = { transaction };
      }
      codeSnippetRepo.remove = jest.fn(async (rows: unknown) => rows);
      dataFlowRepo.remove = jest.fn(async (rows: unknown) => rows);
    });

    /**
     * Drive finalize down the single-candidate branch: one unmatched old row,
     * one row created by THIS scan that `areVulnsSimilar` matches.
     */
    const runRepair = async (older: any, newer: any) => {
      sastRepo.find.mockResolvedValue([older, newer]);
      const histRepo: any = (utils as any).vulnDetectHistoryRepository;
      histRepo.find.mockResolvedValue([{ sastVulnerabilityDetection: newer }]);
      histRepo.findOne.mockResolvedValue({ scanId: 'OLD-SCAN' });
      // The sighted row was created by this scan: no other scan saw it.
      histRepo.exists = jest.fn().mockResolvedValue(false);
      sastRepo.remove = jest.fn(async (e: any) => e);

      await utils.finalizeOldScanVulnerabilities(
        [older],
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );
    };

    it('backfills the surviving row from the fingerprint of the row it deletes', async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: null,
        createdAt: new Date('2020-01-01'),
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest-computed-by-createNewVulnerability',
        createdAt: new Date('2026-01-01'),
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(sastRepo.remove).toHaveBeenCalledWith(newer);
      expect(older.fingerprint).toBe(
        'digest-computed-by-createNewVulnerability',
      );
    });

    it('never merges the finding of another rule into one that disappeared from the same line', async () => {
      // A cybedefend-ignore directive neutralises rule A on a line where rule
      // B still fires: A's finding is absent from this scan while B's is
      // sighted on the very same line. They are two findings — A must be
      // resolved, and B must never be deleted into it.
      const neutralised = mkSast({
        id: 'det-rule-A',
        vulnerability: { id: 'cat-A' },
        currentState: 'confirmed',
        createdAt: new Date('2020-01-01'),
        vulnerableStartLine: 61,
        vulnerableEndLine: 61,
        codeSnippets: [snippet(61, 'containers:')],
      });
      const otherRule = mkSast({
        id: 'det-rule-B',
        vulnerability: { id: 'cat-B' },
        createdAt: new Date('2026-01-01'),
        vulnerableStartLine: 61,
        vulnerableEndLine: 61,
        codeSnippets: [snippet(61, 'containers:')],
      });

      await runRepair(neutralised, otherRule);

      expect(sastRepo.remove).not.toHaveBeenCalled();
      expect(neutralised.currentState).toBe('resolved');
      expect(otherRule.currentState).toBe('to_verify');
    });

    it('warns FINGERPRINT_MISMATCH when the two digests diverge, and keeps the stored one', async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'stored-digest',
        createdAt: new Date('2020-01-01'),
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        // areVulnsSimilar strips the comment, so these two match…
        codeSnippets: [snippet(9, 'eval(x); // old note')],
      });
      const newer = mkSast({
        id: 'det-new',
        // …but normalizeSnippet keeps it, so the digest genuinely moved.
        fingerprint: 'freshly-computed-digest',
        createdAt: new Date('2026-01-01'),
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x); // new note')],
      });

      await runRepair(older, newer);

      expect(older.fingerprint).toBe('stored-digest');
      expect(
        warnedMessages().some(
          (m) =>
            m.includes('FINGERPRINT_MISMATCH') &&
            m.includes('det-old') &&
            m.includes('freshly-computed-digest'),
        ),
      ).toBe(true);
    });

    /**
     * The deleted row is the one THIS scan stamped with today's sighting. If the
     * merge drops it, the survivor exports with a `last_detected_at` weeks old —
     * a finding that IS still present reads to a GRC platform as "probably
     * fixed", which is precisely the ambiguity the column was added to remove.
     */
    it('carries the sighting of the deleted row onto the survivor', async () => {
      const born = new Date('2020-01-01T00:00:00Z');
      const staleSighting = new Date('2026-06-01T00:00:00Z');
      const todaysSighting = new Date('2026-08-06T09:00:00Z');

      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: born,
        firstDetectedAt: born,
        lastDetectedAt: staleSighting,
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: todaysSighting,
        firstDetectedAt: todaysSighting,
        lastDetectedAt: todaysSighting,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(sastRepo.remove).toHaveBeenCalledWith(newer);
      expect(older.lastDetectedAt).toEqual(todaysSighting);
      // …and the window still opens at the EARLIER of the two.
      expect(older.firstDetectedAt).toEqual(born);
    });

    it('seeds both bounds from the deleted row when the survivor has none', async () => {
      const todaysSighting = new Date('2026-08-06T09:00:00Z');

      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: new Date('2020-01-01'),
        firstDetectedAt: null,
        lastDetectedAt: null,
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: todaysSighting,
        firstDetectedAt: todaysSighting,
        lastDetectedAt: todaysSighting,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(older.firstDetectedAt).toEqual(todaysSighting);
      expect(older.lastDetectedAt).toEqual(todaysSighting);
    });

    /**
     * The row this pass DELETES can be the one carrying the human decision:
     * `older` is only "older" by `createdAt`, and `areVulnsSimilar` filters on
     * scanner/path/snippet with no state filter at all, so an `ignored`, frozen
     * detection is a legal merge candidate. `history_item`'s six detection FKs
     * are ON DELETE CASCADE, so the delete takes the `status_change` row AND the
     * `comment` row `backfill-lifecycle.ts` reconstructs `dismissal_reason`
     * from — the evidence and its only recovery source go together.
     */
    const day = (d: string) => new Date(`${d}T00:00:00Z`);

    it('never deletes a sighted row that carries a decision, nor moves that decision', async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'to_verify',
        stateManuallyModified: false,
        triagedAt: null,
        triagedBy: null,
        triagedByType: null,
        dismissalReason: null,
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: day('2026-01-01'),
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: day('2026-02-02'),
        triagedBy: 'u1',
        triagedByType: 'user',
        dismissalReason: 'accepted risk',
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      // The decision stays on the row it was taken on, with its history.
      expect(sastRepo.remove).not.toHaveBeenCalled();
      expect(newer.currentState).toBe('ignored');
      expect(newer.triagedBy).toBe('u1');
      expect(newer.dismissalReason).toBe('accepted risk');
      expect(older.triagedBy).toBeNull();
      expect(older.dismissalReason).toBeNull();
      expect(older.currentState).not.toBe('ignored');
    });

    it("keeps the survivor's decision when the deleted row was never triaged", async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: day('2026-02-02'),
        triagedBy: 'u1',
        triagedByType: 'user',
        dismissalReason: 'accepted risk',
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: day('2026-01-01'),
        currentState: 'to_verify',
        stateManuallyModified: false,
        triagedAt: null,
        triagedBy: null,
        triagedByType: null,
        dismissalReason: null,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(older.currentState).toBe('ignored');
      expect(older.triagedBy).toBe('u1');
      expect(older.dismissalReason).toBe('accepted risk');
    });

    it('keeps two human decisions on their own rows', async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: day('2026-02-02'),
        triagedBy: 'u1',
        triagedByType: 'user',
        dismissalReason: 'accepted risk',
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: day('2026-01-01'),
        currentState: 'confirmed',
        stateManuallyModified: true,
        triagedAt: day('2026-05-05'),
        triagedBy: 'u2',
        triagedByType: 'user',
        dismissalReason: null,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(sastRepo.remove).not.toHaveBeenCalled();
      expect(older.currentState).toBe('ignored');
      expect(older.triagedBy).toBe('u1');
      expect(older.dismissalReason).toBe('accepted risk');
      expect(newer.currentState).toBe('confirmed');
      expect(newer.triagedBy).toBe('u2');
    });

    /**
     * The machine must never overwrite a person's dismissal — the reason
     * `shouldAutoResolveOnDisappearance` leaves `ignored` alone. A later system
     * stamp (an auto-resolve, then a revive) does NOT outrank an earlier human
     * dismissal.
     */
    it('never lets a later machine stamp displace a human decision', async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: day('2026-02-02'),
        triagedBy: 'u1',
        triagedByType: 'user',
        dismissalReason: 'accepted risk',
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: day('2026-01-01'),
        currentState: 'to_verify',
        stateManuallyModified: false,
        triagedAt: day('2026-05-05'),
        triagedBy: null,
        triagedByType: 'system',
        dismissalReason: null,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(older.currentState).toBe('ignored');
      expect(older.triagedBy).toBe('u1');
      expect(older.triagedByType).toBe('user');
      expect(older.dismissalReason).toBe('accepted risk');
    });

    /**
     * A scan created a duplicate of a
     * finding a person had dismissed, the agent analysed that duplicate as new
     * (TP, so `confirmed`), and the next repair carried its verdict over the
     * dismissal because it was later: `TRIAGE_CARRIED_OVER ... state=confirmed
     * by=agent`.
     */
    it("keeps a person's dismissal when the duplicate carries a later verdict the agent reached alone", async () => {
      const older = mkSast({
        id: 'det-old',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt: day('2026-09-21'),
        triagedBy: 'u1',
        triagedByType: 'user',
        dismissalReason: 'no traffic is routed to the workers',
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const newer = mkSast({
        id: 'det-new',
        fingerprint: 'digest',
        createdAt: day('2026-09-21'),
        currentState: 'confirmed',
        stateManuallyModified: true,
        triagedAt: day('2026-09-22'),
        triagedBy: null,
        triagedByType: 'agent',
        dismissalReason: null,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(older, newer);

      expect(older.currentState).toBe('ignored');
      expect(older.triagedBy).toBe('u1');
      expect(older.triagedByType).toBe('user');
      expect(older.triagedAt).toEqual(day('2026-09-21'));
      expect(older.dismissalReason).toBe('no traffic is routed to the workers');
      // The duplicate carries the agent's verdict: it is not deleted either.
      expect(sastRepo.remove).not.toHaveBeenCalled();
      expect(newer.currentState).toBe('confirmed');
    });

    /**
     * The REVERSED orientation, which is the one that bites: `older` is chosen
     * by `createdAt` alone, so when the row that DISAPPEARED happens to be the
     * younger of the two — two occurrences of one pattern in a file, the second
     * added later, exactly what `occurrenceIndex` exists for — the survivor is
     * the row this scan just saw and the deleted row is the vanished one.
     *
     * That vanished row was auto-resolved by an earlier pass, so it carries
     * `triaged_by_type='system'` + a months-old `resolved_at`. Adopting it wrote
     * `resolved` onto a finding whose `last_detected_at` is TODAY — a record
     * that contradicts itself, in the one dimension the export exists to
     * disambiguate. No human triage anywhere in the sequence.
     */
    it('reopens a surviving row a scan had resolved, never closes the finding', async () => {
      const todaysSighting = new Date('2026-08-06T09:00:00Z');
      const autoResolvedAt = new Date('2026-03-03T10:00:00.500Z');

      // Seen by THIS scan, so it owns the earlier createdAt and survives.
      const present = mkSast({
        id: 'det-present',
        fingerprint: 'digest',
        createdAt: day('2020-01-01'),
        currentState: 'to_verify',
        stateManuallyModified: false,
        // Left by an earlier auto-resolve; the revive cleared resolvedAt but
        // deliberately keeps the triage stamps.
        triagedAt: new Date('2026-03-03T10:00:00.000Z'),
        triagedBy: null,
        triagedByType: 'system',
        resolvedAt: null,
        dismissalReason: null,
        firstDetectedAt: day('2020-01-01'),
        lastDetectedAt: todaysSighting,
        vulnerableStartLine: 9,
        vulnerableEndLine: 9,
        codeSnippets: [snippet(9, 'eval(x);')],
      });
      const vanishedAndAutoResolved = mkSast({
        id: 'det-gone',
        fingerprint: 'digest',
        createdAt: day('2026-01-01'),
        currentState: 'resolved',
        stateManuallyModified: false,
        triagedAt: autoResolvedAt,
        triagedBy: null,
        triagedByType: 'system',
        resolvedAt: autoResolvedAt,
        dismissalReason: null,
        vulnerableStartLine: 49,
        vulnerableEndLine: 49,
        codeSnippets: [snippet(49, 'eval(x);')],
      });

      await runRepair(vanishedAndAutoResolved, present);

      // The finding that existed before the scan survives, and it is open:
      // this scan has just detected it at its new position.
      expect(sastRepo.remove).toHaveBeenCalledWith(present);
      expect(vanishedAndAutoResolved.currentState).toBe('to_verify');
      expect(vanishedAndAutoResolved.resolvedAt).toBeNull();
      expect(vanishedAndAutoResolved.lastDetectedAt).toEqual(todaysSighting);
    });

    /**
     * Every finalization of an IaC
     * project failed with "Duplicate entry '<projectId>-main-<fingerprint>'
     * for key 'vulnerability_detections_iac.UQ_vulnerability_detections_iac_fingerprint'"
     * (the SAST table too). The repair carried the digest of the row it discards onto the
     * survivor, then saved the survivor while the discarded row still held that
     * digest. The mocks above accept any write, which is why they never saw
     * it: these enforce UNIQUE (projectId, branch, fingerprint) as MySQL does
     * (a NULL never collides) and roll a failed transaction back.
     */
    describe('under UNIQUE (projectId, branch, fingerprint)', () => {
      type Detection =
        | SastVulnerabilityDetections
        | IacVulnerabilityDetections
        | CicdVulnerabilityDetections;
      type DetectionClass =
        | typeof SastVulnerabilityDetections
        | typeof IacVulnerabilityDetections
        | typeof CicdVulnerabilityDetections;
      type IndexedRow = {
        id?: string;
        projectId?: string;
        branch?: string | null;
        fingerprint?: string | null;
      };
      /** `tx` is the serial of the enclosing transaction, 0 outside one. */
      type Write = { op: string; id: string | undefined; tx: number };

      let live: Map<string, string>;
      let writes: Write[];
      let currentTx: number;

      const keyOf = (row: IndexedRow) =>
        `${row.projectId}-${row.branch}-${row.fingerprint}`;
      const holderOf = (branch: string, fingerprint: string) =>
        live.get(`p1-${branch}-${fingerprint}`);
      const releaseKeysOf = (id: string | undefined) => {
        for (const [key, holder] of live) {
          if (holder === id) live.delete(key);
        }
      };
      const claim = (row: IndexedRow) => {
        const key = keyOf(row);
        const holder = row.fingerprint ? live.get(key) : undefined;
        if (holder && holder !== row.id) {
          throw Object.assign(
            new Error(
              `Duplicate entry '${key}' for key 'UQ_vulnerability_detections_fingerprint'`,
            ),
            { code: 'ER_DUP_ENTRY', errno: 1062 },
          );
        }
        releaseKeysOf(row.id);
        if (row.fingerprint) live.set(key, row.id);
      };
      /** Rows already in the table when finalization starts. */
      const index = (...rows: IndexedRow[]) => rows.forEach(claim);

      beforeEach(() => {
        live = new Map();
        writes = [];
        currentTx = 0;
        let serial = 0;

        for (const repo of [sastRepo, iacRepo, cicdRepo]) {
          repo.save = jest.fn(async (row: IndexedRow) => {
            claim(row);
            writes.push({ op: 'save', id: row.id, tx: currentTx });
            return row;
          });
          repo.remove = jest.fn(async (row: IndexedRow) => {
            writes.push({ op: 'remove', id: row.id, tx: currentTx });
            releaseKeysOf(row.id);
            // TypeORM clears the primary key of the entity it deleted.
            row.id = undefined;
            return row;
          });
        }
        codeSnippetRepo.remove = jest.fn(async (rows: unknown) => {
          writes.push({ op: 'remove-snippets', id: undefined, tx: currentTx });
          return rows;
        });
        dataFlowRepo.remove = jest.fn(async (rows: unknown) => {
          writes.push({ op: 'remove-data-flow', id: undefined, tx: currentTx });
          return rows;
        });

        const transaction = jest.fn(
          async (
            work: (manager: ReturnType<typeof transactionalManager>) => unknown,
          ) => {
            const committed = new Map(live);
            currentTx = ++serial;
            try {
              return await work(transactionalManager());
            } catch (error) {
              live = committed;
              throw error;
            } finally {
              currentTx = 0;
            }
          },
        );
        for (const repo of [sastRepo, iacRepo, cicdRepo]) {
          repo.manager = { transaction };
        }
      });

      const historyKeyOf = (det: Detection) =>
        det instanceof SastVulnerabilityDetections
          ? 'sastVulnerabilityDetection'
          : det instanceof CicdVulnerabilityDetections
            ? 'cicdVulnerabilityDetection'
            : 'iacVulnerabilityDetection';

      /**
       * @param table - every detection row of the project.
       * @param unmatched - the scanner's existing rows finalize is handed.
       * @param sighted - the rows carrying a history row of THIS scan
       *   (`trulyNewVulns`), whether created by it or re-detected.
       */
      const finalize = (opts: {
        table: Detection[];
        unmatched: Detection[];
        sighted: Detection[];
        branch: string | undefined;
        /** Sighted rows another scan saw too: they existed before this one. */
        seenBefore?: Detection[];
      }) => {
        sastRepo.find.mockResolvedValue(
          opts.table.filter((r) => r instanceof SastVulnerabilityDetections),
        );
        iacRepo.find.mockResolvedValue(
          opts.table.filter((r) => r instanceof IacVulnerabilityDetections),
        );
        cicdRepo.find.mockResolvedValue(
          opts.table.filter((r) => r instanceof CicdVulnerabilityDetections),
        );
        const histRepo = (
          utils as unknown as {
            vulnDetectHistoryRepository: {
              find: jest.Mock;
              findOne: jest.Mock;
              exists: jest.Mock;
            };
          }
        ).vulnDetectHistoryRepository;
        histRepo.find.mockResolvedValue(
          opts.sighted.map((d) => ({ [historyKeyOf(d)]: d })),
        );
        histRepo.findOne.mockResolvedValue({ scanId: 'OLD-SCAN' });
        const seenBefore = new Set(
          (opts.seenBefore ?? []).map((d) => d.id as string),
        );
        histRepo.exists = jest.fn(
          async (q: { where: Record<string, { id?: string }> }) =>
            Object.values(q.where).some(
              (v) => typeof v === 'object' && seenBefore.has(v?.id),
            ),
        );

        return utils.finalizeOldScanVulnerabilities(
          opts.unmatched,
          [],
          'p1',
          'NEW-SCAN',
          opts.branch,
        );
      };

      /**
       * The discarded row must release the digest BEFORE the survivor claims
       * it, and both writes must commit or roll back together.
       */
      const expectDiscardedThenSurvivorInOneTransaction = (
        discardedId: string,
        survivorId: string,
      ) => {
        const removedAt = writes.findIndex(
          (w) => w.op === 'remove' && w.id === discardedId,
        );
        const savedAt = writes.findIndex(
          (w) => w.op === 'save' && w.id === survivorId,
        );
        expect(removedAt).toBeGreaterThanOrEqual(0);
        expect(savedAt).toBeGreaterThan(removedAt);
        expect(writes[removedAt].tx).toBeGreaterThan(0);
        expect(writes[savedAt].tx).toBe(writes[removedAt].tx);
      };

      describe.each([
        ['IaC', IacVulnerabilityDetections, 'kics', 'deploy/main.tf'],
        ['SAST', SastVulnerabilityDetections, 'opengrep', 'src/a.ts'],
        ['CI/CD', CicdVulnerabilityDetections, 'kics', '.github/ci.yml'],
      ] as const)('%s', (_family, Entity, scannerType, path) => {
        const mk = (over: Record<string, unknown>): Detection =>
          Object.assign(new (Entity as DetectionClass)(), {
            projectId: 'p1',
            scannerType,
            branch: 'main',
            path,
            language: 'x',
            currentState: 'to_verify',
            vulnerability: { id: 'cat-1' },
            codeSnippets: [],
            ...(Entity === SastVulnerabilityDetections
              ? { dataFlowItems: [] }
              : {}),
            ...over,
          });
        const at = (line: number) => ({
          vulnerableStartLine: line,
          vulnerableEndLine: line,
          codeSnippets: [snippet(line, 'eval(x);')],
        });

        it('carries the digest of a row created by this scan onto a survivor that has none', async () => {
          const older = mk({
            id: 'det-old',
            fingerprint: null,
            createdAt: new Date('2020-01-01'),
            ...at(9),
          });
          const created = mk({
            id: 'det-new',
            fingerprint: 'digest',
            createdAt: new Date('2026-09-22'),
            ...at(49),
          });
          index(older, created);

          await expect(
            finalize({
              table: [older, created],
              unmatched: [older],
              sighted: [created],
              branch: 'main',
            }),
          ).resolves.toBeUndefined();

          expect(older.fingerprint).toBe('digest');
          expect(holderOf('main', 'digest')).toBe('det-old');
          expectDiscardedThenSurvivorInOneTransaction('det-new', 'det-old');
        });

        /**
         * The discarded row was NOT created by the scan: the key belonged
         * to an old re-detected row, whose ingestion logged
         * `FINGERPRINT_MISMATCH det=<id> stored=<a> computed=<b>`. Shadow mode keeps the stored digest, so that is
         * the value the repair carries.
         */
        it('never merges a vanished row into an old row this scan saw at its own position', async () => {
          const older = mk({
            id: 'det-old',
            fingerprint: null,
            createdAt: new Date('2020-01-01'),
            ...at(9),
          });
          const redetected = mk({
            id: 'det-299df759',
            fingerprint: '919a6893-stored',
            createdAt: new Date('2026-09-14'),
            ...at(49),
          });
          index(older, redetected);

          await expect(
            finalize({
              table: [older, redetected],
              unmatched: [older],
              sighted: [redetected],
              branch: 'main',
              seenBefore: [redetected],
            }),
          ).resolves.toBeUndefined();

          // Two occurrences: the one that vanished is resolved, the one the
          // scan found where it was keeps its row, its digest and its id.
          expect(writes.some((w) => w.op === 'remove')).toBe(false);
          expect(redetected.id).toBe('det-299df759');
          expect(older.fingerprint).toBeNull();
          expect(older.currentState).toBe('resolved');
          expect(holderOf('main', '919a6893-stored')).toBe('det-299df759');
        });

        // The row this scan sighted is older than the one that vanished: it
        // was found at its own position, so the vanished row is not merged
        // into it and neither row is deleted.
        it('never deletes the vanished row into an older row the scan sighted', async () => {
          const sighted = mk({
            id: 'det-sighted',
            fingerprint: null,
            createdAt: new Date('2020-01-01'),
            ...at(49),
          });
          const vanished = mk({
            id: 'det-vanished',
            fingerprint: 'digest',
            createdAt: new Date('2026-01-01'),
            ...at(9),
          });
          index(sighted, vanished);

          await expect(
            finalize({
              table: [sighted, vanished],
              unmatched: [vanished],
              sighted: [sighted],
              branch: 'main',
              seenBefore: [sighted],
            }),
          ).resolves.toBeUndefined();

          expect(writes.some((w) => w.op === 'remove')).toBe(false);
          expect(sighted.fingerprint).toBeNull();
          expect(vanished.id).toBe('det-vanished');
          expect(vanished.currentState).toBe('resolved');
          expect(holderOf('main', 'digest')).toBe('det-vanished');
        });
      });

      const mkIac = (over: Record<string, unknown>) =>
        Object.assign(new IacVulnerabilityDetections(), {
          projectId: 'p1',
          scannerType: 'kics',
          branch: 'main',
          path: 'deploy/main.tf',
          language: 'terraform',
          currentState: 'to_verify',
          vulnerability: { id: 'cat-1' },
          codeSnippets: [],
          ...over,
        });

      it("clears the survivor's stale snippets and data flow inside the pair's transaction", async () => {
        const staleSnippet = snippet(9, 'eval(x);');
        const staleDataFlow = { line: 9, remove: jest.fn() };
        const older = mkSast({
          id: 'det-old',
          fingerprint: null,
          createdAt: new Date('2020-01-01'),
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          codeSnippets: [staleSnippet],
          dataFlowItems: [staleDataFlow],
        });
        const created = mkSast({
          id: 'det-new',
          fingerprint: 'digest',
          createdAt: new Date('2026-09-22'),
          vulnerableStartLine: 49,
          vulnerableEndLine: 49,
          codeSnippets: [snippet(49, 'eval(x);')],
        });
        index(older, created);

        await finalize({
          table: [older, created],
          unmatched: [older],
          sighted: [created],
          branch: 'main',
        });

        expect(sastRepo.manager.transaction).toHaveBeenCalledTimes(1);
        expect(codeSnippetRepo.remove).toHaveBeenCalledWith([staleSnippet]);
        expect(dataFlowRepo.remove).toHaveBeenCalledWith([staleDataFlow]);
        // Active-record deletes would run on another connection, outside it.
        expect(staleSnippet.remove).not.toHaveBeenCalled();
        expect(staleDataFlow.remove).not.toHaveBeenCalled();
        const pairTx = writes.find((w) => w.op === 'remove').tx;
        expect(pairTx).toBeGreaterThan(0);
        expect(
          writes
            .filter((w) => w.op.startsWith('remove-'))
            .map((w) => [w.op, w.tx]),
        ).toEqual([
          ['remove-snippets', pairTx],
          ['remove-data-flow', pairTx],
        ]);
      });

      /**
       * A branch-less finalization loads every branch and `areVulnsSimilar`
       * ignores the branch, so a survivor on `release` can be handed the digest
       * of a `main` row while a `release` twin already holds it. That pair must
       * not take the rest of the scanner's finalization down with it.
       */
      it('skips a pair that still collides and finalizes every other group', async () => {
        const older = mkIac({
          id: 'det-old',
          branch: 'release',
          fingerprint: null,
          createdAt: new Date('2020-01-01'),
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          codeSnippets: [snippet(9, 'eval(x);')],
        });
        const created = mkIac({
          id: 'det-new',
          fingerprint: 'digest',
          createdAt: new Date('2026-09-22'),
          vulnerableStartLine: 49,
          vulnerableEndLine: 49,
          codeSnippets: [snippet(49, 'eval(x);')],
        });
        const vanished = mkIac({
          id: 'det-gone',
          path: 'deploy/other.tf',
          fingerprint: 'gone-digest',
          createdAt: new Date('2020-01-01'),
          vulnerableStartLine: 3,
          vulnerableEndLine: 3,
          codeSnippets: [snippet(3, 'resource "x" {}')],
        });
        const older2 = mkIac({
          id: 'det-old-2',
          path: 'deploy/third.tf',
          fingerprint: null,
          createdAt: new Date('2020-01-01'),
          vulnerableStartLine: 5,
          vulnerableEndLine: 5,
          codeSnippets: [snippet(5, 'acl = "public-read"')],
        });
        const created2 = mkIac({
          id: 'det-new-2',
          path: 'deploy/third.tf',
          fingerprint: 'digest-2',
          createdAt: new Date('2026-09-22'),
          vulnerableStartLine: 25,
          vulnerableEndLine: 25,
          codeSnippets: [snippet(25, 'acl = "public-read"')],
        });
        index(
          {
            id: 'det-release-twin',
            projectId: 'p1',
            branch: 'release',
            fingerprint: 'digest',
          },
          older,
          created,
          vanished,
          older2,
          created2,
        );
        const closeIssues = jest.fn().mockResolvedValue(undefined);
        (
          utils as unknown as {
            issueIntegrationService: Record<string, jest.Mock>;
          }
        ).issueIntegrationService.closeIssuesForResolvedVulnerabilities =
          closeIssues;

        await expect(
          finalize({
            table: [older, created, vanished, older2, created2],
            unmatched: [older, vanished, older2],
            sighted: [created, created2],
            branch: undefined,
          }),
        ).resolves.toBeUndefined();

        expect(
          warnedMessages().some((m) =>
            m.includes(
              'DRIFT_MERGE_SKIPPED survivor=det-old discarded=det-new scan=NEW-SCAN',
            ),
          ),
        ).toBe(true);
        // The pair rolled back as a whole: the discarded row is still there.
        expect(holderOf('main', 'digest')).toBe('det-new');
        expect(holderOf('release', 'digest')).toBe('det-release-twin');
        // …and the groups after it were still finalized.
        expect(vanished.currentState).toBe('resolved');
        expect(older2.fingerprint).toBe('digest-2');
        expect(holderOf('main', 'digest-2')).toBe('det-old-2');
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['det-gone'],
          'file_deleted_or_fixed',
          'iac',
        );
      });

      it('propagates any other error, with the pair rolled back', async () => {
        const older = mkIac({
          id: 'det-old',
          fingerprint: null,
          createdAt: new Date('2020-01-01'),
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          codeSnippets: [snippet(9, 'eval(x);')],
        });
        const created = mkIac({
          id: 'det-new',
          fingerprint: 'digest',
          createdAt: new Date('2026-09-22'),
          vulnerableStartLine: 49,
          vulnerableEndLine: 49,
          codeSnippets: [snippet(49, 'eval(x);')],
        });
        index(older, created);
        const deadlock = Object.assign(new Error('Deadlock found'), {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
        });
        const save = iacRepo.save;
        iacRepo.save = jest.fn(async (row: IndexedRow) => {
          if (row.id === 'det-old') throw deadlock;
          return save(row);
        });

        await expect(
          finalize({
            table: [older, created],
            unmatched: [older],
            sighted: [created],
            branch: 'main',
          }),
        ).rejects.toBe(deadlock);

        expect(holderOf('main', 'digest')).toBe('det-new');
        expect(
          warnedMessages().some((m) => m.includes('DRIFT_MERGE_SKIPPED')),
        ).toBe(false);
      });
    });
  });
});
