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
import { applyTriageToDetection } from '../findings-export/lifecycle.util';
import {
  createLoggerMock,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import {
  Library,
  ScanAddScaResultRequest,
} from '@grpc/analysis-reporting/result';

/** One statement a query builder executed, with what each step was given. */
type Statement = Record<string, unknown[]>;

/**
 * A query builder stand-in: every `createQueryBuilder()` opens a statement,
 * every chained call records its arguments on it, `execute()` closes it.
 */
function recordingQueryBuilder() {
  const statements: Statement[] = [];
  let current: Statement = {};
  const builder: Record<string, jest.Mock> = {};
  for (const step of [
    'insert',
    'into',
    'values',
    'orUpdate',
    'updateEntity',
    'update',
    'set',
    'whereInIds',
    'delete',
    'from',
  ]) {
    builder[step] = jest.fn((...args: unknown[]) => {
      current[step] = args;
      return builder;
    });
  }
  // What a statement answers; a spec can make one fail (`mockImplementationOnce`).
  const run = jest.fn<Promise<Record<string, unknown>>, [Statement]>(
    async () => ({ identifiers: [], generatedMaps: [], affected: 0 }),
  );
  builder.execute = jest.fn(async () => {
    const statement = current;
    statements.push(statement);
    current = {};
    return run(statement);
  });
  return {
    statements,
    run,
    createQueryBuilder: jest.fn(() => {
      current = {};
      return builder;
    }),
  };
}

type Repo = Record<string, jest.Mock>;

/**
 * The SCA detection writes, grouped. A re-detected detection
 * used to be saved one at a time (START, SELECT, UPDATE, SELECT updatedAt,
 * COMMIT each), a resolution saved by 20, its history rows saved one by one
 * after re-reading the detections already in memory, and the removed
 * packages deleted by 20.
 */
describe('ScaService — grouped detection writes', () => {
  let service: ScaService;
  let scaDetectedRepo: Repo;
  let scaVulnRepo: Repo;
  let historyItemRepo: Repo;
  let detectionHistoryRepo: Repo;
  let packageWrites: ReturnType<typeof recordingQueryBuilder>;
  let detectionWrites: ReturnType<typeof recordingQueryBuilder>;
  let historyItemWrites: ReturnType<typeof recordingQueryBuilder>;
  let detectionHistoryWrites: ReturnType<typeof recordingQueryBuilder>;
  let matcher: { findMatchingVulnerabilitiesForLibraries: jest.Mock };
  let closeIssues: jest.Mock;

  const packageOf = (i: number): Library => ({
    name: `pkg-${String(i).padStart(3, '0')}`,
    version: '1.0.0',
    file: 'package.json',
    ecosystem: 'npm',
    isTransitive: false,
    isDev: false,
    path: ['root'],
    importLocations: [],
    licenses: [],
  });
  const rowOf = (i: number) => ({
    id: `pkg-id-${i}`,
    projectId: 'p1',
    branch: '',
    packageName: packageOf(i).name,
    packageVersion: '1.0.0',
    ecosystem: 'npm',
    isDev: false,
    isTransitive: false,
    dependencyInfoAvailable: true,
    reachability: null,
  });
  const advisory = (id: string) => ({
    vulnerability: { id, severities: [] },
    severity: [
      {
        type: 'CVSS_V3',
        score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      },
    ],
    ranges: [],
  });
  const detection = (id: string, pkg: { id: string }, osvId: string) => ({
    id,
    projectId: 'p1',
    branch: '',
    currentState: 'to_verify',
    stateManuallyModified: false,
    priorityManualOverride: false,
    exploitabilitySource: 'static',
    fingerprint: null,
    firstDetectedAt: new Date('2026-01-01T00:00:00Z'),
    lastDetectedAt: new Date('2026-01-01T00:00:00Z'),
    triagedAt: null,
    triagedBy: null,
    triagedByType: null,
    resolvedAt: null,
    dismissalReason: null,
    scaDetectedPackage: pkg,
    vulnerability: { id: osvId },
  });
  const batchOf = (packages: Library[]): ScanAddScaResultRequest => ({
    projectId: 'p1',
    scanId: 's1',
    scannerName: 'scanlink-sca',
    isLastRequest: false,
    vulnerabilityType: 'ALL',
    packages,
  });

  /** The statements of one kind ('insert', 'update', 'delete'). */
  const statementsOf = (
    writes: ReturnType<typeof recordingQueryBuilder>,
    kind: 'insert' | 'update' | 'delete',
  ) => writes.statements.filter((s) => s[kind]);

  beforeEach(async () => {
    packageWrites = recordingQueryBuilder();
    detectionWrites = recordingQueryBuilder();
    historyItemWrites = recordingQueryBuilder();
    detectionHistoryWrites = recordingQueryBuilder();
    scaDetectedRepo = {
      ...(createMockRepository() as Repo),
      createQueryBuilder: packageWrites.createQueryBuilder,
      remove: jest.fn(async (rows) => rows),
    };
    scaVulnRepo = {
      ...(createMockRepository() as Repo),
      createQueryBuilder: detectionWrites.createQueryBuilder,
    };
    historyItemRepo = {
      ...(createMockRepository() as Repo),
      createQueryBuilder: historyItemWrites.createQueryBuilder,
    };
    detectionHistoryRepo = {
      ...(createMockRepository() as Repo),
      createQueryBuilder: detectionHistoryWrites.createQueryBuilder,
    };
    scaVulnRepo.create.mockImplementation((e) => e);
    scaVulnRepo.save.mockImplementation(async (e) =>
      Array.isArray(e)
        ? e
        : { ...e, id: e.id ?? `det-new-${e.vulnerability?.id}` },
    );
    scaVulnRepo.find.mockResolvedValue([]);
    historyItemRepo.create.mockImplementation((e) => e);
    detectionHistoryRepo.create.mockImplementation((e) => e);
    matcher = { findMatchingVulnerabilitiesForLibraries: jest.fn() };
    closeIssues = jest.fn().mockResolvedValue({ success: true });

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
          useValue: detectionHistoryRepo,
        },
        { provide: getRepositoryToken(HistoryItem), useValue: historyItemRepo },
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
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'high', priorityScore: 80 }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: closeIssues },
        },
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
          useValue: {
            getService: () => ({
              getScan: jest.fn().mockReturnValue(of({ branch: '' })),
            }),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: getDataSourceToken(), useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getScoringBranches: jest.fn().mockResolvedValue(['main', 'master']),
          },
        },
        { provide: ProjectOrgResolver, useValue: {} },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
  });

  describe('ingestion', () => {
    /** Packages 0..n-1, upserted and read back, each with one advisory. */
    const ingest = async (n: number, advisoryOf: (i: number) => string) => {
      const rows = Array.from({ length: n }, (_, i) => rowOf(i));
      scaDetectedRepo.find.mockImplementation(async ({ where }) =>
        where?.packageName ? rows : [],
      );
      matcher.findMatchingVulnerabilitiesForLibraries.mockImplementation(
        async (libraries: Array<{ name: string }>) =>
          libraries.map((l) => {
            const i = Number(l.name.slice(4));
            return [advisory(advisoryOf(i))];
          }),
      );
      await service.processScaBatch(
        batchOf(Array.from({ length: n }, (_, i) => packageOf(i))),
      );
      return rows;
    };

    it('saves 20 re-detections once, without reload, and writes their history in one INSERT', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => rowOf(i));
      const existing = rows.map((row, i) =>
        detection(`det-${i}`, row, `GHSA-${i}`),
      );
      scaVulnRepo.find.mockImplementation(async ({ where }) =>
        where?.stateManuallyModified ? [] : existing,
      );

      await ingest(20, (i) => `GHSA-${i}`);

      expect(scaVulnRepo.save).toHaveBeenCalledTimes(1);
      const [saved, options] = scaVulnRepo.save.mock.calls[0];
      expect(saved).toHaveLength(20);
      expect(options).toEqual({ reload: false });
      // Their sighting is on the entities that were saved.
      for (const det of saved) {
        expect(det.lastDetectedAt.getTime()).toBeGreaterThan(
          new Date('2026-01-01T00:00:00Z').getTime(),
        );
      }

      const historyInserts = statementsOf(detectionHistoryWrites, 'insert');
      expect(historyInserts).toHaveLength(1);
      expect(historyInserts[0].updateEntity).toEqual([false]);
      const [values] = historyInserts[0].values as [
        Array<{ scanId: string; scaVulnerabilityDetection: { id: string } }>,
      ];
      expect(values.map((v) => v.scaVulnerabilityDetection.id)).toEqual(
        existing.map((d) => d.id),
      );
      expect(values.every((v) => v.scanId === 's1')).toBe(true);
      // The detections already in memory are not read again for it.
      expect(detectionHistoryRepo.save).not.toHaveBeenCalled();
      expect(scaVulnRepo.find.mock.calls.filter(([o]) => o?.where?.id)).toEqual(
        [],
      );
    });

    it('keeps creating new detections one at a time', async () => {
      await ingest(3, (i) => `GHSA-new-${i}`);

      const creations = scaVulnRepo.save.mock.calls.filter(
        ([e]) => !Array.isArray(e),
      );
      expect(creations).toHaveLength(3);
      expect(
        statementsOf(detectionHistoryWrites, 'insert')[0].values[0],
      ).toHaveLength(3);
    });

    it('falls back to one save per re-detection when the grouped save fails; a failed one gets no history', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => rowOf(i));
      const existing = rows.map((row, i) =>
        detection(`det-${i}`, row, `GHSA-${i}`),
      );
      scaVulnRepo.find.mockImplementation(async ({ where }) =>
        where?.stateManuallyModified ? [] : existing,
      );
      scaVulnRepo.save.mockImplementation(async (e) => {
        if (Array.isArray(e)) throw new Error('Lock wait timeout exceeded');
        if (e.id === 'det-1') throw new Error('Lock wait timeout exceeded');
        return e;
      });

      await ingest(3, (i) => `GHSA-${i}`);

      const single = scaVulnRepo.save.mock.calls.filter(
        ([e]) => !Array.isArray(e),
      );
      expect(single.map(([e]) => e.id)).toEqual(['det-0', 'det-1', 'det-2']);
      const [values] = statementsOf(detectionHistoryWrites, 'insert')[0]
        .values as [Array<{ scaVulnerabilityDetection: { id: string } }>];
      expect(values.map((v) => v.scaVulnerabilityDetection.id)).toEqual([
        'det-0',
        'det-2',
      ]);
    });

    it('resolves what the scan no longer reports in one UPDATE, with one history INSERT each, and closes the same issues', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => rowOf(i));
      // Each package carries the advisory still reported and one gone.
      const existing = rows.flatMap((row, i) => [
        detection(`det-kept-${i}`, row, `GHSA-${i}`),
        detection(`det-gone-${i}`, row, `GHSA-gone-${i}`),
      ]);
      scaVulnRepo.find.mockImplementation(async ({ where }) =>
        where?.stateManuallyModified ? [] : existing,
      );

      await ingest(3, (i) => `GHSA-${i}`);

      const gone = ['det-gone-0', 'det-gone-1', 'det-gone-2'];
      const updates = statementsOf(detectionWrites, 'update');
      expect(updates).toHaveLength(1);
      expect(updates[0].whereInIds).toEqual([gone]);
      const [set] = updates[0].set as [Record<string, unknown>];
      expect(set).toMatchObject({
        currentState: 'resolved',
        triagedBy: null,
        triagedByType: 'system',
        dismissalReason: null,
      });
      expect(set.resolvedAt).toBeInstanceOf(Date);
      expect(set.triagedAt).toEqual(set.resolvedAt);

      const [items] = statementsOf(historyItemWrites, 'insert')[0].values as [
        Array<Record<string, unknown>>,
      ];
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        type: 'status_change',
        value: 'resolved',
        source: 'system',
        date: set.resolvedAt,
      });
      // The resolved rows are not saved one by one any more.
      expect(
        scaVulnRepo.save.mock.calls.some(([e]) =>
          Array.isArray(e) ? e.some((d) => gone.includes(d.id)) : false,
        ),
      ).toBe(false);
      expect(closeIssues).toHaveBeenCalledWith(
        'p1',
        gone,
        'version_upgrade_fixed',
        'sca',
        expect.anything(),
      );
    });
  });

  describe('finalization (removeMissingLibs)', () => {
    const finalize = async (n: number) => {
      const libs = Array.from({ length: n }, (_, i) => rowOf(i));
      const detections = libs.map((lib, i) =>
        detection(`det-${i}`, lib, `GHSA-${i}`),
      );
      scaDetectedRepo.find.mockResolvedValue(libs);
      scaVulnRepo.find.mockResolvedValue(detections);
      await service.finalizeScan('p1', 's1');
      return { libs, detections };
    };

    it('resolves 150 detections in one UPDATE, one INSERT per history table, one DELETE, and closes the same 150 issues', async () => {
      const { libs, detections } = await finalize(150);
      const ids = detections.map((d) => d.id);

      const updates = statementsOf(detectionWrites, 'update');
      expect(updates).toHaveLength(1);
      expect(updates[0].whereInIds).toEqual([ids]);
      const [set] = updates[0].set as [Record<string, unknown>];
      expect(set).toMatchObject({
        currentState: 'resolved',
        triagedBy: null,
        triagedByType: 'system',
        dismissalReason: null,
      });

      const items = statementsOf(historyItemWrites, 'insert');
      expect(items).toHaveLength(1);
      expect(items[0].updateEntity).toEqual([false]);
      expect(items[0].values[0]).toHaveLength(150);
      const history = statementsOf(detectionHistoryWrites, 'insert');
      expect(history).toHaveLength(1);
      expect(history[0].values[0]).toHaveLength(150);
      // That row records the disappearance, at the resolution's instant.
      expect(
        (history[0].values[0] as Array<{ detectedAt: Date }>)[0].detectedAt,
      ).toEqual(set.resolvedAt);

      const deletes = statementsOf(packageWrites, 'delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].whereInIds).toEqual([libs.map((l) => l.id)]);
      expect(scaDetectedRepo.remove).not.toHaveBeenCalled();
      expect(scaVulnRepo.save).not.toHaveBeenCalled();
      expect(historyItemRepo.save).not.toHaveBeenCalled();
      expect(detectionHistoryRepo.save).not.toHaveBeenCalled();

      expect(closeIssues).toHaveBeenCalledTimes(1);
      expect(closeIssues.mock.calls[0].slice(0, 4)).toEqual([
        'p1',
        ids,
        'dependency_removed',
        'sca',
      ]);
    });

    it('cuts the UPDATE and the DELETE into chunks of 500', async () => {
      await finalize(600);

      expect(
        statementsOf(detectionWrites, 'update').map(
          (s) => (s.whereInIds[0] as string[]).length,
        ),
      ).toEqual([500, 100]);
      expect(
        statementsOf(packageWrites, 'delete').map(
          (s) => (s.whereInIds[0] as string[]).length,
        ),
      ).toEqual([500, 100]);
      expect(
        statementsOf(historyItemWrites, 'insert').map(
          (s) => (s.values[0] as unknown[]).length,
        ),
      ).toEqual([500, 100]);
    });

    it('leaves a dismissal open and deletes its package all the same', async () => {
      const lib = rowOf(0);
      const dismissed = {
        ...detection('det-ignored', lib, 'GHSA-0'),
        currentState: 'ignored',
        stateManuallyModified: true,
      };
      scaDetectedRepo.find.mockResolvedValue([lib]);
      scaVulnRepo.find.mockResolvedValue([dismissed]);

      await service.finalizeScan('p1', 's1');

      expect(statementsOf(detectionWrites, 'update')).toEqual([]);
      expect(statementsOf(historyItemWrites, 'insert')).toEqual([]);
      expect(closeIssues).not.toHaveBeenCalled();
      expect(statementsOf(packageWrites, 'delete')[0].whereInIds).toEqual([
        [lib.id],
      ]);
    });

    it('inserts the history of the detections that still exist when one vanished (foreign key)', async () => {
      detectionHistoryWrites.run.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Cannot add or update a child row'), {
          code: 'ER_NO_REFERENCED_ROW_2',
          errno: 1452,
        });
      });
      scaVulnRepo.find.mockImplementation(async ({ where }) =>
        where?.id
          ? [{ id: 'det-0' }, { id: 'det-2' }]
          : [0, 1, 2].map((i) => detection(`det-${i}`, rowOf(i), `GHSA-${i}`)),
      );
      scaDetectedRepo.find.mockResolvedValue([0, 1, 2].map(rowOf));

      await service.finalizeScan('p1', 's1');

      const inserts = statementsOf(detectionHistoryWrites, 'insert');
      expect(inserts).toHaveLength(2);
      expect(
        (
          inserts[1].values[0] as Array<{
            scaVulnerabilityDetection: { id: string };
          }>
        ).map((v) => v.scaVulnerabilityDetection.id),
      ).toEqual(['det-0', 'det-2']);
    });

    it('inserts the status rows of the detections that still exist when one vanished after the UPDATE (foreign key)', async () => {
      historyItemWrites.run.mockImplementationOnce(async () => {
        throw Object.assign(new Error('Cannot add or update a child row'), {
          code: 'ER_NO_REFERENCED_ROW_2',
          errno: 1452,
        });
      });
      scaVulnRepo.find.mockImplementation(async ({ where }) =>
        where?.id
          ? [{ id: 'det-0' }, { id: 'det-2' }]
          : [0, 1, 2].map((i) => detection(`det-${i}`, rowOf(i), `GHSA-${i}`)),
      );
      scaDetectedRepo.find.mockResolvedValue([0, 1, 2].map(rowOf));

      await service.finalizeScan('p1', 's1');

      const inserts = statementsOf(historyItemWrites, 'insert');
      expect(inserts).toHaveLength(2);
      expect(
        (
          inserts[1].values[0] as Array<{
            scaVulnerabilityDetection: { id: string };
          }>
        ).map((v) => v.scaVulnerabilityDetection.id),
      ).toEqual(['det-0', 'det-2']);
    });
  });

  it('writes, on a resolution, every field applyTriageToDetection sets, and the state', async () => {
    // Every field the helper writes, whatever its type says.
    const written = new Set<string>();
    const probe = new Proxy({} as Record<string, unknown>, {
      set: (target, key, value) => {
        written.add(String(key));
        target[String(key)] = value;
        return true;
      },
    }) as unknown as Parameters<typeof applyTriageToDetection>[0];
    applyTriageToDetection(probe, { status: 'resolved' }, new Date(), 'system');
    const lib = rowOf(0);
    scaDetectedRepo.find.mockResolvedValue([lib]);
    scaVulnRepo.find.mockResolvedValue([detection('det-0', lib, 'GHSA-0')]);

    await service.finalizeScan('p1', 's1');

    const [set] = statementsOf(detectionWrites, 'update')[0].set as [
      Record<string, unknown>,
    ];
    expect(Object.keys(set).sort()).toEqual(
      [...written, 'currentState'].sort(),
    );
  });
});
