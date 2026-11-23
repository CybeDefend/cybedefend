// `ScaService.ingestMatched`: the SCA write path of processScaBatch
// (package upsert, detections, fingerprint, triage carry-over, history) fed
// with advisories the caller already matched, so that an import writes
// SCA findings without any advisory matcher. Built with the providers of
// sca.service.spec.ts.
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { ScaService } from './sca.service';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { ADVISORY_MATCHER } from '../../edition/ports/advisory-matcher.port';
import {
  DETECTION_ENRICHERS,
  DetectionEnricher,
} from '../../edition/ports/detection-enrichers.port';
import {
  createLoggerMock,
  createMockRepository,
  createQueryBuilderMock,
  MockType,
} from '../../test-utils/typeorm-mock.util';
import { Library } from '@grpc/analysis-reporting/result';

const CRITICAL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

function advisory(id: string): VulnerabilityOsvAffected {
  return {
    ecosystem: 'npm',
    packageName: 'lodash',
    severity: null,
    vulnerability: { id, severity: [{ score: CRITICAL_VECTOR }] },
  } as unknown as VulnerabilityOsvAffected;
}

const lodash = (overrides: Partial<Library> = {}): Library =>
  ({
    name: 'lodash',
    version: '4.17.20',
    isDev: false,
    isTransitive: false,
    file: 'package.json',
    ecosystem: 'npm',
    path: 'root',
    ...overrides,
  }) as Library;

describe('ScaService.ingestMatched', () => {
  let service: ScaService;
  let scaDetectedRepo: MockType<any>;
  let scaVulnRepo: MockType<any>;
  let packageUpsert: any;
  let matcher: { findMatchingVulnerabilitiesForLibraries: jest.Mock };
  let enricher: DetectionEnricher & { enrichDetections: jest.Mock };

  const PKG = {
    id: 'pkg-1',
    projectId: 'p1',
    packageName: 'lodash',
    packageVersion: '4.17.20',
    isDev: false,
    isTransitive: false,
    ecosystem: 'npm',
    reachability: null,
  };
  const meta = { projectId: 'p1', scanId: 's1', vulnerabilityType: 'ALL' };

  beforeEach(async () => {
    scaDetectedRepo = createMockRepository();
    scaVulnRepo = createMockRepository();
    const vulnHistoryRepo: MockType<any> = createMockRepository();
    const historyRepo: MockType<any> = createMockRepository();
    matcher = { findMatchingVulnerabilitiesForLibraries: jest.fn() };
    enricher = {
      name: 'EPSS',
      enrichDetections: jest.fn().mockResolvedValue(0),
    };

    packageUpsert = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({
        identifiers: [{ id: 'pkg-1' }],
        generatedMaps: [],
      }),
    };
    scaDetectedRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(packageUpsert);
    for (const repo of [scaVulnRepo, vulnHistoryRepo, historyRepo]) {
      repo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createQueryBuilderMock());
    }

    const module = await Test.createTestingModule({
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
          useValue: vulnHistoryRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: historyRepo },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: createMockRepository(),
        },
        { provide: ADVISORY_MATCHER, useValue: matcher },
        { provide: DETECTION_ENRICHERS, useValue: [enricher] },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn().mockReturnValue(null) },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn().mockResolvedValue({}),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest.fn().mockResolvedValue({
              adjustedPriority: 'high',
              adjustedPriorityScore: 80,
            }),
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

    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue(PKG);
    scaDetectedRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    let nextDetId = 0;
    scaVulnRepo.save!.mockImplementation(async (det: any) => {
      nextDetId += 1;
      return { ...det, id: `det-${nextDetId}` };
    });
  });

  it('writes the packages and the given advisories without calling a matcher', async () => {
    const handle = jest.spyOn(service as any, 'batchHandleVulnerabilities');
    const given = advisory('GHSA-1111-2222-3333');

    await service.ingestMatched(meta, [
      { library: lodash(), affected: [given] },
    ]);

    expect(
      matcher.findMatchingVulnerabilitiesForLibraries,
    ).not.toHaveBeenCalled();
    expect(packageUpsert.execute).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
    const [batch, projectId, scanId, vulnerabilityType] = handle.mock
      .calls[0] as any[];
    expect(batch).toEqual([{ pkg: PKG, vulns: [given] }]);
    expect([projectId, scanId, vulnerabilityType]).toEqual(['p1', 's1', 'ALL']);
  });

  it('merges the advisories of two items of one package', async () => {
    const ids = await service.ingestMatched(meta, [
      { library: lodash(), affected: [advisory('GHSA-aaaa-aaaa-aaaa')] },
      { library: lodash(), affected: [advisory('GHSA-bbbb-bbbb-bbbb')] },
    ]);

    // One package row upserted…
    expect(packageUpsert.execute).toHaveBeenCalledTimes(1);
    expect(packageUpsert.values.mock.calls[0][0]).toHaveLength(1);
    // …and one detection per advisory.
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('neither finalizes nor enriches', async () => {
    const finalize = jest.spyOn(service as any, 'removeMissingLibs');

    const ids = await service.ingestMatched(meta, [
      { library: lodash(), affected: [advisory('GHSA-cccc-cccc-cccc')] },
    ]);
    await new Promise((r) => setImmediate(r));

    expect(ids.length).toBeGreaterThan(0);
    expect(finalize).not.toHaveBeenCalled();
    expect(enricher.enrichDetections).not.toHaveBeenCalled();
  });
});
