import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';
import { PROJECT_SERVICE_NAME } from '@grpc/global-management/global_management';
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
 * A triage is a decision about a FINDING — this package, this advisory — not
 * about a build artefact. But `ScaDetectedPackages` is unique on
 * `(projectId, packageName, packageVersion, branch)`, so bumping the package
 * creates a new package row, hence brand-new detections in `to_verify`.
 *
 * Without the carry-over, ignored vulnerabilities come back after each bump
 * and their first-detection date resets: every Django bump re-opens the same
 * decisions. The triage has to carry over to the new version.
 */
describe('ScaService – triage carry-over across a package version bump', () => {
  let service: ScaService;
  let scaDetectedRepo: MockType<any>;
  let scaVulnRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let matcher: {
    findMatchingVulnerabilities: jest.Mock;
    findMatchingVulnerabilitiesForLibraries: jest.Mock;
  };
  /** What the scan service reports for this scan's branch. */
  let scanBranch: string;
  /**
   * global-management's `ProjectService/Get`, shared by the batch and the REAL
   * `ReferenceBranchResolver`: the branch scope is derived from what this
   * returns, whichever of the two reads it.
   */
  let projectGet: jest.Mock;

  /** The package row this scan produced: django was bumped to 5.2.16. */
  const pkgRow = {
    id: 'pkg-new',
    projectId: 'p1',
    packageName: 'django',
    packageVersion: '5.2.16',
    isDev: false,
    isTransitive: false,
    ecosystem: 'PyPI',
    reachability: 'potentially_used',
    dependencyInfoAvailable: true,
    branch: '',
  };

  /** The same finding, triaged by a human on the version this scan replaces. */
  const triagedAt = new Date('2026-08-18T09:00:00Z');
  const firstSeen = new Date('2026-07-01T00:00:00Z');
  const previousVersionTriage = () => ({
    id: 'det-old',
    projectId: 'p1',
    branch: '',
    currentState: 'ignored',
    currentPriority: 'low',
    stateManuallyModified: true,
    triagedAt,
    triagedBy: 'u9',
    triagedByType: 'user' as const,
    resolvedAt: null,
    dismissalReason: 'false positive, not reachable',
    firstDetectedAt: firstSeen,
    lastDetectedAt: triagedAt,
    vulnerability: { id: 'osv-1' },
    scaDetectedPackage: {
      id: 'pkg-old',
      projectId: 'p1',
      packageName: 'django',
      packageVersion: '5.2.1',
      ecosystem: 'PyPI',
      branch: '',
    },
  });

  const scanDto = () =>
    ({
      projectId: 'p1',
      scanId: 's1',
      packages: [
        {
          name: 'django',
          version: '5.2.16',
          isDev: false,
          isTransitive: false,
          file: 'uv.lock',
          ecosystem: 'PyPI',
          path: 'root',
          reachability: 'potentially_used',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    }) as any;

  /** The detection `save()` was called with for the new package row. */
  const createdDetection = () =>
    scaVulnRepo
      .save!.mock.calls.map((c: any[]) => c[0])
      .find((d: any) => d?.vulnerability?.id === 'osv-1');

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
    scanBranch = '';
    projectGet = jest.fn(() => of({ parsedBranches: [] }));

    scaDetectedRepo.createQueryBuilder = jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      execute: jest
        .fn()
        .mockResolvedValue({ identifiers: [{ id: 'pkg-new' }] }),
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
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn().mockResolvedValue({}),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'high', priorityScore: 80 }),
          },
        },
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
            getService: (name: string) =>
              name === PROJECT_SERVICE_NAME
                ? { get: projectGet }
                : { get: jest.fn().mockReturnValue(of({})) },
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              updateScanState: jest.fn().mockReturnValue(of({})),
              // The branch is read from the scan, never from the batch payload.
              getScan: jest.fn(() => of({ branch: scanBranch })),
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
        // The real resolver: what it concludes from a project is what the
        // batch must keep concluding, now that it no longer asks it.
        ReferenceBranchResolver,
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    module.get(ReferenceBranchResolver).onModuleInit();
    service = module.get(ScaService);
    service.onModuleInit();

    historyRepo.create!.mockImplementation((e: any) => e);
    historyRepo.save!.mockImplementation(async (e: any) => e);
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
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);
  });

  /**
   * `find()` serves two reads on this path: the detections of the packages in
   * THIS scan (none — the package row is new), and the portable triages decided
   * on other versions of the same package.
   */
  const withPreviousTriage = (rows: any[]) => {
    scaVulnRepo.find!.mockImplementation(async (options: any) => {
      const where = options?.where ?? {};
      return where.stateManuallyModified === true ? rows : [];
    });
  };

  it('carries a human ignore over to the bumped version', async () => {
    withPreviousTriage([previousVersionTriage()]);

    await service.addScaScanResult(scanDto());

    const created = createdDetection();
    expect(created.currentState).toBe('ignored');
    expect(created.stateManuallyModified).toBe(true);
    expect(created.triagedBy).toBe('u9');
    expect(created.triagedByType).toBe('user');
    expect(created.dismissalReason).toBe('false positive, not reachable');
    expect(created.triagedAt).toEqual(triagedAt);
  });

  it('keeps the original first-detection date', async () => {
    withPreviousTriage([previousVersionTriage()]);

    await service.addScaScanResult(scanDto());

    // The finding was first seen in July, not on the day the bump landed —
    // a reset date is exactly what made this look like a brand-new finding.
    expect(createdDetection().firstDetectedAt).toEqual(firstSeen);
  });

  it('adopts the most recent decision when several versions were triaged', async () => {
    const older = previousVersionTriage();
    const newer = {
      ...previousVersionTriage(),
      id: 'det-older-but-newer-decision',
      currentState: 'confirmed',
      dismissalReason: null,
      triagedAt: new Date('2026-08-20T09:00:00Z'),
      triagedBy: 'u42',
      scaDetectedPackage: {
        ...previousVersionTriage().scaDetectedPackage,
        id: 'pkg-mid',
        packageVersion: '5.2.9',
      },
    };
    withPreviousTriage([older, newer]);

    await service.addScaScanResult(scanDto());

    const created = createdDetection();
    expect(created.currentState).toBe('confirmed');
    expect(created.triagedBy).toBe('u42');
  });

  it('does not carry a machine auto-resolve over to the bumped version', async () => {
    // `resolved` is what the scan writes when a finding disappears. Adopting it
    // would file a finding this very scan just saw as already closed.
    withPreviousTriage([
      {
        ...previousVersionTriage(),
        currentState: 'resolved',
        stateManuallyModified: false,
        triagedBy: null,
        triagedByType: 'system',
        dismissalReason: null,
      },
    ]);

    await service.addScaScanResult(scanDto());

    expect(createdDetection().currentState).toBe('to_verify');
  });

  it('does not carry a resolved decision onto a finding this scan just saw', async () => {
    // A user CAN set `resolved` by hand, and that freezes the row. But the
    // re-detection path reopens a `resolved` detection precisely because the
    // scan contradicts it — carrying it onto the bumped version would file a
    // present finding as closed, which is the one thing the state must not say.
    withPreviousTriage([
      {
        ...previousVersionTriage(),
        currentState: 'resolved',
        dismissalReason: null,
        resolvedAt: triagedAt,
      },
    ]);

    await service.addScaScanResult(scanDto());

    const created = createdDetection();
    expect(created.currentState).toBe('to_verify');
    expect(created.resolvedAt).toBeFalsy();
  });

  it('leaves a fresh finding alone when no previous version was triaged', async () => {
    withPreviousTriage([]);

    await service.addScaScanResult(scanDto());

    const created = createdDetection();
    expect(created.currentState).toBe('to_verify');
    expect(created.triagedBy).toBeUndefined();
    expect(created.firstDetectedAt).toBeInstanceOf(Date);
  });

  /** The branch partition the carry-over query was scoped to. */
  const triageQueryBranches = (): string[] => {
    const query = scaVulnRepo
      .find!.mock.calls.map((c: any[]) => c[0])
      .find((o: any) => o?.where?.stateManuallyModified === true);
    // `In([...])` keeps its operands on `_value`.
    return query.where.branch?._value ?? query.where.branch;
  };

  // A scan run with no branch is stored as '' and is the SAME logical
  // branch as the project's canonical default. The read paths and the cleanup
  // already resolve that partition; ingestion did not, so a decision taken on
  // `main` did not apply to a later no-branch scan — a second way for an
  // `ignored` to come back, independent of the version bump.
  it('carries a decision across the default-branch partition', async () => {
    withPreviousTriage([{ ...previousVersionTriage(), branch: 'main' }]);

    await service.addScaScanResult(scanDto());

    expect(triageQueryBranches()).toEqual(
      expect.arrayContaining(['main', 'master', '']),
    );
    expect(createdDetection().currentState).toBe('ignored');
  });

  it('does not carry a decision from a feature branch', async () => {
    scanBranch = 'feature/y';
    withPreviousTriage([{ ...previousVersionTriage(), branch: 'feature/x' }]);

    await service.addScaScanResult(scanDto());

    // A real feature branch is its own partition — nothing folds into it.
    expect(triageQueryBranches()).toEqual(['feature/y']);
  });

  // The scope now comes from the project the batch already read,
  // not from a second lookup per tranche. What it concludes must not move.
  describe('branch scope taken from the batch project read', () => {
    it('reads the project once per batch', async () => {
      withPreviousTriage([]);

      await service.addScaScanResult(scanDto());

      expect(projectGet).toHaveBeenCalledTimes(1);
    });

    it('falls back to main/master when the project read fails, as before', async () => {
      projectGet.mockImplementation(() =>
        throwError(() =>
          Object.assign(new Error('14 UNAVAILABLE: no healthy upstream'), {
            code: status.UNAVAILABLE,
          }),
        ),
      );
      withPreviousTriage([{ ...previousVersionTriage(), branch: 'master' }]);

      await service.addScaScanResult(scanDto());

      expect(triageQueryBranches()).toEqual(['main', 'master', '']);
      expect(createdDetection().currentState).toBe('ignored');
    });

    describe("with referenceBranch 'develop' (effective-branch partition)", () => {
      beforeEach(() => {
        projectGet.mockImplementation(() =>
          of({ referenceBranch: 'develop', defaultBranch: 'main' }),
        );
      });

      it('folds a no-branch scan into develop, not main/master', async () => {
        withPreviousTriage([{ ...previousVersionTriage(), branch: 'develop' }]);

        await service.addScaScanResult(scanDto());

        expect(triageQueryBranches()).toEqual(['develop', '']);
        expect(createdDetection().currentState).toBe('ignored');
      });

      it('folds only the legacy partition into a develop scan', async () => {
        scanBranch = 'develop';
        withPreviousTriage([{ ...previousVersionTriage(), branch: 'develop' }]);

        await service.addScaScanResult(scanDto());

        expect(triageQueryBranches()).toEqual(['develop', '']);
      });

      it('keeps main to itself: it is a feature branch for this project', async () => {
        scanBranch = 'main';
        withPreviousTriage([]);

        await service.addScaScanResult(scanDto());

        expect(triageQueryBranches()).toEqual(['main']);
      });
    });

    it("skips an 'all branches' reference and scopes to the git default", async () => {
      projectGet.mockImplementation(() =>
        of({ referenceBranch: '*', defaultBranch: 'trunk' }),
      );
      withPreviousTriage([]);

      await service.addScaScanResult(scanDto());

      expect(triageQueryBranches()).toEqual(['trunk', '']);
    });
  });
});
