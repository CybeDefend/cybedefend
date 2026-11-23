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
 * Task 6 — the four code families' half of "keep the lifecycle correct going
 * forward". Task 5 populated `first/last_detected_at`, `triaged_at/by/by_type`,
 * `resolved_at` and `dismissal_reason` from history; without a write path that
 * maintains them, that backfill decays from the day it lands.
 */
describe('SastIacUtilsService – GRC lifecycle maintenance', () => {
  let service: SastIacUtilsService;
  let sastRepo: any;
  let iacRepo: any;
  let cicdRepo: any;
  let secretRepo: any;
  let detectionHistoryRepo: any;
  let resultService: {
    addHistoryItem: jest.Mock;
    recalculatePriority: jest.Mock;
    computeEnvironmentalForProject: jest.Mock;
  };

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
      cvss4EnvAdjustments: '',
      scoringSource: '',
      agentToolCallId: '',
      agentConversationId: '',
      agentStreamId: '',
      ...overrides,
    }) as any;

  const make = (Ctor: any, overrides: Record<string, any> = {}) =>
    Object.assign(new Ctor(), {
      id: 'det-1',
      projectId: 'proj-1',
      currentState: 'to_verify',
      currentPriority: 'Normal',
      stateManuallyModified: false,
      firstDetectedAt: null,
      lastDetectedAt: null,
      triagedAt: null,
      triagedBy: null,
      triagedByType: null,
      resolvedAt: null,
      dismissalReason: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  beforeEach(async () => {
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    cicdRepo = createMockRepository();
    secretRepo = createMockRepository();
    detectionHistoryRepo = createMockRepository();

    resultService = {
      addHistoryItem: jest.fn().mockResolvedValue(undefined),
      recalculatePriority: jest
        .fn()
        .mockResolvedValue({ priority: 'Normal', priorityScore: 0.5 }),
      computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
    } as any;

    const sastIacService = {
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
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: detectionHistoryRepo,
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
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(SastIacUtilsService);
  });

  // ── the four triage handlers ──────────────────────────────────────

  const handlers: [string, any, () => any][] = [
    ['handleUpdateSast', SastVulnerabilityDetections, () => sastRepo],
    ['handleUpdateIac', IacVulnerabilityDetections, () => iacRepo],
    ['handleUpdateCicd', CicdVulnerabilityDetections, () => cicdRepo],
    ['handleUpdateSecret', SecretVulnerabilityDetections, () => secretRepo],
  ];

  it.each(handlers)(
    '%s stamps the triage on the same clock as its status_change row',
    async (handler, Ctor) => {
      const vuln = make(Ctor);
      await (service as any)[handler](vuln, makeDto({ status: 'confirmed' }));

      expect(vuln.triagedBy).toBe('user-1');
      expect(vuln.triagedByType).toBe('user');
      const statusRow = resultService.addHistoryItem.mock.calls
        .map((c) => c[0])
        .find((h) => h.type === 'status_change');
      expect(statusRow).toBeDefined();
      // backfill-lifecycle.ts joins a dismissal comment to its transition on
      // equality to the second; two clocks here would break that join.
      expect(vuln.triagedAt).toBe(statusRow.date);
    },
  );

  it.each(handlers)(
    '%s files a HITL chat write as agent',
    async (handler, Ctor) => {
      const vuln = make(Ctor);
      await (service as any)[handler](
        vuln,
        // An `ignored` now REQUIRES a reason; the subject here is
        // still the actor classification, not the justification.
        makeDto({
          status: 'ignored',
          dismissalReason: 'agent verdict: not exploitable',
          agentToolCallId: 'call-1',
        }),
      );
      expect(vuln.triagedByType).toBe('agent');
      // The human confirmer stays the accountable actor.
      expect(vuln.triagedBy).toBe('user-1');
    },
  );

  it.each(handlers)(
    "%s files the agent's own userId='system' write as agent, not as a user",
    async (handler, Ctor) => {
      const vuln = make(Ctor);
      await (service as any)[handler](
        vuln,
        makeDto({
          status: 'ignored',
          dismissalReason: 'agent verdict: not exploitable',
          userId: 'system',
        }),
      );
      expect(vuln.triagedByType).toBe('agent');
      expect(vuln.triagedBy).toBeNull();
    },
  );

  // ── the dismissal guard is WIRED, not merely defined ─────
  //
  // `assertDismissalReason` has its own unit test in findings-export. These
  // assert the handlers actually call it: a guard that exists but is never
  // invoked from the four code families lets an unjustified `ignored` through
  // on the batch path and on every non-HTTP gRPC caller.

  it.each(handlers)(
    '%s refuses an ignore with no reason and writes nothing',
    async (handler, Ctor, repo) => {
      const vuln = make(Ctor);
      await expect(
        (service as any)[handler](vuln, makeDto({ status: 'ignored' })),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: 3 }), // INVALID_ARGUMENT
      });

      // Rejected BEFORE any mutation: a half-applied dismissal would leave the
      // row `ignored` with a null justification, which is the exact state the
      // guard exists to make impossible.
      expect(vuln.currentState).toBe('to_verify');
      expect(vuln.triagedAt).toBeNull();
      expect(repo().save).not.toHaveBeenCalled();
      expect(resultService.addHistoryItem).not.toHaveBeenCalled();
    },
  );

  it.each(handlers)(
    '%s refuses an ignore whose reason is only whitespace',
    async (handler, Ctor) => {
      const vuln = make(Ctor);
      await expect(
        (service as any)[handler](
          vuln,
          makeDto({ status: 'ignored', dismissalReason: '   ' }),
        ),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: 3 }),
      });
    },
  );

  it.each(handlers)(
    '%s persists the dismissal reason it was given',
    async (handler, Ctor) => {
      const vuln = make(Ctor);
      await (service as any)[handler](
        vuln,
        makeDto({ status: 'ignored', dismissalReason: 'accepted risk' }),
      );
      expect(vuln.currentState).toBe('ignored');
      expect(vuln.dismissalReason).toBe('accepted risk');
    },
  );

  it.each(handlers)(
    '%s leaves the lifecycle untouched on a comment-only update',
    async (handler, Ctor) => {
      const vuln = make(Ctor, { triagedAt: null });
      await (service as any)[handler](vuln, makeDto({ comment: 'a note' }));
      expect(vuln.triagedAt).toBeNull();
      expect(vuln.triagedByType).toBeNull();
    },
  );

  it('handleUpdateSast sets resolved_at on resolve and clears it on reopen', async () => {
    const vuln = make(SastVulnerabilityDetections);
    await service.handleUpdateSast(vuln, makeDto({ status: 'resolved' }));
    expect(vuln.resolvedAt).toEqual(vuln.triagedAt);

    await service.handleUpdateSast(vuln, makeDto({ status: 'to_verify' }));
    expect(vuln.resolvedAt).toBeNull();
  });

  // ── the auto-resolve path ─────────────────────────────────────────

  it('finalizeOldScanVulnerabilities files its auto-resolve as the machine', async () => {
    const managed = make(SastVulnerabilityDetections, {
      id: 'sast-managed',
      currentState: 'to_verify',
    });
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    cicdRepo.find.mockResolvedValue([]);
    detectionHistoryRepo.find.mockResolvedValue([]);
    detectionHistoryRepo.findOne.mockResolvedValue(null);

    await service.finalizeOldScanVulnerabilities(
      [managed],
      [],
      'proj-1',
      'scan-current',
    );

    expect(managed.currentState).toBe('resolved');
    expect(managed.triagedByType).toBe('system');
    expect(managed.triagedBy).toBeNull();
    expect(managed.resolvedAt).toEqual(managed.triagedAt);

    const historyRow = resultService.addHistoryItem.mock.calls[0][0];
    // A null userId with no source reads as "unknown user" downstream.
    expect(historyRow.source).toBe('system');
    expect(historyRow.date).toEqual(managed.resolvedAt);
  });

  // ── a confirmed finding the scan no longer reports ────────────────

  const scanFamilies: [string, any, () => any][] = [
    ['handleUpdateSast', SastVulnerabilityDetections, () => sastRepo],
    ['handleUpdateIac', IacVulnerabilityDetections, () => iacRepo],
    ['handleUpdateCicd', CicdVulnerabilityDetections, () => cicdRepo],
  ];

  const finalizeWithoutIt = async (det: any, scanId: string) => {
    sastRepo.find.mockResolvedValue([]);
    iacRepo.find.mockResolvedValue([]);
    cicdRepo.find.mockResolvedValue([]);
    detectionHistoryRepo.find.mockResolvedValue([]);
    detectionHistoryRepo.findOne.mockResolvedValue(null);
    await service.finalizeOldScanVulnerabilities([det], [], 'proj-1', scanId);
  };

  const statusRows = () =>
    resultService.addHistoryItem.mock.calls
      .map(([row]) => row)
      .filter((row) => row.type === 'status_change');

  it.each(scanFamilies)(
    'a finding confirmed through %s closes as the machine once a scan no longer reports it',
    async (handler, Ctor, repo) => {
      const det = make(Ctor, { id: 'det-confirmed' });
      await (service as any)[handler](det, makeDto({ status: 'confirmed' }));

      await finalizeWithoutIt(det, 'scan-after-fix');

      expect(det.currentState).toBe('resolved');
      // The resolution is the machine's: it must not read as the confirmer
      // closing the finding.
      expect(det.triagedByType).toBe('system');
      expect(det.triagedBy).toBeNull();
      expect(det.resolvedAt).toEqual(det.triagedAt);
      expect(repo().save).toHaveBeenLastCalledWith(det);

      // The human decision stays readable: the confirm row is untouched and
      // the machine's resolution is appended after it, naming nobody.
      expect(statusRows()).toEqual([
        expect.objectContaining({
          value: 'confirmed',
          userId: 'user-1',
          source: 'dashboard_manual',
        }),
        expect.objectContaining({ value: 'resolved', source: 'system' }),
      ]);
      expect(statusRows()[1].userId).toBeUndefined();
    },
  );

  it('a confirmed CICD finding the scan closed re-opens as to_verify when it comes back', async () => {
    const det = make(CicdVulnerabilityDetections, {
      id: 'det-confirmed',
      vulnerabilityDetectionHistory: [],
    });
    await service.handleUpdateCicd(det, makeDto({ status: 'confirmed' }));
    await finalizeWithoutIt(det, 'scan-after-fix');
    expect(det.currentState).toBe('resolved');

    await service.recordCicdRedetection(det, 'scan-after-revert');

    expect(det.currentState).toBe('to_verify');
    expect(det.stateManuallyModified).toBe(false);
    expect(det.resolvedAt).toBeNull();
  });

  // ── the sighting funnel ───────────────────────────────────────────

  const families: [string, any, () => any][] = [
    ['sast', SastVulnerabilityDetections, () => sastRepo],
    ['iac', IacVulnerabilityDetections, () => iacRepo],
    ['cicd', CicdVulnerabilityDetections, () => cicdRepo],
    // Secrets reach the funnel through createNewVulnerability like the rest;
    // without an explicit branch here the whole family exports a null "last
    // seen", which is exactly the ambiguity the export exists to remove.
    ['secret', SecretVulnerabilityDetections, () => secretRepo],
  ];

  it.each(families)(
    'addVulnerabilityDetectionHistory persists the %s sighting window',
    async (_family, Ctor, repo) => {
      const det = make(Ctor);
      await service.addVulnerabilityDetectionHistory(det, 'scan-1');

      expect(det.firstDetectedAt).toBeInstanceOf(Date);
      expect(det.lastDetectedAt).toBe(det.firstDetectedAt);
      // Three of the four callers save the row BEFORE calling this, so an
      // in-memory mutation alone would be silently dropped.
      expect(repo().update).toHaveBeenCalledWith('det-1', {
        firstDetectedAt: det.firstDetectedAt,
        lastDetectedAt: det.lastDetectedAt,
      });
    },
  );

  it('addVulnerabilityDetectionHistory keeps first_detected_at on re-detection', async () => {
    const first = new Date('2026-01-01T00:00:00Z');
    const det = make(SastVulnerabilityDetections, {
      firstDetectedAt: first,
      lastDetectedAt: first,
    });

    await service.addVulnerabilityDetectionHistory(det, 'scan-2');

    expect(det.firstDetectedAt).toBe(first);
    expect(det.lastDetectedAt.getTime()).toBeGreaterThan(first.getTime());
  });

  it('addVulnerabilityDetectionHistory never resets a stored triage', async () => {
    const triagedAt = new Date('2026-02-02T00:00:00Z');
    const det = make(SastVulnerabilityDetections, {
      currentState: 'ignored',
      triagedAt,
      triagedBy: 'user-9',
      triagedByType: 'user',
      dismissalReason: 'accepted risk',
    });

    await service.addVulnerabilityDetectionHistory(det, 'scan-2');

    expect(det.triagedAt).toBe(triagedAt);
    expect(det.triagedBy).toBe('user-9');
    expect(det.triagedByType).toBe('user');
    expect(det.dismissalReason).toBe('accepted risk');
    expect(sastRepo.update).toHaveBeenCalledWith('det-1', {
      firstDetectedAt: det.firstDetectedAt,
      lastDetectedAt: det.lastDetectedAt,
    });
  });

  // ── the secret family's ONLY re-detection path ────────────────────

  /**
   * `getExistingVulnerabilities` maps SAST + IaC only, and CICD is handled by
   * `recordCicdRedetection`. A re-detected SECRET therefore falls through to
   * `createNewVulnerability`'s duplicate short-circuit and returns without ever
   * touching the sighting funnel — which would freeze `last_detected_at` at
   * creation time for the entire family and make "still exposed" indistinguish-
   * able from "not scanned since March" in the export.
   */
  it('moves last_detected_at on a re-detected secret (alreadyExists short-circuit)', async () => {
    const first = new Date('2026-01-01T00:00:00Z');
    const duplicate = make(SecretVulnerabilityDetections, {
      id: 'det-secret',
      fingerprint: null,
      fileHash: 'hash-1',
      scannerType: 'gitleaks',
      branch: 'main',
      vulnerability: { id: 'cat-1' },
      vulnerabilityDetectionHistory: [{ scanId: 'scan-1' }],
      firstDetectedAt: first,
      lastDetectedAt: first,
    });
    secretRepo.find.mockResolvedValue([duplicate]);
    secretRepo.save.mockImplementation(async (e: any) => e);

    await service.createNewVulnerability(
      {
        ruleId: 'generic.secrets.aws-key',
        path: 'src/a.ts',
        language: 'typescript',
        fileHash: 'hash-1',
        secretValue: 'AKIAIOSFODNN7EXAMPLE',
        codeSnippet: {
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          startLine: 7,
          endLine: 11,
          code: [{ line: 9, content: 'const k = "AKIA...";' }],
        },
        dataFlow: [],
      } as any,
      {
        ruleId: 'rule-a',
        scanner: 'gitleaks',
        vulnerabilityType: 'secret',
        vulnerability: { id: 'cat-1', severity: 'high' },
      } as any,
      'scan-2',
      'proj-1',
      'gitleaks',
      'main',
      0,
    );

    expect(duplicate.firstDetectedAt).toBe(first);
    expect(secretRepo.update).toHaveBeenCalledWith(
      'det-secret',
      expect.objectContaining({ firstDetectedAt: first }),
    );
    // The sighting update (the row, stored without a value hash, is also
    // given one by a conditional update of its own).
    const written = secretRepo.update.mock.calls.find(
      ([criteria]: [unknown]) => criteria === 'det-secret',
    )[1];
    expect(written.lastDetectedAt.getTime()).toBeGreaterThan(first.getTime());
  });

  // ── the revive path ───────────────────────────────────────────────

  it('updateExistingVulnerability drops resolved_at when a resolved finding reappears', async () => {
    const det = make(SastVulnerabilityDetections, {
      currentState: 'resolved',
      resolvedAt: new Date('2026-03-03T00:00:00Z'),
      triagedAt: new Date('2026-03-03T00:00:00Z'),
      triagedByType: 'system',
    });

    await service.updateExistingVulnerability(det, 'scan-2');

    expect(det.currentState).toBe('to_verify');
    expect(det.resolvedAt).toBeNull();
    // A sighting is not a triage: nobody decided anything here.
    expect(det.triagedByType).toBe('system');
  });

  it('recordCicdRedetection drops resolved_at when a resolved CICD finding reappears', async () => {
    const det = make(CicdVulnerabilityDetections, {
      currentState: 'resolved',
      resolvedAt: new Date('2026-03-03T00:00:00Z'),
      vulnerabilityDetectionHistory: [],
    });

    await service.recordCicdRedetection(det, 'scan-2');

    expect(det.currentState).toBe('to_verify');
    expect(det.resolvedAt).toBeNull();
  });
});
