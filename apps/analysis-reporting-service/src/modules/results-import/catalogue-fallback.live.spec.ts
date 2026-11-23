import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { parseDialect } from '@cybedefend/db-dialect';
import { RuleMetadata } from '@grpc/analysis-reporting/result';
import {
  createLiveDatabase,
  type LiveDatabase,
} from '../../core/db/live-database';
import { CatalogueFallbackService } from './catalogue-fallback.service';
import { CatalogRule, SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';

/**
 * LIVE spec for the catalogue fallback, on the engine LIVE_DB_TYPE
 * selects (default mysql) and a real Redis:
 *
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=mysql \
 *     RESULTS_IMPORT_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/catalogue-fallback.live.spec.ts
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/catalogue-fallback.live.spec.ts
 *
 * The database comes from createLiveDatabase({ dialect }) and is migrated
 * with the dialect's tracks — the (scanner, ruleId) unique comes from a
 * migration, not from synchronize. Redis comes from RESULTS_IMPORT_REDIS_URL
 * (default redis://127.0.0.1:6379); every lock key is prefixed with the test
 * run id. Counts are read with repository.count({ where }), never a raw
 * COUNT(*) (pg returns it as a string).
 */
const LIVE = process.env.RESULTS_IMPORT_MYSQL_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;
const REDIS_URL =
  process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379';

const meta = (over: Partial<RuleMetadata> = {}): RuleMetadata => ({
  toolName: 'semgrep-live',
  ruleId: 'live-rule',
  name: 'Live rule',
  shortDescription: 'short',
  fullDescription: 'full',
  helpMarkdown: 'help',
  cwe: ['CWE-79'],
  severity: 'high',
  helpUri: 'https://example.com/live-rule',
  owaspTop10: ['A03:2021'],
  ...over,
});

describeLive('CatalogueFallbackService on a real database and Redis', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;

  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  const runId = randomUUID();
  /** Every lock key the service builds is prefixed with the run id. */
  const lockPrefix = `results-import-live-${runId}:`;
  const bullPrefix = `bull-live-${runId}`;

  let live: LiveDatabase;
  let scanQueue: ScanQueueService;
  let queues: Queue[];
  let redis: Redis;
  let sastIacUtils: SastIacUtilsService;
  let service: CatalogueFallbackService;
  let serviceB: CatalogueFallbackService;

  const logger = {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  /** A ScanQueueService view whose lock keys carry the run prefix. */
  const prefixedQueue = (real: ScanQueueService): ScanQueueService =>
    ({
      acquireDetectionCreationLock: (key: string) =>
        real.acquireDetectionCreationLock(lockPrefix + key),
      releaseDetectionCreationLock: (key: string, token: string) =>
        real.releaseDetectionCreationLock(lockPrefix + key, token),
    }) as unknown as ScanQueueService;

  const makeService = (queue: ScanQueueService): CatalogueFallbackService =>
    new CatalogueFallbackService(live.dataSource, sastIacUtils, queue, logger);

  const correspondanceRepo = () =>
    live.dataSource.getRepository(CorrespondanceTable);
  const vulnerabilityRepo = () => live.dataSource.getRepository(Vulnerability);

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'results_import_cat',
      envPrefix: 'RESULTS_IMPORT',
      dialect,
      migrations: 'track',
    });

    // The real resolveCatalogRules over the live repositories.
    sastIacUtils = Object.assign(
      Object.create(SastIacUtilsService.prototype) as SastIacUtilsService,
      {
        correspondanceTableRepository: correspondanceRepo(),
      },
    );

    const url = new URL(REDIS_URL);
    const connection = { host: url.hostname, port: Number(url.port || 6379) };
    redis = new Redis(REDIS_URL);
    queues = Object.values(QUEUE_NAMES).map(
      (name) => new Queue(name, { connection, prefix: bullPrefix }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScanQueueService,
        ...queues.map((queue) => ({
          provide: getQueueToken(queue.name),
          useValue: queue,
        })),
      ],
    }).compile();
    scanQueue = moduleRef.get(ScanQueueService);
    await scanQueue.onModuleInit();

    const queue = prefixedQueue(scanQueue);
    service = makeService(queue);
    serviceB = makeService(queue);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Each cleanup step on its own: one failing handle must not leave the
    // others open and hang the Jest process.
    try {
      await (await scanQueue.getRedisClient()).quit();
    } catch {
      /* the client never came up */
    }
    for (const queue of queues) {
      try {
        await queue.close();
      } catch {
        /* ignore */
      }
    }
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
    await live?.drop();
  }, HOOK_TIMEOUT);

  it('two concurrent ensureRules for the same rule create one row', async () => {
    const rule = meta({ ruleId: 'concurrent-rule' });
    const [a, b] = await Promise.all([
      service.ensureRules('semgrep-live', 'sast', [rule]),
      serviceB.ensureRules('semgrep-live', 'sast', [rule]),
    ]);
    expect([a, b].sort()).toEqual([0, 1]);
    const correspondances = await correspondanceRepo().count({
      where: { scanner: 'semgrep-live', ruleId: 'concurrent-rule' },
    });
    expect(correspondances).toBe(1);
    const vulnerabilities = await vulnerabilityRepo().count({
      where: { name: 'Live rule' },
    });
    expect(vulnerabilities).toBe(1);
  });

  it('a rule another connection committed between the re-check and the insert is retried in a new transaction', async () => {
    const ruleId = 'raced-rule';
    const rule = meta({ ruleId });

    // Hook on the re-check: the SECOND resolveCatalogRules call (the one under
    // the lock) reads first, then commits the same (scanner, ruleId) from
    // another connection, and still reports the rule as missing — so the
    // write transaction that follows hits the unique index.
    const original = sastIacUtils.resolveCatalogRules.bind(sastIacUtils);
    let calls = 0;
    const hooked = jest.fn(async (ids: string[], scanner: string) => {
      calls += 1;
      const result = await original(ids, scanner);
      if (calls === 2) {
        const vulnId = randomUUID();
        await live.dataSource
          .createQueryBuilder()
          .insert()
          .into(Vulnerability)
          .values({
            id: vulnId,
            name: 'Raced rule',
            shortDescription: 'raced',
            description: 'raced',
            howToPrevent: 'raced',
            cwe: null,
            owaspTop10: null,
            severity: 'low',
            language: 'generic',
            vulnerabilityType: 'sast',
            code: 'CD-SAST-90777',
            cvss3: null,
            codeExamples: null,
            sourceMetadata: null,
          })
          .updateEntity(false)
          .execute();
        await live.dataSource
          .createQueryBuilder()
          .insert()
          .into(CorrespondanceTable)
          .values({
            id: randomUUID(),
            scanner: 'semgrep-live',
            ruleId,
            vulnerabilityType: 'sast',
            enabled: true,
            vulnerability: { id: vulnId },
          })
          .updateEntity(false)
          .execute();
      }
      return result;
    });
    Object.assign(sastIacUtils, { resolveCatalogRules: hooked });
    try {
      const created = await service.ensureRules('semgrep-live', 'sast', [rule]);
      // The insert hit the unique index, the whole transaction rolled back,
      // and the retry's re-check found the rule: created here = 0, and no
      // « current transaction is aborted » on PostgreSQL.
      expect(created).toBe(0);
      expect(hooked).toHaveBeenCalledTimes(3);
    } finally {
      Object.assign(sastIacUtils, { resolveCatalogRules: original });
    }
    const correspondances = await correspondanceRepo().count({
      where: { scanner: 'semgrep-live', ruleId },
    });
    expect(correspondances).toBe(1);
  });

  it('two tools at once get distinct codes of one type', async () => {
    const [a, b] = await Promise.all([
      service.ensureRules('tool-one-live', 'iac', [
        meta({ ruleId: 'shared-rule-id' }),
      ]),
      serviceB.ensureRules('tool-two-live', 'iac', [
        meta({ ruleId: 'shared-rule-id' }),
      ]),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    const rows = await correspondanceRepo().find({
      where: { ruleId: 'shared-rule-id' },
      relations: ['vulnerability'],
    });
    expect(rows).toHaveLength(2);
    const codes = rows.map((r) => r.vulnerability.code).sort();
    expect(codes[0]).not.toBe(codes[1]);
    for (const code of codes) expect(code).toMatch(/^CD-IAC-9\d{4,}$/);
  });

  it('a rule created here is found by processVulnerability', async () => {
    const created = await service.ensureRules('semgrep-live', 'sast', [
      meta({ ruleId: 'dotted.lang.rule-for-process' }),
    ]);
    expect(created).toBe(1);
    const resolved = await sastIacUtils.resolveCatalogRules(
      ['dotted.lang.rule-for-process'],
      'semgrep-live',
    );
    const rule: CatalogRule | undefined = resolved.get('rule-for-process');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('high');
    expect(rule?.code).toMatch(/^CD-SAST-9\d{4,}$/);
  });

  it('an existing rule keeps its owaspTop10', async () => {
    const vulnId = randomUUID();
    await live.dataSource.getRepository(Vulnerability).save({
      id: vulnId,
      name: 'Existing rule',
      shortDescription: 'existing',
      description: 'existing',
      howToPrevent: 'existing',
      cwe: ['CWE-89'],
      owaspTop10: ['A01:2021'],
      severity: 'medium',
      language: 'generic',
      vulnerabilityType: 'sast',
      code: 'CD-SAST-90050',
    });
    await correspondanceRepo().save({
      id: randomUUID(),
      scanner: 'semgrep-live',
      ruleId: 'existing-rule',
      vulnerabilityType: 'sast',
      enabled: true,
      vulnerability: { id: vulnId },
    });

    const created = await service.ensureRules('semgrep-live', 'sast', [
      meta({ ruleId: 'existing-rule', owaspTop10: ['A03:2021'] }),
    ]);
    expect(created).toBe(0);

    const row = await correspondanceRepo().findOne({
      where: { scanner: 'semgrep-live', ruleId: 'existing-rule' },
      relations: ['vulnerability'],
    });
    expect(row?.vulnerability.owaspTop10).toEqual(['A01:2021']);
    expect(row?.vulnerability.code).toBe('CD-SAST-90050');
  });
});
