import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { Logger } from 'nestjs-pino';
import { SastIacService } from './sast-iac.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ResultService } from '../result/result.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { DIFF_SCAN_SINK } from '../../edition/ports/diff-scan-sink.port';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';

/**
 * The scanner's secret detections are finalized with its SAST, IaC and CICD
 * ones: by `finalizeScan` (the queue path) and by the inline last batch of
 * `addScanResult`, never on a diff scan, never when the scan record cannot be
 * read.
 */
describe('SastIacService — secret detections take part in finalization', () => {
  let service: SastIacService;
  let utils: {
    resolveCatalogRules: jest.Mock;
    getExistingVulnerabilities: jest.Mock;
    findExistingDetections: jest.Mock;
    loadCurrentScanSightings: jest.Mock;
    processVulnerability: jest.Mock;
    finalizeOldScanVulnerabilities: jest.Mock;
  };
  const secrets = [{ id: 'secret-1' }];
  // What the scan sighted, read once and shared by every finalize call.
  const sightings = {
    ids: new Set<string>(),
    detections: [],
    secretIds: new Set<string>(),
  };

  beforeEach(async () => {
    utils = {
      resolveCatalogRules: jest.fn().mockResolvedValue(new Map()),
      getExistingVulnerabilities: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
        existingSecretVulns: secrets,
        existingVulnsMap: new Map(),
      }),
      findExistingDetections: jest.fn().mockResolvedValue({
        existingSastVulns: [],
        existingIacVulns: [],
        existingCicdVulns: [],
        existingSecretVulns: secrets,
      }),
      loadCurrentScanSightings: jest.fn().mockResolvedValue(sightings),
      processVulnerability: jest.fn().mockResolvedValue(undefined),
      finalizeOldScanVulnerabilities: jest.fn().mockResolvedValue(undefined),
    };

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
        ...[
          SastVulnerabilityDetections,
          IacVulnerabilityDetections,
          CicdVulnerabilityDetections,
          SecretVulnerabilityDetections,
          ScaVulnerabilityDetections,
          AutoFixRecord,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: createMockRepository(),
        })),
        { provide: Logger, useValue: createLoggerMock() },
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
          useValue: {
            ingestBatch: jest.fn().mockResolvedValue(undefined),
            upsertSummary: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(SastIacService);
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of({ branch: 'main' })),
    };
  });

  // A scan with no recorded history pass and no outcome.
  const NO_HISTORY = {
    outcome: null,
    mode: null,
    firstPass: false,
    ignoredPaths: new Set(),
  };

  const secretCalls = () =>
    utils.finalizeOldScanVulnerabilities.mock.calls.filter(
      (c) => c[0] === secrets,
    );

  it('finalizeScan finalizes the secret detections of the finalizing scanner', async () => {
    await (service as any).finalizeScan('p1', 'scan1', 'Gitleaks');

    expect(utils.findExistingDetections).toHaveBeenCalledWith(
      'p1',
      'gitleaks',
      'main',
    );
    expect(secretCalls()).toEqual([
      [secrets, [], 'p1', 'scan1', 'main', sightings, NO_HISTORY],
    ]);
  });

  it('finalizeScan does not finalize secrets on a diff scan', async () => {
    (service as any).scanServiceClient = {
      getScan: jest
        .fn()
        .mockReturnValue(of({ branch: 'main', isDiffScan: true })),
    };

    await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');

    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  it('finalizeScan does not finalize secrets when the scan record is unavailable', async () => {
    (service as any).scanServiceClient = {
      getScan: jest.fn().mockReturnValue(of(null)),
    };

    await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');

    expect(utils.finalizeOldScanVulnerabilities).not.toHaveBeenCalled();
  });

  it('the inline last batch finalizes the secret detections too', async () => {
    const res = await service.addScanResult({
      scanId: 'scan3',
      projectId: 'p1',
      vulnerabilityType: 'secret',
      scannerName: 'gitleaks',
      vulnerabilities: [],
      isLastRequest: true,
    } as any);

    expect(res.success).toBe(true);
    expect(secretCalls()).toEqual([
      [secrets, [], 'p1', 'scan3', 'main', sightings, NO_HISTORY],
    ]);
  });

  /**
   * What decides a secret's fate at finalize: the scan's recorded history
   * pass (mode, first pass), read with the branch, and the outcome the
   * scanner's last batch sent, kept by the queue until the finalize gate.
   */
  describe('the history rule', () => {
    const scanWithPass = (mode: string, firstPass = false) => ({
      branch: 'main',
      historyPass: {
        mode,
        firstPass,
        excludeShas: [],
        bytes: '0',
        repositoryKey: 'github:acme/api',
      },
    });
    const useScan = (scan: unknown) => {
      (service as any).scanServiceClient = {
        getScan: jest.fn().mockReturnValue(of(scan)),
      };
    };
    const useOutcome = (read: jest.Mock, ignored?: jest.Mock) => {
      (service as any).scanQueueService = {
        getHistoryPassOutcome: read,
        getIgnoredPaths: ignored ?? jest.fn().mockResolvedValue(new Set()),
      };
    };

    it('finalizeScan hands the stored outcome and the recorded pass to the secret finalization only', async () => {
      useScan(scanWithPass('full', true));
      const read = jest.fn().mockResolvedValue('ok');
      useOutcome(read);

      await (service as any).finalizeScan('p1', 'scan1', 'Gitleaks');

      expect(read).toHaveBeenCalledWith('scan1', 'gitleaks');
      expect(secretCalls()).toEqual([
        [
          secrets,
          [],
          'p1',
          'scan1',
          'main',
          sightings,
          {
            outcome: 'ok',
            mode: 'full',
            firstPass: true,
            ignoredPaths: new Set(),
          },
        ],
      ]);
      // SAST, IaC and CI/CD findings keep their rule.
      for (const call of utils.finalizeOldScanVulnerabilities.mock.calls) {
        if (call[0] !== secrets) expect(call).toHaveLength(6);
      }
    });

    it('finalizeScan reads a recorded pass without an outcome as none', async () => {
      useScan(scanWithPass('none', true));
      useOutcome(jest.fn().mockResolvedValue(null));

      await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');

      expect(secretCalls()[0][6]).toEqual({
        outcome: 'none',
        mode: 'none',
        firstPass: true,
        ignoredPaths: new Set(),
      });
    });

    it('finalizeScan reads an outcome Redis cannot answer as none when a pass was recorded', async () => {
      useScan(scanWithPass('incremental'));
      useOutcome(jest.fn().mockRejectedValue(new Error('READONLY')));

      await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');

      expect(secretCalls()[0][6]).toEqual({
        outcome: 'none',
        mode: 'incremental',
        firstPass: false,
        ignoredPaths: new Set(),
      });
    });

    it('finalizeScan hands the scanner its own ignored paths, and reads none when Redis cannot answer', async () => {
      useScan(scanWithPass('incremental'));
      const ignored = jest.fn().mockResolvedValue(new Set(['repo/tests/a.py']));
      useOutcome(jest.fn().mockResolvedValue('ok'), ignored);

      await (service as any).finalizeScan('p1', 'scan1', 'Gitleaks');

      expect(ignored).toHaveBeenCalledWith('scan1', 'gitleaks');
      expect(secretCalls()[0][6].ignoredPaths).toEqual(
        new Set(['repo/tests/a.py']),
      );
      for (const call of utils.finalizeOldScanVulnerabilities.mock.calls) {
        if (call[0] !== secrets) expect(call).toHaveLength(6);
      }

      utils.finalizeOldScanVulnerabilities.mockClear();
      useOutcome(
        jest.fn().mockResolvedValue('ok'),
        jest.fn().mockRejectedValue(new Error('READONLY')),
      );
      await (service as any).finalizeScan('p1', 'scan1', 'gitleaks');
      expect(secretCalls()[0][6].ignoredPaths).toEqual(new Set());
    });

    it('the inline last batch reads the ignored paths from the request', async () => {
      useScan(scanWithPass('incremental'));

      await service.addScanResult({
        scanId: 'scan4',
        projectId: 'p1',
        vulnerabilityType: 'secret',
        scannerName: 'gitleaks',
        vulnerabilities: [],
        isLastRequest: true,
        ignoredPaths: ['repo/tests/a.py'],
      } as any);

      expect(secretCalls()[0][6].ignoredPaths).toEqual(
        new Set(['repo/tests/a.py']),
      );
    });

    it('the inline last batch reads the outcome from the request', async () => {
      useScan(scanWithPass('incremental'));

      await service.addScanResult({
        scanId: 'scan3',
        projectId: 'p1',
        vulnerabilityType: 'secret',
        scannerName: 'gitleaks',
        vulnerabilities: [],
        isLastRequest: true,
        historyPassOutcome: 'failed',
      } as any);

      expect(secretCalls()[0][6]).toEqual({
        outcome: 'failed',
        mode: 'incremental',
        firstPass: false,
        ignoredPaths: new Set(),
      });
    });
  });
});
