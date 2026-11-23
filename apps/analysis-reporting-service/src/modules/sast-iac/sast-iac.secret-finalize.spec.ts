import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator } from 'typeorm';
import {
  fingerprintForNewSastDetection,
  SastIacUtilsService,
  SecretHistoryRule,
  secretFinalizeAction,
  secretHistoryRuleOf,
} from './sast-iac.utils';
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

/**
 * Secret detections take part in rescan finalization the way CICD detections
 * do: a secret a later full scan no longer reports — removed from the
 * code, or a path added to `.cybeignore` — is resolved, a secret the scan
 * reports again is not. Before this, `getExistingVulnerabilities`,
 * `finalizeScan` and `finalizeOldScanVulnerabilities` knew SAST, IaC and CICD
 * only, and the ingestion history of a secret was written with no detection
 * attached, so a secret stayed `to_verify` forever.
 */
describe('SastIacUtilsService — secret ingestion history + resolution', () => {
  const buildUtils = async (opts: {
    secretRepo?: any;
    histRepo?: any;
    resultService?: any;
    issueService?: any;
    secretEncryption?: any;
  }): Promise<SastIacUtilsService> => {
    const emptyRepo = () => ({
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacUtilsService,
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: opts.histRepo ?? createMockRepository(),
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: emptyRepo(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: opts.secretRepo ?? emptyRepo(),
        },
        { provide: SastIacService, useValue: {} },
        {
          provide: ResultService,
          useValue: opts.resultService ?? {
            addHistoryItem: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: opts.issueService ?? {
            closeIssuesForResolvedVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          // Every secret reported with a value is looked up on its hash.
          useValue: opts.secretEncryption ?? {
            encrypt: (v: string) => 'v1:iv:' + v + ':tag',
            hashSecretValue: (v: string) => 'h:' + v,
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/AV:N', baseScore: 9.3 }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();
    return module.get(SastIacUtilsService);
  };

  const mkSecret = (
    id: string,
    state: string,
    path: string,
    line = 4,
    extra: Partial<SecretVulnerabilityDetections> = {},
  ): SecretVulnerabilityDetections =>
    Object.assign(new SecretVulnerabilityDetections(), {
      id,
      projectId: 'p1',
      currentState: state,
      path,
      language: 'python',
      vulnerableStartLine: line,
      vulnerableEndLine: line,
      scannerType: 'gitleaks',
      branch: 'main',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      codeSnippets: [
        { code: JSON.stringify([{ line, content: 'AWS_KEY = "…"' }]) },
      ],
      vulnerability: { id: 'vuln-gitleaks-aws' },
      vulnerabilityDetectionHistory: [],
      ...extra,
    });

  const secretDto = (): any => ({
    ruleId: 'aws-access-token',
    path: 'scripts/backup.py',
    language: 'python',
    fileHash: 'hash-1',
    secretValue: 'AKIAIOSFODNN7EXAMPLE',
    secretSource: 'head',
    codeSnippet: {
      vulnerableStartLine: 4,
      vulnerableEndLine: 4,
      snippet: 'AWS_KEY = "…"',
    },
    dataFlow: [],
  });
  const secretCorrespondance: any = {
    vulnerabilityType: 'secret',
    vulnerability: { id: 'vuln-gitleaks-aws', severity: 'CRITICAL' },
  };

  it('links the ingestion history to secretVulnerabilityDetection for a secret', async () => {
    const histSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const utils = await buildUtils({
      histRepo: { ...createMockRepository(), save: histSave },
    });

    const secret = mkSecret('secret-1', 'to_verify', 'a.py');
    await (utils as any).addVulnerabilityDetectionHistory(secret, 'scan-1');

    expect(histSave).toHaveBeenCalledTimes(1);
    const saved = histSave.mock.calls[0][0];
    expect(saved.scanId).toBe('scan-1');
    // Without this link finalize cannot tell a still-present secret from one
    // the scan no longer reports.
    expect(saved.secretVulnerabilityDetection).toBe(secret);
    expect(saved.sastVulnerabilityDetection).toBeUndefined();
    expect(saved.iacVulnerabilityDetection).toBeUndefined();
    expect(saved.cicdVulnerabilityDetection).toBeUndefined();
  });

  it('returns existingSecretVulns scoped to the scanner and the branch', async () => {
    const secretA = mkSecret('secret-a', 'to_verify', 'a.py');
    const secretFind = jest.fn().mockResolvedValue([secretA]);
    const utils = await buildUtils({
      secretRepo: { ...createMockRepository(), find: secretFind },
    });

    const res: any = await (utils as any).getExistingVulnerabilities(
      'p1',
      'scan1',
      'gitleaks',
      'main',
    );

    expect(res.existingSecretVulns).toEqual([secretA]);
    expect(secretFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', scannerType: 'gitleaks', branch: 'main' },
      }),
    );
  });

  it('a new secret detection stores the keyed hash of its value', async () => {
    const secretSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const utils = await buildUtils({
      secretRepo: {
        ...createMockRepository(),
        find: jest.fn().mockResolvedValue([]),
        save: secretSave,
      },
      resultService: {
        addHistoryItem: jest.fn().mockResolvedValue(undefined),
        computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
      },
      secretEncryption: {
        encrypt: (v: string) => 'v1:iv:' + v + ':tag',
        hashSecretValue: (v: string) => 'h:' + v,
      },
    });

    await utils.createNewVulnerability(
      secretDto(),
      secretCorrespondance,
      'scan-new',
      'p1',
      'gitleaks',
      'main',
    );

    const inserted = secretSave.mock.calls
      .map((c: any[]) => c[0])
      .find((x: any) => x instanceof SecretVulnerabilityDetections);
    expect(inserted).toBeDefined();
    expect(inserted.secretValueHash).toBe('h:AKIAIOSFODNN7EXAMPLE');
  });

  it('records the current scan and reopens a resolved secret on re-detection, without inserting a duplicate', async () => {
    const existing = mkSecret(
      'secret-existing',
      'resolved',
      'scripts/backup.py',
      4,
      { fileHash: 'hash-1', resolvedAt: new Date('2026-10-01T00:00:00Z') },
    );
    const secretSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const histSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const utils = await buildUtils({
      secretRepo: {
        ...createMockRepository(),
        find: jest.fn().mockResolvedValue([existing]),
        save: secretSave,
      },
      histRepo: { ...createMockRepository(), save: histSave },
    });

    await utils.createNewVulnerability(
      secretDto(),
      secretCorrespondance,
      'scan-new',
      'p1',
      'gitleaks',
      'main',
    );

    // The current scan is recorded on the EXISTING detection, so finalize
    // keeps a secret the scan still reports.
    expect(histSave).toHaveBeenCalledTimes(1);
    expect(histSave.mock.calls[0][0].secretVulnerabilityDetection).toBe(
      existing,
    );
    expect(histSave.mock.calls[0][0].scanId).toBe('scan-new');

    // A secret reported again is open again, without a resolution date.
    expect(existing.currentState).toBe('to_verify');
    expect(existing.resolvedAt).toBeNull();
    expect(secretSave).toHaveBeenCalledWith(existing);

    // No duplicate insert.
    const insertedNew = secretSave.mock.calls.find(
      (c: any[]) => c[0].id !== 'secret-existing',
    );
    expect(insertedNew).toBeUndefined();
  });

  // The duplicate lookup loads `vulnerabilityDetectionHistory`, a cascaded
  // one-to-many. Saving the reopened row AFTER the current scan's history row
  // was written makes TypeORM null that row's foreign key (it is not in the
  // loaded array), and the next finalize resolves the secret again. Proven on
  // a real MySQL by sast-iac.secret-finalize.live.spec.ts.
  it.each([
    ['secret', 'recordSecretRedetection', SecretVulnerabilityDetections],
    ['cicd', 'recordCicdRedetection', CicdVulnerabilityDetections],
  ] as const)(
    'saves a reopened %s detection before writing the current-scan history row',
    async (_family, method, Entity) => {
      const utils = await buildUtils({});
      const detection = Object.assign(new (Entity as any)(), {
        id: 'det-1',
        currentState: 'resolved',
        resolvedAt: new Date(),
        vulnerabilityDetectionHistory: [{ scanId: 'OLD-SCAN' }],
      });
      const order: string[] = [];
      const repoKey =
        Entity === SecretVulnerabilityDetections
          ? 'secretVulnDetectRepository'
          : 'cicdVulnDetectRepository';
      (utils as any)[repoKey].save = jest.fn(async (x: unknown) => {
        order.push('save');
        return x;
      });
      jest
        .spyOn(utils as any, 'addVulnerabilityDetectionHistory')
        .mockImplementation(async () => {
          order.push('history');
        });

      await (utils as any)[method](detection, 'NEW-SCAN');

      expect(detection.currentState).toBe('to_verify');
      expect(order).toEqual(['save', 'history']);
    },
  );

  it('records one current-scan history row when a secret is reported twice in one scan, and keeps a dismissal', async () => {
    const existing = mkSecret(
      'secret-existing',
      'ignored',
      'scripts/backup.py',
      4,
      {
        fileHash: 'hash-1',
        vulnerabilityDetectionHistory: [{ scanId: 'scan-new' }] as any,
      },
    );
    const secretSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const histSave = jest.fn().mockImplementation((x) => Promise.resolve(x));
    const utils = await buildUtils({
      secretRepo: {
        ...createMockRepository(),
        find: jest.fn().mockResolvedValue([existing]),
        save: secretSave,
      },
      histRepo: { ...createMockRepository(), save: histSave },
    });

    await utils.createNewVulnerability(
      secretDto(),
      secretCorrespondance,
      'scan-new',
      'p1',
      'gitleaks',
      'main',
    );

    expect(histSave).not.toHaveBeenCalled();
    expect(existing.currentState).toBe('ignored');
  });

  describe('finalizeOldScanVulnerabilities', () => {
    const setup = async (
      dbSecrets: SecretVulnerabilityDetections[],
      currentScanSecretIds: string[],
    ) => {
      const secretSave = jest
        .fn()
        .mockImplementation((x) => Promise.resolve(x));
      const secretRemove = jest.fn().mockResolvedValue(undefined);
      const histRepo: any = createMockRepository();
      // The current scan's ingestion history: one row per secret it reported.
      histRepo.find.mockResolvedValue(
        currentScanSecretIds.map((id) => ({
          scanId: 'NEW-SCAN',
          secretVulnerabilityDetection: { id },
        })),
      );
      histRepo.findOne.mockImplementation((query: any) => {
        const where = Array.isArray(query.where) ? query.where[0] : query.where;
        const secretId = where?.secretVulnerabilityDetection?.id;
        return Promise.resolve({
          scanId: currentScanSecretIds.includes(secretId)
            ? 'NEW-SCAN'
            : 'OLD-SCAN',
        });
      });
      const addHistoryItem = jest.fn().mockResolvedValue(undefined);
      const closeIssues = jest.fn().mockResolvedValue(undefined);
      const secretUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const utils = await buildUtils({
        secretRepo: {
          ...createMockRepository(),
          find: jest.fn().mockResolvedValue(dbSecrets),
          save: secretSave,
          remove: secretRemove,
          update: secretUpdate,
        },
        histRepo,
        resultService: { addHistoryItem },
        issueService: { closeIssuesForResolvedVulnerabilities: closeIssues },
      });
      return {
        utils,
        secretSave,
        secretRemove,
        secretUpdate,
        addHistoryItem,
        closeIssues,
      };
    };

    it('resolves a secret the scan no longer reports and keeps the one it reported again', async () => {
      const absent = mkSecret('secret-absent', 'to_verify', 'ignored/a.py');
      const present = mkSecret('secret-present', 'to_verify', 'b.py');
      const { utils, secretSave, addHistoryItem, closeIssues } = await setup(
        [absent, present],
        ['secret-present'],
      );

      await utils.finalizeOldScanVulnerabilities(
        [absent, present],
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );

      expect(absent.currentState).toBe('resolved');
      expect(absent.resolvedAt).toBeInstanceOf(Date);
      expect(absent.triagedByType).toBe('system');
      expect(present.currentState).toBe('to_verify');

      const savedIds = secretSave.mock.calls.map((c: any[]) => c[0].id);
      expect(savedIds).toEqual(['secret-absent']);

      // The resolution is written to the secret's own timeline.
      expect(addHistoryItem).toHaveBeenCalledTimes(1);
      const item = addHistoryItem.mock.calls[0][0];
      expect(item.type).toBe('status_change');
      expect(item.value).toBe('resolved');
      expect(item.secretVulnerabilityDetection).toBe(absent);

      // The linked GitHub / GitLab issues are closed under the 'secret' type.
      expect(closeIssues).toHaveBeenCalledWith(
        'p1',
        ['secret-absent'],
        'file_deleted_or_fixed',
        'secret',
      );
    });

    it('treats ignored, resolved and confirmed secrets as the other families do', async () => {
      const ignored = mkSecret('secret-ignored', 'ignored', 'a.py');
      const resolved = mkSecret('secret-resolved', 'resolved', 'b.py');
      const confirmed = mkSecret('secret-confirmed', 'confirmed', 'c.py');
      const { utils, secretSave, closeIssues } = await setup(
        [ignored, resolved, confirmed],
        [],
      );

      await utils.finalizeOldScanVulnerabilities(
        [ignored, resolved, confirmed],
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );

      // A dismissal is a decision; a resolved secret is already closed.
      expect(ignored.currentState).toBe('ignored');
      expect(resolved.currentState).toBe('resolved');
      // A confirmed secret the scan no longer reports closes.
      expect(confirmed.currentState).toBe('resolved');

      const savedIds = secretSave.mock.calls.map((c: any[]) => c[0].id);
      expect(savedIds).toEqual(['secret-confirmed']);
      expect(closeIssues).toHaveBeenCalledWith(
        'p1',
        ['secret-confirmed'],
        expect.any(String),
        'secret',
      );
    });

    it('never merges or deletes a secret row through the line-drift repair', async () => {
      // An old secret at line 4 and a NEW secret of the same rule, file and
      // code at line 9: the SAST/IaC repair would merge the new row into the
      // old one and delete it. Secrets keep the plain behaviour: the one not
      // reported again is resolved, the new one stays, nothing is removed.
      const old = mkSecret('secret-old', 'to_verify', 'a.py', 4);
      const fresh = mkSecret('secret-new', 'to_verify', 'a.py', 9, {
        createdAt: new Date('2026-10-14T00:00:00Z'),
        codeSnippets: old.codeSnippets,
      });
      const { utils, secretRemove } = await setup([old, fresh], ['secret-new']);

      await utils.finalizeOldScanVulnerabilities(
        [old, fresh],
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );

      expect(secretRemove).not.toHaveBeenCalled();
      expect(old.currentState).toBe('resolved');
      expect(old.vulnerableStartLine).toBe(4);
      expect(fresh.currentState).toBe('to_verify');
    });

    it('only resolves the secrets it was given (the scanner and branch of the scan)', async () => {
      // The candidate list is built per scanner and per branch by
      // getExistingVulnerabilities; finalize acts on that list only, even if
      // the project holds other secrets the scan did not report.
      const mine = mkSecret('secret-mine', 'to_verify', 'a.py');
      const otherBranch = mkSecret('secret-dev', 'to_verify', 'a.py', 4, {
        branch: 'dev',
      });
      const otherScanner = mkSecret('secret-checkov', 'to_verify', 'b.tf', 4, {
        scannerType: 'checkov',
      });
      const { utils, secretSave } = await setup(
        [mine, otherBranch, otherScanner],
        [],
      );

      await utils.finalizeOldScanVulnerabilities(
        [mine],
        [],
        'p1',
        'NEW-SCAN',
        'main',
      );

      expect(mine.currentState).toBe('resolved');
      expect(otherBranch.currentState).toBe('to_verify');
      expect(otherScanner.currentState).toBe('to_verify');
      expect(secretSave.mock.calls.map((c: any[]) => c[0].id)).toEqual([
        'secret-mine',
      ]);
    });

    /**
     * Incremental git history. A scan resolves a secret by absence only from
     * its HEAD pass (the secret is no longer in the code), never from its
     * history pass: an incremental pass reads the new commits only, so a secret
     * found in older history is not reported again and is still in git. One
     * rule for every scan, whatever its history pass (`SecretHistoryRule`):
     * - the branch's first full pass that ran ok resolves every secret it did
     *   not report, whatever its source: it read the whole history;
     * - otherwise a history finding is kept, a code finding with history
     *   evidence (a commit) becomes a history finding, and one without is
     *   resolved. A scan without a pass (an upload, an import, an older
     *   scanner) follows it too: no later incremental pass would bring back
     *   what it resolved.
     */
    describe('incremental git history', () => {
      const COMMIT = 'c0ffee1234567890abcdef1234567890abcdef12';
      const rule = (
        outcome: SecretHistoryRule['outcome'],
        mode: string | null,
        firstPass = false,
        ignoredPaths: string[] = [],
      ): SecretHistoryRule => ({
        outcome,
        mode,
        firstPass,
        ignoredPaths: new Set(ignoredPaths),
      });
      const historySecret = (id: string, path = 'old/creds.py') =>
        mkSecret(id, 'to_verify', path, 3, {
          source: 'history',
          commitSha: COMMIT,
        });
      const codeSecret = (id: string, path: string, commitSha: string | null) =>
        mkSecret(id, 'to_verify', path, 4, { source: 'head', commitSha });

      const finalizeWith = async (
        secrets: SecretVulnerabilityDetections[],
        historyRule: SecretHistoryRule,
        reported: string[] = [],
      ) => {
        const harness = await setup(secrets, reported);
        await harness.utils.finalizeOldScanVulnerabilities(
          secrets,
          [],
          'p1',
          'NEW-SCAN',
          'main',
          undefined,
          historyRule,
        );
        return harness;
      };

      it('a secret with git evidence in a path the ignore file excludes is resolved', async () => {
        const excluded = codeSecret(
          'secret-excluded',
          'repo/tests/a.py',
          COMMIT,
        );
        const kept = codeSecret('secret-kept', 'repo/src/b.py', COMMIT);
        const { secretSave } = await finalizeWith(
          [excluded, kept],
          rule('ok', 'incremental', false, ['repo/tests/a.py']),
        );

        expect(excluded.currentState).toBe('resolved');
        expect(kept.currentState).toBe('to_verify');
        expect(kept.source).toBe('history');
        expect(secretSave).toHaveBeenCalled();
      });

      it('a history finding in an excluded path is resolved', async () => {
        const excluded = historySecret('secret-excluded', 'vendor/bundle.js');
        const kept = historySecret('secret-kept', 'old/creds.py');
        await finalizeWith(
          [excluded, kept],
          rule('failed', 'incremental', false, ['vendor/bundle.js']),
        );

        expect(excluded.currentState).toBe('resolved');
        expect(kept.currentState).toBe('to_verify');
      });

      it('an excluded path never resolves a secret the scan reported, nor a muted one', async () => {
        const reported = codeSecret(
          'secret-reported',
          'repo/tests/a.py',
          COMMIT,
        );
        const dismissed = mkSecret(
          'secret-ignored',
          'ignored',
          'repo/tests/a.py',
          5,
          {
            source: 'history',
            commitSha: COMMIT,
          },
        );
        await finalizeWith(
          [reported, dismissed],
          rule('ok', 'incremental', false, ['repo/tests/a.py']),
          ['secret-reported'],
        );

        expect(reported.currentState).toBe('to_verify');
        expect(dismissed.currentState).toBe('ignored');
      });

      it('a scanner that sends no ignored paths changes nothing', async () => {
        const history = historySecret('secret-history', 'repo/tests/a.py');
        const moved = codeSecret('secret-moved', 'repo/tests/b.py', COMMIT);
        await finalizeWith([history, moved], rule('ok', 'incremental'));
        expect(history.currentState).toBe('to_verify');
        expect(moved.source).toBe('history');

        // A caller with no rule at all reads the same.
        expect(
          secretFinalizeAction(
            { source: 'history', commitSha: COMMIT, path: 'repo/tests/a.py' },
            undefined,
          ),
        ).toBe('keep');
        // Paths are compared exactly as stored.
        expect(
          secretFinalizeAction(
            { source: 'history', commitSha: COMMIT, path: 'tests/a.py' },
            rule('ok', 'incremental', false, ['repo/tests/a.py']),
          ),
        ).toBe('keep');
      });

      it('a recorded pass of mode none without a scanner outcome counts as none', async () => {
        // A pass of mode none gives the scanner no history URL: it sends no
        // outcome. Even on a first full pass, only an outcome `ok` lets a
        // scan resolve what it did not read.
        const derived = secretHistoryRuleOf(
          { historyMode: 'none', historyFirstPass: true },
          null,
        );
        expect(derived).toEqual(rule('none', 'none', true));
        // Without a recorded pass (an upload, an older platform): no outcome.
        expect(secretHistoryRuleOf(null, null)).toEqual(rule(null, null));
        expect(
          secretHistoryRuleOf(
            { historyMode: null, historyFirstPass: false },
            null,
          ),
        ).toEqual(rule(null, null));
        // The scanner's own outcome wins over the recorded mode.
        expect(
          secretHistoryRuleOf(
            { historyMode: 'incremental', historyFirstPass: false },
            'failed',
          ),
        ).toEqual(rule('failed', 'incremental'));

        const inHistory = historySecret('secret-history');
        const goneWithCommit = codeSecret('secret-moved', 'a.py', COMMIT);
        const goneNoCommit = codeSecret('secret-gone', 'b.py', null);
        await finalizeWith([inHistory, goneWithCommit, goneNoCommit], derived);

        expect(inHistory.currentState).toBe('to_verify');
        expect(goneWithCommit.currentState).toBe('to_verify');
        expect(goneWithCommit.source).toBe('history');
        expect(goneNoCommit.currentState).toBe('resolved');
      });

      it('a ZIP or CLI upload (no pass recorded) never resolves a history finding', async () => {
        // An upload has no history: it cannot tell a secret removed from the
        // history from one it never read, and the branch's next pass is
        // incremental, so it would never read those commits again. An older
        // scanner (no outcome, no pass) reads the same.
        const inHistory = historySecret('secret-history');
        const { secretSave, closeIssues } = await finalizeWith(
          [inHistory],
          secretHistoryRuleOf(null, null),
        );

        expect(inHistory.currentState).toBe('to_verify');
        expect(inHistory.source).toBe('history');
        expect(secretSave).not.toHaveBeenCalled();
        expect(closeIssues).not.toHaveBeenCalled();
      });

      it('a ZIP or CLI upload moves a code finding with a commit to history', async () => {
        const goneWithCommit = codeSecret('secret-moved', 'a.py', COMMIT);
        const { secretUpdate, addHistoryItem, closeIssues } =
          await finalizeWith([goneWithCommit], secretHistoryRuleOf(null, null));

        expect(goneWithCommit.currentState).toBe('to_verify');
        expect(goneWithCommit.source).toBe('history');
        expect(secretUpdate).toHaveBeenCalledWith(
          { id: 'secret-moved', source: 'head' },
          { source: 'history' },
        );
        expect(addHistoryItem.mock.calls[0][0].type).toBe('source_change');
        expect(closeIssues).not.toHaveBeenCalled();
      });

      it('a SARIF import without commits still resolves code findings as today', async () => {
        // An import carries no commit and no history pass: its secrets are
        // code findings, resolved when a later import no longer reports them.
        const absent = codeSecret('secret-absent', 'a.py', null);
        const present = codeSecret('secret-present', 'b.py', null);
        const { secretUpdate, closeIssues } = await finalizeWith(
          [absent, present],
          secretHistoryRuleOf(null, null),
          ['secret-present'],
        );

        expect(absent.currentState).toBe('resolved');
        expect(present.currentState).toBe('to_verify');
        expect(secretUpdate).not.toHaveBeenCalled();
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['secret-absent'],
          'file_deleted_or_fixed',
          'secret',
        );

        // A caller that passes no rule gets the same.
        const legacy = codeSecret('secret-legacy', 'c.py', null);
        const harness = await setup([legacy], []);
        await harness.utils.finalizeOldScanVulnerabilities(
          [legacy],
          [],
          'p1',
          'NEW-SCAN',
          'main',
        );
        expect(legacy.currentState).toBe('resolved');
      });

      it('history findings are never resolved by an incremental scan', async () => {
        for (const mode of ['incremental', 'incremental_with_gap']) {
          const inHistory = historySecret(`secret-history-${mode}`);
          const { secretSave, secretUpdate, addHistoryItem, closeIssues } =
            await finalizeWith([inHistory], rule('ok', mode));

          expect(inHistory.currentState).toBe('to_verify');
          expect(inHistory.resolvedAt ?? null).toBeNull();
          expect(secretSave).not.toHaveBeenCalled();
          expect(secretUpdate).not.toHaveBeenCalled();
          expect(addHistoryItem).not.toHaveBeenCalled();
          expect(closeIssues).not.toHaveBeenCalled();
        }
      });

      it('a first full pass resolves history findings it did not report', async () => {
        // Before incremental history, a full mirror also stored history
        // findings of other branches and forks under the scanned branch. The
        // branch's first pass over its whole history settles them once.
        const elsewhere = historySecret('secret-other-branch');
        const reported = historySecret('secret-reported', 'kept/creds.py');
        const { closeIssues } = await finalizeWith(
          [elsewhere, reported],
          rule('ok', 'full', true),
          ['secret-reported'],
        );

        expect(elsewhere.currentState).toBe('resolved');
        expect(reported.currentState).toBe('to_verify');
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['secret-other-branch'],
          'file_deleted_or_fixed',
          'secret',
        );

        // A later full pass is not the first one: nothing is resolved.
        const later = historySecret('secret-later');
        await finalizeWith([later], rule('ok', 'full', false));
        expect(later.currentState).toBe('to_verify');
      });

      it('a code finding with a commit, not reported by a first full pass, is resolved', async () => {
        // The pass read the whole branch history and did not report it: its
        // commit is not in this branch's history (a legacy row the new report
        // did not match, a rewritten history). Moved to the history instead,
        // it would stay open for good, since no later pass is a first one.
        const stale = codeSecret('secret-stale', 'config/settings.py', COMMIT);
        const reported = codeSecret('secret-reported', 'b.py', COMMIT);
        const { secretUpdate, addHistoryItem, closeIssues } =
          await finalizeWith([stale, reported], rule('ok', 'full', true), [
            'secret-reported',
          ]);

        expect(stale.currentState).toBe('resolved');
        expect(stale.source).toBe('head');
        expect(reported.currentState).toBe('to_verify');
        expect(secretUpdate).not.toHaveBeenCalled();
        expect(addHistoryItem.mock.calls.map((c: any[]) => c[0].type)).toEqual([
          'status_change',
        ]);
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['secret-stale'],
          'file_deleted_or_fixed',
          'secret',
        );
      });

      it('a partial first pass leaves history findings alone', async () => {
        // The finding may sit in the older commits the pass did not reach.
        const inHistory = historySecret('secret-history');
        const { secretSave } = await finalizeWith(
          [inHistory],
          rule('ok', 'partial', true),
        );

        expect(inHistory.currentState).toBe('to_verify');
        expect(secretSave).not.toHaveBeenCalled();
      });

      it('a secret removed from the code but in scanned history becomes a history finding', async () => {
        const removed = codeSecret(
          'secret-removed',
          'config/settings.py',
          COMMIT,
        );
        const { secretSave, secretUpdate, addHistoryItem, closeIssues } =
          await finalizeWith([removed], rule('ok', 'incremental'));

        // Still exposed in git: open, now a history finding.
        expect(removed.currentState).toBe('to_verify');
        expect(removed.source).toBe('history');
        // A narrow update of the source column, never a save of the row (it may
        // carry cascaded relations a save would rewrite).
        expect(secretUpdate).toHaveBeenCalledTimes(1);
        expect(secretUpdate).toHaveBeenCalledWith(
          { id: 'secret-removed', source: 'head' },
          { source: 'history' },
        );
        expect(secretSave).not.toHaveBeenCalled();
        // Written to the finding's timeline, by the system, after the update.
        expect(addHistoryItem).toHaveBeenCalledTimes(1);
        const item = addHistoryItem.mock.calls[0][0];
        expect(item.type).toBe('source_change');
        expect(item.value).toBe('history');
        expect(item.secretVulnerabilityDetection).toBe(removed);
        expect(item.source).toBe('system');
        // No userId: a `system` userId marks an agent analysis of the finding.
        expect(item.userId).toBeUndefined();
        expect(secretUpdate.mock.invocationCallOrder[0]).toBeLessThan(
          addHistoryItem.mock.invocationCallOrder[0],
        );
        expect(closeIssues).not.toHaveBeenCalled();
      });

      it('a secret removed from the code without history evidence is resolved', async () => {
        const removed = codeSecret(
          'secret-removed',
          'config/settings.py',
          null,
        );
        const { secretUpdate, closeIssues } = await finalizeWith(
          [removed],
          rule('ok', 'incremental'),
        );

        expect(removed.currentState).toBe('resolved');
        expect(removed.source).toBe('head');
        expect(secretUpdate).not.toHaveBeenCalled();
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['secret-removed'],
          'file_deleted_or_fixed',
          'secret',
        );
      });

      it('a failed history pass leaves history findings untouched and still resolves code findings', async () => {
        // Even on the branch's first full pass: a failed pass proves nothing
        // about the history.
        const inHistory = historySecret('secret-history');
        const goneNoCommit = codeSecret('secret-gone', 'b.py', null);
        const goneWithCommit = codeSecret('secret-moved', 'a.py', COMMIT);
        const still = codeSecret('secret-still', 'c.py', null);
        const { closeIssues } = await finalizeWith(
          [inHistory, goneNoCommit, goneWithCommit, still],
          rule('failed', 'full', true),
          ['secret-still'],
        );

        expect(inHistory.currentState).toBe('to_verify');
        expect(inHistory.source).toBe('history');
        expect(goneNoCommit.currentState).toBe('resolved');
        expect(goneWithCommit.currentState).toBe('to_verify');
        expect(goneWithCommit.source).toBe('history');
        expect(still.currentState).toBe('to_verify');
        expect(still.source).toBe('head');
        expect(closeIssues).toHaveBeenCalledWith(
          'p1',
          ['secret-gone'],
          'file_deleted_or_fixed',
          'secret',
        );
      });

      it('a dismissed or resolved code finding keeps its source, like its state', async () => {
        const ignored = mkSecret('secret-ignored', 'ignored', 'a.py', 4, {
          source: 'head',
          commitSha: COMMIT,
        });
        const resolved = mkSecret('secret-resolved', 'resolved', 'b.py', 4, {
          source: 'head',
          commitSha: COMMIT,
        });
        const { secretUpdate, addHistoryItem } = await finalizeWith(
          [ignored, resolved],
          rule('ok', 'incremental'),
        );

        expect(ignored.source).toBe('head');
        expect(ignored.currentState).toBe('ignored');
        expect(resolved.source).toBe('head');
        expect(resolved.currentState).toBe('resolved');
        expect(secretUpdate).not.toHaveBeenCalled();
        expect(addHistoryItem).not.toHaveBeenCalled();
      });

      it('writes no source change when another finalize already moved the finding', async () => {
        const removed = codeSecret(
          'secret-removed',
          'config/settings.py',
          COMMIT,
        );
        const harness = await setup([removed], []);
        harness.secretUpdate.mockResolvedValueOnce({ affected: 0 });

        await harness.utils.finalizeOldScanVulnerabilities(
          [removed],
          [],
          'p1',
          'NEW-SCAN',
          'main',
          undefined,
          rule('ok', 'incremental'),
        );

        expect(removed.currentState).toBe('to_verify');
        expect(harness.addHistoryItem).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * The Gitleaks scanner reports a secret twice per scan: the HEAD pass
   * (`--no-git` over the tree: the current line, a file hash, no commit) and
   * the history pass (the line in the commit that introduced it, the commit,
   * no file hash). Both are one finding: a secret is matched first on
   * (project, branch, scanner, catalogue rule, path, keyed value hash), and
   * the position lookup only reads the rows that carry no value hash yet.
   */
  describe('one secret across passes', () => {
    // Token-shaped values built at runtime: no literal in this file matches
    // a secret scanner's rule.
    const fakeToken = (body: string) => ['ghp', body].join('_');
    const VALUE = fakeToken('9fK2xQ7mZt4LwR8vN1bJc6Hd3Ys5Ae0Ug2Pq');
    const COMMIT = 'c0ffee1234567890abcdef1234567890abcdef12';
    const OLD_VALUE = fakeToken('OLD0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV');
    const OTHER_VALUE = fakeToken('K2nW8xY3zA6bC9dE2fG5hJ8kL1mN4pQ7rS0t');
    const OTHER_COMMIT = 'deadbeef1234567890abcdef1234567890abcdef';
    const hashOf = (value: string) => 'h:' + value;
    // A reversible stand-in for the envelope encryption.
    const encrypt = (v: string) =>
      'v1:iv:' + Buffer.from(v, 'utf8').toString('hex') + ':tag';
    const decrypt = (envelope: string) =>
      Buffer.from(envelope.split(':')[2], 'hex').toString('utf8');
    const ciphertextOf = (v: string) => Buffer.from(encrypt(v), 'utf8');

    /**
     * The secret table in memory: `find` and `findOne` answer their `where`
     * (IsNull included), `save` inserts a row without an id, `update` patches
     * the rows its criteria (an id or a `where`) select.
     */
    const memoryTable = (seed: SecretVulnerabilityDetections[] = []) => {
      const rows = [...seed];
      const inserted: SecretVulnerabilityDetections[] = [];
      const matches = (row: any, where: Record<string, unknown>) =>
        Object.entries(where).every(([field, expected]) => {
          if (expected instanceof FindOperator) {
            if (expected.type !== 'isNull') {
              throw new Error(`unsupported operator ${expected.type}`);
            }
            return row[field] == null;
          }
          if (field === 'vulnerability') {
            return row.vulnerability?.id === (expected as { id: string }).id;
          }
          return row[field] === expected;
        });
      const repo = {
        ...createMockRepository(),
        find: jest.fn(async ({ where }: any) =>
          rows.filter((r) => matches(r, where)),
        ),
        findOne: jest.fn(
          async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
        ),
        save: jest.fn(async (entity: SecretVulnerabilityDetections) => {
          if (!entity.id) {
            entity.id = `secret-row-${inserted.length + 1}`;
            entity.vulnerabilityDetectionHistory ??= [];
            rows.push(entity);
            inserted.push(entity);
          }
          return entity;
        }),
        update: jest.fn(async (criteria: any, patch: any) => {
          const selected = rows.filter((r) =>
            typeof criteria === 'string'
              ? r.id === criteria
              : matches(r, criteria),
          );
          selected.forEach((r) => Object.assign(r, patch));
          return { affected: selected.length };
        }),
      };
      return { rows, inserted, repo };
    };

    /** The ingestion history: each row is attached to its detection. */
    const historyTable = () => ({
      ...createMockRepository(),
      save: jest.fn(async (h: any) => {
        h.secretVulnerabilityDetection?.vulnerabilityDetectionHistory?.push({
          scanId: h.scanId,
        });
        return h;
      }),
    });

    const build = (table: ReturnType<typeof memoryTable>) => {
      const histRepo = historyTable();
      return buildUtils({
        secretRepo: table.repo,
        histRepo,
        resultService: {
          addHistoryItem: jest.fn().mockResolvedValue(undefined),
          computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
        },
        secretEncryption: { encrypt, decrypt, hashSecretValue: hashOf },
      }).then((utils) => ({ utils, histRepo }));
    };

    const headDto = (line = 4, over: Record<string, unknown> = {}): any => ({
      ruleId: 'github-pat',
      path: 'config/settings.py',
      language: 'python',
      fileHash: 'hash-head',
      secretValue: VALUE,
      secretSource: 'head',
      secretPass: 'head',
      codeSnippet: {
        startLine: line,
        endLine: line,
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        code: [{ line, content: 'GITHUB_TOKEN = "****"' }],
        language: 'python',
      },
      dataFlow: [],
      ...over,
    });

    // A history-pass finding: the commit's line, the commit, no file hash and
    // no snippet (the file is not on disk). Its source is `head` when the HEAD
    // pass reported the same value.
    const historyDto = (line = 2, over: Record<string, unknown> = {}): any => ({
      ruleId: 'github-pat',
      path: 'config/settings.py',
      language: 'python',
      fileHash: '',
      secretValue: VALUE,
      secretSource: 'head',
      secretPass: 'history',
      commitSha: COMMIT,
      codeSnippet: {
        startLine: line,
        endLine: line,
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        code: [],
        language: 'python',
      },
      dataFlow: [],
      ...over,
    });

    const ingest = (utils: SastIacUtilsService, dto: any, scanId: string) =>
      utils.createNewVulnerability(
        dto,
        { ...secretCorrespondance },
        scanId,
        'p1',
        'gitleaks',
        'main',
      );

    const stored = (
      id: string,
      line: number,
      extra: Partial<SecretVulnerabilityDetections> = {},
    ) =>
      mkSecret(id, 'to_verify', 'config/settings.py', line, {
        fileHash: 'hash-head',
        source: 'head',
        commitSha: null,
        secretValueHash: hashOf(VALUE),
        fingerprint: null,
        ...extra,
      });

    const commitShaUpdates = (repo: { update: jest.Mock }) =>
      repo.update.mock.calls.filter(
        ([, patch]: [unknown, Record<string, unknown>]) => 'commitSha' in patch,
      );

    it('a history-pass occurrence of a secret already found by the HEAD pass updates that finding instead of creating one', async () => {
      const table = memoryTable();
      const { utils } = await build(table);

      await ingest(utils, headDto(4), 'scan-1');
      await ingest(utils, historyDto(2), 'scan-1');

      // One create (the HEAD pass), never a second row for the history pass.
      expect(table.inserted).toHaveLength(1);
      expect(table.rows).toHaveLength(1);
      const [row] = table.rows;
      expect(row.secretValueHash).toBe(hashOf(VALUE));

      // Then one update: the commit, the history evidence. The source stays
      // what the HEAD pass wrote; finalize decides when it changes.
      const updates = commitShaUpdates(table.repo);
      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual([row.id, { commitSha: COMMIT }]);
      expect(row.commitSha).toBe(COMMIT);
      expect(row.source).toBe('head');
      // The commit's line is not where the secret is now.
      expect(row.vulnerableStartLine).toBe(4);
    });

    it('the same secret at another line of the same file is still the same finding', async () => {
      const existing = stored('secret-1', 4);
      const table = memoryTable([existing]);
      const { utils, histRepo } = await build(table);

      // Three lines lower, in a file that changed since.
      await ingest(utils, headDto(9, { fileHash: 'hash-head-2' }), 'scan-2');

      expect(table.inserted).toHaveLength(0);
      expect(table.repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: 'p1',
            branch: 'main',
            scannerType: 'gitleaks',
            path: 'config/settings.py',
            secretValueHash: hashOf(VALUE),
            vulnerability: { id: 'vuln-gitleaks-aws' },
          },
        }),
      );
      // The scan is recorded on the existing finding.
      expect(histRepo.save).toHaveBeenCalledTimes(1);
      expect(histRepo.save.mock.calls[0][0].secretVulnerabilityDetection).toBe(
        existing,
      );
      expect(histRepo.save.mock.calls[0][0].scanId).toBe('scan-2');
      // The HEAD pass reports where the secret is now: the finding follows.
      expect(existing.vulnerableStartLine).toBe(9);
      expect(existing.vulnerableEndLine).toBe(9);
    });

    it('a row without a value hash is still matched by position', async () => {
      // Stored before value hashes existed.
      const legacy = stored('secret-legacy', 4, {
        secretValueHash: null,
        encryptedSecret: ciphertextOf(VALUE),
      });
      const table = memoryTable([legacy]);
      const { utils, histRepo } = await build(table);

      await ingest(utils, headDto(4), 'scan-2');

      expect(table.inserted).toHaveLength(0);
      expect(histRepo.save.mock.calls[0][0].secretVulnerabilityDetection).toBe(
        legacy,
      );
      // It takes the value hash, so later passes match it at any line.
      expect(legacy.secretValueHash).toBe(hashOf(VALUE));

      await ingest(utils, historyDto(2), 'scan-2');
      expect(table.inserted).toHaveLength(0);
      expect(legacy.commitSha).toBe(COMMIT);
    });

    it('a row holding another secret value at the same position is another finding', async () => {
      // The value was rotated in place: the old one's row sits at line 2.
      const rotated = stored('secret-old', 2, {
        secretValueHash: hashOf('ghp_OLD0000000000000000000000000000000000'),
      });
      const table = memoryTable([rotated]);
      const { utils } = await build(table);

      await ingest(utils, historyDto(2), 'scan-2');

      expect(table.inserted).toHaveLength(1);
      expect(table.inserted[0].secretValueHash).toBe(hashOf(VALUE));
      expect(table.inserted[0].commitSha).toBe(COMMIT);
      // The old secret keeps its own identity and gets no evidence of this one.
      expect(rotated.secretValueHash).toBe(
        hashOf('ghp_OLD0000000000000000000000000000000000'),
      );
      expect(rotated.commitSha).toBeNull();
    });

    it('a new history-only secret in a file that already holds another history-only secret of the same rule is its own finding', async () => {
      const table = memoryTable();
      const { utils } = await build(table);

      // Scan 1: the history pass reports K1, in a commit long gone from HEAD.
      await ingest(utils, historyDto(5, { secretSource: 'history' }), 'scan-1');
      const [k1] = table.rows;
      // Scan 2: the incremental pass reports only the new commit, holding K2.
      // Both have no snippet and the occurrence index 0 of their own scan.
      await ingest(
        utils,
        historyDto(9, {
          secretSource: 'history',
          secretValue: OTHER_VALUE,
          commitSha: OTHER_COMMIT,
        }),
        'scan-2',
      );

      expect(table.rows).toHaveLength(2);
      const k2 = table.rows.find((r) => r !== k1);
      expect(k2.secretValueHash).toBe(hashOf(OTHER_VALUE));
      expect(k2.commitSha).toBe(OTHER_COMMIT);
      expect(k2.vulnerableStartLine).toBe(9);
      expect(k2.fingerprint).not.toBe(k1.fingerprint);
      // K1 is untouched: its line, its commit, its state, its sightings.
      expect(k1.vulnerableStartLine).toBe(5);
      expect(k1.commitSha).toBe(COMMIT);
      expect(k1.currentState).toBe('to_verify');
      expect(k1.secretValueHash).toBe(hashOf(VALUE));
      expect(k1.vulnerabilityDetectionHistory).toEqual([{ scanId: 'scan-1' }]);
    });

    it('an unhashed row holding another value is never claimed', async () => {
      // Stored before value hashes, for the value since rotated in place.
      const rotated = stored('secret-old', 2, {
        secretValueHash: null,
        encryptedSecret: ciphertextOf(OLD_VALUE),
      });
      const table = memoryTable([rotated]);
      const { utils, histRepo } = await build(table);

      // The history pass has no file hash, so the position alone would match.
      await ingest(utils, historyDto(2), 'scan-2');

      expect(table.rows).toHaveLength(2);
      expect(table.inserted).toHaveLength(1);
      expect(table.inserted[0].secretValueHash).toBe(hashOf(VALUE));
      expect(table.inserted[0].commitSha).toBe(COMMIT);
      // The old row now carries the hash of the value it holds, and nothing
      // of the new one.
      expect(rotated.secretValueHash).toBe(hashOf(OLD_VALUE));
      expect(rotated.commitSha).toBeNull();
      expect(
        histRepo.save.mock.calls.map(
          (c: any[]) => c[0].secretVulnerabilityDetection,
        ),
      ).toEqual([table.inserted[0]]);
    });

    it('the HEAD and history reports of one value share one fingerprint', async () => {
      const fingerprintOf = async (
        dto: any,
        occurrenceIndex: number | null,
      ) => {
        const table = memoryTable();
        const { utils } = await build(table);
        await utils.createNewVulnerability(
          dto,
          { ...secretCorrespondance },
          'scan-1',
          'p1',
          'gitleaks',
          'main',
          occurrenceIndex,
        );
        expect(table.inserted).toHaveLength(1);
        return table.inserted[0].fingerprint;
      };

      // Different lines, snippets, file hashes and occurrence indexes.
      const head = await fingerprintOf(headDto(12), 1);
      const history = await fingerprintOf(historyDto(3), 0);
      // An unrankable batch still gets it: never a NULL fingerprint.
      const unranked = await fingerprintOf(historyDto(3), null);
      const otherValue = await fingerprintOf(
        historyDto(3, { secretValue: OTHER_VALUE }),
        0,
      );

      expect(head).toMatch(/^[0-9a-f]{64}$/);
      expect(history).toBe(head);
      expect(unranked).toBe(head);
      expect(otherValue).not.toBe(head);
    });

    it.each([
      ['holding another value hash', { secretValueHash: hashOf(OLD_VALUE) }],
      [
        'holding another value, unhashed',
        { secretValueHash: null, encryptedSecret: ciphertextOf(OLD_VALUE) },
      ],
    ] as const)(
      'a drift claimant %s is never merged into',
      async (_label, extra) => {
        // A row stored with the snippet digest this report would compute,
        // at another line, never seen by this scan.
        const dto = historyDto(9);
        const claimant = stored('secret-old', 5, {
          ...extra,
          fileHash: '',
          fingerprint: fingerprintForNewSastDetection(
            dto,
            secretCorrespondance,
            'p1',
            'gitleaks',
            'main',
            0,
          ),
        });
        const table = memoryTable([claimant]);
        const { utils } = await build(table);

        await ingest(utils, dto, 'scan-2');

        expect(table.inserted).toHaveLength(1);
        expect(table.inserted[0].secretValueHash).toBe(hashOf(VALUE));
        expect(claimant.vulnerableStartLine).toBe(5);
        expect(claimant.secretValueHash).toBe(hashOf(OLD_VALUE));
        expect(claimant.commitSha).toBeNull();
        expect(claimant.vulnerabilityDetectionHistory).toEqual([]);
      },
    );
  });
});
