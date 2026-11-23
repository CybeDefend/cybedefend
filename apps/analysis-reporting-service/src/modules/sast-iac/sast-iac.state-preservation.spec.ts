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

/**
 * Preserve manually-decided states (`stateManuallyModified`) on
 * SAST / IaC / CICD across re-scans, mirroring the SCA fix (`97b5e2f3f`, see
 * `sca.service.spec.ts` › "re-scan state & exploitability preservation").
 *
 * The behaviours asserted here:
 *   1. An update handler that applies a status must FREEZE the decision by
 *      setting `stateManuallyModified = true`.
 *   2. The freeze guards against RE-EVALUATION, not disappearance. When its
 *      finding disappears, `finalizeOldScanVulnerabilities` auto-resolves a
 *      `confirmed` detection even when frozen (closing it completes the
 *      confirm), and never touches an `ignored` one (a dismissal the scan
 *      cannot contradict). Scan-managed detections resolve as before.
 *   3. A `resolved` detection that reappears wins the lifecycle: it is reset to
 *      `to_verify` and the (now stale) manual flag is cleared.
 *
 * NOTE (CICD surface): CICD has no re-detection reset nor a
 * `finalizeOldScanVulnerabilities` path — its ingestion goes through
 * `createNewVulnerability` with a pure `alreadyExists` dedup (state preserved
 * implicitly) and its only mutable-state entry point is `handleUpdateCicd`.
 * Therefore only the handler-freeze scenario applies to CICD here.
 */
describe('SastIacUtilsService – re-scan state preservation', () => {
  let service: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let cicdRepo: any;
  let historyRepo: any;
  let correspondanceRepo: any;
  let resultService: {
    addHistoryItem: jest.Mock;
    recalculatePriority: jest.Mock;
    computeEnvironmentalForProject: jest.Mock;
  };
  let sastIacService: {
    getSastVulnerabilityByIdInProject: jest.Mock;
    getIacVulnerabilityByIdInProject: jest.Mock;
    getCicdVulnerabilityByIdInProject: jest.Mock;
    getSecretVulnerabilityByIdInProject: jest.Mock;
  };
  let cyberiskEnqueuer: { enqueue: jest.Mock };

  const makeDto = (overrides: Record<string, any> = {}) =>
    ({
      projectId: 'proj-1',
      vulnerabilityId: 'vuln-1',
      status: '',
      priority: '',
      comment: '',
      userId: 'user-1',
      exploitabilityScore: 0,
      exploitabilityVerdict: '',
      exploitabilityReason: '',
      exploitabilityScoreReason: '',
      exploitabilitySource: '',
      exploitabilityFactors: '',
      cvss4EnvAdjustments: '',
      scoringSource: '',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
      ...overrides,
    }) as any;

  const makeSast = (overrides: Record<string, any> = {}) =>
    Object.assign(new SastVulnerabilityDetections(), {
      id: 'sast-1',
      projectId: 'proj-1',
      currentState: 'to_verify',
      currentPriority: 'Normal',
      stateManuallyModified: false,
      vulnerableStartLine: 10,
      vulnerableEndLine: 12,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  const makeIac = (overrides: Record<string, any> = {}) =>
    Object.assign(new IacVulnerabilityDetections(), {
      id: 'iac-1',
      projectId: 'proj-1',
      currentState: 'to_verify',
      currentPriority: 'Normal',
      stateManuallyModified: false,
      vulnerableStartLine: 10,
      vulnerableEndLine: 12,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  const makeCicd = (overrides: Record<string, any> = {}) =>
    Object.assign(new CicdVulnerabilityDetections(), {
      id: 'cicd-1',
      projectId: 'proj-1',
      currentState: 'to_verify',
      currentPriority: 'Normal',
      stateManuallyModified: false,
      ...overrides,
    });

  beforeEach(async () => {
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    cicdRepo = createMockRepository();
    historyRepo = createMockRepository();
    correspondanceRepo = createMockRepository();

    resultService = {
      addHistoryItem: jest.fn().mockResolvedValue(undefined),
      recalculatePriority: jest
        .fn()
        .mockResolvedValue({ priority: 'Normal', priorityScore: 0.5 }),
      computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
    } as any;
    sastIacService = {
      getSastVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getIacVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getCicdVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
      getSecretVulnerabilityByIdInProject: jest
        .fn()
        .mockResolvedValue({ vulnerability: {} }),
    };
    cyberiskEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

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
          useValue: correspondanceRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: historyRepo,
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
          useValue: createMockRepository(),
        },
        { provide: SastIacService, useValue: sastIacService },
        { provide: ResultService, useValue: resultService },
        { provide: IssueIntegrationService, useValue: {} },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn() },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecretEncryptionService,
          useValue: {
            encrypt: jest.fn(() => 'v1:mock-iv:mock-ct:mock-tag'),
            hashSecretValue: jest.fn((v: string) => 'h:' + v),
          },
        },
        { provide: CyberiskRecomputeEnqueuer, useValue: cyberiskEnqueuer },
      ],
    }).compile();

    service = module.get(SastIacUtilsService);

    sastRepo.save.mockImplementation(async (e: any) => e);
    iacRepo.save.mockImplementation(async (e: any) => e);
    cicdRepo.save.mockImplementation(async (e: any) => e);
    // The CICD path goes through finalizeOldScanVulnerabilities, so it now
    // queries cicdVulnDetectRepository.find — default it to [] so the SAST/IaC
    // finalize cases don't blow up on `[...dbCicdVulns]`.
    cicdRepo.find.mockResolvedValue([]);
    historyRepo.save.mockResolvedValue(undefined);
  });

  // ── 1. Update handlers freeze the manual decision ────────────────────────

  it('handleUpdateSast marks the detection as manually modified when a status is applied', async () => {
    const vuln = makeSast();

    await service.handleUpdateSast(
      vuln,
      makeDto({
        status: 'ignored',
        dismissalReason: 'fixture: dismissed for this test',
      }),
    );

    expect(vuln.currentState).toBe('ignored');
    expect((vuln as any).stateManuallyModified).toBe(true);
  });

  it('handleUpdateIac marks the detection as manually modified when a status is applied', async () => {
    const vuln = makeIac();

    await service.handleUpdateIac(vuln, makeDto({ status: 'confirmed' }));

    expect(vuln.currentState).toBe('confirmed');
    expect((vuln as any).stateManuallyModified).toBe(true);
  });

  it('handleUpdateCicd marks the detection as manually modified when a status is applied', async () => {
    const vuln = makeCicd();

    await service.handleUpdateCicd(
      vuln,
      makeDto({
        status: 'ignored',
        dismissalReason: 'fixture: dismissed for this test',
      }),
    );

    expect(vuln.currentState).toBe('ignored');
    expect((vuln as any).stateManuallyModified).toBe(true);
  });

  it('handleUpdateSast does NOT flag a detection when the update carries no status (comment-only)', async () => {
    const vuln = makeSast();

    await service.handleUpdateSast(vuln, makeDto({ comment: 'just a note' }));

    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateIac does NOT flag a detection when the update carries no status (comment-only)', async () => {
    const vuln = makeIac();

    await service.handleUpdateIac(vuln, makeDto({ comment: 'just a note' }));

    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateCicd does NOT flag a detection when the update carries no status (comment-only)', async () => {
    const vuln = makeCicd();

    await service.handleUpdateCicd(vuln, makeDto({ comment: 'just a note' }));

    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  // ── 1b. `to_verify` is the undecided/scan-managed state: it must NOT freeze ─
  // The modal offers `to_verify` to hand an accidental confirm/ignore back to
  // the scan: it records no decision, so there is nothing for the flag to
  // protect against re-evaluation.

  it('handleUpdateSast does NOT freeze the detection when the status is set to to_verify', async () => {
    const vuln = makeSast();

    await service.handleUpdateSast(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateSast clears a prior manual freeze when the user reverts to to_verify', async () => {
    const vuln = makeSast({
      currentState: 'confirmed',
      stateManuallyModified: true,
    });

    await service.handleUpdateSast(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateIac does NOT freeze the detection when the status is set to to_verify', async () => {
    const vuln = makeIac();

    await service.handleUpdateIac(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateIac clears a prior manual freeze when the user reverts to to_verify', async () => {
    const vuln = makeIac({
      currentState: 'ignored',
      stateManuallyModified: true,
    });

    await service.handleUpdateIac(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateCicd does NOT freeze the detection when the status is set to to_verify', async () => {
    const vuln = makeCicd();

    await service.handleUpdateCicd(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  it('handleUpdateCicd clears a prior manual freeze when the user reverts to to_verify', async () => {
    const vuln = makeCicd({
      currentState: 'confirmed',
      stateManuallyModified: true,
    });

    await service.handleUpdateCicd(vuln, makeDto({ status: 'to_verify' }));

    expect(vuln.currentState).toBe('to_verify');
    expect((vuln as any).stateManuallyModified).toBe(false);
  });

  // ── 2. finalizeOldScanVulnerabilities: a disappearance closes a confirm ──

  it('finalizeOldScanVulnerabilities auto-resolves a manually-confirmed SAST detection that disappears', async () => {
    const decided = makeSast({
      id: 'sast-decided',
      currentState: 'confirmed',
      stateManuallyModified: true,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [decided],
      [],
      'proj-1',
      'scan-current',
    );

    // Nobody detects it any more: closing it completes the confirm.
    expect(decided.currentState).toBe('resolved');
    expect(sastRepo.save).toHaveBeenCalledWith(decided);
  });

  it('finalizeOldScanVulnerabilities still auto-resolves a scan-managed SAST detection that disappears', async () => {
    const managed = makeSast({
      id: 'sast-managed',
      currentState: 'to_verify',
      stateManuallyModified: false,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [managed],
      [],
      'proj-1',
      'scan-current',
    );

    expect(managed.currentState).toBe('resolved');
  });

  it('finalizeOldScanVulnerabilities auto-resolves a manually-confirmed IaC detection that disappears', async () => {
    const decided = makeIac({
      id: 'iac-decided',
      currentState: 'confirmed',
      stateManuallyModified: true,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [decided],
      [],
      'proj-1',
      'scan-current',
    );

    expect(decided.currentState).toBe('resolved');
    expect(iacRepo.save).toHaveBeenCalledWith(decided);
  });

  it('finalizeOldScanVulnerabilities still auto-resolves a scan-managed IaC detection that disappears', async () => {
    const managed = makeIac({
      id: 'iac-managed',
      currentState: 'to_verify',
      stateManuallyModified: false,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [managed],
      [],
      'proj-1',
      'scan-current',
    );

    expect(managed.currentState).toBe('resolved');
  });

  // CICD has a finalization path, so it follows the SAST/IaC rule.
  // The case that forced the change: 10 unpinned-action findings confirmed by
  // hand stayed `confirmed` after the actions were pinned by SHA and the next
  // scan of main no longer reported them.

  it('finalizeOldScanVulnerabilities auto-resolves a manually-confirmed CICD detection that disappears', async () => {
    const decided = makeCicd({
      id: 'cicd-decided',
      currentState: 'confirmed',
      stateManuallyModified: true,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    cicdRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [decided],
      [],
      'proj-1',
      'scan-current',
    );

    expect(decided.currentState).toBe('resolved');
    expect(cicdRepo.save).toHaveBeenCalledWith(decided);
  });

  it('finalizeOldScanVulnerabilities still auto-resolves a scan-managed CICD detection that disappears', async () => {
    const managed = makeCicd({
      id: 'cicd-managed',
      currentState: 'to_verify',
      stateManuallyModified: false,
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    cicdRepo.find.mockResolvedValue([]);
    historyRepo.find.mockResolvedValue([]);
    historyRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [managed],
      [],
      'proj-1',
      'scan-current',
    );

    expect(managed.currentState).toBe('resolved');
  });

  it('recordCicdRedetection resets a re-detected resolved CICD detection to to_verify and clears the manual flag', async () => {
    const reappeared = makeCicd({
      id: 'cicd-reappeared',
      currentState: 'resolved',
      stateManuallyModified: true,
      // already has a current-scan history row → skip the history insert path
      vulnerabilityDetectionHistory: [{ scanId: 'scan-current' }],
    });

    await service.recordCicdRedetection(reappeared, 'scan-current');

    expect(reappeared.currentState).toBe('to_verify');
    expect((reappeared as any).stateManuallyModified).toBe(false);
  });

  // ── 3. Re-detection: manual state frozen, resolved lifecycle wins ────────

  it('updateExistingVulnerability preserves a manually-confirmed SAST detection on re-detection', async () => {
    const confirmed = makeSast({
      id: 'sast-confirmed',
      currentState: 'confirmed',
      stateManuallyModified: true,
    });

    await service.updateExistingVulnerability(confirmed, 'scan-current');

    expect(confirmed.currentState).toBe('confirmed');
    expect((confirmed as any).stateManuallyModified).toBe(true);
  });

  it('updateExistingVulnerability resets a re-detected resolved SAST detection to to_verify and clears the manual flag', async () => {
    const reappeared = makeSast({
      id: 'sast-reappeared',
      currentState: 'resolved',
      stateManuallyModified: true,
    });

    await service.updateExistingVulnerability(reappeared, 'scan-current');

    // A reappearing resolved vuln is scan-managed again: reset and drop the
    // now-stale manual freeze so future scans can manage it normally.
    expect(reappeared.currentState).toBe('to_verify');
    expect((reappeared as any).stateManuallyModified).toBe(false);
  });

  it('updateExistingVulnerability resets a re-detected resolved IaC detection to to_verify and clears the manual flag', async () => {
    const reappeared = makeIac({
      id: 'iac-reappeared',
      currentState: 'resolved',
      stateManuallyModified: true,
    });

    await service.updateExistingVulnerability(reappeared, 'scan-current');

    expect(reappeared.currentState).toBe('to_verify');
    expect((reappeared as any).stateManuallyModified).toBe(false);
  });

  // Re-detection where the finding's code changed (fileHash differs) goes down
  // the SAST-only branch of processVulnerability that resets currentState — it
  // must not clobber a frozen user/agent decision.
  it('processVulnerability preserves a manually-confirmed SAST detection when the code (fileHash) changes', async () => {
    jest
      .spyOn(service as any, 'addVulnerabilityDetectionHistory')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'addCodeSnippetToDetection')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'addDataFlowItemsToDetection')
      .mockResolvedValue(undefined);

    const existing = makeSast({
      id: 'sast-filehash',
      currentState: 'confirmed',
      stateManuallyModified: true,
      path: 'app.py',
      language: 'python',
      vulnerableStartLine: 10,
      vulnerableEndLine: 10,
      fileHash: 'OLD_HASH',
      vulnerability: { id: 'V1' },
    });
    correspondanceRepo.findOne.mockResolvedValue({
      ruleId: 'B102',
      scanner: 'bandit',
      enabled: true,
      vulnerabilityType: 'sast',
      vulnerability: { id: 'V1', severity: 'high' },
    });

    const vulnDto: any = {
      ruleId: 'bandit.B102',
      path: 'app.py',
      language: 'python',
      fileHash: 'NEW_HASH', // code changed since last scan
      codeSnippet: {
        vulnerableStartLine: 10,
        vulnerableEndLine: 10,
        startLine: 8,
        endLine: 12,
        code: 'exec(x)',
        language: 'python',
      },
      dataFlow: [],
    };
    const existingVulnsMap = new Map([['bandit:B102', [existing]]]);

    await service.processVulnerability(
      vulnDto,
      existingVulnsMap as any,
      [],
      [],
      'scan-current',
      'proj-1',
      'bandit',
      'critical,high,medium,low',
    );

    expect(existing.currentState).toBe('confirmed');
    expect((existing as any).stateManuallyModified).toBe(true);
  });

  // A user CAN set a status of 'resolved' (it is in the allowed set), which
  // freezes the flag. If that finding later reappears with changed code, the
  // resolved lifecycle wins: it must reset to to_verify AND drop the stale
  // freeze — otherwise it stays frozen 'to_verify' forever and can never
  // auto-resolve again.
  it('processVulnerability resets a resolved+frozen SAST detection to to_verify and clears the flag when the code (fileHash) changes', async () => {
    jest
      .spyOn(service as any, 'addVulnerabilityDetectionHistory')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'addCodeSnippetToDetection')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'addDataFlowItemsToDetection')
      .mockResolvedValue(undefined);

    const existing = makeSast({
      id: 'sast-resolved-filehash',
      currentState: 'resolved',
      stateManuallyModified: true,
      path: 'app.py',
      language: 'python',
      vulnerableStartLine: 10,
      vulnerableEndLine: 10,
      fileHash: 'OLD_HASH',
      vulnerability: { id: 'V1' },
    });
    correspondanceRepo.findOne.mockResolvedValue({
      ruleId: 'B102',
      scanner: 'bandit',
      enabled: true,
      vulnerabilityType: 'sast',
      vulnerability: { id: 'V1', severity: 'high' },
    });

    const vulnDto: any = {
      ruleId: 'bandit.B102',
      path: 'app.py',
      language: 'python',
      fileHash: 'NEW_HASH',
      codeSnippet: {
        vulnerableStartLine: 10,
        vulnerableEndLine: 10,
        startLine: 8,
        endLine: 12,
        code: 'exec(x)',
        language: 'python',
      },
      dataFlow: [],
    };
    const existingVulnsMap = new Map([['bandit:B102', [existing]]]);

    await service.processVulnerability(
      vulnDto,
      existingVulnsMap as any,
      [],
      [],
      'scan-current',
      'proj-1',
      'bandit',
      'critical,high,medium,low',
    );

    expect(existing.currentState).toBe('to_verify');
    expect((existing as any).stateManuallyModified).toBe(false);
  });

  // Guard: a manually-IGNORED detection that disappears from the scan must be
  // preserved. Unlike a confirm, a dismissal is a decision the scan cannot
  // complete: resolving it would overwrite the dismissal reason and its actor.
  it.each<[string, (o: Record<string, any>) => any, () => any]>([
    ['SAST', makeSast, () => sastRepo],
    ['IaC', makeIac, () => iacRepo],
    ['CICD', makeCicd, () => cicdRepo],
  ])(
    'finalizeOldScanVulnerabilities does NOT auto-resolve a manually-ignored %s detection that disappears',
    async (_family, make, repo) => {
      const ignored = make({
        id: 'det-ignored',
        currentState: 'ignored',
        stateManuallyModified: true,
      });
      sastRepo.find.mockResolvedValue([]);
      iacRepo.find.mockResolvedValue([]);
      historyRepo.find.mockResolvedValue([]);
      historyRepo.findOne.mockResolvedValue(null);

      await service.finalizeOldScanVulnerabilities(
        [ignored],
        [],
        'proj-1',
        'scan-current',
      );

      expect(ignored.currentState).toBe('ignored');
      expect(repo().save).not.toHaveBeenCalled();
      expect(resultService.addHistoryItem).not.toHaveBeenCalled();
    },
  );

  // Re-evaluation is untouched by the disappearance rule: a CICD finding the
  // scan still reports keeps its confirm.
  it('recordCicdRedetection keeps a manually-confirmed CICD detection confirmed', async () => {
    const confirmed = makeCicd({
      id: 'cicd-confirmed',
      currentState: 'confirmed',
      stateManuallyModified: true,
      vulnerabilityDetectionHistory: [{ scanId: 'scan-current' }],
    });

    await service.recordCicdRedetection(confirmed, 'scan-current');

    expect(confirmed.currentState).toBe('confirmed');
    expect((confirmed as any).stateManuallyModified).toBe(true);
    expect(cicdRepo.save).not.toHaveBeenCalled();
  });
});
