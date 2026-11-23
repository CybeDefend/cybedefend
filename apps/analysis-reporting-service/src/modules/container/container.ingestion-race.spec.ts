// Container ingestion must be idempotent under the concurrent
// worker pool. Two workers can race on the same brand-new CVE (OSV stub
// primary key) or on the same detection row (fingerprint UNIQUE). Without
// it the BullMQ job fails on `Duplicate entry` and only succeeds on a later
// attempt, minutes later.
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { ContainerService } from './container.service';
import { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { VulnerabilityOsv } from '../../entities/osv';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../../test-utils/typeorm-mock.util';

/** Shape of the error TypeORM raises on a MySQL duplicate key (errno 1062). */
function duplicateEntryError(detail: string): Error {
  const err = new Error(`Duplicate entry ${detail}`) as Error & {
    driverError: { code: string; errno: number };
  };
  err.name = 'QueryFailedError';
  err.driverError = { code: 'ER_DUP_ENTRY', errno: 1062 };
  return err;
}

describe('ContainerService — ingestion race', () => {
  let service: ContainerService;
  let imageRepo: MockType<any>;
  let pkgRepo: MockType<any>;
  let detRepo: MockType<any>;
  let osvRepo: MockType<any>;

  const PKG = {
    id: 'pkg1',
    packageName: 'openssl',
    packageVersion: '3.0.0',
    target: 'alpine',
  };

  const buildRequest = (
    vulnerabilities: Array<Record<string, unknown>>,
  ): any => ({
    projectId: 'p1',
    scanId: 's1',
    os: { family: 'alpine', name: '3.19', eosl: false },
    chunk: { index: 0, isLast: false },
    results: [
      {
        target: 'alpine',
        class: 'os-pkgs',
        packages: [{ name: 'openssl', version: '3.0.0', target: 'alpine' }],
        vulnerabilities,
      },
    ],
  });

  const vuln = (vulnerabilityId: string) => ({
    pkgName: 'openssl',
    installedVersion: '3.0.0',
    target: 'alpine',
    vulnerabilityId,
    severity: 'high',
  });

  beforeEach(async () => {
    imageRepo = createMockRepository();
    pkgRepo = createMockRepository();
    detRepo = createMockRepository();
    osvRepo = createMockRepository();
    (osvRepo as any).findOneBy = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: imageRepo,
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: pkgRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: createMockRepository(),
        },
        { provide: getRepositoryToken(VulnerabilityOsv), useValue: osvRepo },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn(),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', compositeScore: 0.5 }),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: jest.fn().mockReturnValue(null) },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ContainerService);
    imageRepo.findOne!.mockResolvedValue(null);
    imageRepo.save!.mockImplementation(async (x) => x);
    pkgRepo.findOne!.mockResolvedValue(PKG);
    // The vulnerability path resolves package rows through `find`; mirror
    // whatever each test mocked on `findOne` so existing fixtures still apply.
    pkgRepo.find!.mockImplementation(async (opts) => {
      const row = await pkgRepo.findOne!(opts);
      return row ? [row] : [];
    });
    pkgRepo.save!.mockImplementation(async (x) => x);
    detRepo.save!.mockImplementation(async (x) => x);
  });

  it('recovers from a duplicate OSV stub insert by re-reading the row a concurrent worker created', async () => {
    // First lookup: nobody has created CVE-2026-4897 yet. The insert then
    // loses the race (another worker committed first) and the re-read must
    // return the winner's row instead of failing the whole batch.
    (osvRepo as any).findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'CVE-2026-4897' });
    osvRepo.save!.mockRejectedValueOnce(
      duplicateEntryError(
        "'CVE-2026-4897' for key 'vulnerability_osv.PRIMARY'",
      ),
    );
    detRepo.findOne!.mockResolvedValue(null);

    const res = await service.addContainerScanResult(
      buildRequest([vuln('CVE-2026-4897')]),
    );

    expect(res.success).toBe(true);
    expect((osvRepo as any).findOneBy).toHaveBeenCalledTimes(2);
    // The detection was still written, linked to the re-read stub.
    expect(detRepo.save).toHaveBeenCalledTimes(1);
    expect(detRepo.save.mock.calls[0][0].vulnerability).toEqual({
      id: 'CVE-2026-4897',
    });
  });

  it('recovers from a duplicate detection fingerprint by updating the row a concurrent worker created', async () => {
    (osvRepo as any).findOneBy.mockResolvedValue({ id: 'CVE-1' });
    const existing = {
      id: 'det-existing',
      branch: 'main',
      fingerprint: 'fp',
      currentState: 'to_verify',
    };
    // Lookup misses (row not committed yet), insert hits the UNIQUE
    // fingerprint, re-lookup finds the winner's row.
    detRepo
      .findOne!.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    detRepo
      .save!.mockRejectedValueOnce(
        duplicateEntryError(
          "'p1-main-abc' for key 'vulnerability_detections_container.UQ_vulnerability_detections_container_fingerprint'",
        ),
      )
      .mockImplementation(async (x) => x);

    const res = await service.addContainerScanResult(
      buildRequest([vuln('CVE-1')]),
    );

    expect(res.success).toBe(true);
    expect(detRepo.findOne).toHaveBeenCalledTimes(2);
    expect(detRepo.save).toHaveBeenCalledTimes(2);
    // Second save is an UPDATE of the existing row, not a new INSERT.
    expect(detRepo.save.mock.calls[1][0].id).toBe('det-existing');
  });

  it('still fails the batch on a non-duplicate database error', async () => {
    (osvRepo as any).findOneBy.mockResolvedValue(null);
    osvRepo.save!.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      service.addContainerScanResult(buildRequest([vuln('CVE-1')])),
    ).rejects.toThrow('ECONNRESET');
  });

  it('collapses duplicate (package, version, target, CVE) entries of one batch into a single detection write', async () => {
    (osvRepo as any).findOneBy.mockResolvedValue({ id: 'CVE-1' });
    detRepo.findOne!.mockResolvedValue(null);

    await service.addContainerScanResult(
      buildRequest([vuln('CVE-1'), vuln('CVE-1')]),
    );

    expect(detRepo.save).toHaveBeenCalledTimes(1);
  });

  describe('package row resolution', () => {
    // Trivy splits deb/rpm coordinates: Package.Version is "8.30" while the
    // vulnerability's InstalledVersion is "8.30-3" (version-release). A
    // strict equality lookup on the version therefore drops EVERY Debian
    // vulnerability (68/68 skipped on debian:10).
    let rows: Array<Record<string, string>>;
    const debianVuln = (
      installedVersion: string,
      vulnerabilityId = 'CVE-1',
    ) => ({
      pkgName: 'coreutils',
      installedVersion,
      target: 'debian',
      vulnerabilityId,
      severity: 'high',
    });
    const debianRequest = (v: Record<string, unknown>): any => ({
      ...buildRequest([v]),
      results: [
        {
          target: 'debian',
          class: 'os-pkgs',
          packages: [],
          vulnerabilities: [v],
        },
      ],
    });

    beforeEach(() => {
      rows = [
        {
          id: 'pkg-8.30',
          projectId: 'p1',
          packageName: 'coreutils',
          packageVersion: '8.30',
          target: 'debian',
        },
        {
          id: 'pkg-8.31',
          projectId: 'p1',
          packageName: 'coreutils',
          packageVersion: '8.31-1',
          target: 'debian',
        },
      ];
      const matches = (where: Record<string, unknown>) => (r: any) =>
        Object.entries(where).every(([k, v]) => r[k] === v);
      pkgRepo.find!.mockImplementation(async ({ where }) =>
        rows.filter(matches(where)),
      );
      pkgRepo.findOne!.mockImplementation(
        async ({ where }) => rows.find(matches(where)) ?? null,
      );
      (osvRepo as any).findOneBy.mockResolvedValue({ id: 'CVE-1' });
      detRepo.findOne!.mockResolvedValue(null);
    });

    it('attaches a Debian vulnerability whose installed version carries the release suffix', async () => {
      await service.addContainerScanResult(debianRequest(debianVuln('8.30-3')));

      expect(detRepo.save).toHaveBeenCalledTimes(1);
      expect(detRepo.save.mock.calls[0][0].detectedPackage.id).toBe('pkg-8.30');
    });

    it('prefers the row whose version equals the installed version when two versions coexist', async () => {
      await service.addContainerScanResult(debianRequest(debianVuln('8.31-1')));

      expect(detRepo.save).toHaveBeenCalledTimes(1);
      expect(detRepo.save.mock.calls[0][0].detectedPackage.id).toBe('pkg-8.31');
    });

    it('still attaches when only one row exists for the package name', async () => {
      rows.splice(1, 1);
      await service.addContainerScanResult(debianRequest(debianVuln('8.30-3')));

      expect(detRepo.save.mock.calls[0][0].detectedPackage.id).toBe('pkg-8.30');
    });
  });
});
