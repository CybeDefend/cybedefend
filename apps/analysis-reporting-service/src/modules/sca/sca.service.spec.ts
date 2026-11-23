import * as fs from 'fs';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { status } from '@grpc/grpc-js';
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
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  createQueryBuilderMock,
  MockType,
} from '../../test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';
import { Observable, of, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';
import { computeScaFingerprint } from '../findings-export/fingerprint.util';
import {
  GetProjectScaVulnerabilitiesRequest,
  Library,
  ScanAddScaResultRequest,
} from '@grpc/analysis-reporting/result';
import {
  makeEmptyRepository,
  makeProjectLookupHarness,
  ProjectLookupHarness,
  QueryBuilderCalls,
} from '../../test-utils/project-lookup.harness';

describe('ScaService', () => {
  let service: ScaService;
  let scaDetectedRepo: MockType<any>;
  let scaVulnRepo: MockType<any>;
  let vulnHistoryRepo: MockType<any>;
  let historyRepo: MockType<any>;
  let matcher: {
    findMatchingVulnerabilities: jest.Mock;
    findMatchingVulnerabilitiesForLibraries: jest.Mock;
  };
  let resultService: {
    addHistoryItem: jest.Mock;
    computeEnvironmentalForProject: jest.Mock;
    recalculatePriority?: jest.Mock;
  };
  let cvssCalculator: { computeCvss4Base: jest.Mock };
  let epssService: { enrichDetectionsFromEpss: jest.Mock };
  let cyberiskEnqueuer: { enqueue: jest.Mock };
  let licenseOverrideRepo: MockType<any>;
  let projectOrgResolver: { resolveOrgId: jest.Mock };
  let logger: any;
  let mockQueryBuilder: any;
  let executeCallCount: number;

  beforeEach(async () => {
    executeCallCount = 0;
    scaDetectedRepo = createMockRepository();
    scaVulnRepo = createMockRepository();
    vulnHistoryRepo = createMockRepository();
    historyRepo = createMockRepository();
    matcher = {
      findMatchingVulnerabilities: jest.fn().mockResolvedValue([]),
      // The batch contract: what the per-package lookup gives, per package
      // (proved against the OSV mirror by osv.matcher.batch.live.spec.ts).
      findMatchingVulnerabilitiesForLibraries: jest.fn((libraries: unknown[]) =>
        Promise.all(
          libraries.map((library) =>
            matcher.findMatchingVulnerabilities(library),
          ),
        ),
      ),
    } as any;
    resultService = {
      addHistoryItem: jest.fn().mockResolvedValue({}),
      computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
    } as any;
    cvssCalculator = {
      computeCvss4Base: jest.fn().mockReturnValue({
        vector:
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
        baseScore: 9.3,
      }),
    };
    epssService = {
      enrichDetectionsFromEpss: jest.fn().mockResolvedValue(0),
    };
    cyberiskEnqueuer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    licenseOverrideRepo = createMockRepository();
    projectOrgResolver = { resolveOrgId: jest.fn().mockResolvedValue(null) };
    logger = createLoggerMock();

    // Mock QueryBuilder chain for UPSERT operations
    mockQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      whereInIds: jest.fn().mockReturnThis(),
      execute: jest.fn().mockImplementation(async () => {
        executeCallCount++;
        return { identifiers: [{ id: 'pkg-1' }], generatedMaps: [] };
      }),
    };

    scaDetectedRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(mockQueryBuilder);
    // The grouped detection writes.
    for (const repo of [scaVulnRepo, vulnHistoryRepo, historyRepo]) {
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
          useValue: scaVulnRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: vulnHistoryRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: historyRepo },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: licenseOverrideRepo,
        },
        { provide: ADVISORY_MATCHER, useValue: matcher },
        { provide: CvssCalculatorService, useValue: cvssCalculator },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: DETECTION_ENRICHERS,
          useValue: [
            {
              name: 'EPSS',
              enrichDetections: epssService.enrichDetectionsFromEpss,
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
        { provide: Logger, useValue: logger },
        {
          provide: getDataSourceToken(),
          useValue: {
            createQueryBuilder: jest.fn(),
          },
        },
        { provide: CyberiskRecomputeEnqueuer, useValue: cyberiskEnqueuer },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getScoringBranches: jest.fn().mockResolvedValue(['main', 'master']),
          },
        },
        { provide: ProjectOrgResolver, useValue: projectOrgResolver },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
    // Default stub behaviors used by service internals
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
  });

  it('addScaScanResult processes unique packages and matches OSV (mocked)', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    // Mock findOne to return the upserted package after insert
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);
    // When matching vulnerabilities, service may query existing detections -> return empty list for simplicity
    scaVulnRepo.find!.mockResolvedValue([]);
    const dto = {
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
        },
        {
          name: 'lodash',
          version: '4.17.21',
          isDev: true,
          isTransitive: false,
          file: 'package.json',
          ecosystem: 'npm',
          path: 'root',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'sca',
    } as any;

    const res = await service.addScaScanResult(dto);
    expect(res.message).toContain('processed successfully');
    // de-duplicated to one unique package - now uses UPSERT via createQueryBuilder
    expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(executeCallCount).toBe(1);
    expect(matcher.findMatchingVulnerabilities).toHaveBeenCalledTimes(1);
  });

  it('does NOT call EpssService.enrichDetectionsFromEpss when no detections are saved during batch ingestion', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.find!.mockResolvedValue([]);
    // matcher returns no vulnerabilities -> no detection is created

    const dto = {
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
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'sca',
    } as any;

    await service.addScaScanResult(dto);
    await new Promise((r) => setImmediate(r));

    expect(epssService.enrichDetectionsFromEpss).not.toHaveBeenCalled();
  });

  it('calls EpssService.enrichDetectionsFromEpss fire-and-forget with the saved detection IDs', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: null,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);

    // No existing detections in DB (forces new-detection branch)
    scaVulnRepo.find!.mockResolvedValue([]);
    // create() just returns its input
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    // save() assigns a deterministic id so we can assert on it
    let nextDetId = 0;
    scaVulnRepo.save!.mockImplementation(async (det: any) => {
      nextDetId += 1;
      return { ...det, id: `det-${nextDetId}` };
    });

    matcher.findMatchingVulnerabilities.mockResolvedValue([
      {
        vulnerability: {
          id: 'osv-1',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);

    (resultService as any).recalculatePriority = jest.fn().mockResolvedValue({
      adjustedPriority: 'high',
      adjustedPriorityScore: 80,
    });

    const dto = {
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
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any;

    await service.addScaScanResult(dto);
    await new Promise((r) => setImmediate(r));

    expect(epssService.enrichDetectionsFromEpss).toHaveBeenCalledTimes(1);
    const call = epssService.enrichDetectionsFromEpss.mock.calls[0][0];
    expect(call).toEqual({
      detectionIds: expect.arrayContaining([expect.stringMatching(/^det-/)]),
    });
  });

  it('recomputes static exploitability when an SCA detection already exists', async () => {
    const pkg = {
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: true,
      isTransitive: true,
      ecosystem: 'npm',
      reachability: 'potentially_used',
      dependencyInfoAvailable: true,
    };
    const existingDetection = {
      id: 'det-existing',
      scaDetectedPackage: pkg,
      vulnerability: { id: 'osv-1' },
      exploitabilitySource: 'static',
      exploitabilityVerdict: 'proven',
      exploitabilityScore: 0.88,
      exploitabilityReason: 'Previous static verdict',
    };

    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue(pkg);
    scaDetectedRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.find!.mockResolvedValue([existingDetection]);
    scaVulnRepo.save!.mockImplementation(async (e) => e);

    matcher.findMatchingVulnerabilities.mockResolvedValue([
      {
        vulnerability: {
          id: 'osv-1',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);

    (resultService as any).recalculatePriority = jest.fn().mockResolvedValue({
      priority: 'high',
      priorityScore: 80,
    });

    await service.addScaScanResult({
      projectId: 'p1',
      scanId: 's1',
      packages: [
        {
          name: 'lodash',
          version: '4.17.21',
          isDev: true,
          isTransitive: true,
          file: 'package.json',
          ecosystem: 'npm',
          path: 'root',
          reachability: 'potentially_used',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any);

    // Re-detections are saved together.
    expect(scaVulnRepo.save).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'det-existing',
          exploitabilitySource: 'static',
          exploitabilityVerdict: 'not_exploitable',
          exploitabilityScore: 0.05,
        }),
      ],
      { reload: false },
    );
  });

  describe('malware category', () => {
    const runMalwareIngestion = (opts: {
      vulnerabilityType: string;
      advisoryId?: string;
    }) => {
      scaDetectedRepo.find!.mockResolvedValue([]);
      scaDetectedRepo.findOne!.mockResolvedValue({
        id: 'pkg-1',
        projectId: 'p1',
        packageName: 'evil-pkg',
        packageVersion: '1.0.0',
        isDev: false,
        isTransitive: false,
        ecosystem: 'npm',
        reachability: null,
      });
      scaDetectedRepo.save!.mockImplementation(async (e) => e);
      scaVulnRepo.find!.mockResolvedValue([]);
      scaVulnRepo.create!.mockImplementation((e: any) => e);
      scaVulnRepo.save!.mockImplementation(async (det: any) => ({
        ...det,
        id: 'det-1',
      }));
      matcher.findMatchingVulnerabilities.mockResolvedValue([
        { vulnerability: { id: opts.advisoryId ?? 'MAL-2024-1' } },
      ]);
      (resultService as any).recalculatePriority = jest
        .fn()
        .mockResolvedValue({ priority: 'critical', priorityScore: 100 });

      return service.addScaScanResult({
        projectId: 'p1',
        scanId: 's1',
        packages: [
          {
            name: 'evil-pkg',
            version: '1.0.0',
            isDev: false,
            isTransitive: false,
            file: 'package.json',
            ecosystem: 'npm',
            path: 'root',
          },
        ],
        isLastRequest: false,
        vulnerabilityType: opts.vulnerabilityType,
      } as any);
    };

    it('flags a MAL-* advisory as malware and forces max scores on the created detection', async () => {
      await runMalwareIngestion({ vulnerabilityType: 'ALL' });
      expect(scaVulnRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isMalware: true,
          epssScore: 1.0,
          epssPercentile: 1.0,
          effectiveSeverity: 'critical',
          exploitabilityVerdict: 'malicious',
          exploitabilityScore: 1.0,
          exploitabilitySource: 'malware',
        }),
      );
    });

    it('feeds the maxed EPSS/exploitability into the priority computation', async () => {
      await runMalwareIngestion({ vulnerabilityType: 'ALL' });
      expect((resultService as any).recalculatePriority).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSeverity: 'CRITICAL',
          epssScore: 1.0,
          epssPercentile: 1.0,
          exploitabilityScore: 1.0,
        }),
        'p1',
        null,
      );
    });

    it('ingests a malware finding even when the scan severity filter would exclude it', async () => {
      await runMalwareIngestion({ vulnerabilityType: 'LOW' });
      expect(scaVulnRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isMalware: true }),
      );
    });

    it('does NOT flag a regular CVE advisory as malware', async () => {
      await runMalwareIngestion({
        vulnerabilityType: 'ALL',
        advisoryId: 'CVE-2024-1',
      });
      const sawMalware = scaVulnRepo.save!.mock.calls.some(
        ([d]: any[]) => d?.isMalware === true,
      );
      expect(sawMalware).toBe(false);
    });
  });

  describe('re-scan state & exploitability preservation', () => {
    const buildReDetectionDto = () => ({
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
    });

    const reachablePkg = {
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

    const matchedVuln = [
      {
        vulnerability: {
          id: 'osv-1',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ];

    beforeEach(() => {
      scaDetectedRepo.find!.mockResolvedValue([]);
      scaDetectedRepo.findOne!.mockResolvedValue(reachablePkg);
      scaDetectedRepo.save!.mockImplementation(async (e) => e);
      scaVulnRepo.create!.mockImplementation((e: any) => e);
      let autoId = 0;
      scaVulnRepo.save!.mockImplementation(async (e: any) => ({
        ...e,
        id: e.id || `det-new-${++autoId}`,
      }));
      matcher.findMatchingVulnerabilities.mockResolvedValue(matchedVuln);
      (resultService as any).recalculatePriority = jest
        .fn()
        .mockResolvedValue({ priority: 'high', priorityScore: 80 });
    });

    it('preserves a manually-modified status when an existing detection is re-detected', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      // The user decision (ignored) must survive the re-scan, even though the
      // freshly computed adjustedState for a reachable package is 'to_verify'.
      expect(existingDetection.currentState).toBe('ignored');
    });

    it('preserves a manually-confirmed status when an existing detection is re-detected', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'confirmed',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(existingDetection.currentState).toBe('confirmed');
    });

    it('re-evaluates a resolved detection back to to_verify when it reappears', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'resolved',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      // A reappearing resolved vuln is scan-managed (not user-modified): reset it.
      expect(existingDetection.currentState).toBe('to_verify');
    });

    it('re-evaluates a resolved detection to to_verify on reappearance even when it was previously manually modified', async () => {
      // The vuln was once decided (e.g. ignored), then disappeared and was marked
      // resolved while the manual flag lingered. On reappearance the resolved
      // lifecycle must win: reset to to_verify and clear the manual flag.
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'resolved',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(existingDetection.currentState).toBe('to_verify');
      expect(existingDetection.stateManuallyModified).toBe(false);
    });

    it('preserves a manual exploitability verdict across a re-scan', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        stateManuallyModified: false,
        exploitabilitySource: 'manual',
        exploitabilityVerdict: 'proven',
        exploitabilityScore: 0.88,
        exploitabilityReason: 'Analyst confirmed reachable in prod',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      // Static recompute must not clobber an analyst's manual verdict.
      expect(existingDetection.exploitabilityVerdict).toBe('proven');
      expect(existingDetection.exploitabilitySource).toBe('manual');
    });

    it('does NOT resolve a manually-ignored detection whose vulnerability disappears from the scan', async () => {
      // pkg-1 is still scanned, but only osv-1 is found now. The existing,
      // user-ignored detection for osv-2 is no longer detected — it must stay
      // ignored, NOT be flipped to 'resolved'.
      const disappearedDecided = {
        id: 'det-decided',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-2' },
        currentState: 'ignored',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([disappearedDecided]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(disappearedDecided.currentState).toBe('ignored');
    });

    it('still resolves a scan-managed detection whose vulnerability disappears from the scan', async () => {
      const disappearedScanManaged = {
        id: 'det-managed',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-2' },
        currentState: 'to_verify',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([disappearedScanManaged]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(disappearedScanManaged.currentState).toBe('resolved');
    });

    // The freeze guards a decision against RE-EVALUATION (see the re-detection
    // tests above). A disappearance closes a confirm instead of contradicting it.
    it('resolves a manually-confirmed detection whose vulnerability disappears from the scan', async () => {
      const disappearedConfirmed = {
        id: 'det-confirmed',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-2' },
        currentState: 'confirmed',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([disappearedConfirmed]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(disappearedConfirmed.currentState).toBe('resolved');
    });

    // handleUpdateSca flags `to_verify` too; no other family freezes it, and it
    // records no decision a disappearance could contradict.
    it('resolves a detection a person handed back to to_verify when its vulnerability disappears', async () => {
      const disappearedToVerify = {
        id: 'det-to-verify',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-2' },
        currentState: 'to_verify',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([disappearedToVerify]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(disappearedToVerify.currentState).toBe('resolved');
    });

    it('still resolves a reachability-driven ignored detection whose vulnerability disappears', async () => {
      const disappearedAutoIgnored = {
        id: 'det-auto-ignored',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-2' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([disappearedAutoIgnored]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(disappearedAutoIgnored.currentState).toBe('resolved');
    });

    it('re-evaluates a reachability-driven ignored detection (not user-modified) when reachability changes', async () => {
      const reachabilityIgnored = {
        id: 'det-reach',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([reachabilityIgnored]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      // Auto-ignore (reachability) is scan-managed: once the package is reachable
      // again, the detection must be re-surfaced for verification.
      expect(reachabilityIgnored.currentState).toBe('to_verify');
      expect(reachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('keeps a reachability-driven ignored detection when the re-scan lost the reachability signal (empty string)', async () => {
      // The scanner's reachability is best-effort: on any failure it comes back
      // as '' (scanlink-sca serializes a missing verdict as '' — see client.ts).
      // A lost signal is NOT evidence the package became reachable, so a vuln a
      // previous scan auto-ignored as `unused` must stay ignored, not churn to
      // `to_verify`.
      const lostReachabilityPkg = { ...reachablePkg, reachability: '' };
      scaDetectedRepo.findOne!.mockResolvedValue(lostReachabilityPkg);
      const reachabilityIgnored = {
        id: 'det-reach',
        scaDetectedPackage: lostReachabilityPkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([reachabilityIgnored]);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [{ ...buildReDetectionDto().packages[0], reachability: '' }],
      } as any);

      expect(reachabilityIgnored.currentState).toBe('ignored');
      expect(reachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('keeps a reachability-driven ignored detection when the re-scan reports unknown reachability', async () => {
      const unknownReachabilityPkg = {
        ...reachablePkg,
        reachability: 'unknown',
      };
      scaDetectedRepo.findOne!.mockResolvedValue(unknownReachabilityPkg);
      const reachabilityIgnored = {
        id: 'det-reach',
        scaDetectedPackage: unknownReachabilityPkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([reachabilityIgnored]);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [
          { ...buildReDetectionDto().packages[0], reachability: 'unknown' },
        ],
      } as any);

      expect(reachabilityIgnored.currentState).toBe('ignored');
      expect(reachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('still re-surfaces a reachability-driven ignored detection when the package is now conclusively used', async () => {
      // A conclusive reachable verdict (`used`) IS positive evidence — the vuln
      // must be re-surfaced for verification (this preserves the intended
      // re-evaluation, distinct from a merely lost/unknown signal above).
      const usedPkg = { ...reachablePkg, reachability: 'used' };
      scaDetectedRepo.findOne!.mockResolvedValue(usedPkg);
      const reachabilityIgnored = {
        id: 'det-reach',
        scaDetectedPackage: usedPkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([reachabilityIgnored]);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [
          { ...buildReDetectionDto().packages[0], reachability: 'used' },
        ],
      } as any);

      expect(reachabilityIgnored.currentState).toBe('to_verify');
      expect(reachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('does NOT auto-ignore a package whose only imports are in test code', async () => {
      // `test_only` means "no production import path", not "provably unused" —
      // it must never trigger the reachability auto-ignore.
      const testOnlyPkg = { ...reachablePkg, reachability: 'test_only' };
      scaDetectedRepo.findOne!.mockResolvedValue(testOnlyPkg);
      scaVulnRepo.find!.mockResolvedValue([]);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [
          { ...buildReDetectionDto().packages[0], reachability: 'test_only' },
        ],
      } as any);

      const created = scaVulnRepo
        .save!.mock.calls.map((c: any[]) => c[0])
        .find((d: any) => d?.vulnerability?.id === 'osv-1');
      expect(created.currentState).toBe('to_verify');
    });

    it('treats test_only as a conclusive verdict and re-surfaces a reachability-driven ignore', async () => {
      // Unlike '' / 'unknown', `test_only` IS a verdict the scanner reached, so
      // a previously auto-ignored detection must be re-evaluated.
      const testOnlyPkg = { ...reachablePkg, reachability: 'test_only' };
      scaDetectedRepo.findOne!.mockResolvedValue(testOnlyPkg);
      const reachabilityIgnored = {
        id: 'det-reach',
        scaDetectedPackage: testOnlyPkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([reachabilityIgnored]);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [
          { ...buildReDetectionDto().packages[0], reachability: 'test_only' },
        ],
      } as any);

      expect(reachabilityIgnored.currentState).toBe('to_verify');
      expect(reachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('keeps a reachability-driven ignored detection through the ER_DUP concurrent-insert path when reachability is lost', async () => {
      const lostReachabilityPkg = { ...reachablePkg, reachability: '' };
      scaDetectedRepo.findOne!.mockResolvedValue(lostReachabilityPkg);
      scaVulnRepo.find!.mockResolvedValue([]);
      const racedReachabilityIgnored = {
        id: 'det-raced-reach',
        scaDetectedPackage: lostReachabilityPkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: false,
        exploitabilitySource: 'static',
      };
      let saveCalls = 0;
      scaVulnRepo.save!.mockImplementation(async (e: any) => {
        saveCalls += 1;
        if (saveCalls === 1) {
          const err: any = new Error('duplicate');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return { ...e, id: e.id || 'det-raced-reach' };
      });
      scaVulnRepo.findOne!.mockResolvedValue(racedReachabilityIgnored);

      await service.addScaScanResult({
        ...buildReDetectionDto(),
        packages: [{ ...buildReDetectionDto().packages[0], reachability: '' }],
      } as any);

      expect(racedReachabilityIgnored.currentState).toBe('ignored');
      expect(racedReachabilityIgnored.stateManuallyModified).toBe(false);
    });

    it('preserves a manually-modified status through the ER_DUP concurrent-insert path', async () => {
      // Initial batch query returns nothing (forces the create path); the insert
      // races another pod and throws ER_DUP_ENTRY; the subsequent fetch returns a
      // user-ignored detection that must be preserved.
      scaVulnRepo.find!.mockResolvedValue([]);
      const racedDecided = {
        id: 'det-raced',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'ignored',
        stateManuallyModified: true,
        exploitabilitySource: 'static',
      };
      let saveCalls = 0;
      scaVulnRepo.save!.mockImplementation(async (e: any) => {
        saveCalls += 1;
        if (saveCalls === 1) {
          const err: any = new Error('duplicate');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return { ...e, id: e.id || 'det-raced' };
      });
      scaVulnRepo.findOne!.mockResolvedValue(racedDecided);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(racedDecided.currentState).toBe('ignored');
    });

    it('removeMissingLibs preserves a manual dismissal but resolves the rest, confirmed included', async () => {
      const lib = { id: 'lib-1', projectId: 'p1' };
      const decided = {
        id: 'd-decided',
        scaDetectedPackage: lib,
        currentState: 'ignored',
        stateManuallyModified: true,
      };
      const confirmed = {
        id: 'd-confirmed',
        scaDetectedPackage: lib,
        currentState: 'confirmed',
        stateManuallyModified: true,
      };
      const scanManaged = {
        id: 'd-managed',
        scaDetectedPackage: lib,
        currentState: 'to_verify',
        stateManuallyModified: false,
      };
      scaDetectedRepo.find!.mockResolvedValue([lib]);
      scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
      scaVulnRepo.find!.mockResolvedValue([decided, confirmed, scanManaged]);
      scaVulnRepo.save!.mockImplementation(async (e) => e);

      await (service as any).removeMissingLibs('p1', 's1', '');

      expect(decided.currentState).toBe('ignored');
      // The package row is removed right after (its FK is SET NULL): a confirm
      // left open here would stay open on a package that no longer exists.
      expect(confirmed.currentState).toBe('resolved');
      expect(scanManaged.currentState).toBe('resolved');
    });

    // Cross-scan branch drift: a scan run without a branch is stored
    // on the '' partition; a later canonical-branch ('main') scan must still
    // heal those orphaned detections instead of leaving them stuck open.
    it('resolves orphaned detections on the empty partition when finalizing the canonical branch', async () => {
      (
        service as any
      ).referenceBranchResolver.getScoringBranches.mockResolvedValue(['main']);
      const orphanPkg = { id: 'pkg-orphan', projectId: 'p1', branch: '' };
      // Branch-aware: the package query only returns the '' orphan when the
      // resolver expands its scope to include the empty partition.
      scaDetectedRepo.find!.mockImplementation(async (opts: any) => {
        const f = opts?.where?.branch;
        const values =
          f && typeof f === 'object' && 'value' in f ? f.value : [f];
        return values.includes('') ? [orphanPkg] : [];
      });
      scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
      const orphanDet = {
        id: 'd-orphan',
        scaDetectedPackage: orphanPkg,
        currentState: 'confirmed',
        stateManuallyModified: false,
      };
      scaVulnRepo.find!.mockResolvedValue([orphanDet]);
      scaVulnRepo.save!.mockImplementation(async (e: any) => e);

      // scan-2 runs on the canonical branch 'main'
      await (service as any).removeMissingLibs('p1', 'scan-2', 'main');

      expect(orphanDet.currentState).toBe('resolved');
      // Removed by id.
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.whereInIds).toHaveBeenCalledWith(['pkg-orphan']);
    });

    // Guard — finalizing a real feature branch must NOT cross-resolve
    // the default/empty partition (genuine multi-branch SCA stays isolated).
    it('does not resolve the empty-partition orphans when finalizing a feature branch', async () => {
      (
        service as any
      ).referenceBranchResolver.getScoringBranches.mockResolvedValue(['main']);
      const orphanPkg = { id: 'pkg-orphan', projectId: 'p1', branch: '' };
      scaDetectedRepo.find!.mockImplementation(async (opts: any) => {
        const f = opts?.where?.branch;
        const values =
          f && typeof f === 'object' && 'value' in f ? f.value : [f];
        return values.includes('') ? [orphanPkg] : [];
      });
      scaDetectedRepo.remove = jest.fn().mockResolvedValue(undefined);
      const orphanDet = {
        id: 'd-orphan',
        scaDetectedPackage: orphanPkg,
        currentState: 'confirmed',
        stateManuallyModified: false,
      };
      scaVulnRepo.find!.mockResolvedValue([orphanDet]);
      scaVulnRepo.save!.mockImplementation(async (e: any) => e);

      await (service as any).removeMissingLibs('p1', 'scan-2', 'feature/x');

      expect(orphanDet.currentState).toBe('confirmed');
      expect(scaVulnRepo.save).not.toHaveBeenCalled();
      // Resolutions are written by id since None was.
      expect(scaVulnRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    // Read paths must scope to the SAME logical branch partition as
    // the resolver, so the default-branch view includes legacy '' rows instead
    // of hard-defaulting to 'main' and showing an empty page.
    it('getProjectScaPackages filters by the full effective-branch partition', async () => {
      (
        service as any
      ).referenceBranchResolver.getScoringBranches.mockResolvedValue(['main']);
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
      };
      scaDetectedRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectScaPackages({
        projectId: 'p1',
        branch: 'main',
      } as any);

      const branchCall = qb.andWhere.mock.calls.find((c: any[]) =>
        /branch IN/.test(c[0]),
      );
      expect(branchCall).toBeTruthy();
      expect(branchCall[1]).toEqual({ branches: ['main', ''] });
    });

    it('getProjectLicenseSummary queries the full effective-branch partition', async () => {
      (
        service as any
      ).referenceBranchResolver.getScoringBranches.mockResolvedValue(['main']);
      scaDetectedRepo.find!.mockResolvedValue([]);

      await service.getProjectLicenseSummary({
        projectId: 'p1',
        branch: 'main',
      });

      const call = scaDetectedRepo.find!.mock.calls.find(
        (c: any[]) => c[0]?.where?.projectId === 'p1',
      );
      expect(call).toBeTruthy();
      expect(call[0].where.branch?.value).toEqual(['main', '']);
    });

    it('getPackagesByLicense queries the full effective-branch partition', async () => {
      (
        service as any
      ).referenceBranchResolver.getScoringBranches.mockResolvedValue(['main']);
      scaDetectedRepo.find!.mockResolvedValue([]);

      await service.getPackagesByLicense({
        projectId: 'p1',
        spdxId: 'MIT',
        branch: 'main',
      });

      const call = scaDetectedRepo.find!.mock.calls.find(
        (c: any[]) => c[0]?.where?.projectId === 'p1',
      );
      expect(call).toBeTruthy();
      expect(call[0].where.branch?.value).toEqual(['main', '']);
    });

    it('preserves a user-overridden priority when an existing detection is re-detected', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        stateManuallyModified: false,
        priorityManualOverride: true,
        currentPriority: 'critical_urgent',
        priorityScore: 95,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      // recalculatePriority would yield 'high'/80 — but the analyst lock wins.
      expect(existingDetection.currentPriority).toBe('critical_urgent');
      expect(existingDetection.priorityScore).toBe(95);
    });

    it('re-evaluates priority and clears the override when a resolved detection reappears', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'resolved',
        stateManuallyModified: false,
        priorityManualOverride: true,
        currentPriority: 'low',
        priorityScore: 10,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(existingDetection.currentPriority).toBe('high');
      expect(existingDetection.priorityScore).toBe(80);
      expect(existingDetection.priorityManualOverride).toBe(false);
    });

    it('recomputes priority normally when it is not manually overridden', async () => {
      const existingDetection = {
        id: 'det-existing',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        stateManuallyModified: false,
        priorityManualOverride: false,
        currentPriority: 'low',
        priorityScore: 10,
        exploitabilitySource: 'static',
      };
      scaVulnRepo.find!.mockResolvedValue([existingDetection]);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(existingDetection.currentPriority).toBe('high');
      expect(existingDetection.priorityScore).toBe(80);
    });

    it('preserves a user-overridden priority through the ER_DUP concurrent-insert path', async () => {
      scaVulnRepo.find!.mockResolvedValue([]);
      const racedPriority = {
        id: 'det-raced',
        scaDetectedPackage: reachablePkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        stateManuallyModified: false,
        priorityManualOverride: true,
        currentPriority: 'critical_urgent',
        priorityScore: 95,
        exploitabilitySource: 'static',
      };
      let saveCalls = 0;
      scaVulnRepo.save!.mockImplementation(async (e: any) => {
        saveCalls += 1;
        if (saveCalls === 1) {
          const err: any = new Error('duplicate');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return { ...e, id: e.id || 'det-raced' };
      });
      scaVulnRepo.findOne!.mockResolvedValue(racedPriority);

      await service.addScaScanResult(buildReDetectionDto() as any);

      expect(racedPriority.currentPriority).toBe('critical_urgent');
      expect(racedPriority.priorityScore).toBe(95);
    });
  });

  it('handleUpdateSca marks a detection as manually modified when a status is applied', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'to_verify',
      currentPriority: 'normal',
      stateManuallyModified: false,
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      status: 'ignored',
      dismissalReason: 'fixture: dismissed for this test',
      userId: 'u1',
    } as any);

    expect(vuln.stateManuallyModified).toBe(true);
  });

  it('handleUpdateSca freezes an explicit to_verify decision against scan re-evaluation', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'ignored',
      currentPriority: 'normal',
      stateManuallyModified: false,
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      status: 'to_verify',
      userId: 'u1',
    } as any);

    expect(vuln.currentState).toBe('to_verify');
    expect(vuln.stateManuallyModified).toBe(true);
  });

  it('handleUpdateSca saves changes and records history for status/priority/comment', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'open',
      currentPriority: 'normal',
    } as any;
    scaVulnRepo.save!.mockResolvedValue(vuln);
    // Let read-back return an object to avoid NOT_FOUND
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      status: 'closed',
      priority: 'urgent',
      comment: 'please check',
      userId: 'u1',
    } as any);

    expect(scaVulnRepo.save).toHaveBeenCalled();
    expect(resultService.addHistoryItem).toHaveBeenCalledTimes(3);
    expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith('p1', 'vuln_update');
  });

  it('handleUpdateSca resets exploitability when verdict is not_evaluated', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'to_verify',
      currentPriority: 'normal',
      exploitabilityVerdict: 'proven',
      exploitabilityScore: 0.9,
      exploitabilitySource: 'manual',
      scoringSource: 'agent',
      priorityManualOverride: true,
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      reachability: 'potentially_used',
    });
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'low', priorityScore: 10 });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      exploitabilityVerdict: 'not_evaluated',
      userId: 'u1',
    } as any);

    expect(vuln.exploitabilityVerdict).toBeNull();
    expect(vuln.exploitabilitySource).toBeNull();
    // scoring_source is NOT NULL, so the reset falls back to the
    // 'static' baseline rather than null (persisting null fails the save).
    expect(vuln.scoringSource).toBe('static');
    expect(vuln.priorityManualOverride).toBe(false);
    expect(resultService.addHistoryItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'exploitability_change' }),
    );
    expect(cyberiskEnqueuer.enqueue).toHaveBeenCalledWith('p1', 'vuln_update');
  });

  // A verdict with no explicit source must default to 'manual',
  // never silently to 'agent'.
  it('handleUpdateSca defaults exploitabilitySource to "manual" when not provided', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      reachability: null,
    });
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'normal', priorityScore: 10 });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      exploitabilityVerdict: 'not_exploitable',
      exploitabilitySource: '',
      userId: 'u1',
    } as any);

    expect(vuln.exploitabilitySource).toBe('manual');
  });

  // A human manual exploitability edit shifting the priority bucket
  // must attribute the recompute-derived priority_change to the human editor,
  // not to the 'system' sentinel (which falsely shows "Analyzed by Agent Cybe").
  it('handleUpdateSca attributes the recompute-derived priority_change to the human editor', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      reachability: null,
    });
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'high', priorityScore: 80 });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      exploitabilityVerdict: 'proven',
      exploitabilitySource: 'manual',
      userId: 'human-13',
    } as any);

    const priorityCall = resultService.addHistoryItem.mock.calls.find(
      (call) => call[0].type === 'priority_change',
    );
    expect(priorityCall).toBeDefined();
    expect(priorityCall![0].userId).toBe('human-13');
    expect(priorityCall![0].userId).not.toBe('system');
    expect(priorityCall![0].source).toBe('dashboard_manual');
  });

  // Non-regression — autonomous agent (userId='system') keeps system
  // attribution so the banner still shows.
  it('handleUpdateSca keeps the recompute-derived priority_change attributed to system for agent analysis', async () => {
    const vuln = {
      id: 'v1',
      currentState: 'to_verify',
      currentPriority: 'normal',
    } as any;
    scaVulnRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.findOne!.mockResolvedValue({
      id: 'v1',
      projectId: 'p1',
      scaDetectedPackage: { projectId: 'p1' },
    });
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      reachability: null,
    });
    (resultService as any).recalculatePriority = jest
      .fn()
      .mockResolvedValue({ priority: 'high', priorityScore: 80 });

    await service.handleUpdateSca(vuln, {
      projectId: 'p1',
      vulnerabilityId: 'v1',
      exploitabilityVerdict: 'proven',
      exploitabilitySource: 'agent',
      userId: 'system',
    } as any);

    const priorityCall = resultService.addHistoryItem.mock.calls.find(
      (call) => call[0].type === 'priority_change',
    );
    expect(priorityCall).toBeDefined();
    expect(priorityCall![0].userId).toBe('system');
    expect(priorityCall![0].source).toBe('system');
  });

  it('persists environmental vector + score when project context exists for SCA', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: null,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);

    // No existing detections in DB -> forces new-detection branch
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    let nextDetId = 0;
    scaVulnRepo.save!.mockImplementation(async (det: any) => {
      nextDetId += 1;
      return { ...det, id: `det-${nextDetId}` };
    });

    matcher.findMatchingVulnerabilities.mockResolvedValue([
      {
        vulnerability: {
          id: 'osv-1',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);

    (resultService as any).recalculatePriority = jest.fn().mockResolvedValue({
      priority: 'high',
      priorityScore: 80,
    });
    resultService.computeEnvironmentalForProject.mockResolvedValueOnce({
      fullVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
      baseScore: 9.3,
      environmentalScore: 9.8,
    });

    const dto = {
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
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any;

    await service.addScaScanResult(dto);
    await new Promise((r) => setImmediate(r));

    expect(resultService.computeEnvironmentalForProject).toHaveBeenCalledWith(
      'p1',
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    // Find the detection save (there may also be package saves); look at the
    // call where the persisted entity has cvss4BaseScore set.
    const detectionSaveCall = scaVulnRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    );
    expect(detectionSaveCall).toBeDefined();
    const saved = detectionSaveCall![0];
    expect(saved.cvss4EnvironmentalScore).toBe(9.8);
    expect(saved.cvss4EnvironmentalVector).toBe(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
    );
  });

  it('falls back to base score and null vector when no project context exists for SCA', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: null,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);

    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    let nextDetId = 0;
    scaVulnRepo.save!.mockImplementation(async (det: any) => {
      nextDetId += 1;
      return { ...det, id: `det-${nextDetId}` };
    });

    matcher.findMatchingVulnerabilities.mockResolvedValue([
      {
        vulnerability: {
          id: 'osv-1',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);

    (resultService as any).recalculatePriority = jest.fn().mockResolvedValue({
      priority: 'high',
      priorityScore: 80,
    });
    // No project security context -> service returns null
    resultService.computeEnvironmentalForProject.mockResolvedValueOnce(null);

    const dto = {
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
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any;

    await service.addScaScanResult(dto);
    await new Promise((r) => setImmediate(r));

    const detectionSaveCall = scaVulnRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    );
    expect(detectionSaveCall).toBeDefined();
    const saved = detectionSaveCall![0];
    expect(saved.cvss4EnvironmentalScore).toBe(9.3);
    expect(saved.cvss4EnvironmentalVector).toBeNull();
  });

  it('keeps the label of an advisory with no CVSS: its default vector skips the security context', async () => {
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: null,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    scaVulnRepo.save!.mockImplementation(async (det: any) => ({
      ...det,
      id: 'det-1',
    }));
    matcher.findMatchingVulnerabilities.mockResolvedValue([
      { vulnerability: { id: 'osv-1', severity: [] } },
    ]);
    (resultService as any).recalculatePriority = jest.fn().mockResolvedValue({
      priority: 'high',
      priorityScore: 80,
    });
    const real = new CvssCalculatorService();
    cvssCalculator.computeCvss4Base.mockReturnValueOnce(
      real.computeCvss4Base({ severity: 'high' }),
    );
    resultService.computeEnvironmentalForProject.mockResolvedValue({
      fullVector: 'CVSS:4.0/env',
      baseScore: 8.2,
      environmentalScore: 9.6,
    });

    await service.addScaScanResult({
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
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any);
    await new Promise((r) => setImmediate(r));

    expect(resultService.computeEnvironmentalForProject).not.toHaveBeenCalled();
    const saved = scaVulnRepo.save!.mock.calls.find(
      (call: any[]) => call[0] && 'cvss4BaseScore' in call[0],
    )![0];
    expect(saved.cvss4BaseScore).toBe(8.2);
    expect(saved.cvss4EnvironmentalScore).toBe(8.2);
    expect(saved.cvss4EnvironmentalVector).toBeNull();
    expect(resolveEffectiveSeverity(saved)).toBe('high');
  });

  it('passes env score to recalculatePriority when env score >= 9.0', async () => {
    // Regression test for SCA OSV ingestion ordering: env must be computed
    // BEFORE recalculatePriority so the call receives the real environmental
    // score (not the base score masquerading as env).
    scaDetectedRepo.find!.mockResolvedValue([]);
    scaDetectedRepo.findOne!.mockResolvedValue({
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'axios',
      packageVersion: '0.21.1',
      isDev: false,
      isTransitive: false,
      ecosystem: 'npm',
      reachability: null,
    });
    scaDetectedRepo.save!.mockImplementation(async (e) => e);

    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    let nextDetId = 0;
    scaVulnRepo.save!.mockImplementation(async (det: any) => {
      nextDetId += 1;
      return { ...det, id: `det-${nextDetId}` };
    });

    matcher.findMatchingVulnerabilities.mockResolvedValue([
      {
        vulnerability: {
          id: 'osv-critical',
          severity: [{ score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        },
      },
    ]);

    const recalcMock = jest.fn().mockResolvedValue({
      priority: 'urgent',
      priorityScore: 95,
    });
    (resultService as any).recalculatePriority = recalcMock;

    // computeEnvironmentalForProject returns env score of 9.4 (>= 9.0 → critical)
    resultService.computeEnvironmentalForProject.mockResolvedValueOnce({
      fullVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:H/AR:H',
      baseScore: 9.3,
      environmentalScore: 9.4,
    });

    const dto = {
      projectId: 'p1',
      scanId: 's1',
      packages: [
        {
          name: 'axios',
          version: '0.21.1',
          isDev: false,
          isTransitive: false,
          file: 'package.json',
          ecosystem: 'npm',
          path: 'root',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    } as any;

    await service.addScaScanResult(dto);
    await new Promise((r) => setImmediate(r));

    // recalculatePriority must have been called with the real env score (9.4),
    // not the base score (9.3). effectiveSeverity is no longer forwarded -
    // recalculatePriority resolves it live from the CVSS4 scores.
    expect(recalcMock).toHaveBeenCalledTimes(1);
    const callArg = recalcMock.mock.calls[0][0];
    expect(callArg.cvss4EnvironmentalScore).toBe(9.4);
    expect(callArg).not.toHaveProperty('effectiveSeverity');
  });

  // An ingestion batch reads two project flags (reachability
  // priority / status) and a vulnerability detail one fact (a parsed branch).
  // Each paid a full ProjectService/Get, whose vulnerability count called
  // back into this service.
  describe('project reads', () => {
    let projectClient: { get: jest.Mock; getProjectBranches: jest.Mock };

    beforeEach(() => {
      projectClient = {
        get: jest.fn().mockReturnValue(
          of({
            scaReachabilityPriorityEnabled: false,
            scaReachabilityStatusEnabled: false,
          }),
        ),
        getProjectBranches: jest.fn(),
      };
      (service as any).projectServiceClient = projectClient;
    });

    // The batch's one Get also gives the branch scope of the triage
    // carry-over, which reads defaultBranch: the integration
    // status stays, only the stats and the security context are skipped.
    it('processScaBatch reads the reachability flags and the branch scope with the lean project read', async () => {
      scaDetectedRepo.find!.mockResolvedValue([]);
      scaVulnRepo.find!.mockResolvedValue([]);
      matcher.findMatchingVulnerabilities.mockResolvedValue([]);

      await service.addScaScanResult({
        projectId: 'p1',
        scanId: 's1',
        packages: [],
        isLastRequest: false,
        vulnerabilityType: 'ALL',
      } as any);

      expect(projectClient.get.mock.calls).toEqual([
        [
          {
            projectId: 'p1',
            skipVulnerabilityStats: true,
            skipSecurityContext: true,
          },
        ],
      ]);
    });

    describe('getScaVulnerabilityByIdInProject isProjectParsed', () => {
      beforeEach(() => {
        scaVulnRepo.findOne!.mockResolvedValue({
          id: 'det-1',
          projectId: 'p1',
          currentSeverity: 'high',
          currentState: 'to_verify',
          historyItems: [],
          scaAutofixRecords: [],
          scaDetectedPackage: {
            id: 'pkg-1',
            packageName: 'lodash',
            packageVersion: '4.17.20',
            isTransitive: false,
            branch: 'main',
          },
          vulnerability: {
            id: 'osv-1',
            aliases: [],
            references: [],
            severities: [],
            affected: [],
          },
        });
      });

      const detail = () =>
        service.getScaVulnerabilityByIdInProject({
          projectId: 'p1',
          vulnerabilityId: 'det-1',
        });

      it('answers from GetProjectBranches, without ProjectService/Get', async () => {
        projectClient.getProjectBranches.mockReturnValue(
          of({
            branches: [
              { branch: 'main', status: 'BRANCH_INGESTION_STATUS_PARSED' },
            ],
          }),
        );

        const res = await detail();

        expect(res.isProjectParsed).toBe(true);
        expect(projectClient.getProjectBranches).toHaveBeenCalledWith({
          projectId: 'p1',
        });
        expect(projectClient.get).not.toHaveBeenCalled();
      });

      it('is false while the only branch is still parsing or failed', async () => {
        projectClient.getProjectBranches.mockReturnValue(
          of({
            branches: [
              { branch: 'main', status: 'BRANCH_INGESTION_STATUS_PARSING' },
              { branch: 'dev', status: 'BRANCH_INGESTION_STATUS_FAILED' },
            ],
          }),
        );

        const res = await detail();

        expect(res.isProjectParsed).toBe(false);
      });
    });
  });

  // ── SHADOW-MODE fingerprint (Task 3) ──────────────────────────────
  describe('fingerprint (shadow mode)', () => {
    const dto = () => ({
      projectId: 'p1',
      scanId: 's1',
      branch: 'main',
      packages: [
        {
          name: 'lodash',
          version: '4.17.21',
          isDev: false,
          isTransitive: false,
          file: 'package.json',
          ecosystem: 'npm',
          path: 'root',
        },
      ],
      isLastRequest: false,
      vulnerabilityType: 'ALL',
    });

    const pkg = {
      id: 'pkg-1',
      projectId: 'p1',
      packageName: 'lodash',
      packageVersion: '4.17.21',
      ecosystem: 'npm',
      isDev: false,
      isTransitive: false,
      dependencyInfoAvailable: true,
    };

    beforeEach(() => {
      scaDetectedRepo.find!.mockResolvedValue([]);
      scaDetectedRepo.findOne!.mockResolvedValue(pkg);
      scaDetectedRepo.save!.mockImplementation(async (e: any) => e);
      scaVulnRepo.create!.mockImplementation((e: any) => e);
      scaVulnRepo.save!.mockImplementation(async (e: any) => ({
        ...e,
        id: e.id || 'det-new',
      }));
      matcher.findMatchingVulnerabilities.mockResolvedValue([
        { vulnerability: { id: 'osv-1', severity: [] } },
      ]);
      (resultService as any).recalculatePriority = jest
        .fn()
        .mockResolvedValue({ priority: 'high', priorityScore: 80 });
    });

    it('stamps a non-null fingerprint on a newly created detection', async () => {
      scaVulnRepo.find!.mockResolvedValue([]);

      await service.addScaScanResult(dto() as any);

      const created = scaVulnRepo.create!.mock.calls.at(-1)![0];
      expect(created.fingerprint).toBe(
        computeScaFingerprint({
          projectId: 'p1',
          branch: created.branch ?? null,
          ecosystem: 'npm',
          packageName: 'lodash',
          packageVersion: '4.17.21',
          osvId: 'osv-1',
        }),
      );
    });

    it('backfills a NULL fingerprint on the re-detection path', async () => {
      const existing = {
        id: 'det-existing',
        scaDetectedPackage: pkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        exploitabilitySource: 'static',
        fingerprint: null,
      };
      scaVulnRepo.find!.mockResolvedValue([existing]);

      await service.addScaScanResult(dto() as any);

      // The harness cannot resolve a scan branch (no security-scanning gRPC),
      // so ingestion falls back to the empty branch — which hashes identically
      // to null.
      expect(existing.fingerprint).toBe(
        computeScaFingerprint({
          projectId: 'p1',
          branch: null,
          ecosystem: 'npm',
          packageName: 'lodash',
          packageVersion: '4.17.21',
          osvId: 'osv-1',
        }),
      );
    });

    it('warns FINGERPRINT_MISMATCH and never overwrites a stored fingerprint', async () => {
      const existing = {
        id: 'det-existing',
        scaDetectedPackage: pkg,
        vulnerability: { id: 'osv-1' },
        currentState: 'to_verify',
        exploitabilitySource: 'static',
        fingerprint: 'stale-digest',
      };
      scaVulnRepo.find!.mockResolvedValue([existing]);

      await service.addScaScanResult(dto() as any);

      expect(existing.fingerprint).toBe('stale-digest');
      const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0]));
      expect(
        warned.some(
          (m: string) =>
            m.includes('FINGERPRINT_MISMATCH') && m.includes('det-existing'),
        ),
      ).toBe(true);
    });
  });

  describe('currentPriority ORDER BY CASE', () => {
    // H4: SAST/IaC include very_low in the priority_order CASE so rows with
    // very_low priority are ranked between low and the default bucket. The
    // SCA listing query must do the same; otherwise very_low rows fall into
    // the ELSE bucket and sort alongside rows with an unknown/null priority.
    const serviceSource = fs.readFileSync(
      path.resolve(__dirname, 'sca.service.ts'),
      'utf8',
    );

    it('maps critical_urgent/urgent/normal/low/very_low to 1..5 in the priority_order CASE', () => {
      expect(serviceSource).toMatch(
        /WHEN LOWER\(vulnDetection\.currentPriority\) = 'critical_urgent' THEN 1/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(vulnDetection\.currentPriority\) = 'urgent' THEN 2/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(vulnDetection\.currentPriority\) = 'normal' THEN 3/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(vulnDetection\.currentPriority\) = 'low' THEN 4/,
      );
      expect(serviceSource).toMatch(
        /WHEN LOWER\(vulnDetection\.currentPriority\) = 'very_low' THEN 5/,
      );
    });

    it('keeps the canonical priority order (very_low is WHEN 5, default is ELSE 6)', () => {
      // Extract the CASE block that sorts by currentPriority.
      const match = serviceSource.match(
        /CASE(?:(?!CASE)[\s\S])*?currentPriority\)\s*=\s*'critical_urgent'[\s\S]*?END/,
      );
      expect(match).not.toBeNull();
      const caseBlock = match![0];
      // The ordinals must be in strictly increasing order inside the block.
      const ordinals = Array.from(caseBlock.matchAll(/THEN (\d+)/g)).map((m) =>
        Number(m[1]),
      );
      expect(ordinals).toEqual([1, 2, 3, 4, 5]);
      expect(caseBlock).toMatch(/ELSE 6/);
    });
  });

  describe('loadFixedVersionsByOsv', () => {
    it('returns a map of osvId → fixed-version list based on a single bounded query', async () => {
      const queryBuilder: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { osvId: 'GHSA-1', fixedVersion: '1.2.3' },
          { osvId: 'GHSA-2', fixedVersion: '' },
        ]),
      };
      const dataSource: any = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      };

      // tslint:disable-next-line:no-any
      const result = await (service as any).loadFixedVersionsByOsv(
        ['GHSA-1', 'GHSA-2', 'GHSA-3'],
        dataSource,
      );

      expect(result.get('GHSA-1')).toEqual(['1.2.3']);
      // Empty `fixed` strings are skipped; ids with no fixed row are absent
      // (the caller defaults to an empty list → hasFix=false).
      expect(result.get('GHSA-2')).toBeUndefined();
      expect(result.get('GHSA-3')).toBeUndefined();
      expect(dataSource.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('returns an empty map for an empty osvIds list and does not hit the DB', async () => {
      const dataSource: any = {
        createQueryBuilder: jest.fn(),
      };
      const result = await (service as any).loadFixedVersionsByOsv(
        [],
        dataSource,
      );
      expect(result.size).toBe(0);
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns all fixed versions per OSV (installed-aware selection is applied per detection)', async () => {
      // Multiple raw event rows per OSV are collected verbatim; the caller
      // later picks the smallest fix strictly above each detection's install.
      const queryBuilder: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { osvId: 'GHSA-X', fixedVersion: '1.10.0' },
          { osvId: 'GHSA-X', fixedVersion: '1.2.3' },
          { osvId: 'GHSA-X', fixedVersion: '2.0.0' },
          { osvId: 'GHSA-Y', fixedVersion: '1.0.10' },
          { osvId: 'GHSA-Y', fixedVersion: '1.0.0' },
        ]),
      };
      const dataSource: any = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      };

      const result = await (service as any).loadFixedVersionsByOsv(
        ['GHSA-X', 'GHSA-Y'],
        dataSource,
      );

      expect(result.get('GHSA-X')).toEqual(['1.10.0', '1.2.3', '2.0.0']);
      expect(result.get('GHSA-Y')).toEqual(['1.0.10', '1.0.0']);
    });
  });

  describe('getProjectScaVulnerabilities (list path)', () => {
    const stubResultServiceCounts = () => {
      (resultService as any).getCountVulnerabilitiesCountByType = jest
        .fn()
        .mockResolvedValue({
          sast: 0,
          iac: 0,
          sca: 0,
          container: 0,
          cicd: 0,
          secret: 0,
        });
      (resultService as any).getAutofixCountByType = jest
        .fn()
        .mockResolvedValue({
          sast: { withAutofix: 0, withoutAutofix: 0 },
          iac: { withAutofix: 0, withoutAutofix: 0 },
          cicd: { withAutofix: 0, withoutAutofix: 0 },
          secret: { withAutofix: 0, withoutAutofix: 0 },
          sca: { withAutofix: 0, withoutAutofix: 0 },
        });
    };

    const stubGrpcClients = (extraProjectFields: Record<string, any> = {}) => {
      (service as any).projectServiceClient = {
        get: () => of({ name: 't', ...extraProjectFields }),
      };
      (service as any).scanServiceClient = {
        getLastScanStatus: () =>
          of({
            scanId: '',
            state: '',
            createAt: '',
            scanType: '',
          }),
      };
    };

    it('does NOT join osv.aliases / severities / references / affected / ranges / events', async () => {
      const joins: string[] = [];
      const fakeQb: any = {
        leftJoinAndSelect: jest.fn((rel: string) => {
          joins.push(rel);
          return fakeQb;
        }),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => fakeQb,
      };
      stubGrpcClients();
      stubResultServiceCounts();
      jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(new Map());
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());

      await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentSeverity',
        order: 'DESC',
        severity: ['critical'],
        status: [],
        priority: [],
        searchQuery: '',
        packageType: '',
        exploitabilityVerdict: [],
      } as any);

      expect(joins).toEqual(
        expect.arrayContaining([
          'vulnDetection.scaDetectedPackage',
          'vulnDetection.vulnerability',
        ]),
      );
      expect(joins).not.toEqual(
        expect.arrayContaining([
          'osv.aliases',
          'osv.severities',
          'osv.references',
          'osv.affected',
          'affected.ranges',
          'ranges.events',
        ]),
      );
    });

    it('calls loadFixedVersionsByOsv with the OSV ids of the current page and passes the result to the list mapper', async () => {
      const detections = [
        {
          id: 'd1',
          projectId: 'p1',
          vulnerability: { id: 'GHSA-1', aliases: [], affected: [] },
          scaDetectedPackage: {
            packageName: 'lodash',
            ecosystem: 'npm',
            packageVersion: '4.0.0',
          },
        },
        {
          id: 'd2',
          projectId: 'p1',
          vulnerability: { id: 'GHSA-2', aliases: [], affected: [] },
          scaDetectedPackage: {
            packageName: 'axios',
            ecosystem: 'npm',
            packageVersion: '1.0.0',
          },
        },
      ];
      const fakeQb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(detections),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => fakeQb,
      };
      stubGrpcClients({ parsedBranches: [] });
      stubResultServiceCounts();
      // loadFixedVersionsByOsv now returns the raw fixed-version list per OSV;
      // the call site picks the installed-aware fix. lodash@4.0.0 -> 4.17.21 is
      // a real upgrade (fixAvailable true); axios has no listed fix (false).
      const fixedVersionsMap = new Map([
        ['GHSA-1', ['4.17.21']],
        ['GHSA-2', []],
      ]);
      const spy = jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(fixedVersionsMap);
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(
        new Map([
          ['GHSA-1', 'CVE-2024-1111'],
          ['GHSA-2', 'CVE-2024-2222'],
        ]),
      );

      const response = await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentSeverity',
        order: 'DESC',
        severity: ['critical'],
        status: [],
        priority: [],
        searchQuery: '',
        packageType: '',
        exploitabilityVerdict: [],
      } as any);

      expect(spy).toHaveBeenCalledWith(['GHSA-1', 'GHSA-2']);
      expect(response.vulnerabilities).toHaveLength(2);
      expect(response.vulnerabilities[0].metadata?.aliases).toEqual([]);
      expect(
        response.vulnerabilities[0].metadata?.packages?.[0]?.fixAvailable,
      ).toBe(true);
      expect(
        response.vulnerabilities[1].metadata?.packages?.[0]?.fixAvailable,
      ).toBe(false);
      // CVE resolved via loadCveMap (list-mode skips the aliases join) — no more N/A
      expect(response.vulnerabilities[0].metadata?.cve).toBe('CVE-2024-1111');
      expect(response.vulnerabilities[1].metadata?.cve).toBe('CVE-2024-2222');

      // The project-wide malware count must be scoped to the active
      // vuln states so the Malware sub-tab badge/banner match the (active-state
      // filtered) list — otherwise a resolved/removed malware keeps the badge.
      expect(fakeQb.andWhere).toHaveBeenCalledWith(
        'vd.currentState IN (:...activeStates)',
        { activeStates: ['to_verify', 'confirmed'] },
      );
    });

    it('orders currentCVSS DESC with NULL rows pushed to the bottom (cvss_null_order ASC)', async () => {
      // Capture every addOrderBy call so we can assert the relative position
      // of the null-bubbling clause against the value-sort clause.
      const addOrderByCalls: Array<[string, string]> = [];
      const addSelectCalls: Array<[string, string]> = [];
      const fakeQb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn((expr: string, alias: string) => {
          addSelectCalls.push([expr, alias]);
          return fakeQb;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn((expr: string, order: string) => {
          addOrderByCalls.push([expr, order]);
          return fakeQb;
        }),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => fakeQb,
      };
      stubGrpcClients();
      stubResultServiceCounts();
      jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(new Map());
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());

      await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentCVSS',
        order: 'DESC',
        severity: [],
        status: [],
        priority: [],
        searchQuery: '',
        packageType: '',
        exploitabilityVerdict: [],
      } as any);

      // The query must register a `cvss_null_order` column that flags
      // NULL/zero currentCVSS rows with `1`.
      const nullOrderSelect = addSelectCalls.find(
        ([, alias]) => alias === 'cvss_null_order',
      );
      expect(nullOrderSelect).toBeDefined();
      expect(nullOrderSelect![0]).toMatch(/currentCVSS\s*=\s*0/);
      expect(nullOrderSelect![0]).toMatch(/currentCVSS\s+IS\s+NULL/);

      // The cvss_null_order clause must be sorted ASC (0 first, 1 last) so
      // null/zero rows bubble to the BOTTOM of the DESC value ordering.
      const nullOrderClause = addOrderByCalls.find(
        ([expr]) => expr === 'cvss_null_order',
      );
      expect(nullOrderClause).toEqual(['cvss_null_order', 'ASC']);

      // And the cvss_null_order must come BEFORE the currentCVSS value sort.
      const nullIdx = addOrderByCalls.findIndex(
        ([expr]) => expr === 'cvss_null_order',
      );
      const valueIdx = addOrderByCalls.findIndex(
        ([expr]) => expr === 'vulnDetection.currentCVSS',
      );
      expect(nullIdx).toBeGreaterThanOrEqual(0);
      expect(valueIdx).toBeGreaterThan(nullIdx);
      // The value sort itself must be DESC for the DESC-requested page.
      expect(addOrderByCalls[valueIdx][1]).toBe('DESC');
    });

    // The list read its project twice: once through
    // ReferenceBranchResolver.getScoringBranches for the branch partition, once
    // directly for its name. It now derives the partition from its own Get.
    describe('one ProjectService/Get per list', () => {
      const scopedTo = (branches: string[]) => [
        'andWhere',
        ['vulnDetection.branch IN (:...branches)', { branches }],
      ];

      const useHarness = (
        harness: ProjectLookupHarness,
        calls: QueryBuilderCalls,
      ) => {
        Object.assign(service, {
          scaVulnDetectRepo: makeEmptyRepository(calls),
          projectServiceClient: harness.projectServiceClient,
          referenceBranchResolver: harness.referenceBranchResolver,
          resultService: harness.resultService,
          scanServiceClient: {
            getLastScanStatus: () =>
              of({ scanId: '', state: '', createAt: '', scanType: '' }),
          },
          loadFixedVersionsByOsv: jest.fn().mockResolvedValue(new Map()),
          loadCveMap: jest.fn().mockResolvedValue(new Map()),
        });
      };

      const list = () =>
        service.getProjectScaVulnerabilities({
          projectId: 'p1',
          pageNumber: 1,
          pageSizeNumber: 10,
        } as GetProjectScaVulnerabilitiesRequest);

      it('calls projectServiceClient.get once, never getScoringBranches, and scopes the list and both counters to the same partition', async () => {
        const calls: QueryBuilderCalls = [];
        const harness = makeProjectLookupHarness({
          name: 'p',
          referenceBranch: 'develop',
        });
        useHarness(harness, calls);

        await list();

        expect(harness.get).toHaveBeenCalledTimes(1);
        expect(harness.getScoringBranches).not.toHaveBeenCalled();
        expect(calls).toContainEqual(scopedTo(['develop', '']));
        expect(harness.countByType).toHaveBeenCalledWith('p1', undefined, [
          'develop',
          '',
        ]);
        expect(harness.autofixCountByType).toHaveBeenCalledWith(
          'p1',
          undefined,
          ['develop', ''],
        );
      });

      it('fails as before when the Get fails, the list and its counters scoped to main/master', async () => {
        const calls: QueryBuilderCalls = [];
        const harness = makeProjectLookupHarness(
          Object.assign(new Error('14 UNAVAILABLE: gm down'), {
            code: status.UNAVAILABLE,
            details: 'gm down',
          }),
        );
        useHarness(harness, calls);

        const failure = await list().catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RpcException);
        expect((failure as RpcException).getError()).toEqual({
          code: status.UNAVAILABLE,
          message: 'gm down',
        });
        expect(calls).toContainEqual(scopedTo(['main', 'master', '']));
        expect(harness.countByType).toHaveBeenCalledWith('p1', undefined, [
          'main',
          'master',
          '',
        ]);
      });

      // The SCA Results page never reads the autofix counts
      // (the AutoFix page does): it asks the list not to compute them.
      it('does not call getAutofixCountByType when excludeAutofixCounts is set', async () => {
        const harness = makeProjectLookupHarness({
          name: 'p',
          referenceBranch: 'develop',
        });
        useHarness(harness, []);

        const res = await service.getProjectScaVulnerabilities({
          projectId: 'p1',
          pageNumber: 1,
          pageSizeNumber: 10,
          excludeAutofixCounts: true,
        } as GetProjectScaVulnerabilitiesRequest);

        expect(harness.autofixCountByType).not.toHaveBeenCalled();
        expect(res.autofixCountByType).toBeUndefined();
        expect(harness.countByType).toHaveBeenCalledTimes(1);
      });

      it('still returns the autofix counts without the flag', async () => {
        const harness = makeProjectLookupHarness({
          name: 'p',
          referenceBranch: 'develop',
        });
        useHarness(harness, []);

        const res = await list();

        expect(harness.autofixCountByType).toHaveBeenCalledTimes(1);
        expect(
          (res as { autofixCountByType?: unknown }).autofixCountByType,
        ).toBeDefined();
      });
    });

    // The gRPC server loads the proto with `defaults: true`, so
    // an absent pageNumber/pageSizeNumber arrives as 0 and the destructuring
    // defaults never apply. The public route is bounded by the gateway, which
    // now always sends a page size; analysis-reporting clamps what it gets.
    describe('page bounds', () => {
      const pageQb = (total: number) => {
        const qb: any = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          addSelect: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          addOrderBy: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(total),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      };

      const listWith = async (
        qb: any,
        page: { pageNumber: number; pageSizeNumber: number },
      ) => {
        (service as any).scaVulnDetectRepo = {
          createQueryBuilder: () => qb,
        };
        stubGrpcClients();
        stubResultServiceCounts();
        jest
          .spyOn(service as any, 'loadFixedVersionsByOsv')
          .mockResolvedValue(new Map());
        jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());
        // What the gRPC server hands over for a request without paging:
        // proto3 scalar defaults, not undefined.
        return service.getProjectScaVulnerabilities({
          projectId: 'p1',
          ...page,
          sort: '',
          order: '',
          severity: [],
          status: [],
          priority: [],
          searchQuery: '',
          packageType: [],
          exploitabilityVerdict: [],
        } as any);
      };

      it('pageNumber=0 is page 1: skip(0), never a negative OFFSET', async () => {
        const qb = pageQb(1271);

        const response = await listWith(qb, {
          pageNumber: 0,
          pageSizeNumber: 10,
        });

        expect(qb.skip).toHaveBeenCalledWith(0);
        expect(qb.take).toHaveBeenCalledWith(10);
        expect(response.page).toBe(1);
        expect(response.limit).toBe(10);
        expect(response.totalPages).toBe(128);
      });

      it('pageSizeNumber=100000 → take(500)', async () => {
        const qb = pageQb(1271);

        const response = await listWith(qb, {
          pageNumber: 1,
          pageSizeNumber: 100000,
        });

        expect(qb.take).toHaveBeenCalledWith(500);
        expect(response.limit).toBe(500);
        expect(response.totalPages).toBe(3);
      });

      it('keeps the 500 rows the IDE extension asks for in one call', async () => {
        const qb = pageQb(1271);

        await listWith(qb, { pageNumber: 2, pageSizeNumber: 500 });

        expect(qb.take).toHaveBeenCalledWith(500);
        expect(qb.skip).toHaveBeenCalledWith(500);
      });

      // policy-management's post-scan evaluation
      // (policy-evaluation.processor.ts, fetchAllVulnerabilities) calls this
      // RPC with no paging at all and evaluates every SCA detection. Defaulting
      // 0 to 10 rows (sorted low severity first) would let an SCA policy pass
      // on a project with a critical CVE. Paginate that caller before changing
      // this.
      it('pageSizeNumber=0 still returns the whole list (policy evaluation)', async () => {
        const qb = pageQb(1271);
        const rows = Array.from({ length: 1271 }, (_, i) => ({
          id: `d${i}`,
          projectId: 'p1',
          vulnerability: { id: `GHSA-${i}` },
          scaDetectedPackage: {
            packageName: 'lodash',
            packageVersion: '1.0.0',
          },
        }));
        qb.getMany.mockResolvedValue(rows);

        const response = await listWith(qb, {
          pageNumber: 0,
          pageSizeNumber: 0,
        });

        expect(qb.take).toHaveBeenCalledWith(0);
        expect(response.vulnerabilities).toHaveLength(1271);
      });
    });
    // The MCP list asks for the page only. The SCA list
    // otherwise reads the project, the last scan, the per-type and autofix
    // counters, the unused-reachability and malware counts, and every
    // history row (to compute hasCybeAnalysis, which the MCP item shows).
    describe('slim list for the MCP surface', () => {
      const makeQb = (rows: unknown[]) => {
        const qb: Record<string, jest.Mock> & { joins: string[] } = {
          joins: [],
        } as never;
        for (const m of [
          'innerJoin',
          'andWhere',
          'addSelect',
          'orderBy',
          'addOrderBy',
          'where',
          'skip',
          'take',
          'select',
          'distinct',
        ]) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.leftJoinAndSelect = jest.fn((relation: string) => {
          qb.joins.push(relation);
          return qb;
        });
        qb.getCount = jest.fn().mockResolvedValue(rows.length);
        qb.getMany = jest.fn().mockResolvedValue(rows);
        // The page flags query: d1 has an AI agent history row.
        qb.getRawMany = jest.fn().mockResolvedValue([{ id: 'd1' }]);
        return qb;
      };

      const list = async (
        slim: boolean | undefined,
        projectAnswer: () => Observable<unknown> = () => of({ name: 't' }),
      ) => {
        const rows = [
          {
            id: 'd1',
            projectId: 'p1',
            vulnerability: { id: 'GHSA-1', summary: 's' },
            scaDetectedPackage: {
              packageName: 'lodash',
              packageVersion: '1.0.0',
            },
          },
        ];
        const builders: ReturnType<typeof makeQb>[] = [];
        (service as unknown as Record<string, unknown>).scaVulnDetectRepo = {
          createQueryBuilder: () => {
            const qb = makeQb(builders.length === 0 ? rows : []);
            builders.push(qb);
            return qb;
          },
        };
        const projectGet = jest.fn(projectAnswer);
        const lastScan = jest.fn(() => of({ id: 's1' }));
        (service as unknown as Record<string, unknown>).projectServiceClient = {
          get: projectGet,
        };
        (service as unknown as Record<string, unknown>).scanServiceClient = {
          getLastScanStatus: lastScan,
        };
        stubResultServiceCounts();
        // Private page lookups, stubbed: the slim path does not change them.
        const loose = service as unknown as Record<string, unknown>;
        loose.loadFixedVersionsByOsv = jest.fn().mockResolvedValue(new Map());
        loose.loadCveMap = jest.fn().mockResolvedValue(new Map());
        const response = await service.getProjectScaVulnerabilities({
          projectId: 'p1',
          pageNumber: 1,
          pageSizeNumber: 20,
          slim,
        } as GetProjectScaVulnerabilitiesRequest);
        return { response, builders, projectGet, lastScan };
      };

      it('slim=true reads the page only, hasCybeAnalysis still right', async () => {
        const { response, builders, projectGet, lastScan } = await list(true);

        // One project read, for the branch scoping of the list: since
        // It is the list's own Get, not the resolver's. The slim
        // list never reads the project a second time.
        expect(projectGet).toHaveBeenCalledTimes(1);
        expect(lastScan).not.toHaveBeenCalled();
        expect(
          (resultService as unknown as Record<string, jest.Mock>)
            .getCountVulnerabilitiesCountByType,
        ).not.toHaveBeenCalled();
        expect(
          (resultService as unknown as Record<string, jest.Mock>)
            .getAutofixCountByType,
        ).not.toHaveBeenCalled();
        expect(builders[0].joins).not.toContain('vulnDetection.historyItems');
        // The list query and the page flags query: no count query.
        expect(builders).toHaveLength(2);
        expect(builders[1].getCount).not.toHaveBeenCalled();
        expect(response.total).toBe(1);
        expect(response.vulnerabilities[0].hasCybeAnalysis).toBe(true);
      });

      // The slim list still reads the project once, for the branch
      // scoping. A failed Get must fail it, as it fails the dashboard list,
      // never serve it scoped to the main/master fallback.
      it('slim=true fails with the Get when the project read fails', async () => {
        const failure = await list(true, () =>
          throwError(() =>
            Object.assign(new Error('14 UNAVAILABLE: gm down'), {
              code: status.UNAVAILABLE,
              details: 'gm down',
            }),
          ),
        ).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RpcException);
        expect((failure as RpcException).getError()).toEqual({
          code: status.UNAVAILABLE,
          message: 'gm down',
        });
      });

      it('without slim, the dashboard answer is unchanged', async () => {
        const { builders, projectGet, lastScan } = await list(undefined);

        expect(projectGet).toHaveBeenCalled();
        expect(lastScan).toHaveBeenCalled();
        expect(builders[0].joins).toContain('vulnDetection.historyItems');
      });
    });
  });

  describe('getProjectScaVulnerabilities – packageManager and packageSource filters', () => {
    const stubResultServiceCounts = () => {
      (resultService as any).getCountVulnerabilitiesCountByType = jest
        .fn()
        .mockResolvedValue({
          sast: 0,
          iac: 0,
          sca: 0,
          container: 0,
          cicd: 0,
          secret: 0,
        });
      (resultService as any).getAutofixCountByType = jest
        .fn()
        .mockResolvedValue({
          sast: { withAutofix: 0, withoutAutofix: 0 },
          iac: { withAutofix: 0, withoutAutofix: 0 },
          cicd: { withAutofix: 0, withoutAutofix: 0 },
          secret: { withAutofix: 0, withoutAutofix: 0 },
          sca: { withAutofix: 0, withoutAutofix: 0 },
        });
    };

    const stubGrpcClients = () => {
      (service as any).projectServiceClient = {
        get: () => of({ name: 't' }),
      };
      (service as any).scanServiceClient = {
        getLastScanStatus: () =>
          of({ scanId: '', state: '', createAt: '', scanType: '' }),
      };
    };

    it('applies IN filters for packageManager and packageSource when provided', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => qb,
      };
      stubGrpcClients();
      stubResultServiceCounts();
      jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(new Map());
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());

      await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentSeverity',
        order: 'ASC',
        severity: [],
        status: [],
        priority: [],
        searchQuery: '',
        packageType: '',
        exploitabilityVerdict: [],
        packageManager: ['npm', 'maven'],
        packageSource: ['package.json'],
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'scaPackage.ecosystem IN (:...packageManager)',
        { packageManager: ['npm', 'maven'] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'scaPackage.fileName IN (:...packageSource)',
        { packageSource: ['package.json'] },
      );
    });

    it('does NOT apply packageManager / packageSource filters when arrays are empty', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => qb,
      };
      stubGrpcClients();
      stubResultServiceCounts();
      jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(new Map());
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());

      await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentSeverity',
        order: 'ASC',
        severity: [],
        status: [],
        priority: [],
        searchQuery: '',
        packageType: '',
        exploitabilityVerdict: [],
        packageManager: [],
        packageSource: [],
      } as any);

      const andWhereCalls: string[] = qb.andWhere.mock.calls.map(
        (c: any[]) => c[0] as string,
      );
      expect(andWhereCalls).not.toContain(
        'scaPackage.ecosystem IN (:...packageManager)',
      );
      expect(andWhereCalls).not.toContain(
        'scaPackage.fileName IN (:...packageSource)',
      );
    });

    it('searchQuery also matches package ecosystem and manifest file name', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      (service as any).scaVulnDetectRepo = {
        createQueryBuilder: () => qb,
      };
      stubGrpcClients();
      stubResultServiceCounts();
      jest
        .spyOn(service as any, 'loadFixedVersionsByOsv')
        .mockResolvedValue(new Map());
      jest.spyOn(service as any, 'loadCveMap').mockResolvedValue(new Map());

      await service.getProjectScaVulnerabilities({
        projectId: 'p1',
        pageNumber: 1,
        pageSizeNumber: 10,
        sort: 'currentSeverity',
        order: 'ASC',
        severity: [],
        status: [],
        priority: [],
        searchQuery: 'npm',
        packageType: '',
        exploitabilityVerdict: [],
        packageManager: [],
        packageSource: [],
      } as any);

      const searchClause = qb.andWhere.mock.calls.find(
        (c: any[]) =>
          typeof c[0] === 'string' && c[0].includes('osv.summary LIKE :search'),
      );
      expect(searchClause).toBeDefined();
      expect(searchClause[0]).toContain('scaPackage.ecosystem LIKE :search');
      expect(searchClause[0]).toContain('scaPackage.fileName LIKE :search');
      expect(searchClause[1]).toEqual({ search: '%npm%' });
    });
  });

  describe('getProjectScaPackages packageManager/packageSource filter', () => {
    it('applies ecosystem/fileName IN filters when provided', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
      };
      scaDetectedRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectScaPackages({
        projectId: 'p1',
        branch: 'main',
        packageManager: ['npm'],
        packageSource: ['package.json'],
      } as any);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'pkg.ecosystem IN (:...packageManager)',
        { packageManager: ['npm'] },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        'pkg.fileName IN (:...packageSource)',
        { packageSource: ['package.json'] },
      );
    });

    it('does NOT add ecosystem/fileName clauses when filters are empty', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        getMany: jest.fn().mockResolvedValue([]),
      };
      scaDetectedRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.getProjectScaPackages({
        projectId: 'p1',
        branch: 'main',
        packageManager: [],
        packageSource: [],
      } as any);

      const clauses: string[] = qb.andWhere.mock.calls.map(
        (c: any[]) => c[0] as string,
      );
      expect(clauses).not.toContain('pkg.ecosystem IN (:...packageManager)');
      expect(clauses).not.toContain('pkg.fileName IN (:...packageSource)');
    });
  });

  describe('getScaFilterOptions', () => {
    it('returns distinct ecosystems/fileNames from VULNERABLE packages only, NULL/empty excluded, projectId + branch scoped', async () => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValueOnce([{ value: 'npm' }, { value: 'maven' }])
          .mockResolvedValueOnce([
            { value: 'package.json' },
            { value: 'pom.xml' },
          ]),
      };
      (service as any).scaVulnDetectRepo = { createQueryBuilder: () => qb };

      const result = await service.getScaFilterOptions({
        projectId: 'p1',
        branch: 'main',
      });

      expect(result.ecosystems).toEqual(['maven', 'npm']);
      expect(result.fileNames).toEqual(['package.json', 'pom.xml']);
      // options are sourced from packages that actually have vulnerabilities
      expect(qb.innerJoin).toHaveBeenCalledWith('v.scaDetectedPackage', 'pkg');
      // scoped to the project
      expect(qb.where).toHaveBeenCalledWith('v.projectId = :projectId', {
        projectId: 'p1',
      });
      // NULL / empty values are excluded (both columns)
      expect(qb.andWhere).toHaveBeenCalledWith('pkg.ecosystem IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith("pkg.ecosystem <> ''");
      expect(qb.andWhere).toHaveBeenCalledWith('pkg.fileName IS NOT NULL');
      expect(qb.andWhere).toHaveBeenCalledWith("pkg.fileName <> ''");
      // Branch scoped to the full logical partition (canonical
      // branch + legacy '' rows), matching the vuln list.
      expect(qb.andWhere).toHaveBeenCalledWith('v.branch IN (:...branches)', {
        branches: ['main', ''],
      });
    });

    it('rejects with INVALID_ARGUMENT when projectId is missing', async () => {
      await expect(
        service.getScaFilterOptions({ projectId: '' }),
      ).rejects.toMatchObject({ error: { code: status.INVALID_ARGUMENT } });
    });
  });

  // The license routes are guarded on the PROJECT, yet the
  // organization whose license policy applied came from the query string.
  describe('license overrides come from the project organization', () => {
    const overridesOf: Record<
      string,
      Array<{ spdxId: string; category: string }>
    > = {
      'org-own': [{ spdxId: 'MIT', category: 'WEAK_COPYLEFT' }],
      'org-other': [{ spdxId: 'MIT', category: 'STRONG_COPYLEFT' }],
    };

    // What the gateway used to forward: the caller's organizationId rides
    // along with the project, as the gRPC request still allows it.
    const fromQuery = <T extends object>(dto: T) => ({
      ...dto,
      organizationId: 'org-other',
    });

    beforeEach(() => {
      licenseOverrideRepo.find!.mockImplementation(
        async ({ where }) => overridesOf[where.organizationId] ?? [],
      );
      scaDetectedRepo.find!.mockResolvedValue([
        {
          id: 'pkg-1',
          packageName: 'lodash',
          packageVersion: '4.17.21',
          ecosystem: 'npm',
          licenses: ['MIT'],
          isDev: false,
          isTransitive: false,
          isLicenseIgnored: false,
        },
      ]);
    });

    it('getPackagesByLicense applies the project organization policy, not the query one', async () => {
      projectOrgResolver.resolveOrgId.mockResolvedValue('org-own');

      const res = await service.getPackagesByLicense(
        fromQuery({ projectId: 'p1', spdxId: 'MIT' }),
      );

      expect(projectOrgResolver.resolveOrgId).toHaveBeenCalledWith('p1');
      expect(res.category).toBe('WEAK_COPYLEFT');
      expect(licenseOverrideRepo.find).not.toHaveBeenCalledWith({
        where: { organizationId: 'org-other' },
      });
    });

    it('getProjectLicenseSummary applies the project organization policy, not the query one', async () => {
      projectOrgResolver.resolveOrgId.mockResolvedValue('org-own');

      const res = await service.getProjectLicenseSummary(
        fromQuery({ projectId: 'p1' }),
      );

      expect(res.licenses).toEqual([
        expect.objectContaining({ spdxId: 'MIT', category: 'WEAK_COPYLEFT' }),
      ]);
      expect(licenseOverrideRepo.find).not.toHaveBeenCalledWith({
        where: { organizationId: 'org-other' },
      });
    });

    it('applies no override when the project organization cannot be resolved', async () => {
      projectOrgResolver.resolveOrgId.mockResolvedValue(null);

      const res = await service.getPackagesByLicense(
        fromQuery({ projectId: 'p1', spdxId: 'MIT' }),
      );

      expect(res.category).toBe('PERMISSIVE');
      expect(licenseOverrideRepo.find).not.toHaveBeenCalled();
    });
  });

  // A batch of 50 packages asked global-management for the same
  // project 6 times — once for the reachability flags, then once per tranche of
  // 10 packages through the triage carry-over's branch scope — and read every
  // package of the branch only to log how many there were.
  describe('project context read once per batch', () => {
    const fiftyPackages: Library[] = Array.from({ length: 50 }, (_, i) => ({
      name: `pkg-${i}`,
      version: '1.0.0',
      file: 'package.json',
      ecosystem: 'npm',
      isTransitive: false,
      isDev: false,
      path: ['root'],
      importLocations: [],
      licenses: [],
    }));
    const batch = (): ScanAddScaResultRequest => ({
      projectId: 'p1',
      scanId: 's1',
      scannerName: 'scanlink-sca',
      isLastRequest: false,
      vulnerabilityType: 'ALL',
      packages: fiftyPackages,
    });

    let projectGet: jest.Mock;
    let getScoringBranches: jest.Mock;

    /** The branch partitions each triage carry-over query was scoped to. */
    const carryOverScopes = (): string[][] =>
      scaVulnRepo
        .find!.mock.calls.map(([options]) => options?.where)
        .filter((where) => where?.stateManuallyModified === true)
        // `In([...])` exposes its operands on `value`.
        .map((where) => where.branch.value);

    beforeEach(() => {
      projectGet = jest.fn(() =>
        of({
          scaReachabilityPriorityEnabled: true,
          scaReachabilityStatusEnabled: true,
        }),
      );
      const internals = service as unknown as {
        projectServiceClient: { get: jest.Mock };
        referenceBranchResolver: { getScoringBranches: jest.Mock };
      };
      internals.projectServiceClient = { get: projectGet };
      getScoringBranches = internals.referenceBranchResolver.getScoringBranches;

      scaDetectedRepo.find!.mockResolvedValue([]);
      scaDetectedRepo.findOne!.mockImplementation(async ({ where }) => ({
        id: `id-${where.packageName}`,
        projectId: where.projectId,
        packageName: where.packageName,
        packageVersion: where.packageVersion,
        ecosystem: 'npm',
        branch: where.branch,
        isDev: false,
        isTransitive: false,
      }));
      matcher.findMatchingVulnerabilities.mockResolvedValue([]);
    });

    it('asks global-management for the project once for 50 packages without a match', async () => {
      await service.processScaBatch(batch());

      expect(projectGet).toHaveBeenCalledTimes(1);
      expect(getScoringBranches).not.toHaveBeenCalled();
      // The batch's one tranche (five of 10 packages before the batching rewrite)
      // still ran its carry-over lookup, on the default partition derived
      // from that one read.
      expect(matcher.findMatchingVulnerabilities).toHaveBeenCalledTimes(50);
      expect(carryOverScopes()).toEqual([['main', 'master', '']]);
    });

    it('matches the 50 packages with one batched OSV lookup', async () => {
      await service.processScaBatch(batch());

      expect(
        matcher.findMatchingVulnerabilitiesForLibraries,
      ).toHaveBeenCalledTimes(1);
      const [libraries] =
        matcher.findMatchingVulnerabilitiesForLibraries.mock.calls[0];
      expect(libraries).toHaveLength(50);
      expect(libraries[0]).toEqual({
        name: 'pkg-0',
        version: '1.0.0',
        ecosystem: 'npm',
      });
    });

    it('never reads every package of the branch to build an unused map', async () => {
      await service.processScaBatch(batch());

      const wholeBranchReads = scaDetectedRepo.find!.mock.calls.filter(
        ([options]) => {
          const keys = Object.keys(options?.where ?? {}).sort();
          return keys.join(',') === 'branch,projectId';
        },
      );
      expect(wholeBranchReads).toEqual([]);
      // The 50 packages were still upserted, once each, in one statement.
      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.values.mock.calls[0][0]).toHaveLength(50);
    });
  });
  // The packages of a batch were upserted one by one, each
  // INSERT followed by TypeORM's re-SELECT and a findOne by unique key, and
  // sometimes a save to OR the dev/transitive flags: 3 to 4 round trips per
  // package. One multi-row upsert and one SELECT now serve the batch.
  describe('package upsert in one statement', () => {
    const packageOf = (i: number, over: Partial<Library> = {}): Library => ({
      name: `pkg-${String(i).padStart(2, '0')}`,
      version: '1.0.0',
      file: 'package.json',
      ecosystem: 'npm',
      isTransitive: false,
      isDev: false,
      path: ['root'],
      importLocations: [],
      licenses: [],
      ...over,
    });
    const batchOf = (packages: Library[]): ScanAddScaResultRequest => ({
      projectId: 'p1',
      scanId: 's1',
      scannerName: 'scanlink-sca',
      isLastRequest: false,
      vulnerabilityType: 'ALL',
      packages,
    });

    /** The rows "MySQL" holds, by (lowercased name, version) as the collation. */
    let stored: Map<string, Record<string, unknown>>;
    const keyOf = (name: string, version: string) =>
      `${name.toLowerCase()}@${version.toLowerCase()}`;

    /** The INSERT statements, each with the rows it carried. */
    const inserts = (): Array<Array<Record<string, unknown>>> =>
      mockQueryBuilder.values.mock.calls.map(([rows]: [unknown]) =>
        Array.isArray(rows) ? rows : [rows],
      );

    /** The packages the batch handed to the OSV lookup. */
    const matched = (): string[] =>
      matcher.findMatchingVulnerabilitiesForLibraries.mock.calls.flatMap(
        ([libraries]: [Array<{ name: string }>]) =>
          libraries.map((l) => l.name),
      );

    beforeEach(() => {
      stored = new Map();
      // The upsert: every row lands in `stored` (an existing key keeps its
      // id and its stored name), as ON DUPLICATE KEY UPDATE does.
      mockQueryBuilder.execute.mockImplementation(async () => {
        const rows = mockQueryBuilder.values.mock.calls.at(-1)[0];
        for (const row of Array.isArray(rows) ? rows : [rows]) {
          const key = keyOf(row.packageName, row.packageVersion);
          const held = stored.get(key);
          stored.set(key, {
            ...row,
            id: held?.id ?? `id-${row.packageName}`,
            packageName: held?.packageName ?? row.packageName,
          });
        }
        return { identifiers: [], generatedMaps: [] };
      });
      // The re-association SELECT: projectId, branch, packageName IN (...).
      scaDetectedRepo.find!.mockImplementation(async ({ where }) => {
        const names: string[] = where?.packageName?.value ?? [];
        return [...stored.values()].filter((row) =>
          names.some(
            (n) => n.toLowerCase() === String(row.packageName).toLowerCase(),
          ),
        );
      });
      scaDetectedRepo.findOne!.mockResolvedValue(null);
    });

    it('upserts 50 packages in one INSERT without reloading it, and finds them with one SELECT', async () => {
      const packages = Array.from({ length: 50 }, (_, i) => packageOf(49 - i));

      await service.processScaBatch(batchOf(packages));

      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.updateEntity).toHaveBeenCalledWith(false);
      expect(inserts()).toHaveLength(1);
      // Sorted by the unique key, so that two consumers take their gap
      // locks in the same order.
      expect(inserts()[0].map((r) => r.packageName)).toEqual(
        Array.from({ length: 50 }, (_, i) => packageOf(i).name),
      );
      expect(scaDetectedRepo.findOne).not.toHaveBeenCalled();
      const selects = scaDetectedRepo.find!.mock.calls.filter(
        ([o]) => o?.where?.packageName,
      );
      expect(selects).toHaveLength(1);
      expect(selects[0][0].where).toMatchObject({
        projectId: 'p1',
        branch: '',
      });
      // Every package reached the OSV lookup, in the order it came.
      expect(matched()).toEqual(packages.map((p) => p.name));
    });

    it('updates isDev and isTransitive to what this scan saw, never ORs them with the stored row', async () => {
      stored.set(keyOf('pkg-00', '1.0.0'), {
        id: 'id-existing',
        packageName: 'pkg-00',
        packageVersion: '1.0.0',
        isDev: true,
        isTransitive: true,
      });

      await service.processScaBatch(batchOf([packageOf(0)]));

      expect(mockQueryBuilder.orUpdate.mock.calls[0][0]).toEqual(
        expect.arrayContaining(['isDev', 'isTransitive']),
      );
      expect(inserts()[0][0]).toMatchObject({
        isDev: false,
        isTransitive: false,
      });
      // No second write turning the flags back on.
      expect(scaDetectedRepo.save).not.toHaveBeenCalled();
      expect(stored.get(keyOf('pkg-00', '1.0.0'))).toMatchObject({
        id: 'id-existing',
        isDev: false,
        isTransitive: false,
      });
    });

    it('finds a package stored under another case without a per-package read', async () => {
      stored.set(keyOf('lodash', '4.17.21'), {
        id: 'id-lodash',
        packageName: 'lodash',
        packageVersion: '4.17.21',
      });

      await service.processScaBatch(
        batchOf([packageOf(0, { name: 'LoDash', version: '4.17.21' })]),
      );

      expect(scaDetectedRepo.findOne).not.toHaveBeenCalled();
      // The stored row (its id and its name) is what the batch goes on with.
      expect(matched()).toEqual(['lodash']);
    });

    it('retries once on a deadlock, without falling back to one row at a time', async () => {
      const upsert = mockQueryBuilder.execute.getMockImplementation();
      mockQueryBuilder.execute.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Deadlock found'), {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
        });
      });
      mockQueryBuilder.execute.mockImplementation(upsert);

      await service.processScaBatch(
        batchOf(Array.from({ length: 50 }, (_, i) => packageOf(i))),
      );

      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(2);
      expect(inserts().map((rows) => rows.length)).toEqual([50, 50]);
      expect(matched()).toHaveLength(50);
    });

    it('falls back to one row at a time on another error, so one bad package loses only itself', async () => {
      const upsert = mockQueryBuilder.execute.getMockImplementation();
      mockQueryBuilder.execute.mockImplementation(async () => {
        const rows = mockQueryBuilder.values.mock.calls.at(-1)[0];
        const list = Array.isArray(rows) ? rows : [rows];
        if (list.some((row) => row.packageName === 'pkg-13')) {
          throw Object.assign(
            new Error("Data too long for column 'importLocations' at row 14"),
            { code: 'ER_DATA_TOO_LONG', errno: 1406 },
          );
        }
        return upsert();
      });

      await service.processScaBatch(
        batchOf(Array.from({ length: 50 }, (_, i) => packageOf(i))),
      );

      // 1 multi-row attempt, then 50 single-row upserts.
      expect(inserts().map((rows) => rows.length)).toEqual([
        50,
        ...Array.from({ length: 50 }, () => 1),
      ]);
      expect(matched()).toHaveLength(49);
      expect(matched()).not.toContain('pkg-13');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[SCA] INCOMPLETE RESULTS: 1/50 package(s) failed to persist',
        ),
      );
    });

    it('reads a package back by its unique key when the SELECT cannot tell its row in JS', async () => {
      // Outside printable ASCII the collation decides (accents are equal
      // under utf8mb4_0900_ai_ci), so the package is read back by key.
      scaDetectedRepo.findOne!.mockResolvedValue({
        id: 'id-lodash',
        projectId: 'p1',
        packageName: 'lodash',
        packageVersion: '1.0.0',
        ecosystem: 'npm',
      });

      await service.processScaBatch(
        batchOf([packageOf(0), packageOf(1, { name: 'lödash' })]),
      );

      expect(scaDetectedRepo.findOne).toHaveBeenCalledTimes(1);
      expect(scaDetectedRepo.findOne).toHaveBeenCalledWith({
        where: {
          projectId: 'p1',
          packageName: 'lödash',
          packageVersion: '1.0.0',
          branch: '',
        },
      });
      expect(matched()).toEqual(['pkg-00', 'lodash']);
    });
  });
});
