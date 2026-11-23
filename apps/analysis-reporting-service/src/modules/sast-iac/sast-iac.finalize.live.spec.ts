import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { currentDialect, ident, sql } from '@cybedefend/db-dialect';
import type { Sql } from '@cybedefend/db-dialect';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import {
  ScanAddResultRequest,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import { SastIacService } from './sast-iac.service';
import { SastIacUtilsService } from './sast-iac.utils';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { VulnerabilityDetectionHistory } from 'src/entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from 'src/entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from 'src/entities/vulnerability/vulnerability.entity';
import { CodeSnippet } from 'src/entities/code-snippet.entity';
import { DataFlowItem } from 'src/entities/data-flow-item.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { joinSql, rawSql } from 'src/core/db/raw-sql';
import {
  analyzeTables,
  indexColumns,
  indexIsUnique,
  planAccesses,
} from 'src/test-utils/live-introspection';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../cvss/cvss-calculator.service';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecretEncryptionService } from 'src/core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { ScanMetaCache } from '../scan-queue/scan-meta-cache.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

/**
 * LIVE spec against a REAL database: the schema every migration
 * builds (foreign keys and the new IDX_vdh_scanId included), and two scans of
 * a project ingested in two batches each through the real SastIacService and
 * SastIacUtilsService. What the unit specs cannot show: the ON DELETE CASCADE
 * foreign keys that take a merged-away detection's history with it, the SQL
 * `loadRelationIds` and `relationLoadStrategy: 'query'` really emit, and the
 * plan the engine picks for a read by scanId.
 *
 * It runs on both engines, on the one LIVE_DB_TYPE selects, with the
 * schema of that engine's migration tracks (createLiveDatabase); the MySQL
 * migration's own up/down proof moved to
 * sast-iac.vdh-scanid-migration.live.spec.ts (MySQL track only).
 *
 * Skipped unless `SAST_IAC_FINALIZE_LIVE=1` (the former
 * `SAST_IAC_FINALIZE_MYSQL_LIVE=1` still works and means MySQL), so
 * `pnpm run test` stays hermetic. It creates a throwaway database, runs every
 * migration of the service there, and drops it at the end. Redis is not used
 * (the ScanMetaCache reads an in-memory stand-in).
 *
 * How to run:
 *   SAST_IAC_FINALIZE_LIVE=1 LIVE_DB_TYPE=mysql SAST_IAC_FINALIZE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=sast-iac.finalize.live --runInBand
 *   SAST_IAC_FINALIZE_LIVE=1 LIVE_DB_TYPE=postgres SAST_IAC_FINALIZE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=sast-iac.finalize.live --runInBand
 */
const LIVE = liveEnabled('SAST_IAC_FINALIZE');
const describeLive = LIVE ? describe : describe.skip;

describeLive('SAST/IaC ingestion and finalization on a real MySQL', () => {
  jest.setTimeout(300_000);

  const PROJECT = 'p-live';
  const SEVERITIES = 'CRITICAL,HIGH,MEDIUM,LOW';
  let live: LiveDatabase;
  let dataSource: DataSource;
  let service: SastIacService;
  let getScan: jest.Mock;

  const repo = <T extends ObjectLiteral>(entity: EntityTarget<T>) =>
    dataSource.getRepository(entity);

  /** Runs a statement written with the dialect's `sql` tag. */
  const run = (statement: Sql) =>
    dataSource.query(statement.text, statement.params);
  const historyOf = (column: string, id: string) =>
    run(
      sql`SELECT ${ident('scanId')} AS ${ident('scanId')} FROM vulnerability_detection_history WHERE ${ident(column)} = ${id}`,
    );
  /**
   * History rows of many scans, `scanOf(i)` naming the scan of the i-th,
   * inserted in chunks: enough rows that reading the whole table costs more
   * than the index range on both engines (PostgreSQL reads a table of a page
   * or two whole, whatever its indexes).
   */
  const insertHistory = async (
    count: number,
    scanOf: (i: number) => string,
  ): Promise<void> => {
    for (let from = 0; from < count; from += 500) {
      const values = Array.from(
        { length: Math.min(500, count - from) },
        (_, k) => sql`(${randomUUID()}, ${scanOf(from + k)}, NOW())`,
      );
      await run(
        sql`INSERT INTO vulnerability_detection_history (id, ${ident('scanId')}, ${ident('detectedAt')}) VALUES ${joinSql(values, ', ')}`,
      );
    }
  };
  /** `<column> - 1 day`, the merge compares rows created a day apart. */
  const dayEarlier = (column: string) =>
    currentDialect() === 'mysql'
      ? `${column} - INTERVAL 1 DAY`
      : `"${column}" - INTERVAL '1 day'`;

  const iacFinding = (
    ruleId: string,
    path: string,
    line: number,
    content: string,
  ): VulnerabilityDtoRequest =>
    ({
      ruleId,
      language: 'terraform',
      cwe: [],
      owaspTop10: [],
      name: ruleId,
      description: '',
      severity: 'HIGH',
      confidence: 'HIGH',
      path,
      fileHash: `${path}:${content}`,
      codeSnippet: {
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        startLine: line,
        endLine: line,
        code: [{ line, content }],
        language: 'terraform',
        path,
      },
      dataFlow: [],
      inlineIgnores: [],
    }) as VulnerabilityDtoRequest;

  const ingest = (
    scanId: string,
    vulnerabilities: VulnerabilityDtoRequest[],
  ): Promise<unknown> =>
    service.processSastIacBatch({
      projectId: PROJECT,
      scanId,
      scannerName: 'checkov',
      vulnerabilityType: SEVERITIES,
      vulnerabilities,
      isLastRequest: false,
    } as ScanAddResultRequest);

  const iacRows = () =>
    repo(IacVulnerabilityDetections).find({
      where: { projectId: PROJECT },
      order: { path: 'ASC', createdAt: 'ASC' },
    });

  beforeAll(async () => {
    // The core entities, the schema of the engine's migration tracks.
    live = await createLiveDatabase({
      prefix: 'back240_l11',
      envPrefix: 'SAST_IAC_FINALIZE',
      migrations: 'track',
    });
    dataSource = live.dataSource;

    // The catalogue: three checkov rules on three catalogue vulnerabilities.
    for (const n of [1, 2, 3]) {
      const vulnerability = await repo(Vulnerability).save(
        repo(Vulnerability).create({
          name: `Rule ${n}`,
          shortDescription: '',
          description: '',
          howToPrevent: '',
          severity: 'HIGH',
          language: 'terraform',
          vulnerabilityType: 'iac',
          code: `CD-IAC-990${n}`,
        }),
      );
      await repo(CorrespondanceTable).save(
        repo(CorrespondanceTable).create({
          scanner: 'checkov',
          ruleId: `CKV_LIVE_${n}`,
          vulnerabilityType: 'iac',
          enabled: true,
          vulnerability,
        }),
      );
    }

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const redisStore = new Map<string, string>();
    const scanMetaCache = new ScanMetaCache({
      getRedisClient: async () => ({
        get: async (key: string) => redisStore.get(key) ?? null,
        set: async (key: string, value: string) => {
          redisStore.set(key, value);
          return 'OK';
        },
      }),
    } as unknown as ScanQueueService);

    const module = await Test.createTestingModule({
      providers: [
        SastIacService,
        SastIacUtilsService,
        ...[
          SastVulnerabilityDetections,
          IacVulnerabilityDetections,
          CicdVulnerabilityDetections,
          SecretVulnerabilityDetections,
          ScaVulnerabilityDetections,
          AutoFixRecord,
          VulnerabilityDetectionHistory,
          CorrespondanceTable,
          CodeSnippet,
          DataFlowItem,
        ].map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: dataSource.getRepository(entity),
        })),
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: (item: HistoryItem) =>
              dataSource.getRepository(HistoryItem).save(item),
            computeEnvironmentalForProject: async () => null,
            recalculatePriority: async () => ({
              priority: 'high',
              priorityScore: 60,
            }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: { closeIssuesForResolvedVulnerabilities: async () => {} },
        },
        {
          provide: CvssCalculatorService,
          useValue: new CvssCalculatorService(),
        },
        { provide: CvssExplainerService, useValue: {} },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => {} },
        },
        { provide: SecurityContextCacheService, useValue: {} },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: Logger, useValue: logger },
        { provide: ScanMetaCache, useValue: scanMetaCache },
      ],
    }).compile();

    service = module.get(SastIacService);
    getScan = jest.fn(() => of({ branch: 'main', isDiffScan: false }));
    (service as unknown as { scanServiceClient: unknown }).scanServiceClient = {
      getScan,
    };
  });

  afterAll(async () => {
    await live?.drop();
  });

  it('the migrations create IDX_vdh_scanId, and a read by scanId uses it', async () => {
    expect(
      await indexColumns(
        dataSource,
        'vulnerability_detection_history',
        'IDX_vdh_scanId',
      ),
    ).toEqual(['scanId']);

    // Rows of many scans, so the plan is a real choice.
    await insertHistory(5000, (i) => `scan-${i % 500}`);
    await analyzeTables(dataSource, ['vulnerability_detection_history']);
    const [plan] = await planAccesses(
      dataSource,
      `SELECT * FROM vulnerability_detection_history WHERE ${ident('scanId').text} = 'scan-3'`,
    );
    expect(plan).toMatchObject({ key: 'IDX_vdh_scanId', full: false });
    // MySQL's access type for an equality on a non-unique index.
    if (currentDialect() === 'mysql') expect(plan.type).toBe('ref');
    await run(
      sql`DELETE FROM vulnerability_detection_history WHERE ${ident('scanId')} LIKE 'scan-%'`,
    );
  });

  it.each([
    ['SAST', SastVulnerabilityDetections, 'sastVulnerabilityDetectionId'],
    ['IaC', IacVulnerabilityDetections, 'iacVulnerabilityDetectionId'],
    // The CICD foreign key comes from 1766000000001, not the initial schema.
    ['CICD', CicdVulnerabilityDetections, 'cicdVulnerabilityDetectionId'],
  ] as const)(
    'deleting a %s detection deletes its history (ON DELETE CASCADE)',
    async (_family, entity, column) => {
      const id = randomUUID();
      const table = ident(repo(entity).metadata.tableName);
      await run(
        sql`INSERT INTO ${table}
           (id, ${ident('projectId')}, ${ident('currentState')}, ${ident('currentSeverity')}, ${ident('currentPriority')}, language, path,
            ${ident('vulnerableStartLine')}, ${ident('vulnerableEndLine')}, ${ident('scannerType')})
         VALUES (${id}, 'p-fk', 'to_verify', 'HIGH', 'high', 'terraform', 'x.tf', 1, 1, 'checkov')`,
      );
      await run(
        sql`INSERT INTO vulnerability_detection_history (id, ${ident('scanId')}, ${ident('detectedAt')}, ${ident(column)})
         VALUES (${randomUUID()}, 'scan-fk', NOW(), ${id}), (${randomUUID()}, 'scan-fk-2', NOW(), ${id})`,
      );
      expect(await historyOf(column, id)).toHaveLength(2);

      await run(sql`DELETE FROM ${table} WHERE id = ${id}`);

      expect(await historyOf(column, id)).toHaveLength(0);
    },
  );

  it('two scans of two batches: kept, created, resolved, and a moved finding merged with its history gone', async () => {
    // Scan 1: three findings, in two batches.
    await ingest('scan-1', [
      iacFinding('CKV_LIVE_1', 'a.tf', 10, 'acl = "public-read"'),
      iacFinding('CKV_LIVE_3', 'c.tf', 5, 'encrypted = false'),
    ]);
    await ingest('scan-1', [
      iacFinding('CKV_LIVE_2', 'd.tf', 20, 'cidr_blocks = ["0.0.0.0/0"]'),
    ]);
    await service.finalizeScan(PROJECT, 'scan-1', 'checkov');

    const afterScan1 = await iacRows();
    expect(afterScan1.map((d) => [d.path, d.currentState])).toEqual([
      ['a.tf', 'to_verify'],
      ['c.tf', 'to_verify'],
      ['d.tf', 'to_verify'],
    ]);
    const [a, c, d] = afterScan1;
    // The merge keeps the row created first, compared on `createdAt`, a
    // TIMESTAMP to the second: two scans a day apart, as in real life, not
    // two inside the same second of this test.
    await run(
      sql`UPDATE vulnerability_detections_iac
          SET ${ident('createdAt')} = ${rawSql(dayEarlier('createdAt'))}
        WHERE ${ident('projectId')} = ${PROJECT}`,
    );

    // Scan 2: a.tf unchanged, c.tf fixed (absent), b.tf new, and d.tf moved
    // three lines down with a comment added on the line. The comment moves
    // the fingerprint, so ingestion creates a second row; areVulnsSimilar
    // ignores comments, so the finalization merges the two.
    getScan.mockClear();
    await ingest('scan-2', [
      iacFinding('CKV_LIVE_1', 'a.tf', 10, 'acl = "public-read"'),
    ]);
    await ingest('scan-2', [
      iacFinding('CKV_LIVE_2', 'b.tf', 1, 'cidr_blocks = ["0.0.0.0/0"]'),
      iacFinding(
        'CKV_LIVE_2',
        'd.tf',
        23,
        'cidr_blocks = ["0.0.0.0/0"] # open on purpose',
      ),
    ]);
    const beforeFinalize = await iacRows();
    const movedCopy = beforeFinalize.find(
      (row) => row.path === 'd.tf' && row.id !== d.id,
    );
    expect(movedCopy).toBeDefined();
    expect(
      await historyOf('iacVulnerabilityDetectionId', movedCopy.id),
    ).toEqual([{ scanId: 'scan-2' }]);

    await service.finalizeScan(PROJECT, 'scan-2', 'checkov');

    // Two batches and a finalization: one GetScan.
    expect(getScan).toHaveBeenCalledTimes(1);

    const after = await iacRows();
    expect(after.map((row) => [row.path, row.currentState])).toEqual([
      ['a.tf', 'to_verify'],
      ['b.tf', 'to_verify'],
      ['c.tf', 'resolved'],
      ['d.tf', 'to_verify'],
    ]);
    // The ids that survived: a, c and d are the rows.
    expect(after.find((row) => row.path === 'a.tf').id).toBe(a.id);
    expect(after.find((row) => row.path === 'c.tf').id).toBe(c.id);
    const survivor = after.find((row) => row.path === 'd.tf');
    expect(survivor.id).toBe(d.id);
    expect(survivor.vulnerableStartLine).toBe(23);

    // The merged-away copy is gone, and its history went with it.
    expect(
      await repo(IacVulnerabilityDetections).findOneBy({ id: movedCopy.id }),
    ).toBeNull();
    expect(
      await historyOf('iacVulnerabilityDetectionId', movedCopy.id),
    ).toHaveLength(0);

    // a.tf was matched by batch 1 of scan 2: its history carries both scans.
    expect(
      (await historyOf('iacVulnerabilityDetectionId', a.id))
        .map((row: { scanId: string }) => row.scanId)
        .sort(),
    ).toEqual(['scan-1', 'scan-2']);
  });

  it('reads what loadRelationIds returns on MySQL: ids, not entities', async () => {
    const utils = (
      service as unknown as { sastIacUtilsService: SastIacUtilsService }
    ).sastIacUtilsService;

    const sighted = await utils.findScanSightingIds('scan-2');
    expect(sighted.sast).toEqual([]);
    expect(sighted.cicd).toEqual([]);
    expect(sighted.iac.length).toBeGreaterThanOrEqual(2);
    for (const id of sighted.iac) expect(typeof id).toBe('string');

    const catalogue = await repo(Vulnerability).find({
      order: { code: 'ASC' },
    });
    const rules = await utils.findEnabledCorrespondancesByVuln(
      catalogue.map((v) => v.id),
    );
    expect(catalogue.map((v) => rules.get(v.id)?.map((r) => r.ruleId))).toEqual(
      [['CKV_LIVE_1'], ['CKV_LIVE_2'], ['CKV_LIVE_3']],
    );
  });

  it('the sightings read keeps to the SAST, IaC and CICD rows of the scan, through IDX_vdh_scanId', async () => {
    const utils = (
      service as unknown as { sastIacUtilsService: SastIacUtilsService }
    ).sastIacUtilsService;
    // A row of scan-2 that sights no SAST, IaC or CICD detection: what an
    // SCA or a secret row looks like to this read.
    const other = randomUUID();
    await run(
      sql`INSERT INTO vulnerability_detection_history (id, ${ident('scanId')}, ${ident('detectedAt')}) VALUES (${other}, 'scan-2', NOW())`,
    );
    const historyRepo = repo(VulnerabilityDetectionHistory);
    const find = jest.spyOn(historyRepo, 'find');
    try {
      const sighted = await utils.findScanSightingIds('scan-2');
      const rows: VulnerabilityDetectionHistory[] =
        await find.mock.results[0].value;

      expect(rows.map((r) => r.id)).not.toContain(other);
      expect(rows).toHaveLength(
        sighted.sast.length + sighted.iac.length + sighted.cicd.length,
      );
      expect(sighted.iac.length).toBeGreaterThanOrEqual(2);

      // Other scans' rows, so the plan is a real choice (removed below).
      await insertHistory(5000, (i) => `noise-${i % 500}`);
      await analyzeTables(dataSource, ['vulnerability_detection_history']);
      const [statement, parameters] = historyRepo
        .createQueryBuilder()
        .setFindOptions({ where: find.mock.calls[0][0].where })
        .getQueryAndParameters();
      const plan = await planAccesses(dataSource, statement, parameters);
      expect(plan.map((p) => p.key)).toEqual(['IDX_vdh_scanId']);
    } finally {
      find.mockRestore();
      await run(
        sql`DELETE FROM vulnerability_detection_history WHERE id = ${other}`,
      );
      await run(
        sql`DELETE FROM vulnerability_detection_history WHERE ${ident('scanId')} LIKE 'noise-%'`,
      );
    }
  });

  it('overlapping scans: finalizing the older one keeps open what it sighted, even if the newer one sighted it since', async () => {
    const open = (await iacRows()).filter(
      (row) => row.currentState === 'to_verify',
    );
    expect(open.map((row) => row.path)).toEqual(['a.tf', 'b.tf', 'd.tf']);
    const findings = [
      iacFinding('CKV_LIVE_1', 'a.tf', 10, 'acl = "public-read"'),
      iacFinding('CKV_LIVE_2', 'b.tf', 1, 'cidr_blocks = ["0.0.0.0/0"]'),
      iacFinding(
        'CKV_LIVE_2',
        'd.tf',
        23,
        'cidr_blocks = ["0.0.0.0/0"] # open on purpose',
      ),
    ];
    // Scan A sights the three findings, then scan B, started after it on
    // the same branch, sights them too: B wrote their latest history rows.
    await ingest('scan-A', findings);
    await ingest('scan-B', findings);

    await service.finalizeScan(PROJECT, 'scan-A', 'checkov');

    const afterA = await iacRows();
    expect(
      afterA
        .filter((row) => open.some((o) => o.id === row.id))
        .map((row) => [row.path, row.currentState]),
    ).toEqual([
      ['a.tf', 'to_verify'],
      ['b.tf', 'to_verify'],
      ['d.tf', 'to_verify'],
    ]);
  });

  // The survivor of a line-drift merge
  // had no fingerprint, took the digest of the row the merge discards, and
  // was saved while that row still held it. UNIQUE (projectId, branch,
  // fingerprint) refused the save and the whole finalization failed, scan
  // after scan. The unit spec simulates the index; this one is MySQL's.
  it('merges a moved finding into a survivor without a fingerprint, under the real UNIQUE index', async () => {
    expect(
      await indexIsUnique(
        dataSource,
        'vulnerability_detections_iac',
        'UQ_vulnerability_detections_iac_fingerprint',
      ),
    ).toBe(true);

    await ingest('scan-b196-1', [
      iacFinding('CKV_LIVE_3', 'e.tf', 30, 'kms_key_id = ""'),
    ]);
    await service.finalizeScan(PROJECT, 'scan-b196-1', 'checkov');
    const legacy = (await iacRows()).find((row) => row.path === 'e.tf');
    // A row from before fingerprints, a day older than the next scan.
    await run(
      sql`UPDATE vulnerability_detections_iac
            SET fingerprint = NULL, ${ident('createdAt')} = ${rawSql(dayEarlier('createdAt'))}
          WHERE id = ${legacy.id}`,
    );

    // The finding moved four lines down and gained a comment: ingestion
    // creates a second row, with a digest; the repair merges the two.
    await ingest('scan-b196-2', [
      iacFinding('CKV_LIVE_3', 'e.tf', 34, 'kms_key_id = "" # rotate later'),
    ]);
    const moved = (await iacRows()).find(
      (row) => row.path === 'e.tf' && row.id !== legacy.id,
    );
    expect(moved).toBeDefined();
    // This harness wires no occurrence allocator, so ingestion writes a NULL
    // digest (an unrankable batch). Give the new row the digest a healthy
    // scan writes: the merge carries it onto the survivor.
    const digest = 'b196-live-digest';
    await run(
      sql`UPDATE vulnerability_detections_iac SET fingerprint = ${digest} WHERE id = ${moved.id}`,
    );

    await service.finalizeScan(PROJECT, 'scan-b196-2', 'checkov');

    const rows = (await iacRows()).filter((row) => row.path === 'e.tf');
    expect(rows.map((row) => row.id)).toEqual([legacy.id]);
    expect(rows[0].fingerprint).toBe(digest);
    expect(rows[0].vulnerableStartLine).toBe(34);
    expect(rows[0].currentState).toBe('to_verify');
    // The discarded row is gone with its history; the survivor kept its own.
    expect(
      await historyOf('iacVulnerabilityDetectionId', moved.id),
    ).toHaveLength(0);
    expect(await historyOf('iacVulnerabilityDetectionId', legacy.id)).toEqual([
      { scanId: 'scan-b196-1' },
    ]);
    // The survivor's snippet is the moved one, its old one deleted.
    const snippets = await run(
      sql`SELECT ${ident('vulnerableStartLine')} AS line FROM code_snippet
          WHERE ${ident('iacVulnerabilityDetectionId')} = ${legacy.id}`,
    );
    expect(snippets).toEqual([{ line: 34 }]);
  });
});
