import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
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
import { ScanMetaCache } from '../scan-queue/scan-meta-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import {
  createLoggerMock,
  createMockRepository,
  createQueryBuilderMock,
} from '../../test-utils/typeorm-mock.util';

/**
 * Every SCA batch, and the SCA finalization, called GetScan for
 * the scan's branch. It is read once per scan through ScanMetaCache now. SCA
 * has no diff-scan fail-safe: a failed read still means the '' branch, as
 * before, and caches nothing.
 */
describe('ScaService — scan branch read once per scan', () => {
  let service: ScaService;
  let getScan: jest.Mock;
  let redisStore: Map<string, string>;

  const emptyBatch = () =>
    ({
      projectId: 'p1',
      scanId: 's1',
      packages: [],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    }) as never;

  beforeEach(async () => {
    redisStore = new Map();
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    getScan = jest.fn(() => of({ branch: 'main', isDiffScan: false }));
    const scaDetectedRepo = {
      ...createMockRepository(),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: scaDetectedRepo,
        },
        ...[
          ScaVulnerabilityDetections,
          VulnerabilityDetectionHistory,
          HistoryItem,
          ScaLicenseOverride,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: createMockRepository(),
        })),
        { provide: ADVISORY_MATCHER, useValue: {} },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: CvssExplainerService, useValue: {} },
        { provide: DETECTION_ENRICHERS, useValue: [] },
        { provide: ResultService, useValue: {} },
        { provide: IssueIntegrationService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              get: jest.fn().mockReturnValue(of({ parsedBranches: [] })),
            }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({ getScan }) },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: getDataSourceToken(), useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        { provide: ReferenceBranchResolver, useValue: {} },
        { provide: ProjectOrgResolver, useValue: {} },
        {
          provide: ScanMetaCache,
          useValue: new ScanMetaCache({
            getRedisClient: jest.fn(async () => redis),
          } as unknown as ScanQueueService),
        },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
  });

  it('reads the scan record once for two batches and the finalization', async () => {
    const removeMissingLibs = jest
      .spyOn(
        service as unknown as { removeMissingLibs: () => Promise<void> },
        'removeMissingLibs',
      )
      .mockResolvedValue(undefined);

    await service.processScaBatch(emptyBatch());
    await service.processScaBatch(emptyBatch());
    await service.finalizeScan('p1', 's1');

    expect(getScan).toHaveBeenCalledTimes(1);
    // The finalization still resolves on the scan's branch, with the
    // project context the batches read.
    expect(removeMissingLibs).toHaveBeenCalledWith(
      'p1',
      's1',
      'main',
      expect.objectContaining({ scoringBranches: ['main', 'master'] }),
    );
  });

  it("keeps the '' branch when GetScan fails, and caches nothing", async () => {
    getScan.mockReturnValueOnce(throwError(() => new Error('14 UNAVAILABLE')));
    const removeMissingLibs = jest
      .spyOn(
        service as unknown as { removeMissingLibs: () => Promise<void> },
        'removeMissingLibs',
      )
      .mockResolvedValue(undefined);

    await service.finalizeScan('p1', 's1');

    expect(removeMissingLibs).toHaveBeenCalledWith(
      'p1',
      's1',
      '',
      expect.objectContaining({ scoringBranches: ['main', 'master'] }),
    );
    // No scan record was cached; the project context is a section of its
    // own.
    expect(
      [...redisStore.keys()].filter((k) => k.startsWith('scan-meta:v2:scan:')),
    ).toEqual([]);
  });

  it('ScaService asks Nest for ScanMetaCache, by class', () => {
    expect(Reflect.getMetadata('design:paramtypes', ScaService)).toContain(
      ScanMetaCache,
    );
  });
});

/**
 * The project context of the SCA worker (branch scope,
 * reachability flags, issue settings) is read once per scan, through the same
 * ScanMetaCache: every batch read ProjectService/Get, and the finalization
 * read it twice more (the branch scope of removeMissingLibs through
 * ReferenceBranchResolver, then the issue settings of closeIssues).
 */
describe('ScaService — project context read once per scan', () => {
  let service: ScaService;
  let projectGet: jest.Mock;
  let getScoringBranches: jest.Mock;
  let closeIssues: jest.Mock;
  let scaDetectedRepo: Record<string, jest.Mock>;
  let scaVulnDetectRepo: Record<string, jest.Mock>;
  let redisStore: Map<string, string>;

  const PROJECT = {
    organizationId: 'org-1',
    referenceBranch: 'develop',
    defaultBranch: 'trunk',
    scaReachabilityPriorityEnabled: false,
    scaReachabilityStatusEnabled: true,
    githubIssueEnabled: true,
    gitlabIssueEnabled: false,
    issueCreationMode: 'per_scan',
    issueCreationBranches: ['develop'],
    parsedBranches: [],
  };

  const emptyBatch = () =>
    ({
      projectId: 'p1',
      scanId: 's1',
      packages: [],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    }) as never;

  /** A batch carrying one package, so that its triage carry-over runs. */
  const batchWithPackage = (isLastRequest = false) =>
    ({
      projectId: 'p1',
      scanId: 's1',
      packages: [
        {
          name: 'lodash',
          version: '4.17.21',
          file: 'package.json',
          ecosystem: 'npm',
          isDev: false,
          isTransitive: false,
          path: ['root'],
          importLocations: [],
          licenses: [],
        },
      ],
      isLastRequest,
      vulnerabilityType: 'ALL',
    }) as never;

  /** The partitions each triage carry-over read was scoped to. */
  const carryOverScopes = (): string[][] =>
    scaVulnDetectRepo.find.mock.calls
      .map(([options]) => options?.where)
      .filter((where) => where?.stateManuallyModified === true)
      .map((where) => where.branch.value);

  /** The partitions the finalization's package read was scoped to. */
  const finalizationScope = (): string[] => {
    const where = scaDetectedRepo.find.mock.calls
      .map(([options]) => options?.where)
      .find((w) => w?.lastScanId);
    return where?.branch?.value;
  };

  beforeEach(async () => {
    redisStore = new Map();
    const redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
    };
    projectGet = jest.fn(() => of(PROJECT));
    getScoringBranches = jest.fn().mockResolvedValue(['main', 'master']);
    closeIssues = jest.fn().mockResolvedValue({ success: true });
    scaDetectedRepo = createMockRepository() as Record<string, jest.Mock>;
    // The upserted package read back by name; every other read finds nothing.
    scaDetectedRepo.find.mockImplementation(async ({ where }) =>
      where?.packageName
        ? [
            {
              id: 'pkg-1',
              projectId: 'p1',
              branch: '',
              packageName: 'lodash',
              packageVersion: '4.17.21',
              ecosystem: 'npm',
            },
          ]
        : [],
    );
    scaVulnDetectRepo = createMockRepository() as Record<string, jest.Mock>;
    scaVulnDetectRepo.find.mockResolvedValue([]);
    // The grouped writes of the finalization.
    for (const repo of [scaDetectedRepo, scaVulnDetectRepo]) {
      repo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createQueryBuilderMock());
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: scaDetectedRepo,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: scaVulnDetectRepo,
        },
        ...[VulnerabilityDetectionHistory, HistoryItem, ScaLicenseOverride].map(
          (entity) => ({
            provide: getRepositoryToken(entity),
            useValue: createMockRepository({
              create: jest.fn((e) => e),
              createQueryBuilder: jest
                .fn()
                .mockReturnValue(createQueryBuilderMock()),
            }),
          }),
        ),
        {
          provide: ADVISORY_MATCHER,
          useValue: {
            findMatchingVulnerabilitiesForLibraries: jest.fn(
              async (libraries: unknown[]) => libraries.map(() => []),
            ),
          },
        },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: CvssExplainerService, useValue: {} },
        {
          provide: DETECTION_ENRICHERS,
          useValue: [
            { name: 'EPSS', enrichDetections: jest.fn(async () => 0) },
          ],
        },
        { provide: ResultService, useValue: {} },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: closeIssues },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({ get: projectGet }) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              getScan: jest.fn(() => of({ branch: '', isDiffScan: false })),
            }),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: getDataSourceToken(), useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        { provide: ReferenceBranchResolver, useValue: { getScoringBranches } },
        { provide: ProjectOrgResolver, useValue: {} },
        {
          provide: ScanMetaCache,
          useValue: new ScanMetaCache({
            getRedisClient: jest.fn(async () => redis),
          } as unknown as ScanQueueService),
        },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
  });

  it('reads the project once for the batches, and afresh for the finalization', async () => {
    await service.processScaBatch(emptyBatch());
    await service.processScaBatch(emptyBatch());
    await service.finalizeScan('p1', 's1');

    // One read for every batch of the scan, one for the finalization, which
    // never deletes nor resolves on a copy taken at the first batch.
    expect(projectGet).toHaveBeenCalledTimes(2);
    expect(getScoringBranches).not.toHaveBeenCalled();
    // The lean read: the scope reads defaultBranch, so the integration
    // status stays.
    expect(projectGet).toHaveBeenCalledWith({
      projectId: 'p1',
      skipVulnerabilityStats: true,
      skipSecurityContext: true,
    });
    // A scan without a branch is the project's reference branch.
    expect(finalizationScope()).toEqual(['develop', '']);
  });

  it('caches nothing when the project read fails, and reads it again for the next batch', async () => {
    projectGet.mockReturnValueOnce(
      throwError(() => new Error('14 UNAVAILABLE')),
    );

    await service.processScaBatch(emptyBatch());
    expect(
      [...redisStore.keys()].filter((k) => k.includes(':scaProject:')),
    ).toEqual([]);

    await service.processScaBatch(emptyBatch());
    await service.finalizeScan('p1', 's1');

    // The failed read, the second batch's, the finalization's.
    expect(projectGet).toHaveBeenCalledTimes(3);
    expect(getScoringBranches).not.toHaveBeenCalled();
    expect(finalizationScope()).toEqual(['develop', '']);
  });

  it('scopes the finalization to main/master when the project cannot be read at all, as before', async () => {
    projectGet.mockReturnValue(throwError(() => new Error('14 UNAVAILABLE')));

    await service.finalizeScan('p1', 's1');

    // The resolver's own read is the fallback, as before this change.
    expect(getScoringBranches).toHaveBeenCalledTimes(1);
    expect(finalizationScope()).toEqual(['main', 'master', '']);
  });

  it('keeps no scope that fell back to main/master: the next batch reads the project again', async () => {
    // A degraded read: global-management could not reach the integration
    // status and answered an empty defaultBranch (76 times in 7 days in
    // production). It cannot be told from a project that has no branch at all.
    projectGet
      .mockReturnValueOnce(
        of({ ...PROJECT, referenceBranch: undefined, defaultBranch: '' }),
      )
      .mockReturnValueOnce(
        of({
          ...PROJECT,
          referenceBranch: undefined,
          defaultBranch: 'develop',
        }),
      );

    await service.processScaBatch(batchWithPackage());
    await service.processScaBatch(batchWithPackage());

    expect(projectGet).toHaveBeenCalledTimes(2);
    expect(carryOverScopes()).toEqual([
      ['main', 'master', ''],
      // A no-branch scan is the git default branch's partition.
      ['develop', ''],
    ]);
  });

  it('finalizes on the reference branch the project has now, not the one the first batch read', async () => {
    projectGet
      .mockReturnValueOnce(of(PROJECT))
      .mockReturnValue(of({ ...PROJECT, referenceBranch: 'release' }));

    await service.processScaBatch(batchWithPackage());
    await service.processScaBatch(batchWithPackage());
    await service.finalizeScan('p1', 's1');

    // The batches kept the copy of the scan, the finalization did not.
    expect(carryOverScopes()).toEqual([
      ['develop', ''],
      ['develop', ''],
    ]);
    expect(finalizationScope()).toEqual(['release', '']);
    expect(projectGet).toHaveBeenCalledTimes(2);
  });

  it('finalizes the last batch on a fresh read too', async () => {
    projectGet
      .mockReturnValueOnce(of(PROJECT))
      .mockReturnValue(of({ ...PROJECT, referenceBranch: 'release' }));

    await service.processScaBatch(batchWithPackage());
    await service.processScaBatch(batchWithPackage(true));

    expect(finalizationScope()).toEqual(['release', '']);
    expect(projectGet).toHaveBeenCalledTimes(2);
  });

  it('never serves the cached context of another project under the same scan id', async () => {
    // The cache is keyed by scan id alone: a context of another project
    // reads as a miss.
    redisStore.set(
      'scan-meta:v2:scaProject:s1',
      JSON.stringify({
        scoringBranches: ['other-branch'],
        reachabilityPriorityEnabled: true,
        reachabilityStatusEnabled: true,
        issueSettings: {
          projectId: 'p-other',
          organizationId: 'org-other',
          githubIssueEnabled: false,
          gitlabIssueEnabled: false,
          issueCreationMode: 'per_vulnerability_type',
          issueCreationBranches: [],
        },
      }),
    );

    await service.processScaBatch(batchWithPackage());

    expect(projectGet).toHaveBeenCalledTimes(1);
    expect(carryOverScopes()).toEqual([['develop', '']]);
  });

  describe('issues closed by an in-batch resolution', () => {
    /** A detection of the batch's package whose advisory is gone. */
    const gone = {
      id: 'det-gone',
      projectId: 'p1',
      branch: '',
      currentState: 'to_verify',
      stateManuallyModified: false,
      scaDetectedPackage: { id: 'pkg-1' },
      vulnerability: { id: 'GHSA-gone' },
    };
    const resolveOnNextBatch = () =>
      scaVulnDetectRepo.find.mockImplementation(async ({ where }) =>
        where?.stateManuallyModified ? [] : [{ ...gone }],
      );

    it('closes them with the issue settings the project has now', async () => {
      projectGet
        .mockReturnValueOnce(of({ ...PROJECT, githubIssueEnabled: false }))
        .mockReturnValue(of({ ...PROJECT, githubIssueEnabled: true }));

      await service.processScaBatch(batchWithPackage());
      resolveOnNextBatch();
      await service.processScaBatch(batchWithPackage());

      // The scan's copy, then a read of its own for the closing.
      expect(projectGet).toHaveBeenCalledTimes(2);
      expect(closeIssues).toHaveBeenCalledWith(
        'p1',
        ['det-gone'],
        'version_upgrade_fixed',
        'sca',
        { settings: expect.objectContaining({ githubIssueEnabled: true }) },
      );
    });

    it('reads no project for a batch that resolves nothing', async () => {
      await service.processScaBatch(batchWithPackage());
      await service.processScaBatch(batchWithPackage());

      expect(projectGet).toHaveBeenCalledTimes(1);
      expect(closeIssues).not.toHaveBeenCalled();
    });

    it('hands no settings over when that read fails: the closing reads the project itself', async () => {
      projectGet
        .mockReturnValueOnce(of(PROJECT))
        .mockReturnValue(throwError(() => new Error('14 UNAVAILABLE')));

      await service.processScaBatch(batchWithPackage());
      resolveOnNextBatch();
      await service.processScaBatch(batchWithPackage());

      expect(closeIssues).toHaveBeenCalledWith(
        'p1',
        ['det-gone'],
        'version_upgrade_fixed',
        'sca',
        { settings: undefined },
      );
    });
  });

  it("hands the scan's issue settings to the issue closing, which then reads no project", async () => {
    scaDetectedRepo.find.mockResolvedValue([
      { id: 'pkg-old', projectId: 'p1', branch: '' },
    ]);
    scaVulnDetectRepo.find.mockResolvedValue([
      {
        id: 'det-1',
        currentState: 'to_verify',
        stateManuallyModified: false,
        scaDetectedPackage: { id: 'pkg-old' },
      },
    ]);

    // The settings changed during the scan: the closing applies the new ones.
    projectGet
      .mockReturnValueOnce(of(PROJECT))
      .mockReturnValue(of({ ...PROJECT, gitlabIssueEnabled: true }));

    await service.processScaBatch(emptyBatch());
    await service.finalizeScan('p1', 's1');

    // The batch's read, and the finalization's own.
    expect(projectGet).toHaveBeenCalledTimes(2);
    expect(closeIssues).toHaveBeenCalledWith(
      'p1',
      ['det-1'],
      'dependency_removed',
      'sca',
      {
        settings: {
          projectId: 'p1',
          organizationId: 'org-1',
          githubIssueEnabled: true,
          gitlabIssueEnabled: true,
          issueCreationMode: 'per_scan',
          issueCreationBranches: ['develop'],
        },
      },
    );
  });
});
