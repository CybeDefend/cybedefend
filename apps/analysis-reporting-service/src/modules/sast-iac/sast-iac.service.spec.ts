import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { SastIacService } from './sast-iac.service';
import { effectiveSeveritySql } from '../cvss/effective-severity-sql';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { CatalogRule, SastIacUtilsService } from './sast-iac.utils';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { DIFF_SCAN_SINK } from '../../edition/ports/diff-scan-sink.port';
import { Logger } from 'nestjs-pino';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import {
  GetProjectCicdVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectSecretVulnerabilitiesRequest,
  InlineIgnoreDirective,
  ScanAddResultRequest,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import {
  makeEmptyRepository,
  makeProjectLookupHarness,
  ProjectLookupHarness,
} from '../../test-utils/project-lookup.harness';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';

import { of, throwError } from 'rxjs';

describe('SastIacService.getProjectSastVulnerabilities — severity filter', () => {
  let service: SastIacService;
  let andWhereMock: jest.Mock;
  let sastRepo: any;

  beforeEach(async () => {
    andWhereMock = jest.fn().mockReturnThis();
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: andWhereMock,
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    sastRepo = createMockRepository();
    sastRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

    const projectClient = {
      get: jest.fn().mockReturnValue(of({ id: 'proj-1', name: 'Test' })),
      getById: jest.fn().mockReturnValue(of({})),
      getLastScanStatus: jest
        .fn()
        .mockReturnValue(of({ scanId: 'scan-1', status: 'completed' })),
    };
    const globalMgmtGrpc = {
      getService: jest.fn().mockReturnValue(projectClient),
    };
    const securityScanningGrpc = {
      getService: jest.fn().mockReturnValue(projectClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: globalMgmtGrpc,
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: securityScanningGrpc,
        },
        {
          provide: 'AGENT_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue({}) },
        },
        {
          provide: ResultService,
          useValue: {
            getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({}),
            getAutofixCountByType: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: SastIacUtilsService,
          useValue: {
            getExistingVulnerabilities: jest.fn(),
            processVulnerability: jest.fn(),
            finalizeOldScanVulnerabilities: jest.fn(),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: sastRepo,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();
    await module.init();

    service = module.get(SastIacService);
  });

  it('filters by the live env-derived severity band and lowercases severity values', async () => {
    await service.getProjectSastVulnerabilities({
      projectId: 'proj-1',
      severity: ['HIGH', 'MEDIUM'],
      pageNumber: 1,
      pageSizeNumber: 10,
    } as any);

    expect(andWhereMock).toHaveBeenCalledWith(
      `${effectiveSeveritySql('vulnDetection')} IN (:...severity)`,
      { severity: ['high', 'medium'] },
    );
  });

  it('does not add severity filter when severity array is empty', async () => {
    await service.getProjectSastVulnerabilities({
      projectId: 'proj-1',
      severity: [],
      pageNumber: 1,
      pageSizeNumber: 10,
    } as any);

    const coalesceCallArgs = andWhereMock.mock.calls.find((args) =>
      String(args[0]).includes('effective_severity'),
    );
    expect(coalesceCallArgs).toBeUndefined();
  });
});

describe('SastIacService.addScanResult', () => {
  let service: SastIacService;
  let utils: {
    resolveCatalogRules: jest.Mock;
    getExistingVulnerabilities: jest.Mock;
    processVulnerability: jest.Mock;
    finalizeOldScanVulnerabilities: jest.Mock;
    loadCurrentScanSightings: jest.Mock;
  };
  let logger: any;
  // What the scan sighted, read once for the inline finalization.
  const sightings = { ids: new Set<string>(), detections: [] };

  beforeEach(async () => {
    logger = createLoggerMock();
    utils = {
      resolveCatalogRules: jest.fn().mockResolvedValue(new Map()),
      getExistingVulnerabilities: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
        existingVulnsMap: new Map(),
      }),
      processVulnerability: jest.fn().mockResolvedValue(undefined),
      finalizeOldScanVulnerabilities: jest.fn().mockResolvedValue(undefined),
      loadCurrentScanSightings: jest.fn().mockResolvedValue(sightings),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ResultService, useValue: {} },
        { provide: SastIacUtilsService, useValue: utils },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: logger },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
        {
          provide: DIFF_SCAN_SINK,
          useValue: { ingestBatch: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(SastIacService);
    // Default: a readable, non-diff scan. Specific tests override getScan to
    // return a diff scan, null, or an error.
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ branch: 'main' })),
    };
  });

  it('deduplicates IAC vulnerabilities and processes unique items only', async () => {
    const dto = {
      scanId: 'scan1',
      projectId: 'p1',
      vulnerabilityType: 'iac',
      scannerName: 'KICS',
      vulnerabilities: [
        {
          ruleId: 'R1',
          path: 'a.tf',
          language: 'hcl',
          codeSnippet: { vulnerableStartLine: 1, vulnerableEndLine: 2 },
          fileHash: 'hash',
        },
        {
          ruleId: 'R1',
          path: 'a.tf',
          language: 'hcl',
          codeSnippet: { vulnerableStartLine: 1, vulnerableEndLine: 2 },
          fileHash: 'hash',
        },
      ],
      isLastRequest: false,
    } as any;

    const res = await service.addScanResult(dto);
    expect(res.success).toBe(true);
    // Only unique item processed once
    expect(utils.processVulnerability).toHaveBeenCalledTimes(1);
    // No finalize when not last
    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  it('finalizes old scan vulnerabilities on last batch', async () => {
    const dto = {
      scanId: 'scan2',
      projectId: 'p1',
      vulnerabilityType: 'sast',
      scannerName: 'semgrep',
      vulnerabilities: [],
      isLastRequest: true,
    } as any;

    const res = await service.addScanResult(dto);
    expect(res.success).toBe(true);
    // Finalize called twice (once for SAST, once for IAC)
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledTimes(2);
  });

  // a diff scan's findings are routed to the isolated
  // ephemeral store (diff_scan_finding) — they must NEVER enter the real
  // detection tables, so the normal ingestion (getExistingVulnerabilities /
  // processVulnerability / finalize) is skipped entirely.
  it('routes diff-scan findings to the ephemeral store and skips normal ingestion', async () => {
    const diff = (service as any).diffScanSink as {
      ingestBatch: jest.Mock;
    };
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ isDiffScan: true })),
    };

    const dto = {
      scanId: 'scan-diff',
      projectId: 'p1',
      vulnerabilityType: 'sast',
      scannerName: 'opengrep',
      vulnerabilities: [
        { ruleId: 'R1', path: 'app.py', severity: 'HIGH', name: 'SQLi' },
      ],
      isLastRequest: true,
    } as any;

    const res = await service.addScanResult(dto);

    expect(res.success).toBe(true);
    // The sink takes the raw request; it resolves the scanner
    // category itself and reads the severities from the request.
    expect(diff.ingestBatch).toHaveBeenCalledWith(
      dto,
      dto.vulnerabilities,
      // The catalogue code per rule id (R1 has none here).
      new Map([['R1', null]]),
      // The scanner, whose twins the store merges.
      'opengrep',
    );
    // Normal ingestion + finalize must NOT run for a diff scan.
    expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
    expect(utils.processVulnerability).not.toHaveBeenCalled();
    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  // Diff-scan fail-safe (mirrors finalizeScan): the only signal that a batch
  // belongs to a diff scan is the getScan call. If it can't be read, defaulting
  // to a non-diff scan would route the diff findings into the real detection
  // tables. Throw (force a retry) and ingest NOTHING rather than pollute.
  it('throws and skips all ingestion when the scan record is unavailable (no real-table leak)', async () => {
    const diff = (service as any).diffScanSink as {
      ingestBatch: jest.Mock;
    };
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of(null)),
    };

    const dto = {
      scanId: 'scan-unknown',
      projectId: 'p1',
      vulnerabilityType: 'sast',
      scannerName: 'opengrep',
      vulnerabilities: [{ ruleId: 'R1', path: 'app.py', severity: 'HIGH' }],
      isLastRequest: true,
    } as any;

    await expect(service.addScanResult(dto)).rejects.toBeDefined();
    expect(diff.ingestBatch).not.toHaveBeenCalled();
    expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
    expect(utils.processVulnerability).not.toHaveBeenCalled();
    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  // a missing DIFF_SCAN_SINK must fail LOUD, not
  // silently return success with zero findings stored (data loss).
  it('throws INTERNAL when the diff-scan sink is unavailable (no silent data-loss)', async () => {
    (service as any).diffScanSink = undefined;
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ isDiffScan: true })),
    };

    const dto = {
      scanId: 'scan-diff',
      projectId: 'p1',
      vulnerabilityType: 'sast',
      scannerName: 'opengrep',
      vulnerabilities: [{ ruleId: 'R1', path: 'app.py', severity: 'HIGH' }],
      isLastRequest: true,
    } as any;

    await expect(service.addScanResult(dto)).rejects.toMatchObject({
      error: expect.objectContaining({ code: 13 }), // status.INTERNAL
    });
  });

  it('finalizes CICD detections on the inline last batch too', async () => {
    utils.getExistingVulnerabilities.mockResolvedValue({
      existingSastVulns: [],
      existingIacVulns: [],
      existingCicdVulns: [{ id: 'cicd-1' }],
      existingVulnsMap: new Map(),
    });

    const dto = {
      scanId: 'scan3',
      projectId: 'p1',
      vulnerabilityType: 'sast',
      scannerName: 'gitleaks',
      vulnerabilities: [],
      isLastRequest: true,
    } as any;

    const res = await service.addScanResult(dto);
    expect(res.success).toBe(true);
    // SAST + IAC + the gated CICD call.
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledTimes(3);
    // finalization is now branch-scoped — the inline path reads
    // the branch from the (default) getScan mock ('main') and forwards it.
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
      [{ id: 'cicd-1' }],
      [],
      'p1',
      'scan3',
      'main',
      sightings,
    );
    // Read once, after the batch, and shared by the 3 calls.
    expect(utils.loadCurrentScanSightings).toHaveBeenCalledTimes(1);
    expect(utils.loadCurrentScanSightings).toHaveBeenCalledWith(
      'p1',
      'scan3',
      'main',
    );
    for (const call of utils.finalizeOldScanVulnerabilities.mock.calls) {
      expect(call[5]).toBe(sightings);
    }
  });
});

/**
 * The scanner no longer drops an issue carrying a
 * `cybedefend-ignore` directive: it attaches the directive and the platform
 * decides, against the catalogue code of the rule the issue resolves to. The
 * decision is taken once per batch, before the diff/full split, so both paths
 * see the same kept list.
 */
describe('SastIacService — cybedefend-ignore decided by the platform', () => {
  type Internals = {
    scanServiceClient: { getScan: jest.Mock };
    computeOccurrenceIndexes: (
      vulns: VulnerabilityDtoRequest[],
      scanId: string,
      scannerNameLowerCase: string,
    ) => Promise<(number | null)[]>;
    processVulnsWithConcurrency: (
      vulns: VulnerabilityDtoRequest[],
      ...rest: unknown[]
    ) => Promise<void>;
  };

  let service: SastIacService;
  let internals: Internals;
  let utils: {
    resolveCatalogRules: jest.Mock;
    resolveCatalogVulnIds: jest.Mock;
    getExistingVulnerabilities: jest.Mock;
    processVulnerability: jest.Mock;
    finalizeOldScanVulnerabilities: jest.Mock;
    loadCurrentScanSightings: jest.Mock;
  };
  let diff: { ingestBatch: jest.Mock };
  let logger: ReturnType<typeof createLoggerMock>;

  /** Never logged: a reason is free text copied from the customer's code. */
  const REASON = 'reason-text-from-the-source-file';

  const bare = (line = 9): InlineIgnoreDirective => ({
    codes: [],
    allRules: true,
    reason: REASON,
    line,
  });
  const scoped = (codes: string[], line = 10): InlineIgnoreDirective => ({
    codes,
    allRules: false,
    reason: REASON,
    line,
  });

  const issue = (
    ruleId: string,
    line: number,
    inlineIgnores: InlineIgnoreDirective[] = [],
  ): VulnerabilityDtoRequest => ({
    ruleId,
    language: 'hcl',
    cwe: [],
    owaspTop10: [],
    name: ruleId,
    description: '',
    severity: 'HIGH',
    confidence: 'HIGH',
    path: 'main.tf',
    fileHash: 'hash',
    codeSnippet: {
      vulnerableStartLine: line,
      vulnerableEndLine: line + 2,
      startLine: line,
      endLine: line + 2,
      code: [{ line, content: 'resource "aws_s3_bucket" "b" {' }],
      language: 'hcl',
      path: 'main.tf',
    },
    dataFlow: [],
    inlineIgnores,
  });

  const request = (
    vulnerabilities: VulnerabilityDtoRequest[],
    over: Partial<ScanAddResultRequest> = {},
  ): ScanAddResultRequest =>
    ({
      scanId: 'scan-1',
      projectId: 'p1',
      scannerName: 'KICS',
      vulnerabilityType: 'iac',
      vulnerabilities,
      isLastRequest: false,
      ...over,
    }) as ScanAddResultRequest;

  /** What every catalogue rule of these fixtures carries besides its identity. */
  const catalogueDefaults = {
    name: 'Catalogue name',
    severity: 'HIGH',
    cwe: [] as string[],
  };

  /** kics: CKV_AWS_20 is CD-IAC-0123, CKV_AWS_21 is CD-IAC-0124. */
  const kicsCatalogue = (): Map<string, CatalogRule> =>
    new Map([
      [
        'CKV_AWS_20',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-20',
          code: 'CD-IAC-0123',
          vulnerabilityType: 'iac',
        },
      ],
      [
        'CKV_AWS_21',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-21',
          code: 'CD-IAC-0124',
          vulnerabilityType: 'iac',
        },
      ],
    ]);

  /**
   * gitleaks: aws-access-token is CD-SECRET-0007; generic-api-key has a
   * correspondance row without a catalogue code.
   */
  const gitleaksCatalogue = (): Map<string, CatalogRule> =>
    new Map([
      [
        'aws-access-token',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-aws',
          code: 'CD-SECRET-0007',
          vulnerabilityType: 'secret',
        },
      ],
      [
        'generic-api-key',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-generic',
          code: null,
          vulnerabilityType: 'secret',
        },
      ],
    ]);

  /** The plaintext of every gitleaks issue below: never logged. */
  const SECRET_VALUE = 'AKIAIOSFODNN7EXAMPLE';

  /** A gitleaks issue: a credential in `.env`. */
  const secretIssue = (
    line: number,
    inlineIgnores: InlineIgnoreDirective[] = [],
    ruleId = 'aws-access-token',
  ): VulnerabilityDtoRequest => ({
    ...issue(ruleId, line, inlineIgnores),
    path: '.env',
    secretValue: SECRET_VALUE,
  });

  const gitleaksRequest = (
    vulnerabilities: VulnerabilityDtoRequest[],
    over: Partial<ScanAddResultRequest> = {},
  ) =>
    request(vulnerabilities, {
      scannerName: 'gitleaks',
      vulnerabilityType: 'critical,high,medium,low',
      ...over,
    });

  const processedLines = () =>
    utils.processVulnerability.mock.calls.map(
      (c: [VulnerabilityDtoRequest]) => c[0].codeSnippet.vulnerableStartLine,
    );

  /**
   * opengrep: a rule that detects a hard-coded credential is routed to the
   * secret family (`correspondance_table.vulnerabilityType`), the other one
   * to SAST.
   */
  const opengrepCatalogue = (): Map<string, CatalogRule> =>
    new Map([
      [
        'hardcoded-aws-key',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-key',
          code: 'CD-SECRET-0042',
          vulnerabilityType: 'secret',
        },
      ],
      [
        'eval-detected',
        {
          ...catalogueDefaults,
          vulnerabilityId: 'V-eval',
          code: 'CD-SAST-0001',
          vulnerabilityType: 'sast',
        },
      ],
    ]);

  const processedRuleIds = () =>
    utils.processVulnerability.mock.calls.map(
      (c: [VulnerabilityDtoRequest]) => c[0].ruleId,
    );

  beforeEach(async () => {
    logger = createLoggerMock();
    utils = {
      resolveCatalogRules: jest.fn().mockResolvedValue(kicsCatalogue()),
      resolveCatalogVulnIds: jest.fn().mockResolvedValue(new Map()),
      getExistingVulnerabilities: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
        existingVulnsMap: new Map(),
      }),
      processVulnerability: jest.fn().mockResolvedValue(undefined),
      finalizeOldScanVulnerabilities: jest.fn().mockResolvedValue(undefined),
      loadCurrentScanSightings: jest
        .fn()
        .mockResolvedValue({ ids: new Set(), detections: [] }),
    };
    diff = { ingestBatch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ResultService, useValue: {} },
        { provide: SastIacUtilsService, useValue: utils },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: logger },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
        { provide: DIFF_SCAN_SINK, useValue: diff },
      ],
    }).compile();

    service = module.get(SastIacService);
    internals = service as unknown as Internals;
    internals.scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ branch: 'main' })),
    };
  });

  describe('full scan', () => {
    it('drops a neutralised issue before the occurrence ranking and the processing', async () => {
      const ranked = jest.spyOn(internals, 'computeOccurrenceIndexes');
      const processed = jest.spyOn(internals, 'processVulnsWithConcurrency');
      const ignored = issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]);
      const kept = issue('CKV_AWS_21', 40);

      const res = await service.processSastIacBatch(request([ignored, kept]));

      expect(res.success).toBe(true);
      // Occurrence indexes (hence twin fingerprints) are computed as if the
      // scanner had never sent the neutralised issue — as before inline directives existed.
      expect(ranked).toHaveBeenCalledTimes(1);
      expect(ranked.mock.calls[0][0]).toEqual([kept]);
      expect(processed).toHaveBeenCalledTimes(1);
      expect(processed.mock.calls[0][0]).toEqual([kept]);
      expect(processedRuleIds()).toEqual(['CKV_AWS_21']);
    });

    it('resolves the batch once: the occurrence ranking reuses the resolution', async () => {
      await service.processSastIacBatch(
        request([
          issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]),
          issue('CKV_AWS_21', 40),
        ]),
      );

      expect(utils.resolveCatalogRules).toHaveBeenCalledTimes(1);
      expect(utils.resolveCatalogRules).toHaveBeenCalledWith(
        ['CKV_AWS_20', 'CKV_AWS_21'],
        'kics',
      );
      expect(utils.resolveCatalogVulnIds).not.toHaveBeenCalled();
    });

    it('drops a kics issue resolved to an IaC rule under the bare form', async () => {
      await service.processSastIacBatch(
        request([issue('CKV_AWS_20', 10, [bare()]), issue('CKV_AWS_21', 40)]),
      );

      expect(processedRuleIds()).toEqual(['CKV_AWS_21']);
    });

    it.each<[string, InlineIgnoreDirective[]]>([
      ['a directive naming another code', [scoped(['CD-IAC-0124'])]],
      ['a directive naming the scanner id', [scoped(['CKV_AWS_20'])]],
      [
        'a directive naming a KICS query id',
        [scoped(['a227ec01-f97a-4084-91a4-47b350c1db54'])],
      ],
    ])('keeps an issue under %s', async (_label, directives) => {
      await service.processSastIacBatch(
        request([issue('CKV_AWS_20', 10, directives)]),
      );

      expect(processedRuleIds()).toEqual(['CKV_AWS_20']);
    });

    it('completes normally, finalization included, when every issue is neutralised', async () => {
      const res = await service.addScanResult(
        request(
          [
            issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]),
            issue('CKV_AWS_21', 40, [bare()]),
          ],
          { isLastRequest: true },
        ),
      );

      expect(res.success).toBe(true);
      expect(utils.processVulnerability).not.toHaveBeenCalled();
      // SAST + IaC finalization still runs: an existing finding matched by a
      // now-neutralised issue is auto-resolved, as when the scanner dropped it.
      expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledTimes(2);
    });

    // A secret follows the same rules as any other finding.
    it('drops a gitleaks secret under its CD-SECRET code or the bare form, and keeps the others', async () => {
      utils.resolveCatalogRules.mockResolvedValue(gitleaksCatalogue());
      const ranked = jest.spyOn(internals, 'computeOccurrenceIndexes');

      const res = await service.processSastIacBatch(
        gitleaksRequest([
          secretIssue(3, [scoped(['cd-secret-0007'])]),
          secretIssue(7, [bare()]),
          // Another code, the scanner's rule id: not this rule.
          secretIssue(11, [scoped(['CD-SECRET-0008'])]),
          secretIssue(15, [scoped(['aws-access-token'])]),
          secretIssue(19, [scoped(['gitleaks-aws-access-token'])]),
          secretIssue(23),
        ]),
      );

      expect(res.success).toBe(true);
      expect(processedLines()).toEqual([11, 15, 19, 23]);
      // Dropped before the occurrence ranking, as any neutralised issue.
      expect(
        ranked.mock.calls[0][0].map((v) => v.codeSnippet.vulnerableStartLine),
      ).toEqual([11, 15, 19, 23]);
    });

    it('drops a gitleaks secret whose rule has no catalogue code under the bare form only', async () => {
      utils.resolveCatalogRules.mockResolvedValue(gitleaksCatalogue());

      await service.processSastIacBatch(
        gitleaksRequest([
          secretIssue(3, [bare()], 'generic-api-key'),
          secretIssue(7, [scoped(['CD-SECRET-0007'])], 'generic-api-key'),
          secretIssue(11, [scoped(['generic-api-key'])], 'generic-api-key'),
          // No correspondance row at all.
          secretIssue(15, [bare()], 'uncatalogued-token'),
          secretIssue(19, [scoped(['CD-SECRET-0007'])], 'uncatalogued-token'),
        ]),
      );

      expect(processedLines()).toEqual([7, 11, 19]);
    });

    it('drops an issue of another scanner resolved to a secret-typed rule, as any other', async () => {
      utils.resolveCatalogRules.mockResolvedValue(opengrepCatalogue());

      await service.processSastIacBatch(
        request(
          [
            issue('hardcoded-aws-key', 10, [bare()]),
            issue('hardcoded-aws-key', 20, [scoped(['CD-SECRET-0042'])]),
            issue('hardcoded-aws-key', 30, [scoped(['hardcoded-aws-key'])]),
            issue('eval-detected', 40, [bare()]),
          ],
          { scannerName: 'opengrep', vulnerabilityType: 'sast' },
        ),
      );

      expect(processedLines()).toEqual([30]);
    });
  });

  describe('diff scan', () => {
    beforeEach(() => {
      internals.scanServiceClient = {
        getScan: jest.fn().mockReturnValue(of({ isDiffScan: true })),
      };
    });

    const diffRequest = (vulnerabilities: VulnerabilityDtoRequest[]) =>
      request(vulnerabilities, {
        scanId: 'scan-d',
        vulnerabilityType: 'critical,high,medium,low',
      });

    // The store needs the rule's type as well as its code: it scrubs the
    // snippet of a rule raised as a secret.
    it('stores only the kept issues, each with its catalogue rule', async () => {
      const ignored = issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]);
      // A directive naming another rule's code does not cover this one.
      const kept = issue('CKV_AWS_21', 40, [scoped(['CD-IAC-0123'])]);
      const uncatalogued = issue('CKV_CUSTOM_1', 70);

      const res = await service.processSastIacBatch(
        diffRequest([ignored, kept, uncatalogued]),
      );

      expect(res.success).toBe(true);
      expect(diff.ingestBatch).toHaveBeenCalledTimes(1);
      // The sink takes the raw request and the scanner name; the
      // category is resolved inside the sink (see diff-scan-sink.adapter.spec).
      const [req, stored, rules, scanner] = diff.ingestBatch.mock.calls[0];
      expect([req.scanId, req.projectId, scanner]).toEqual([
        'scan-d',
        'p1',
        'kics',
      ]);
      expect(stored).toEqual([kept, uncatalogued]);
      expect(rules.get('CKV_AWS_21')).toEqual({
        ...catalogueDefaults,
        vulnerabilityId: 'V-21',
        code: 'CD-IAC-0124',
        vulnerabilityType: 'iac',
      });
      expect(rules.get('CKV_CUSTOM_1') ?? null).toBeNull();
      expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
      expect(utils.processVulnerability).not.toHaveBeenCalled();
    });

    it('keys the rules by the rule id as reported, resolved on its last segment', async () => {
      utils.resolveCatalogRules.mockResolvedValue(opengrepCatalogue());
      const dotted = issue('python.lang.security.audit.eval-detected', 3);

      await service.processSastIacBatch(
        request([dotted], {
          scanId: 'scan-d',
          scannerName: 'opengrep',
          vulnerabilityType: 'critical,high',
        }),
      );

      const rules = diff.ingestBatch.mock.calls[0][2];
      expect(rules.get('python.lang.security.audit.eval-detected')).toEqual({
        ...catalogueDefaults,
        vulnerabilityId: 'V-eval',
        code: 'CD-SAST-0001',
        vulnerabilityType: 'sast',
      });
    });

    // The store keeps only what the full scan would raise, so it
    // needs the severities the scan asked for, the ones the full scan reads.
    // They travel on the request (`vulnerabilityType`).
    it('hands the store the severities the scan asked for', async () => {
      await service.processSastIacBatch(diffRequest([issue('CKV_AWS_21', 40)]));

      expect(diff.ingestBatch.mock.calls[0][0].vulnerabilityType).toBe(
        'critical,high,medium,low',
      );
    });

    // Twins are two rules of ONE scanner, and kics and checkov both
    // land in the `iac` category: the store needs the scanner itself.
    it('hands the store the scanner the batch comes from', async () => {
      await service.processSastIacBatch(diffRequest([issue('CKV_AWS_21', 40)]));

      expect(diff.ingestBatch.mock.calls[0][3]).toBe('kics');
    });

    it('stores nothing and completes when every issue is neutralised', async () => {
      const res = await service.processSastIacBatch(
        diffRequest([
          issue('CKV_AWS_20', 10, [bare()]),
          issue('CKV_AWS_21', 40, [scoped(['cd-iac-0124'])]),
        ]),
      );

      expect(res.success).toBe(true);
      const stored = diff.ingestBatch.mock.calls[0]?.[1] ?? [];
      expect(stored).toEqual([]);
    });

    // The neutralise step runs before the diff/full split, gitleaks batches
    // included: a diff scan drops a neutralised secret as the full scan does.
    it('drops a neutralised secret and stores the others, as the full scan raises them', async () => {
      utils.resolveCatalogRules.mockResolvedValue(gitleaksCatalogue());
      const byCode = secretIssue(3, [scoped(['CD-SECRET-0007'])]);
      const byBare = secretIssue(7, [bare()], 'generic-api-key');
      const otherCode = secretIssue(11, [scoped(['CD-SECRET-0008'])]);
      const byRuleId = secretIssue(
        15,
        [scoped(['generic-api-key'])],
        'generic-api-key',
      );

      await service.processSastIacBatch(
        gitleaksRequest([byCode, byBare, otherCode, byRuleId], {
          scanId: 'scan-d',
        }),
      );

      const [, stored, rules, scanner] = diff.ingestBatch.mock.calls[0];
      expect(scanner).toBe('gitleaks');
      expect(stored).toEqual([otherCode, byRuleId]);
      expect(rules.get('aws-access-token')?.code).toBe('CD-SECRET-0007');
      expect(utils.processVulnerability).not.toHaveBeenCalled();
    });
  });

  /**
   * A transient MySQL error must neither raise an issue the customer
   * neutralised nor hide one they did not: the batch is deferred to a BullMQ
   * retry exactly when a decision depends on the catalogue rule: a directive
   * listing a code, which only the rule's code can match. The bare form covers
   * every rule of its line, secrets included, so it is decided without the
   * catalogue. Otherwise the batch goes on as before inline directives existed — the occurrence
   * ranking resolves (and degrades) on its own.
   */
  describe('when the catalogue cannot be read', () => {
    beforeEach(() => {
      utils.resolveCatalogRules.mockRejectedValue(new Error('DB blip'));
    });

    const expectDeferred = async (req: ScanAddResultRequest) => {
      await expect(service.processSastIacBatch(req)).rejects.toMatchObject({
        error: expect.objectContaining({ code: 14 }), // status.UNAVAILABLE
      });
      expect(diff.ingestBatch).not.toHaveBeenCalled();
      expect(utils.getExistingVulnerabilities).not.toHaveBeenCalled();
      expect(utils.processVulnerability).not.toHaveBeenCalled();
    };

    it.each([
      ['full', false],
      ['diff', true],
    ])(
      'defers a %s-scan batch whose directive names a code (UNAVAILABLE)',
      async (_kind, isDiffScan) => {
        internals.scanServiceClient = {
          getScan: jest.fn().mockReturnValue(of({ isDiffScan })),
        };

        await expectDeferred(
          request([
            issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]),
            issue('CKV_AWS_21', 40),
          ]),
        );
      },
    );

    it('defers a gitleaks batch whose directive names a CD-SECRET code (UNAVAILABLE)', async () => {
      await expectDeferred(
        gitleaksRequest([
          secretIssue(3, [scoped(['CD-SECRET-0007'])]),
          secretIssue(7),
        ]),
      );
    });

    // The bare form covers every rule of its line, a secret's included: no
    // resolution changes the decision.
    it.each<[string, () => ScanAddResultRequest, number[]]>([
      [
        'a kics',
        () =>
          request([issue('CKV_AWS_20', 10, [bare()]), issue('CKV_AWS_21', 40)]),
        [40],
      ],
      [
        'a gitleaks',
        () =>
          gitleaksRequest([
            secretIssue(3, [bare()]),
            secretIssue(7, [scoped(['aws-access-token'])]),
          ]),
        [7],
      ],
    ])(
      'ingests %s full-scan batch carrying the bare form, the issue it covers dropped',
      async (_kind, req, lines) => {
        const res = await service.processSastIacBatch(req());

        expect(res.success).toBe(true);
        expect(processedLines()).toEqual(lines);
      },
    );

    // The ingestion defers a diff scan without its catalogue whatever the directives.
    it('defers a diff-scan batch carrying the bare form (UNAVAILABLE)', async () => {
      internals.scanServiceClient = {
        getScan: jest.fn().mockReturnValue(of({ isDiffScan: true })),
      };

      await expectDeferred(
        request([issue('CKV_AWS_20', 10, [bare()]), issue('CKV_AWS_21', 40)]),
      );
    });

    it('ingests a batch whose decisions do not depend on the catalogue, as before', async () => {
      const res = await service.processSastIacBatch(
        request([
          issue('CKV_AWS_21', 40),
          issue('CKV_AWS_20', 70, [scoped(['CKV_AWS_20'])]),
        ]),
      );

      expect(res.success).toBe(true);
      expect(
        utils.processVulnerability.mock.calls.map(
          (c: [VulnerabilityDtoRequest]) =>
            c[0].codeSnippet.vulnerableStartLine,
        ),
      ).toEqual([40, 70]);
      // No resolution to reuse: the ranking queries (and degrades) itself.
      expect(utils.resolveCatalogVulnIds).toHaveBeenCalledTimes(1);
      expect(
        logger.warn.mock.calls.some((c: unknown[]) =>
          String(c[0]).includes('catalogue'),
        ),
      ).toBe(true);
    });

    // A diff finding is named, graded and kept by its catalogue
    // rule. Stored without one, every finding would be dropped and the diff
    // scan would report a clean change.
    it('defers a diff-scan batch even when no directive depends on the catalogue (UNAVAILABLE)', async () => {
      internals.scanServiceClient = {
        getScan: jest.fn().mockReturnValue(of({ isDiffScan: true })),
      };

      await expectDeferred(
        request([
          issue('CKV_AWS_20', 10, [scoped(['CKV_AWS_20'])]),
          issue('CKV_AWS_21', 40),
        ]),
      );
    });
  });

  describe('log', () => {
    const logged = () =>
      [
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
        ...logger.debug.mock.calls,
      ].map((c: unknown[]) => String(c[0]));

    it('counts the neutralised issues and names their codes, never the reason', async () => {
      await service.processSastIacBatch(
        request([
          issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0123'])]),
          issue('CKV_AWS_20', 70, [scoped(['CD-IAC-0123'])]),
          issue('CKV_AWS_21', 40, [bare()]),
          issue('CKV_AWS_21', 90),
        ]),
      );

      const line = logged().find((m) => m.includes('Neutralised'));
      expect(line).toContain(
        'Neutralised 3 of 4 issue(s) by cybedefend-ignore directive(s)',
      );
      expect(line).toContain('scan=scan-1');
      expect(line).toContain('scanner=kics');
      expect(line).toContain('codes=CD-IAC-0123,CD-IAC-0124');
      expect(logged().some((m) => m.includes(REASON))).toBe(false);
    });

    it('says nothing when no issue is neutralised', async () => {
      await service.processSastIacBatch(
        request([issue('CKV_AWS_20', 10, [scoped(['CD-IAC-0124'])])]),
      );

      expect(logged().some((m) => m.includes('Neutralised'))).toBe(false);
    });

    it('counts a neutralised secret and names its code, never its value, path or rule id', async () => {
      utils.resolveCatalogRules.mockResolvedValue(gitleaksCatalogue());

      await service.processSastIacBatch(
        gitleaksRequest([
          secretIssue(3, [bare()]),
          secretIssue(7, [scoped(['CD-SECRET-0007'])]),
          // No catalogue code: counted, not named.
          secretIssue(11, [bare()], 'generic-api-key'),
          secretIssue(15),
        ]),
      );

      const line = logged().find((m) => m.includes('Neutralised'));
      expect(line).toContain('Neutralised 3 of 4 issue(s)');
      expect(line).toContain('scanner=gitleaks');
      expect(line).toContain('codes=CD-SECRET-0007)');
      expect(line).not.toContain('.env');
      for (const leak of [SECRET_VALUE, REASON, 'aws-access-token']) {
        expect(logged().some((m) => m.includes(leak))).toBe(false);
      }
    });

    // A directive can now hide a real credential, so every secret it
    // silences leaves one audit line: where, by which code and form. Never
    // the value, the scanner's rule id or the directive's reason.
    const audited = () =>
      logger.warn.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m) => m.startsWith('SECRET_NEUTRALISED'));

    it('leaves one audit line per secret a directive silences', async () => {
      utils.resolveCatalogRules.mockResolvedValue(gitleaksCatalogue());

      await service.processSastIacBatch(
        gitleaksRequest([
          secretIssue(3, [bare()]),
          secretIssue(7, [scoped(['CD-SECRET-0007'])]),
          secretIssue(11, [bare()], 'generic-api-key'),
          secretIssue(15),
        ]),
      );

      expect(audited()).toEqual([
        'SECRET_NEUTRALISED scan=scan-1 scanner=gitleaks code=CD-SECRET-0007 form=bare path=.env line=3',
        'SECRET_NEUTRALISED scan=scan-1 scanner=gitleaks code=CD-SECRET-0007 form=scoped path=.env line=7',
        'SECRET_NEUTRALISED scan=scan-1 scanner=gitleaks code=none form=bare path=.env line=11',
      ]);
      for (const leak of [SECRET_VALUE, REASON, 'aws-access-token']) {
        expect(logged().some((m) => m.includes(leak))).toBe(false);
      }
    });

    it('audits a SAST rule raised as a secret, not a SAST, IaC or CI/CD finding', async () => {
      utils.resolveCatalogRules.mockResolvedValue(opengrepCatalogue());

      await service.processSastIacBatch(
        request(
          [
            issue('hardcoded-aws-key', 10, [bare()]),
            issue('eval-detected', 30, [bare()]),
          ],
          { scannerName: 'opengrep', vulnerabilityType: 'sast' },
        ),
      );

      expect(audited()).toEqual([
        'SECRET_NEUTRALISED scan=scan-1 scanner=opengrep code=CD-SECRET-0042 form=bare path=main.tf line=10',
      ]);
    });

    it('names the code of an opengrep rule raised as a secret', async () => {
      utils.resolveCatalogRules.mockResolvedValue(opengrepCatalogue());

      await service.processSastIacBatch(
        request(
          [
            issue('hardcoded-aws-key', 10, [bare()]),
            issue('hardcoded-aws-key', 20, [scoped(['CD-SECRET-0042'])]),
            issue('eval-detected', 30, [bare()]),
          ],
          { scannerName: 'opengrep', vulnerabilityType: 'sast' },
        ),
      );

      const line = logged().find((m) => m.includes('Neutralised'));
      expect(line).toContain('Neutralised 3 of 3 issue(s)');
      expect(line).toContain('codes=CD-SAST-0001,CD-SECRET-0042)');
    });
  });
});

describe('SastIacService.finalizeScan — scanner-scoped resolution', () => {
  let service: SastIacService;
  let utils: {
    findExistingDetections: jest.Mock;
    loadCurrentScanSightings: jest.Mock;
    processVulnerability: jest.Mock;
    finalizeOldScanVulnerabilities: jest.Mock;
  };
  // What the scan sighted, read once and shared by the calls.
  const sightings = { ids: new Set<string>(), detections: [] };

  beforeEach(async () => {
    utils = {
      findExistingDetections: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
      }),
      loadCurrentScanSightings: jest.fn().mockResolvedValue(sightings),
      processVulnerability: jest.fn().mockResolvedValue(undefined),
      finalizeOldScanVulnerabilities: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ResultService, useValue: {} },
        { provide: SastIacUtilsService, useValue: utils },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SastIacService);
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ branch: 'main' })),
    };
  });

  it('queries existing vulnerabilities scoped to the finalizing scanner, never the literal "*"', async () => {
    await (service as any).finalizeScan('p1', 'scan1', 'Checkov');

    // The bug: getExistingVulnerabilities was called with '*', which TypeORM
    // treats as a literal `scanner_type = '*'` → 0 rows → nothing resolved.
    expect(utils.findExistingDetections).toHaveBeenCalledWith(
      'p1',
      'checkov',
      'main',
    );
    const calledWithStar = utils.findExistingDetections.mock.calls.some(
      (c) => c[1] === '*',
    );
    expect(calledWithStar).toBe(false);
  });

  it('finalizes both the SAST and IaC existing detections returned for that scanner', async () => {
    utils.findExistingDetections.mockResolvedValue({
      existingSastVulns: [{ id: 'sast-1' }],
      existingIacVulns: [{ id: 'iac-1' }],
      existingCicdVulns: [],
    });

    await (service as any).finalizeScan('p1', 'scan1', 'checkov');

    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledTimes(2);
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
      [{ id: 'sast-1' }],
      [],
      'p1',
      'scan1',
      'main',
      sightings,
    );
    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
      [{ id: 'iac-1' }],
      [],
      'p1',
      'scan1',
      'main',
      sightings,
    );
  });

  // a diff scan only re-submits findings for the changed files.
  // Running finalize would auto-resolve every out-of-scope vuln of the branch
  // (and close its Jira/GitHub issue). The scan's isDiffScan flag — read from
  // the getScan call already made here — must short-circuit finalization.
  it('does NOT auto-resolve out-of-scope vulns when the scan is a diff scan', async () => {
    (service as any).scanServiceClient = {
      getScan: jest
        .fn()
        .mockReturnValue(of({ branch: 'main', isDiffScan: true })),
    };
    utils.findExistingDetections.mockResolvedValue({
      existingSastVulns: [{ id: 'sast-1' }],
      existingIacVulns: [{ id: 'iac-1' }],
    });

    await (service as any).finalizeScan('p1', 'scan1', 'checkov');

    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  // Scan-diff history: the summary of a diff scan records who launched it and
  // which AI coding agent asked for it, both read from the scan record.
  it('records the launcher and the AI coding agent in the diff-scan summary', async () => {
    const upsertSummary = jest.fn().mockResolvedValue(undefined);
    (service as any).diffScanSink = { upsertSummary };
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(
        of({
          branch: 'feat/login',
          isDiffScan: true,
          scanType: 'sast,secret',
          initializerUserId: 'u1',
          codingAgent: 'claude-code',
        }),
      ),
    };

    await (service as any).finalizeScan('p1', 'scan1', 'opengrep');

    expect(upsertSummary).toHaveBeenCalledWith(
      'scan1',
      'p1',
      'feat/login',
      'sast,secret',
      { initializerUserId: 'u1', codingAgent: 'claude-code' },
    );
  });

  // if the scan record can't be fetched we know
  // neither the branch nor the diff status — finalizing blind could resolve
  // vulns across the wrong scope. Fail safe: skip finalization entirely.
  it('skips finalization when the scan record is unavailable (fail-safe)', async () => {
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of(null)),
    };
    utils.findExistingDetections.mockResolvedValue({
      existingSastVulns: [{ id: 'sast-1' }],
      existingIacVulns: [{ id: 'iac-1' }],
    });

    await (service as any).finalizeScan('p1', 'scan1', 'checkov');

    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  // An import scan carries one type; a Trivy file holds IaC
  // findings and secrets under one tool, so an `iac` import followed by a
  // `secret` import must not resolve the IaC findings.
  it('finalizes only the named type when one is given, whatever else the scanner has', async () => {
    utils.findExistingDetections.mockResolvedValue({
      existingSastVulns: [{ id: 'sast-1' }],
      existingIacVulns: [{ id: 'iac-1' }],
      existingCicdVulns: [{ id: 'cicd-1' }],
      existingSecretVulns: [{ id: 'secret-1' }],
    });

    for (const [type, id] of [
      ['sast', 'sast-1'],
      ['iac', 'iac-1'],
      ['cicd', 'cicd-1'],
      ['secret', 'secret-1'],
    ] as const) {
      utils.finalizeOldScanVulnerabilities.mockClear();
      await service.finalizeScan('p1', 'scan1', 'trivy', type);

      expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledTimes(1);
      expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
        [{ id }],
        [],
        'p1',
        'scan1',
        'main',
        sightings,
        // An import carries no history pass and no outcome.
        ...(type === 'secret'
          ? [
              {
                outcome: null,
                mode: null,
                firstPass: false,
                ignoredPaths: new Set(),
              },
            ]
          : []),
      );
    }
  });

  it('finalizes the CICD existing detections returned for that scanner', async () => {
    utils.findExistingDetections.mockResolvedValue({
      existingSastVulns: [],
      existingIacVulns: [],
      existingCicdVulns: [{ id: 'cicd-1' }],
    });

    await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');

    expect(utils.finalizeOldScanVulnerabilities).toHaveBeenCalledWith(
      [{ id: 'cicd-1' }],
      [],
      'p1',
      'scan1',
      'main',
      sightings,
    );
  });
});

/**
 * `finalizeScan` with the REAL SastIacUtilsService over mocked
 * repositories: the reads it makes are counted, not assumed. It used to read
 * the history of the scan once per finalize call (2 to 3), reload every
 * detection of the project with three 1-N joins on each call, and look up
 * the last history row of each old detection one by one.
 */
describe('SastIacService.finalizeScan — reads the scan once', () => {
  let service: SastIacService;
  let histRepo: any;
  let repos: Record<'sast' | 'iac' | 'cicd', any>;

  const det = <T>(cls: new () => T, id: string, path: string): T =>
    Object.assign(new cls(), {
      id,
      projectId: 'p1',
      branch: 'main',
      scannerType: 'checkov',
      currentState: 'to_verify',
      path,
      language: 'hcl',
      vulnerableStartLine: 1,
      vulnerableEndLine: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      codeSnippets: [],
      vulnerability: { id: `cat-${id}` },
    });

  beforeEach(async () => {
    const family = (
      existing: unknown[],
      sighted: unknown[],
    ): Record<string, jest.Mock> => ({
      ...createMockRepository(),
      // The scanner-scoped read of the existing detections, or the by-id
      // read of the sighted ones.
      find: jest.fn(async (opts: any) =>
        opts?.where?.id ? sighted : existing,
      ),
      save: jest.fn(async (e: unknown) => e),
      remove: jest.fn(async (e: unknown) => e),
    });
    repos = {
      sast: family(
        [det(SastVulnerabilityDetections, 'sast-old', 'a.py')],
        [det(SastVulnerabilityDetections, 'sast-new', 'b.py')],
      ),
      iac: family(
        [det(IacVulnerabilityDetections, 'iac-old', 'a.tf')],
        [det(IacVulnerabilityDetections, 'iac-new', 'b.tf')],
      ),
      cicd: family(
        [det(CicdVulnerabilityDetections, 'cicd-old', 'a.yml')],
        [det(CicdVulnerabilityDetections, 'cicd-new', 'b.yml')],
      ),
    };
    histRepo = createMockRepository();
    histRepo.find.mockResolvedValue([
      { scanId: 'scan1', sastVulnerabilityDetection: { id: 'sast-new' } },
      { scanId: 'scan1', iacVulnerabilityDetection: { id: 'iac-new' } },
      { scanId: 'scan1', cicdVulnerabilityDetection: { id: 'cicd-new' } },
    ]);
    histRepo.findOne.mockResolvedValue(null);
    const correspondanceRepo: any = createMockRepository();
    correspondanceRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SastIacService,
        SastIacUtilsService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        {
          provide: ResultService,
          useValue: { addHistoryItem: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForResolvedVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: CvssCalculatorService, useValue: {} },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: repos.sast,
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: repos.iac,
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: repos.cicd,
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: histRepo,
        },
        {
          provide: getRepositoryToken(CorrespondanceTable),
          useValue: correspondanceRepo,
        },
        {
          provide: getRepositoryToken(CodeSnippet),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(DataFlowItem),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecurityContextCacheService,
          useValue: { get: jest.fn(), getUpdatedAt: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(SastIacService);
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ branch: 'main' })),
    };
  });

  const byIdReads = (repo: any) =>
    repo.find.mock.calls.filter((c: any[]) => c[0]?.where?.id);

  it('reads the history of the scan once and the sighted detections once, one query per relation', async () => {
    await service.finalizeScan('p1', 'scan1', 'checkov');

    // One history read for the whole finalization, by scanId (IDX_vdh_scanId),
    // and never the last history row of each detection.
    expect(histRepo.find).toHaveBeenCalledTimes(1);
    expect(histRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        // Its SAST, IaC, CICD and secret rows, never its SCA ones ):
        // finalize resolves the scanner's secrets from the same read.
        where: [
          { scanId: 'scan1', sastVulnerabilityDetection: Not(IsNull()) },
          { scanId: 'scan1', iacVulnerabilityDetection: Not(IsNull()) },
          { scanId: 'scan1', cicdVulnerabilityDetection: Not(IsNull()) },
          { scanId: 'scan1', secretVulnerabilityDetection: Not(IsNull()) },
        ],
      }),
    );
    expect(histRepo.findOne).not.toHaveBeenCalled();

    for (const [name, repo] of Object.entries(repos)) {
      const reads = byIdReads(repo);
      expect({ name, reads: reads.length }).toEqual({ name, reads: 1 });
      expect(reads[0][0].relationLoadStrategy).toBe('query');
      // Plus the scanner-scoped read of the existing detections: 2 in all,
      // however many finalize calls share them.
      expect({ name, all: repo.find.mock.calls.length }).toEqual({
        name,
        all: 2,
      });
    }
  });

  it('still resolves what disappeared and keeps what the scan sighted, in every family', async () => {
    await service.finalizeScan('p1', 'scan1', 'checkov');

    for (const repo of Object.values(repos)) {
      const saved = repo.save.mock.calls.map((c: any[]) => c[0]);
      expect(saved.map((d: any) => [d.id, d.currentState])).toEqual([
        [expect.stringMatching(/-old$/), 'resolved'],
      ]);
    }
  });
});

describe.each([
  ['getProjectSastVulnerabilities', 'sast'],
  ['getProjectIacVulnerabilities', 'iac'],
  ['getProjectCicdVulnerabilities', 'cicd'],
  ['getProjectSecretVulnerabilities', 'secret'],
] as const)('%s (list payload slimming)', (method, kind) => {
  let service: SastIacService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        {
          provide: ResultService,
          useValue: {
            getCountVulnerabilitiesCountByType: jest.fn().mockResolvedValue({
              sast: 0,
              iac: 0,
              sca: 0,
              container: 0,
              cicd: 0,
              secret: 0,
            }),
            getAutofixCountByType: jest.fn().mockResolvedValue({
              sast: { withAutofix: 0, withoutAutofix: 0 },
              iac: { withAutofix: 0, withoutAutofix: 0 },
              cicd: { withAutofix: 0, withoutAutofix: 0 },
              secret: { withAutofix: 0, withoutAutofix: 0 },
              sca: { withAutofix: 0, withoutAutofix: 0 },
            }),
          },
        },
        {
          provide: SastIacUtilsService,
          useValue: {
            getExistingVulnerabilities: jest.fn(),
            processVulnerability: jest.fn(),
            finalizeOldScanVulnerabilities: jest.fn(),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();
    await module.init();

    service = module.get(SastIacService);
  });

  it(`returns vulnerabilities with empty description / howToPrevent / codeExamples for ${kind}`, async () => {
    const detection = {
      id: `det-${kind}`,
      projectId: 'p1',
      currentSeverity: 'critical',
      currentPriority: 'critical_urgent',
      currentState: 'to_verify',
      branch: 'main',
      scoringSource: 'static',
      codeSnippets: [],
      historyItems: [],
      autofixRecords: [],
      vulnerability: {
        id: 'v1',
        name: 'X',
        cwe: [],
        severity: 'critical',
        language: 'JavaScript',
        vulnerabilityType: kind,
        owaspTop10: [],
        description: 'HUGE'.repeat(1000),
        howToPrevent: 'HOW'.repeat(500),
        references: [{ id: 'r1', url: 'http://e.test', name: 'R' }],
        codeExamples: [{ filename: 'a.js', content: 'C'.repeat(50_000) }],
        sourceMetadata: { category: 'security' },
      },
    };
    const fakeQb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([detection]),
      getManyAndCount: jest.fn().mockResolvedValue([[detection], 1]),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const repoKey =
      kind === 'sast'
        ? 'sastVulnDetectRepository'
        : kind === 'iac'
          ? 'iacVulnDetectRepository'
          : kind === 'cicd'
            ? 'cicdVulnDetectRepository'
            : 'secretVulnDetectRepository';
    (service as any)[repoKey] = { createQueryBuilder: () => fakeQb };
    (service as any).projectServiceClient = {
      get: () => of({ name: 't', parsedBranches: [] }),
    };
    (service as any).scanServiceClient = {
      getLastScanStatus: () =>
        of({ scanId: '', state: '', createAt: '', scanType: '' }),
    };

    const out = await (service as any)[method]({
      projectId: 'p1',
      pageNumber: 1,
      pageSizeNumber: 10,
      sort: 'currentSeverity',
      order: 'DESC',
      severity: ['critical'],
      status: [],
      priority: [],
      searchQuery: '',
      exploitabilityVerdict: [],
    });

    expect(out.vulnerabilities).toHaveLength(1);
    expect(out.vulnerabilities[0].base.vulnerability.description).toBe('');
    expect(out.vulnerabilities[0].base.vulnerability.howToPrevent).toBe('');
    expect(out.vulnerabilities[0].base.vulnerability.codeExamples).toEqual([]);
    expect(out.vulnerabilities[0].base.vulnerability.references).toEqual([]);
  });
});

// A vulnerability detail only needs to know whether the project
// has a parsed branch (`isProjectParsed`, the code-graph assistant button). It
// paid a full ProjectService/Get for it, whose vulnerability count called back
// into this service. GetProjectBranches answers it from one indexed read.
describe.each([
  ['getSastVulnerabilityByIdInProject', 'sast'],
  ['getIacVulnerabilityByIdInProject', 'iac'],
] as const)('%s (isProjectParsed)', (method, kind) => {
  let service: SastIacService;
  let projectClient: { get: jest.Mock; getProjectBranches: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ResultService, useValue: {} },
        { provide: SastIacUtilsService, useValue: {} },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        { provide: SastIacService, useClass: SastIacService },
        {
          provide: getRepositoryToken(SastVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(IacVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(CicdVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(SecretVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(AutoFixRecord),
          useValue: createMockRepository(),
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: SecurityContextCacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getUpdatedAt: jest.fn().mockResolvedValue(null),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();
    await module.init();
    service = module.get(SastIacService);

    const detection = {
      id: `det-${kind}`,
      projectId: 'p1',
      currentSeverity: 'high',
      currentPriority: 'urgent',
      currentState: 'to_verify',
      branch: 'main',
      scoringSource: 'static',
      codeSnippets: [],
      dataFlowItems: [],
      historyItems: [],
      autofixRecords: [],
      vulnerability: {
        id: 'v1',
        name: 'X',
        cwe: [],
        severity: 'high',
        language: 'JavaScript',
        vulnerabilityType: kind,
        owaspTop10: [],
        description: 'd',
        howToPrevent: 'h',
        references: [],
        codeExamples: [],
      },
    };
    const repoKey =
      kind === 'sast' ? 'sastVulnDetectRepository' : 'iacVulnDetectRepository';
    (service as any)[repoKey] = {
      findOne: jest.fn().mockResolvedValue(detection),
    };
    projectClient = { get: jest.fn(), getProjectBranches: jest.fn() };
    (service as any).projectServiceClient = projectClient;
  });

  const detail = () =>
    (service as any)[method]({
      projectId: 'p1',
      vulnerabilityId: `det-${kind}`,
    });

  it('answers isProjectParsed from GetProjectBranches, without ProjectService/Get', async () => {
    projectClient.getProjectBranches.mockReturnValue(
      of({
        branches: [
          { branch: 'feature', status: 'BRANCH_INGESTION_STATUS_FAILED' },
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

  // ProjectService/Get only listed PARSED branches; GetProjectBranches lists
  // every ingestion row. A branch still parsing, or whose parse failed, has no
  // code graph and must not light the code-graph assistant up.
  it('is false when no branch is parsed yet (parsing or failed rows only)', async () => {
    projectClient.getProjectBranches.mockReturnValue(
      of({
        branches: [
          { branch: 'main', status: 'BRANCH_INGESTION_STATUS_PARSING' },
          { branch: 'dev', status: 3 },
        ],
      }),
    );

    const res = await detail();

    expect(res.isProjectParsed).toBe(false);
  });

  it('accepts the numeric enum as well as its string name', async () => {
    projectClient.getProjectBranches.mockReturnValue(
      of({ branches: [{ branch: 'main', status: 2 }] }),
    );

    const res = await detail();

    expect(res.isProjectParsed).toBe(true);
  });
});

// Resolves the users behind a set of ids in one parallel batch (vulnerability
// history items, the launchers of the scan-diff history…).
describe('SastIacService.resolveUsersByIds', () => {
  function makeService(getById: jest.Mock): SastIacService {
    const service = Object.create(SastIacService.prototype) as SastIacService;
    Object.assign(service, {
      userServiceClient: { getById },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return service;
  }

  it('looks each distinct user up once', async () => {
    const getById = jest.fn(({ userId }: { userId: string }) =>
      of({ id: userId, firstName: 'Ada', lastName: 'Lovelace' }),
    );
    const service = makeService(getById);

    const users = await service.resolveUsersByIds(['u1', 'u2', 'u1']);

    expect(getById).toHaveBeenCalledTimes(2);
    expect(users.get('u1')).toMatchObject({ id: 'u1', firstName: 'Ada' });
    expect(users.get('u2')).toMatchObject({ id: 'u2' });
  });

  it('maps a user that cannot be resolved to null without failing the others', async () => {
    const getById = jest.fn(({ userId }: { userId: string }) =>
      userId === 'gone'
        ? throwError(() => ({ code: 5, details: 'not found' }))
        : of({ id: userId }),
    );
    const service = makeService(getById);

    const users = await service.resolveUsersByIds(['u1', 'gone']);

    expect(users.get('u1')).toMatchObject({ id: 'u1' });
    expect(users.get('gone')).toBeNull();
  });
});

// A results list reads its project ONCE. Its two counters used
// to resolve the SCA branch partition through
// ReferenceBranchResolver.getScoringBranches, i.e. one more ProjectService/Get
// each (3 Gets per list). They now receive the partition derived from the
// list's own Get, under the rule, so the tab badge keeps counting what
// the list shows.
describe('SastIacService – one ProjectService/Get per list', () => {
  const PROJECT = { name: 'p', referenceBranch: 'develop', parsedBranches: [] };
  // What global-management answers when it is down: a grpc-js ServiceError.
  const GM_DOWN = Object.assign(new Error('14 UNAVAILABLE: gm down'), {
    code: status.UNAVAILABLE,
    details: 'gm down',
  });

  function buildSvc(harness: ProjectLookupHarness): SastIacService {
    return Object.assign(
      Object.create(SastIacService.prototype) as SastIacService,
      {
        sastVulnDetectRepository: makeEmptyRepository(),
        iacVulnDetectRepository: makeEmptyRepository(),
        cicdVulnDetectRepository: makeEmptyRepository(),
        secretVulnDetectRepository: makeEmptyRepository(),
        resultService: harness.resultService,
        projectServiceClient: harness.projectServiceClient,
        scanServiceClient: {
          getLastScanStatus: () =>
            of({ id: 's1', state: 'completed', createAt: '', scanType: '' }),
        },
        cvssExplainer: { buildExplanationForEntity: jest.fn() },
        logger: createLoggerMock(),
      },
    );
  }

  /** Lets the counters a rejected list already chained run to their call. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  type FlatList = (svc: SastIacService, branch?: string) => Promise<unknown>;

  const lists: Array<[string, FlatList]> = [
    [
      'getProjectSastVulnerabilities',
      (svc, branch) =>
        svc.getProjectSastVulnerabilities({
          projectId: 'p1',
          branch,
        } as GetProjectSastVulnerabilitiesRequest),
    ],
    [
      'getProjectIacVulnerabilities',
      (svc, branch) =>
        svc.getProjectIacVulnerabilities({
          projectId: 'p1',
          branch,
        } as GetProjectIacVulnerabilitiesRequest),
    ],
    [
      'getProjectCicdVulnerabilities',
      (svc, branch) =>
        svc.getProjectCicdVulnerabilities({
          projectId: 'p1',
          branch,
        } as GetProjectCicdVulnerabilitiesRequest),
    ],
    [
      'getProjectSecretVulnerabilities',
      (svc, branch) =>
        svc.getProjectSecretVulnerabilities({
          projectId: 'p1',
          branch,
        } as GetProjectSecretVulnerabilitiesRequest),
    ],
  ];

  describe.each(lists)('%s', (_name, list) => {
    it('calls projectServiceClient.get once, never getScoringBranches, and hands the expected branches to both counters', async () => {
      const harness = makeProjectLookupHarness(PROJECT);

      await list(buildSvc(harness));

      expect(harness.get).toHaveBeenCalledTimes(1);
      expect(harness.getScoringBranches).not.toHaveBeenCalled();
      // No branch requested: the default partition, i.e. the reference
      // branch plus the legacy '' rows.
      expect(harness.countByType).toHaveBeenCalledWith('p1', undefined, [
        'develop',
        '',
      ]);
      expect(harness.autofixCountByType).toHaveBeenCalledWith('p1', undefined, [
        'develop',
        '',
      ]);
    });

    it('scopes the counters to the reference branch and its legacy rows when that branch is requested', async () => {
      const harness = makeProjectLookupHarness(PROJECT);

      await list(buildSvc(harness), 'develop');

      expect(harness.get).toHaveBeenCalledTimes(1);
      expect(harness.countByType).toHaveBeenCalledWith('p1', 'develop', [
        'develop',
        '',
      ]);
      expect(harness.autofixCountByType).toHaveBeenCalledWith('p1', 'develop', [
        'develop',
        '',
      ]);
    });

    it('fails as before when the Get fails, its counters scoped to main/master', async () => {
      const harness = makeProjectLookupHarness(GM_DOWN);

      const failure = await list(buildSvc(harness)).catch((e: unknown) => e);
      await settle();

      expect(failure).toBeInstanceOf(RpcException);
      expect((failure as RpcException).getError()).toEqual({
        code: status.UNAVAILABLE,
        message: 'gm down',
      });
      expect(harness.countByType).toHaveBeenCalledWith('p1', undefined, [
        'main',
        'master',
        '',
      ]);
      expect(harness.autofixCountByType).toHaveBeenCalledWith('p1', undefined, [
        'main',
        'master',
        '',
      ]);
    });
  });
});

// The Results pages never read the autofix counts (only the
// AutoFix page does), so they ask the flat lists not to compute them. Without
// the flag (public API, MCP, AutoFix page) nothing changes.
describe('SastIacService – excludeAutofixCounts', () => {
  const PROJECT = { name: 'p', referenceBranch: 'develop', parsedBranches: [] };

  function buildSvc(harness: ProjectLookupHarness): SastIacService {
    return Object.assign(
      Object.create(SastIacService.prototype) as SastIacService,
      {
        sastVulnDetectRepository: makeEmptyRepository(),
        iacVulnDetectRepository: makeEmptyRepository(),
        cicdVulnDetectRepository: makeEmptyRepository(),
        secretVulnDetectRepository: makeEmptyRepository(),
        resultService: harness.resultService,
        projectServiceClient: harness.projectServiceClient,
        scanServiceClient: {
          getLastScanStatus: () =>
            of({ id: 's1', state: 'completed', createAt: '', scanType: '' }),
        },
        cvssExplainer: { buildExplanationForEntity: jest.fn() },
        logger: createLoggerMock(),
      },
    );
  }

  type FlatList = (
    svc: SastIacService,
    excludeAutofixCounts?: boolean,
  ) => Promise<{ autofixCountByType?: unknown; vulnCountByType?: unknown }>;

  const lists: Array<[string, FlatList]> = [
    [
      'getProjectSastVulnerabilities',
      (svc, excludeAutofixCounts) =>
        svc.getProjectSastVulnerabilities({
          projectId: 'p1',
          excludeAutofixCounts,
        } as GetProjectSastVulnerabilitiesRequest),
    ],
    [
      'getProjectIacVulnerabilities',
      (svc, excludeAutofixCounts) =>
        svc.getProjectIacVulnerabilities({
          projectId: 'p1',
          excludeAutofixCounts,
        } as GetProjectIacVulnerabilitiesRequest),
    ],
    [
      'getProjectCicdVulnerabilities',
      (svc, excludeAutofixCounts) =>
        svc.getProjectCicdVulnerabilities({
          projectId: 'p1',
          excludeAutofixCounts,
        } as GetProjectCicdVulnerabilitiesRequest),
    ],
    [
      'getProjectSecretVulnerabilities',
      (svc, excludeAutofixCounts) =>
        svc.getProjectSecretVulnerabilities({
          projectId: 'p1',
          excludeAutofixCounts,
        } as GetProjectSecretVulnerabilitiesRequest),
    ],
  ];

  describe.each(lists)('%s', (_name, list) => {
    it('does not call getAutofixCountByType when excludeAutofixCounts is set, and still counts the tabs', async () => {
      const harness = makeProjectLookupHarness(PROJECT);

      const res = await list(buildSvc(harness), true);

      expect(harness.autofixCountByType).not.toHaveBeenCalled();
      expect(res.autofixCountByType).toBeUndefined();
      expect(harness.countByType).toHaveBeenCalledTimes(1);
      expect(res.vulnCountByType).toBeDefined();
    });

    it('still returns the autofix counts when the flag is absent or false', async () => {
      for (const flag of [undefined, false]) {
        const harness = makeProjectLookupHarness(PROJECT);

        const res = await list(buildSvc(harness), flag);

        expect(harness.autofixCountByType).toHaveBeenCalledTimes(1);
        expect(res.autofixCountByType).toBeDefined();
      }
    });
  });
});
