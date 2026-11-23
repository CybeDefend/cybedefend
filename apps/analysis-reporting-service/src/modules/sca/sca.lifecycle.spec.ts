import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { Logger } from 'nestjs-pino';
import { ScaService } from './sca.service';
import { ADVISORY_MATCHER } from '../../edition/ports/advisory-matcher.port';
import { DETECTION_ENRICHERS } from '../../edition/ports/detection-enrichers.port';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  createQueryBuilderMock,
  MockType,
} from '../../test-utils/typeorm-mock.util';

/**
 * Task 6 — the SCA family's half of "keep the lifecycle correct going
 * forward". SCA has TWO auto-resolve sites, not one: the per-scan sweep inside
 * `batchHandleVulnerabilities` and `removeMissingLibs`. Both must file the
 * transition as the machine.
 */
describe('ScaService – GRC lifecycle maintenance', () => {
  let service: ScaService;
  let scaDetectedRepo: MockType<any>;
  let scaVulnRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let matcher: {
    findMatchingVulnerabilities: jest.Mock;
    findMatchingVulnerabilitiesForLibraries: jest.Mock;
  };
  let resultService: any;

  beforeEach(async () => {
    scaDetectedRepo = createMockRepository();
    scaVulnRepo = createMockRepository();
    historyRepo = createMockRepository();
    // The grouped detection writes.
    scaVulnRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(createQueryBuilderMock());
    historyRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(createQueryBuilderMock());
    matcher = {
      findMatchingVulnerabilities: jest.fn().mockResolvedValue([]),
      // The batch contract: what the per-package lookup gives, per package.
      findMatchingVulnerabilitiesForLibraries: jest.fn((libraries: unknown[]) =>
        Promise.all(
          libraries.map((library) =>
            matcher.findMatchingVulnerabilities(library),
          ),
        ),
      ),
    };
    resultService = {
      addHistoryItem: jest.fn().mockResolvedValue({}),
      computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
      recalculatePriority: jest
        .fn()
        .mockResolvedValue({ priority: 'high', priorityScore: 80 }),
    };

    scaDetectedRepo.createQueryBuilder = jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        identifiers: [{ id: 'pkg-1' }],
        generatedMaps: [],
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: scaDetectedRepo,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: scaVulnRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository({
            createQueryBuilder: jest
              .fn()
              .mockReturnValue(createQueryBuilderMock()),
          }),
        },
        { provide: getRepositoryToken(HistoryItem), useValue: historyRepo },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: createMockRepository(),
        },
        { provide: ADVISORY_MATCHER, useValue: matcher },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 9.3 }),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: DETECTION_ENRICHERS,
          useValue: [
            {
              name: 'EPSS',
              enrichDetections: jest.fn().mockResolvedValue(0),
            },
          ],
        },
        { provide: ResultService, useValue: resultService },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
            createIssuesForScan: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              get: jest.fn().mockReturnValue(of({ parsedBranches: [] })),
              getProjectBranches: jest
                .fn()
                .mockReturnValue(of({ branches: [] })),
            }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              updateScanState: jest.fn().mockReturnValue(of({})),
            }),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: getDataSourceToken(),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getScoringBranches: jest.fn().mockResolvedValue(['main', 'master']),
          },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
    historyRepo.create!.mockImplementation((e: any) => e);
    historyRepo.save!.mockImplementation(async (e: any) => e);
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
  });

  const makeDto = (overrides: Record<string, any> = {}) =>
    ({
      projectId: 'p1',
      vulnerabilityId: 'v1',
      status: '',
      priority: '',
      comment: '',
      userId: 'u1',
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

  const makeDet = (overrides: Record<string, any> = {}) => ({
    id: 'v1',
    currentState: 'to_verify',
    currentPriority: 'normal',
    stateManuallyModified: false,
    firstDetectedAt: null,
    lastDetectedAt: null,
    triagedAt: null,
    triagedBy: null,
    triagedByType: null,
    resolvedAt: null,
    dismissalReason: null,
    ...overrides,
  });

  // ── handleUpdateSca ───────────────────────────────────────────────

  it('handleUpdateSca stamps the triage on the same clock as its status_change row', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await service.handleUpdateSca(vuln, makeDto({ status: 'confirmed' }));

    expect(vuln.triagedBy).toBe('u1');
    expect(vuln.triagedByType).toBe('user');
    const statusRow = resultService.addHistoryItem.mock.calls
      .map((c: any[]) => c[0])
      .find((h: any) => h.type === 'status_change');
    expect(vuln.triagedAt).toBe(statusRow.date);
  });

  it('handleUpdateSca files a HITL chat write as agent', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await service.handleUpdateSca(
      vuln,
      // An `ignored` now REQUIRES a reason; the subject here is still
      // the actor classification, not the justification.
      makeDto({
        status: 'ignored',
        dismissalReason: 'agent verdict: not exploitable',
        agentToolCallId: 'call-1',
      }),
    );

    expect(vuln.triagedByType).toBe('agent');
    expect(vuln.triagedBy).toBe('u1');
  });

  // ── the dismissal guard is WIRED into handleUpdateSca ────

  it('handleUpdateSca refuses an ignore with no reason and writes nothing', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await expect(
      service.handleUpdateSca(vuln, makeDto({ status: 'ignored' })),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }), // INVALID_ARGUMENT
    });

    expect(vuln.currentState).toBe('to_verify');
    expect(vuln.triagedAt).toBeNull();
    expect(scaVulnRepo.save).not.toHaveBeenCalled();
    expect(resultService.addHistoryItem).not.toHaveBeenCalled();
  });

  it('handleUpdateSca refuses an ignore whose reason is only whitespace', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await expect(
      service.handleUpdateSca(
        vuln,
        makeDto({ status: 'ignored', dismissalReason: '   ' }),
      ),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: 3 }),
    });
  });

  it('handleUpdateSca persists the dismissal reason it was given', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await service.handleUpdateSca(
      vuln,
      makeDto({ status: 'ignored', dismissalReason: 'accepted risk' }),
    );

    expect(vuln.currentState).toBe('ignored');
    expect(vuln.dismissalReason).toBe('accepted risk');
  });

  it('handleUpdateSca leaves the lifecycle untouched on a comment-only update', async () => {
    const vuln = makeDet() as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await service.handleUpdateSca(vuln, makeDto({ comment: 'a note' }));

    expect(vuln.triagedAt).toBeNull();
    expect(vuln.triagedByType).toBeNull();
  });

  // ── auto-resolve site 2: removeMissingLibs ────────────────────────

  it('removeMissingLibs files its auto-resolve as the machine', async () => {
    const lib = { id: 'lib-1', projectId: 'p1' };
    const scanManaged = makeDet({
      id: 'd-managed',
      scaDetectedPackage: lib,
    }) as any;
    scaDetectedRepo.find!.mockResolvedValue([lib]);
    scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
    scaVulnRepo.find!.mockResolvedValue([scanManaged]);
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await (service as any).removeMissingLibs('p1', 's1', '');

    expect(scanManaged.currentState).toBe('resolved');
    expect(scanManaged.triagedByType).toBe('system');
    expect(scanManaged.triagedBy).toBeNull();
    expect(scanManaged.resolvedAt).toEqual(scanManaged.triagedAt);

    const historyRow = historyRepo
      .create!.mock.calls.map((c: any[]) => c[0])
      .find((h: any) => h?.type === 'status_change');
    // A null userId with no source reads as "unknown user" downstream.
    expect(historyRow.source).toBe('system');
    expect(historyRow.date).toEqual(scanManaged.resolvedAt);
  });

  it('removeMissingLibs closes a confirmed finding as the machine and keeps the confirm row', async () => {
    const lib = { id: 'lib-1', projectId: 'p1' };
    const vuln = makeDet({ id: 'd-confirmed', scaDetectedPackage: lib }) as any;
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);
    await service.handleUpdateSca(vuln, makeDto({ status: 'confirmed' }));

    scaDetectedRepo.find!.mockResolvedValue([lib]);
    scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
    scaVulnRepo.find!.mockResolvedValue([vuln]);

    await (service as any).removeMissingLibs('p1', 's2', '');

    expect(vuln.currentState).toBe('resolved');
    // The resolution is the machine's, not the confirmer closing it.
    expect(vuln.triagedByType).toBe('system');
    expect(vuln.triagedBy).toBeNull();
    expect(vuln.resolvedAt).toEqual(vuln.triagedAt);

    const confirmRow = resultService.addHistoryItem.mock.calls
      .map((c: any[]) => c[0])
      .find((h: any) => h.type === 'status_change');
    expect(confirmRow).toMatchObject({ value: 'confirmed', userId: 'u1' });
    const machineRow = historyRepo
      .create!.mock.calls.map((c: any[]) => c[0])
      .find((h: any) => h?.type === 'status_change');
    expect(machineRow).toMatchObject({ value: 'resolved', source: 'system' });
    expect(machineRow.userId).toBeUndefined();
  });

  it('removeMissingLibs does not bump last_detected_at for a package that disappeared', async () => {
    const lib = { id: 'lib-1', projectId: 'p1' };
    const lastSeen = new Date('2026-01-01T00:00:00Z');
    const scanManaged = makeDet({
      id: 'd-managed',
      scaDetectedPackage: lib,
      firstDetectedAt: lastSeen,
      lastDetectedAt: lastSeen,
    }) as any;
    scaDetectedRepo.find!.mockResolvedValue([lib]);
    scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
    scaVulnRepo.find!.mockResolvedValue([scanManaged]);
    scaVulnRepo.save!.mockImplementation(async (e: any) => e);

    await (service as any).removeMissingLibs('p1', 's1', '');

    // "Last seen" must stay where the last scan that ACTUALLY saw it left it,
    // or the export cannot tell "fixed" from "still there".
    expect(scanManaged.lastDetectedAt).toBe(lastSeen);
  });

  // ── the ingestion sighting sites ──────────────────────────────────

  describe('ingestion', () => {
    const pkgRow = {
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: 'potentially_used',
      dependencyInfoAvailable: true,
    };

    const scanDto = () =>
      ({
        projectId: 'p1',
        scanId: 's1',
        packages: [
          {
            name: 'lodash',
            version: '4.17.21',
            isDev: false,
            isTransitive: false,
            file: 'package.json',
            ecosystem: 'npm',
            path: 'root',
            reachability: 'potentially_used',
          },
        ],
        isLastRequest: false,
        vulnerabilityType: 'ALL',
      }) as any;

    beforeEach(() => {
      scaDetectedRepo.find!.mockResolvedValue([]);
      scaDetectedRepo.findOne!.mockResolvedValue(pkgRow);
      scaDetectedRepo.save!.mockImplementation(async (e: any) => e);
      scaVulnRepo.create!.mockImplementation((e: any) => e);
      scaVulnRepo.save!.mockImplementation(async (e: any) => ({
        ...e,
        id: e.id || 'det-new',
      }));
      matcher.findMatchingVulnerabilities.mockResolvedValue([
        {
          vulnerability: {
            id: 'osv-1',
            severity: [
              { score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
            ],
          },
        },
      ]);
    });

    it('stamps first/last_detected_at on a brand-new detection', async () => {
      scaVulnRepo.find!.mockResolvedValue([]);

      await service.addScaScanResult(scanDto());

      const created = scaVulnRepo
        .save!.mock.calls.map((c: any[]) => c[0])
        .find((d: any) => d?.vulnerability?.id === 'osv-1');
      expect(created.firstDetectedAt).toBeInstanceOf(Date);
      expect(created.lastDetectedAt).toBe(created.firstDetectedAt);
    });

    it('moves last_detected_at forward on re-detection without touching first_detected_at', async () => {
      const first = new Date('2026-01-01T00:00:00Z');
      const existing = makeDet({
        id: 'det-existing',
        scaDetectedPackage: pkgRow,
        vulnerability: { id: 'osv-1' },
        exploitabilitySource: 'static',
        firstDetectedAt: first,
        lastDetectedAt: first,
      }) as any;
      scaVulnRepo.find!.mockResolvedValue([existing]);

      await service.addScaScanResult(scanDto());

      expect(existing.firstDetectedAt).toBe(first);
      expect(existing.lastDetectedAt.getTime()).toBeGreaterThan(
        first.getTime(),
      );
    });

    it('never resets a stored triage on re-detection', async () => {
      const triagedAt = new Date('2026-02-02T00:00:00Z');
      const existing = makeDet({
        id: 'det-existing',
        scaDetectedPackage: pkgRow,
        vulnerability: { id: 'osv-1' },
        exploitabilitySource: 'static',
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedAt,
        triagedBy: 'u9',
        triagedByType: 'user',
        dismissalReason: 'accepted risk',
      }) as any;
      scaVulnRepo.find!.mockResolvedValue([existing]);

      await service.addScaScanResult(scanDto());

      expect(existing.triagedAt).toBe(triagedAt);
      expect(existing.triagedBy).toBe('u9');
      expect(existing.triagedByType).toBe('user');
      expect(existing.dismissalReason).toBe('accepted risk');
    });

    // SCA's OTHER auto-resolve site: the per-scan sweep inside
    // batchHandleVulnerabilities, which fires when the package is still there
    // but one of its advisories is not.
    it('files the in-scan auto-resolve as the machine', async () => {
      const stale = makeDet({
        id: 'det-stale',
        scaDetectedPackage: pkgRow,
        vulnerability: { id: 'osv-gone' },
        exploitabilitySource: 'static',
      }) as any;
      scaVulnRepo.find!.mockResolvedValue([stale]);

      await service.addScaScanResult(scanDto());

      expect(stale.currentState).toBe('resolved');
      expect(stale.triagedByType).toBe('system');
      expect(stale.triagedBy).toBeNull();
      expect(stale.resolvedAt).toEqual(stale.triagedAt);

      const historyRow = historyRepo
        .create!.mock.calls.map((c: any[]) => c[0])
        .find((h: any) => h?.type === 'status_change');
      expect(historyRow.source).toBe('system');
      expect(historyRow.date).toEqual(stale.resolvedAt);
    });

    it('drops resolved_at when a resolved detection reappears', async () => {
      const existing = makeDet({
        id: 'det-existing',
        scaDetectedPackage: pkgRow,
        vulnerability: { id: 'osv-1' },
        exploitabilitySource: 'static',
        currentState: 'resolved',
        resolvedAt: new Date('2026-01-05T00:00:00Z'),
      }) as any;
      scaVulnRepo.find!.mockResolvedValue([existing]);

      await service.addScaScanResult(scanDto());

      expect(existing.currentState).not.toBe('resolved');
      expect(existing.resolvedAt).toBeNull();
    });
  });
});
