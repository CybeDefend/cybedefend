import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';
import { Library } from '@grpc/analysis-reporting/result';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import { ScaLicenseOverride } from '../../entities/sca-license-override.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { ResultService } from '../result/result.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { createLoggerMock } from '../../test-utils/typeorm-mock.util';
import { ScaService } from './sca.service';

/**
 * LIVE spec: a dependency that leaves the manifest and comes back.
 *
 * When a package is no longer reported, its row is deleted and its findings
 * are resolved (their package link is set to NULL by the foreign key). When
 * the same package comes back, its finding has the same fingerprint, which is
 * unique per (project, branch): the finding must be found again, linked to the
 * new package row and reopened, never dropped. A finding a person dismissed
 * stays dismissed.
 *
 * Runs on both engines under the package-upsert flag:
 *
 *   AR_SCA_UPSERT_LIVE=1 LIVE_DB_TYPE=mysql AR_SCA_UPSERT_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=sca.dependency-return.live
 *   AR_SCA_UPSERT_LIVE=1 LIVE_DB_TYPE=postgres AR_SCA_UPSERT_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=sca.dependency-return.live
 */
const LIVE = liveEnabled('AR_SCA_UPSERT');
const describeLive = LIVE ? describe : describe.skip;

const library = (over: Partial<Library> = {}): Library =>
  ({
    name: 'lodash',
    version: '4.17.20',
    isDev: false,
    isTransitive: false,
    file: 'package.json',
    ecosystem: 'npm',
    path: ['root'],
    ...over,
  }) as Library;

describeLive('SCA finding of a dependency that leaves and comes back', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  let live: LiveDatabase;
  let ds: DataSource;
  let service: ScaService;
  let advisory: VulnerabilityOsv;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_sca_return',
      envPrefix: 'AR_SCA_UPSERT',
      migrations: 'track',
    });
    ds = live.dataSource;
    const repo = (entity: new () => unknown) => ({
      provide: getRepositoryToken(entity),
      useValue: ds.getRepository(entity),
    });
    const module = await Test.createTestingModule({
      providers: [
        ScaService,
        repo(ScaDetectedPackages),
        repo(ScaVulnerabilityDetections),
        repo(VulnerabilityDetectionHistory),
        repo(HistoryItem),
        repo(ScaLicenseOverride),
        { provide: getDataSourceToken(), useValue: ds },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: CvssCalculatorService,
          useValue: { computeCvss4Base: () => null },
        },
        { provide: CvssExplainerService, useValue: {} },
        {
          provide: ResultService,
          useValue: {
            recalculatePriority: async () => null,
            computeEnvironmentalForProject: async () => null,
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForResolvedVulnerabilities: async () => undefined,
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({ get: () => of({ parsedBranches: [] }) }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({ getScan: () => of({ branch: 'main' }) }),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => undefined },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: { getScoringBranches: async () => ['main', 'master'] },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: async () => null },
        },
      ],
    }).compile();
    service = module.get(ScaService);
    service.onModuleInit();

    await ds
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsv)
      .values({
        id: 'GHSA-return-0001',
        summary: 'prototype pollution',
        details: 'details',
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsv>)
      .updateEntity(false)
      .execute();
    advisory = await ds
      .getRepository(VulnerabilityOsv)
      .findOneByOrFail({ id: 'GHSA-return-0001' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  /** One scan: its libraries (each affected by the advisory), then finalization. */
  const scan = async (
    projectId: string,
    scanId: string,
    libraries: Library[],
  ) => {
    await service.ingestMatched(
      { projectId, scanId, vulnerabilityType: 'CRITICAL,HIGH,MEDIUM,LOW' },
      libraries.map((l) => ({
        library: l,
        affected: [
          {
            vulnerability: advisory,
            severity: [],
          } as unknown as VulnerabilityOsvAffected,
        ],
      })),
    );
    await service.finalizeScan(projectId, scanId);
  };

  const detectionsOf = (projectId: string) =>
    ds.getRepository(ScaVulnerabilityDetections).find({
      where: { projectId },
      relations: ['scaDetectedPackage', 'vulnerability'],
    });

  const statusHistoryOf = async (detectionId: string) =>
    (
      await ds.getRepository(HistoryItem).find({
        where: { scaVulnerabilityDetection: { id: detectionId } },
        order: { date: 'ASC' },
      })
    ).map((h) => h.value);

  const sightingsOf = async (detectionId: string) =>
    (
      await ds.getRepository(VulnerabilityDetectionHistory).find({
        where: { scaVulnerabilityDetection: { id: detectionId } },
      })
    )
      .map((h) => h.scanId)
      .sort();

  it('reopens the same finding, linked to the new package row, with its history', async () => {
    for (let round = 0; round < 3; round += 1) {
      const projectId = randomUUID();
      await scan(projectId, `scan-1-${round}`, [library()]);
      const [first] = await detectionsOf(projectId);
      expect(first.currentState).toBe('to_verify');

      await scan(projectId, `scan-2-${round}`, []);
      const [gone] = await detectionsOf(projectId);
      expect(gone.id).toBe(first.id);
      expect(gone.currentState).toBe('resolved');
      expect(gone.scaDetectedPackage).toBeNull();

      await scan(projectId, `scan-3-${round}`, [library()]);
      const rows = await detectionsOf(projectId);
      expect(rows).toHaveLength(1);
      const [back] = rows;
      expect(back.id).toBe(first.id);
      expect(back.currentState).toBe('to_verify');
      expect(back.scaDetectedPackage).not.toBeNull();
      expect(back.scaDetectedPackage.packageName).toBe('lodash');
      expect(back.vulnerability.id).toBe('GHSA-return-0001');
      expect(back.resolvedAt ?? null).toBeNull();
      // The finding's history is the same one, carried on, and records the
      // reopen.
      expect((await statusHistoryOf(back.id)).sort()).toEqual([
        'resolved',
        'to_verify',
      ]);
      expect(await sightingsOf(back.id)).toEqual(
        [`scan-1-${round}`, `scan-2-${round}`, `scan-3-${round}`].sort(),
      );
    }
  });

  it('reopens the finding when its insert is refused as a duplicate, instead of dropping it', async () => {
    // The insert path: the row is not found up front (a concurrent ingestion
    // relinked or created it meanwhile), so the insert collides with the
    // unique (project, branch, fingerprint) and the row is read by that key.
    const projectId = randomUUID();
    await scan(projectId, 'scan-1', [library()]);
    const [first] = await detectionsOf(projectId);
    await scan(projectId, 'scan-2', []);

    const spy = jest
      .spyOn(
        service as unknown as {
          loadOrphanedDetections: () => Promise<Map<string, unknown>>;
        },
        'loadOrphanedDetections',
      )
      .mockResolvedValue(new Map());
    try {
      await scan(projectId, 'scan-3', [library()]);
    } finally {
      spy.mockRestore();
    }
    const rows = await detectionsOf(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].currentState).toBe('to_verify');
    expect(rows[0].scaDetectedPackage?.packageName).toBe('lodash');
    expect(await sightingsOf(first.id)).toContain('scan-3');
    expect(await statusHistoryOf(first.id)).toContain('to_verify');
  });

  it('keeps a dismissed finding dismissed when its dependency comes back', async () => {
    const projectId = randomUUID();
    await scan(projectId, 'scan-1', [library()]);
    const [first] = await detectionsOf(projectId);
    await ds
      .getRepository(ScaVulnerabilityDetections)
      .update({ id: first.id }, {
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedByType: 'user',
        triagedBy: 'user-1',
        triagedAt: new Date(),
      } as QueryDeepPartialEntity<ScaVulnerabilityDetections>);

    await scan(projectId, 'scan-2', []);
    const [gone] = await detectionsOf(projectId);
    expect(gone.currentState).toBe('ignored');
    expect(gone.scaDetectedPackage).toBeNull();

    await scan(projectId, 'scan-3', [library()]);
    const rows = await detectionsOf(projectId);
    expect(rows).toHaveLength(1);
    const [back] = rows;
    expect(back.id).toBe(first.id);
    expect(back.currentState).toBe('ignored');
    expect(back.stateManuallyModified).toBe(true);
    expect(back.triagedBy).toBe('user-1');
    expect(back.scaDetectedPackage?.packageName).toBe('lodash');
    // Its status did not change: no status row was written for it.
    expect(await statusHistoryOf(back.id)).not.toContain('to_verify');
  });
});
