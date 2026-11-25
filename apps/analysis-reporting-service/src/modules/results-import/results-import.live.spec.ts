import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ClientGrpc } from '@nestjs/microservices';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  type LiveDatabase,
} from '../../core/db/live-database';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { ResultService } from '../result/result.service';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import {
  CvssCalculatorService,
  EnvironmentalResult,
  SecurityContextForScoring,
} from '../cvss/cvss-calculator.service';
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { SecretEncryptionService } from '../../core/crypto/secret-encryption.service';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import {
  ResultsImportJobData,
  ScanQueueService,
} from '../scan-queue/scan-queue.service';
import type { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
import type { RealtimeBatchPublisher } from '../../core/realtime/realtime-batch-publisher.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { VulnerabilityDetectionHistory } from '../../entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { DataFlowItem } from '../../entities/data-flow-item.entity';
import { HistoryItem } from '../../entities/history-item.entity';
import {
  CatalogueFallbackService,
  importedRuleKey,
  organizationImportedRuleKey,
} from './catalogue-fallback.service';
import type { ImportFileSource } from './import-file.source';
import { ResultsImportProcessor } from './results-import.processor';
import type { ScaService } from '../sca/sca.service';
import type { ContainerService } from '../container/container.service';
import type { AdvisoryFallbackService } from './advisory-fallback.service';

/**
 * LIVE end-to-end proofs of the SARIF import, on PostgreSQL (the import is a
 * Community Edition feature, and the Community Edition runs on PostgreSQL
 * only: with LIVE_DB_TYPE=mysql the suite skips) and a real Redis:
 *
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/results-import.live.spec.ts
 *
 * That command runs seven cases (a few minutes: the CI db-engines job runs
 * them on every analysis-reporting change).
 * The 100,000-result case is an acceptance run, not a per-PR check: about
 * one hour per engine, bound by the database's disk I/O (a commit per write
 * of each detection). It runs only when RESULTS_IMPORT_LIVE_100K=1 is set on
 * top of the suite's flag, at low machine load:
 *
 *   RESULTS_IMPORT_MYSQL_LIVE=1 RESULTS_IMPORT_LIVE_100K=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/results-import.live.spec.ts
 *
 * A SARIF file goes through the real ResultsImportProcessor: the stream
 * reader, the mapper, the real CatalogueFallbackService, the real
 * SastIacService ingestion and finalization, and the real ScanQueueService
 * (finalize locks, batch tracking) on Redis RESULTS_IMPORT_REDIS_URL (default
 * redis://127.0.0.1:6379, queues under a per-run prefix). Only the edges are
 * fakes: the file source reads the fixture from disk, GetScan answers
 * `{ branch: 'main', isDiffScan: false }`, CompleteImportScan and the end of
 * scan dispatch are jest.fn().
 *
 * The database `results_import_<12 hex>` comes from createLiveDatabase and is
 * migrated with the PostgreSQL baseline + common; it is dropped at the end. Counts are read with
 * repository.count, never a raw COUNT(*) (pg returns it as a string).
 */
const LIVE = process.env.RESULTS_IMPORT_MYSQL_LIVE === '1';
// SARIF import is a Community Edition feature, and the Community Edition runs
// on PostgreSQL only (it refuses DB_TYPE=mysql at boot): the MySQL pass skips.
const describeLive =
  LIVE && parseDialect(process.env.LIVE_DB_TYPE) === 'postgres'
    ? describe
    : describe.skip;
/**
 * The 100,000-result acceptance case: about one hour per engine, I/O-bound,
 * so it is opt-in on top of the suite's flag (see the header).
 */
const itLive100k = process.env.RESULTS_IMPORT_LIVE_100K === '1' ? it : it.skip;
const REDIS_URL =
  process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379';
const FIXTURES = join(__dirname, '../../../../../libs/test-fixtures/sarif');

/** Writes `count` results of one rule, path `src/f<n>.js`, line 1, as a stream. */
async function writeGeneratedSarif(path: string, count: number): Promise<void> {
  function* parts(): Generator<string> {
    yield '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"GenTool","rules":[';
    yield JSON.stringify({
      id: 'gen-rule',
      shortDescription: { text: 'Generated rule' },
      properties: { tags: ['CWE-79'] },
    });
    yield ']}},"results":[';
    for (let n = 0; n < count; n += 1) {
      yield (n > 0 ? ',' : '') +
        JSON.stringify({
          ruleId: 'gen-rule',
          level: 'error',
          message: { text: 'generated result' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: `src/f${n}.js` },
                region: { startLine: 1 },
              },
            },
          ],
        });
    }
    yield ']}]}';
  }
  await pipeline(Readable.from(parts()), createWriteStream(path));
}

describeLive('SARIF import end to end on a real database', () => {
  // SARIF import is a Community Edition feature: the
  // worker refuses every job elsewhere.
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  beforeAll(() => {
    process.env.CYBEDEFEND_EDITION = 'community';
  });
  afterAll(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
  });

  jest.setTimeout(300_000);
  const HOOK_TIMEOUT = 300_000;

  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  const bullPrefix = `bull-results-import-live-${randomUUID()}`;

  let live: LiveDatabase;
  let tmp: string;
  let fallback: CatalogueFallbackService;
  let queues: Queue[];
  let scanQueue: ScanQueueService;
  let sastIac: SastIacService;
  let processor: ResultsImportProcessor;
  let completeImportScan: jest.Mock;
  let onScannerFinalized: jest.Mock;

  // No project security context unless a case sets one.
  const computeEnvironmentalForProject = jest.fn<
    Promise<EnvironmentalResult | null>,
    [string, string]
  >(async () => null);

  const repo = <T extends ObjectLiteral>(entity: EntityTarget<T>) =>
    live.dataSource.getRepository(entity);

  const sastRows = (projectId: string) =>
    repo(SastVulnerabilityDetections).find({
      where: { projectId },
      relations: ['vulnerability'],
      order: { path: 'ASC' },
    });

  const countSast = (projectId: string) =>
    repo(SastVulnerabilityDetections).count({ where: { projectId } });

  /** The organisation of each project: a project belongs to one. */
  const organisations = new Map<string, string>();
  const organisationOf = (projectId: string): string => {
    if (!organisations.has(projectId)) {
      organisations.set(projectId, randomUUID());
    }
    return organisations.get(projectId);
  };

  /** One import of `file` (a path) as a new scan of `projectId`. */
  const runImport = async (
    projectId: string,
    file: string,
    organizationId: string = organisationOf(projectId),
  ): Promise<string> => {
    const scanId = randomUUID();
    const data: ResultsImportJobData = {
      scanId,
      projectId,
      organizationId,
      branch: 'main',
      category: 'sast',
      format: 'sarif',
      // The fake file source reads this path.
      fileKey: file,
    };
    await processor.process({
      id: `results-import-${scanId}`,
      data,
    } as Job<ResultsImportJobData>);
    return scanId;
  };

  const fixture = (name: string) => join(FIXTURES, name);

  /** The CompleteImportScan request of `scanId` (exactly one). */
  const completionOf = (scanId: string) => {
    const calls = completeImportScan.mock.calls.filter(
      ([request]) => request.scanId === scanId,
    );
    expect(calls).toHaveLength(1);
    return calls[0][0];
  };

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'results-import-live-'));
    live = await createLiveDatabase({
      prefix: 'results_import',
      envPrefix: 'RESULTS_IMPORT',
      dialect,
      migrations: 'track',
    });

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const url = new URL(REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379) };
    queues = Object.values(QUEUE_NAMES).map(
      (name) => new Queue(name, { connection, prefix: bullPrefix }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        SastIacService,
        SastIacUtilsService,
        ScanQueueService,
        ...queues.map((queue) => ({
          provide: getQueueToken(queue.name),
          useValue: queue,
        })),
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
          useValue: live.dataSource.getRepository(entity),
        })),
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: (item: HistoryItem) =>
              live.dataSource.getRepository(HistoryItem).save(item),
            computeEnvironmentalForProject,
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
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: () => undefined },
        },
        { provide: SecretEncryptionService, useValue: {} },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: async () => {} },
        },
        {
          provide: SecurityContextCacheService,
          useValue: { getUpdatedAt: async () => null },
        },
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
      ],
    }).compile();

    scanQueue = moduleRef.get(ScanQueueService);
    await scanQueue.onModuleInit();
    sastIac = moduleRef.get(SastIacService);
    (sastIac as unknown as { scanServiceClient: unknown }).scanServiceClient = {
      getScan: jest.fn(() => of({ branch: 'main', isDiffScan: false })),
    };

    fallback = new CatalogueFallbackService(
      live.dataSource,
      moduleRef.get(SastIacUtilsService),
      scanQueue,
      logger as unknown as Logger,
    );
    const files = {
      open: (_projectId: string, fileKey: string) => async () =>
        createReadStream(fileKey),
    } as unknown as ImportFileSource;

    completeImportScan = jest.fn(() => of({}));
    onScannerFinalized = jest.fn(async () => undefined);
    processor = new ResultsImportProcessor(
      sastIac,
      scanQueue,
      { onScannerFinalized } as unknown as ScanCompleteNotificationService,
      { publishNow: jest.fn() } as unknown as RealtimeBatchPublisher,
      fallback,
      files,
      {
        getService: () => ({ completeImportScan }),
      } as unknown as ClientGrpc,
      // The sast/iac/secret/cicd imports of this spec never reach the SCA,
      // container or advisory side (the import's constructor).
      {} as unknown as ScaService,
      {} as unknown as ContainerService,
      {} as unknown as AdvisoryFallbackService,
    );
    processor.onModuleInit();
    processor.delay = async () => undefined;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Each cleanup step on its own: one failing handle must not leave the
    // others open and hang the Jest process.
    try {
      await (await scanQueue.getRedisClient()).quit();
    } catch {
      /* the client never came up */
    }
    for (const queue of queues ?? []) {
      try {
        await queue.close();
      } catch {
        /* ignore */
      }
    }
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await live?.drop();
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports minimal.sarif: rows, local codes, CompleteImportScan completed', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(projectId, fixture('minimal.sarif'));

    const rows = await sastRows(projectId);
    expect(await countSast(projectId)).toBe(2);
    expect(rows.map((r) => [r.path, r.vulnerableStartLine])).toEqual([
      ['app/views.py', 12],
      ['web/server.js', 30],
    ]);
    for (const row of rows) {
      expect(row.vulnerability.code).toMatch(/^CD-SAST-9\d{4}$/);
      expect(row.currentState).toBe('to_verify');
    }
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'completed',
        errorCode: '',
        findingsCount: 2,
        toolName: 'semgrep',
      }),
    );
  });

  it('keeps the SARIF rule id of each imported finding, as written in the file', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('minimal.sarif'));

    const rows = await sastRows(projectId);
    expect(rows.map((r) => [r.path, r.scannerRuleId])).toEqual([
      ['app/views.py', 'python.lang.security.audit.eval-detected'],
      [
        'web/server.js',
        'javascript.express.security.audit.xss.direct-response-write',
      ],
    ]);
  });

  it.each(['minimal.sarif', 'extensions-rules.sarif'])(
    're-importing the same file creates no new row and resolves nothing (%s)',
    async (name) => {
      const projectId = randomUUID();
      await runImport(projectId, fixture(name));
      const before = await sastRows(projectId);
      expect(before.length).toBeGreaterThan(0);

      const second = await runImport(projectId, fixture(name));
      expect(completionOf(second).status).toBe('completed');

      const after = await sastRows(projectId);
      expect(after.map((r) => r.id).sort()).toEqual(
        before.map((r) => r.id).sort(),
      );
      // The empty snippet of extensions-rules.sarif keeps a stable fileHash.
      expect(
        after
          .map((r) => [r.id, r.fileHash])
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      ).toEqual(
        before
          .map((r) => [r.id, r.fileHash])
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      );
      for (const row of after) expect(row.currentState).toBe('to_verify');
    },
  );

  it('gives two organisations, and two projects of one organisation, their own catalogue rules', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const [a1, a2, b1] = [randomUUID(), randomUUID(), randomUUID()];
    await runImport(a1, fixture('minimal.sarif'), orgA);
    await runImport(a2, fixture('minimal.sarif'), orgA);
    await runImport(b1, fixture('minimal.sarif'), orgB);
    const rulesOf = async (projectId: string) =>
      (await sastRows(projectId)).map((r) => r.vulnerability.id).sort();
    const [ruleA1, ruleA2, ruleB1] = await Promise.all([
      rulesOf(a1),
      rulesOf(a2),
      rulesOf(b1),
    ]);
    expect(ruleA1.length).toBeGreaterThan(0);
    for (const id of ruleA2) expect(ruleA1).not.toContain(id);
    for (const id of ruleB1) expect(ruleA1).not.toContain(id);
  });

  /** A one-rule SARIF: the rule's wording, then one result per severity. */
  const oneRuleSarif = async (
    wording: string,
    results: Array<{ line: number; securitySeverity: string }>,
  ): Promise<string> => {
    const ruleId = 'acme.crypto.weak-hash';
    const file = join(tmp, `one-rule-${randomUUID()}.sarif`);
    await writeFile(
      file,
      JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'Semgrep',
                rules: [
                  {
                    id: ruleId,
                    name: wording,
                    shortDescription: { text: `${wording} (short)` },
                    fullDescription: { text: `${wording} (full)` },
                    help: { text: wording, markdown: `${wording} (help)` },
                  },
                ],
              },
            },
            results: results.map(({ line, securitySeverity }) => ({
              ruleId,
              ruleIndex: 0,
              message: { text: 'weak hash' },
              properties: { 'security-severity': securitySeverity },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/hash.js' },
                    region: {
                      startLine: line,
                      endLine: line,
                      snippet: { text: `md5(input${line})` },
                    },
                  },
                },
              ],
            })),
          },
        ],
      }),
    );
    return file;
  };

  it("keeps each project's own wording and severity for a rule id two projects of one organisation import", async () => {
    const organizationId = randomUUID();
    const [first, second] = [randomUUID(), randomUUID()];
    await runImport(
      first,
      await oneRuleSarif('Wording of the first project', [
        { line: 3, securitySeverity: '9.8' },
      ]),
      organizationId,
    );
    await runImport(
      second,
      await oneRuleSarif('Wording of the second project', [
        { line: 3, securitySeverity: '2.0' },
      ]),
      organizationId,
    );

    const [rowFirst] = await sastRows(first);
    const [rowSecond] = await sastRows(second);
    expect(rowFirst.vulnerability.id).not.toBe(rowSecond.vulnerability.id);
    expect(rowFirst.vulnerability.name).toBe('Wording of the first project');
    expect(rowSecond.vulnerability.name).toBe('Wording of the second project');
    expect(rowFirst.currentSeverity.toLowerCase()).toBe('critical');
    expect(rowSecond.currentSeverity.toLowerCase()).toBe('low');

    // A later import into the first project refreshes its own rule only.
    await runImport(
      first,
      await oneRuleSarif('Reworded by the first project', [
        { line: 3, securitySeverity: '9.8' },
      ]),
      organizationId,
    );
    const refreshed = await repo(Vulnerability).findOneByOrFail({
      id: rowFirst.vulnerability.id,
    });
    expect(refreshed.name).toBe('Reworded by the first project');
    const untouched = await repo(Vulnerability).findOneByOrFail({
      id: rowSecond.vulnerability.id,
    });
    expect(untouched.name).toBe('Wording of the second project');
  });

  // Findings imported while rules were kept per organisation point at the
  // organisation's row. The next import into their project moves them to the
  // project's own row: they keep their id, their status and their history.
  it("carries a project's findings over from the organisation's former rule row on its next import", async () => {
    const organizationId = randomUUID();
    const [mine, other] = [randomUUID(), randomUUID()];
    const file = await oneRuleSarif('Former wording', [
      { line: 3, securitySeverity: '9.8' },
      { line: 9, securitySeverity: '7.5' },
    ]);
    const ruleId = 'acme.crypto.weak-hash';
    const formerKey = organizationImportedRuleKey(organizationId, ruleId);

    // The state an import wrote before: one rule row for the organisation,
    // which the findings of both projects point at.
    await runImport(mine, file, organizationId);
    const corr = await repo(CorrespondanceTable).findOneOrFail({
      where: { ruleId: importedRuleKey(organizationId, mine, ruleId) },
      relations: ['vulnerability'],
    });
    await repo(CorrespondanceTable).update(
      { id: corr.id },
      { ruleId: formerKey },
    );
    const formerRowId = corr.vulnerability.id;
    await runImport(other, file, organizationId);
    await repo(SastVulnerabilityDetections).update(
      { projectId: other },
      { vulnerability: { id: formerRowId } },
    );

    const before = (await sastRows(mine)).sort(
      (a, b) => a.vulnerableStartLine - b.vulnerableStartLine,
    );
    expect(before.map((r) => r.vulnerability.id)).toEqual([
      formerRowId,
      formerRowId,
    ]);
    await repo(SastVulnerabilityDetections).update(
      { id: before[0].id },
      {
        currentState: 'ignored',
        stateManuallyModified: true,
        triagedByType: 'user',
        triagedBy: randomUUID(),
        triagedAt: new Date(),
        dismissalReason: 'accepted risk',
      },
    );

    await runImport(mine, file, organizationId);

    const after = (await sastRows(mine)).sort(
      (a, b) => a.vulnerableStartLine - b.vulnerableStartLine,
    );
    expect(
      after.map((r) => [r.id, r.vulnerableStartLine, r.currentState]),
    ).toEqual([
      [before[0].id, 3, 'ignored'],
      [before[1].id, 9, 'to_verify'],
    ]);
    const ownRow = after[0].vulnerability.id;
    expect(ownRow).not.toBe(formerRowId);
    expect(after[1].vulnerability.id).toBe(ownRow);
    // The other project's findings stay on the former row until its own
    // next import.
    expect((await sastRows(other)).map((r) => r.vulnerability.id)).toEqual([
      formerRowId,
      formerRowId,
    ]);
  });

  it("updates an imported finding's severity from the project's next import", async () => {
    const projectId = randomUUID();
    await runImport(
      projectId,
      await oneRuleSarif('One rule', [{ line: 3, securitySeverity: '9.8' }]),
    );
    const [first] = await sastRows(projectId);
    expect(first.currentSeverity.toLowerCase()).toBe('critical');

    await runImport(
      projectId,
      await oneRuleSarif('One rule', [{ line: 3, securitySeverity: '2.0' }]),
    );
    const rows = await sastRows(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].currentSeverity.toLowerCase()).toBe('low');
    expect(resolveEffectiveSeverity(rows[0])?.toLowerCase()).toBe('low');
  });

  it('gives each imported finding the severity of its own result', async () => {
    const projectId = randomUUID();
    await runImport(
      projectId,
      await oneRuleSarif('One rule, two severities', [
        { line: 3, securitySeverity: '9.8' },
        { line: 9, securitySeverity: '2.0' },
      ]),
    );
    const rows = (await sastRows(projectId)).sort(
      (a, b) => a.vulnerableStartLine - b.vulnerableStartLine,
    );
    expect(
      rows.map((r) => [r.vulnerableStartLine, r.currentSeverity.toLowerCase()]),
    ).toEqual([
      [3, 'critical'],
      [9, 'low'],
    ]);
  });

  it('a second import without one result resolves exactly that finding', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('minimal.sarif'));

    const reduced = JSON.parse(
      readFileSync(fixture('minimal.sarif'), 'utf8'),
    ) as { runs: Array<{ results: unknown[] }> };
    reduced.runs[0].results = reduced.runs[0].results.slice(0, 1);
    const reducedPath = join(tmp, `minimal-one-${randomUUID()}.sarif`);
    await writeFile(reducedPath, JSON.stringify(reduced));

    const scanId = await runImport(projectId, reducedPath);
    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({ status: 'completed', findingsCount: 1 }),
    );

    const rows = await sastRows(projectId);
    expect(rows.map((r) => [r.path, r.currentState])).toEqual([
      ['app/views.py', 'to_verify'],
      ['web/server.js', 'resolved'],
    ]);
  });

  it('imports multi-run.sarif from four tools, finalized per tool, the scan end dispatched once', async () => {
    const batches = jest.spyOn(sastIac, 'processSastIacBatch');
    const finalizations = jest.spyOn(sastIac, 'finalizeScan');
    try {
      const projectId = randomUUID();
      const scanId = await runImport(projectId, fixture('multi-run.sarif'));

      expect(await countSast(projectId)).toBe(3);
      // An imported rule is kept under its project's own key.
      const correspondances = await repo(CorrespondanceTable).find({
        where: {
          ruleId: importedRuleKey(
            organisationOf(projectId),
            projectId,
            'sql-injection',
          ),
        },
        relations: ['vulnerability'],
      });
      expect(correspondances.map((c) => c.scanner).sort()).toEqual([
        'codeql',
        'semgrep',
      ]);
      expect(correspondances[0].vulnerability.id).not.toBe(
        correspondances[1].vulnerability.id,
      );

      const njsscanBatches = batches.mock.calls.filter(
        ([request]) => request.scannerName === 'njsscan',
      );
      expect(njsscanBatches).toHaveLength(1);
      expect(njsscanBatches[0][0].vulnerabilities).toEqual([]);
      expect(finalizations.mock.calls.map(([, , tool]) => tool).sort()).toEqual(
        ['bandit', 'codeql', 'njsscan', 'semgrep'],
      );
      expect(onScannerFinalized).toHaveBeenCalledTimes(1);
      expect(completionOf(scanId)).toEqual(
        expect.objectContaining({ status: 'completed', findingsCount: 3 }),
      );
    } finally {
      batches.mockRestore();
      finalizations.mockRestore();
    }
  });

  // A result with no CVSS of its own keeps the severity its SARIF gave, under
  // the default project security context (production, public, confidential),
  // in the stored row, in the band the lists show and in the severity filter.
  it('keeps the SARIF severity of every row of severity-mapping.sarif, shown and filtered', async () => {
    const calculator = new CvssCalculatorService();
    const defaultContext: SecurityContextForScoring = {
      environment: 'production',
      internetExposure: 'public',
      dataClassification: 'confidential',
      businessCriticality: 'medium',
      networkSegmentation: 'flat',
      handlesPii: false,
      handlesPaymentData: false,
      safetyCritical: false,
    };
    computeEnvironmentalForProject.mockImplementation(async (_p, vector) =>
      calculator.applyEnvironmentalMetrics(vector, defaultContext),
    );
    try {
      const projectId = randomUUID();
      const scanId = await runImport(
        projectId,
        fixture('severity-mapping.sarif'),
      );
      expect(completionOf(scanId).status).toBe('completed');

      // libs/test-fixtures/sarif/README.md, « Severity column », by line.
      const expected = [
        'critical',
        'high',
        'high',
        'medium',
        'medium',
        'low',
        'low',
        'high',
        'medium',
        'low',
        'low',
        'low',
        'critical',
        'medium',
        'high',
        'high',
      ];
      const rows = await repo(SastVulnerabilityDetections).find({
        where: { projectId },
        order: { vulnerableStartLine: 'ASC' },
      });
      expect(rows.map((r) => r.vulnerableStartLine)).toEqual(
        expected.map((_, n) => n + 1),
      );
      expect(rows.map((r) => resolveEffectiveSeverity(r))).toEqual(expected);
      expect(rows.map((r) => r.currentSeverity)).toEqual(expected);

      for (const band of ['critical', 'high', 'medium', 'low']) {
        const listed = await sastIac.getProjectSastVulnerabilities({
          projectId,
          pageNumber: 1,
          pageSizeNumber: 100,
          severity: [band],
          slim: true,
        } as Parameters<typeof sastIac.getProjectSastVulnerabilities>[0]);
        expect([band, listed.total]).toEqual([
          band,
          expected.filter((s) => s === band).length,
        ]);
      }
    } finally {
      computeEnvironmentalForProject.mockImplementation(async () => null);
    }
  });

  // The AutoFix filter of the lists runs a raw subquery: it must be valid
  // PostgreSQL (no backtick-quoted name) on each of the four lists.
  it('answers the hasAutofix filter on PostgreSQL for the four lists', async () => {
    const projectId = randomUUID();
    await runImport(projectId, fixture('minimal.sarif'));
    const request = (hasAutofix: boolean) =>
      ({
        projectId,
        pageNumber: 1,
        pageSizeNumber: 10,
        hasAutofix,
        slim: true,
      }) as Parameters<typeof sastIac.getProjectSastVulnerabilities>[0];
    for (const hasAutofix of [true, false]) {
      const sast = await sastIac.getProjectSastVulnerabilities(
        request(hasAutofix),
      );
      expect([hasAutofix, sast.total]).toEqual([
        hasAutofix,
        hasAutofix ? 0 : 2,
      ]);
      await sastIac.getProjectIacVulnerabilities(request(hasAutofix) as never);
      await sastIac.getProjectCicdVulnerabilities(request(hasAutofix) as never);
      await sastIac.getProjectSecretVulnerabilities(
        request(hasAutofix) as never,
      );
    }
  });

  it('refuses malformed.sarif with IMPORT_INVALID_SARIF and writes no row', async () => {
    const projectId = randomUUID();
    const scanId = await runImport(projectId, fixture('malformed.sarif'));

    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'IMPORT_INVALID_SARIF',
        findingsCount: 0,
      }),
    );
    expect(await countSast(projectId)).toBe(0);
    expect(onScannerFinalized).not.toHaveBeenCalled();
  });

  it("two containers of one scan, sast and secret, import concurrently: both finalize, neither resolves the other's findings", async () => {
    // The two drivers of the Community images: opengrep's SARIF names
    // its tool `Opengrep OSS`, gitleaks' `gitleaks`.
    const opengrepOf = (withResults: boolean) => ({
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'Opengrep OSS',
              rules: [
                {
                  id: 'opt.cybedefend-scanners.rules.opengrep.python-eval',
                  shortDescription: { text: 'eval of untrusted input' },
                  defaultConfiguration: { level: 'error' },
                },
              ],
            },
          },
          results: withResults
            ? [
                {
                  ruleId: 'opt.cybedefend-scanners.rules.opengrep.python-eval',
                  level: 'error',
                  message: { text: 'eval' },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri: 'app.py' },
                        region: { startLine: 3 },
                      },
                    },
                  ],
                },
              ]
            : [],
        },
      ],
    });
    const gitleaks = {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'gitleaks' } },
          results: [
            {
              ruleId: 'generic-api-key',
              level: 'error',
              message: { text: 'generic-api-key has detected a secret' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'config/app.env' },
                    region: { startLine: 2, endLine: 2 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const sastFile = join(tmp, `opengrep-${randomUUID()}.sarif`);
    const sastEmptyFile = join(tmp, `opengrep-empty-${randomUUID()}.sarif`);
    const secretFile = join(tmp, `gitleaks-${randomUUID()}.sarif`);
    await writeFile(sastFile, JSON.stringify(opengrepOf(true)));
    await writeFile(sastEmptyFile, JSON.stringify(opengrepOf(false)));
    await writeFile(secretFile, JSON.stringify(gitleaks));

    const projectId = randomUUID();
    const organizationId = randomUUID();
    const finalizations = jest.spyOn(sastIac, 'finalizeScan');

    /** One scan: the two containers' jobs at once, as two worker slots. */
    const runClusterScan = async (files: {
      sast: string;
      secret: string;
    }): Promise<{
      scanId: string;
      sastContainer: string;
      secretContainer: string;
    }> => {
      const scanId = randomUUID();
      const sastContainer = randomUUID();
      const secretContainer = randomUUID();
      const jobOf = (
        containerId: string,
        category: 'sast' | 'secret',
        file: string,
      ) =>
        ({
          id: `results-import-${scanId}-${containerId}`,
          data: {
            scanId,
            projectId,
            organizationId,
            branch: 'main',
            category,
            format: 'sarif',
            fileKey: file,
            containerId,
          },
        }) as Job<ResultsImportJobData>;
      await Promise.all([
        processor.process(jobOf(sastContainer, 'sast', files.sast)),
        processor.process(jobOf(secretContainer, 'secret', files.secret)),
      ]);
      return { scanId, sastContainer, secretContainer };
    };

    const completionsOf = (scanId: string) =>
      completeImportScan.mock.calls
        .map(([request]) => request)
        .filter((request) => request.scanId === scanId)
        .sort((a, b) => (a.toolName < b.toolName ? -1 : 1));

    const states = async () => ({
      sast: (
        await repo(SastVulnerabilityDetections).find({ where: { projectId } })
      ).map((row) => [row.id, row.currentState]),
      secret: (
        await repo(SecretVulnerabilityDetections).find({
          where: { projectId },
        })
      ).map((row) => [row.id, row.currentState]),
    });

    try {
      // Scan 1: both containers raise their finding.
      const first = await runClusterScan({
        sast: sastFile,
        secret: secretFile,
      });
      expect(completionsOf(first.scanId)).toEqual([
        expect.objectContaining({
          status: 'completed',
          toolName: 'gitleaks',
          findingsCount: 1,
          containerId: first.secretContainer,
        }),
        expect.objectContaining({
          status: 'completed',
          toolName: 'opengrep-oss',
          findingsCount: 1,
          containerId: first.sastContainer,
        }),
      ]);
      // each container finalized its own tool, its own type only
      expect(
        finalizations.mock.calls
          .filter(([, scanId]) => scanId === first.scanId)
          .map(([, , tool, type]) => [tool, type])
          .sort(),
      ).toEqual([
        ['gitleaks', 'secret'],
        ['opengrep-oss', 'sast'],
      ]);
      const afterFirst = await states();
      expect(afterFirst.sast).toHaveLength(1);
      expect(afterFirst.secret).toHaveLength(1);
      expect(afterFirst.sast[0][1]).toBe('to_verify');
      expect(afterFirst.secret[0][1]).toBe('to_verify');

      // Scan 2, the same files at once: no new row, nothing resolved.
      const second = await runClusterScan({
        sast: sastFile,
        secret: secretFile,
      });
      expect(
        completionsOf(second.scanId).map((c) => [c.status, c.containerId]),
      ).toEqual([
        ['completed', second.secretContainer],
        ['completed', second.sastContainer],
      ]);
      expect(await states()).toEqual(afterFirst);

      // Scan 3: the sast container finds nothing. Its finding resolves; the
      // secret, finalized at the same time by the other container, stays.
      const third = await runClusterScan({
        sast: sastEmptyFile,
        secret: secretFile,
      });
      expect(
        completionsOf(third.scanId).map((c) => [c.status, c.containerId]),
      ).toEqual([
        ['completed', third.secretContainer],
        ['completed', third.sastContainer],
      ]);
      const afterThird = await states();
      expect(afterThird.sast).toEqual([[afterFirst.sast[0][0], 'resolved']]);
      expect(afterThird.secret).toEqual(afterFirst.secret);
    } finally {
      finalizations.mockRestore();
    }
  });

  itLive100k(
    'imports 100,000 generated results into 100,000 detections',
    async () => {
      const path = join(tmp, 'generated-100000.sarif');
      await writeGeneratedSarif(path, 100_000);
      const projectId = randomUUID();

      const started = Date.now();
      const scanId = await runImport(projectId, path);
      console.log(
        `RESULTS_IMPORT_LIVE_100K dialect=${dialect} durationMs=${Date.now() - started}`,
      );

      expect(completionOf(scanId)).toEqual(
        expect.objectContaining({
          status: 'completed',
          findingsCount: 100_000,
        }),
      );
      expect(await countSast(projectId)).toBe(100_000);
    },
    3_600_000,
  );

  it('refuses 100,001 generated results with IMPORT_TOO_MANY_RESULTS and writes no row', async () => {
    const path = join(tmp, 'generated-100001.sarif');
    await writeGeneratedSarif(path, 100_001);
    const projectId = randomUUID();

    const scanId = await runImport(projectId, path);

    expect(completionOf(scanId)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'IMPORT_TOO_MANY_RESULTS',
        findingsCount: 0,
      }),
    );
    expect(await countSast(projectId)).toBe(0);
  }, 600_000);
});
