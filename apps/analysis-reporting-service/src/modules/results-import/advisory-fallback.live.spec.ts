import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { parseDialect } from '@cybedefend/db-dialect';
import type { QueryDeepPartialEntity } from 'typeorm';
import {
  createLiveDatabase,
  type LiveDatabase,
} from '../../core/db/live-database';
import {
  AdvisoryFallbackService,
  AdvisoryInput,
} from './advisory-fallback.service';
import { QUEUE_NAMES } from '../scan-queue/queue-names';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { calculateOsvCvssScore } from '../sca/sca.utils';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';

/**
 * LIVE spec for the advisory fallback, on the engine LIVE_DB_TYPE selects (default mysql) and a real Redis:
 *
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=mysql \
 *     RESULTS_IMPORT_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/advisory-fallback.live.spec.ts
 *   RESULTS_IMPORT_MYSQL_LIVE=1 LIVE_DB_TYPE=postgres \
 *     RESULTS_IMPORT_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand src/modules/results-import/advisory-fallback.live.spec.ts
 *
 * The database comes from createLiveDatabase({ dialect }) and is migrated
 * with the dialect's tracks. Redis comes from RESULTS_IMPORT_REDIS_URL
 * (default redis://127.0.0.1:6379); every lock key is prefixed with the test
 * run id. Counts are read with repository.count({ where }), never a raw
 * COUNT(*) (pg returns it as a string).
 */
const LIVE = process.env.RESULTS_IMPORT_MYSQL_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;
const REDIS_URL =
  process.env.RESULTS_IMPORT_REDIS_URL ?? 'redis://127.0.0.1:6379';

const CVSS_V3_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'; // 9.8

const item = (over: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
  id: 'GHSA-live-0001',
  toolName: 'trivy-live',
  summary: 'Live advisory summary',
  details: 'Live advisory details',
  cweIds: ['CWE-79'],
  severity: 'high',
  cvssV3Vector: CVSS_V3_VECTOR,
  helpUri: 'https://example.com/live-advisory',
  aliases: ['CVE-2024-0001'],
  fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
  ...over,
});

describeLive('AdvisoryFallbackService on a real database and Redis', () => {
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
  let service: AdvisoryFallbackService;
  let serviceB: AdvisoryFallbackService;

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

  const makeService = (queue: ScanQueueService): AdvisoryFallbackService =>
    new AdvisoryFallbackService(live.dataSource, queue, logger);

  const osvRepo = () => live.dataSource.getRepository(VulnerabilityOsv);
  const aliasRepo = () => live.dataSource.getRepository(VulnerabilityOsvAlias);
  const severityRepo = () =>
    live.dataSource.getRepository(VulnerabilityOsvSeverity);
  const affectedRepo = () =>
    live.dataSource.getRepository(VulnerabilityOsvAffected);
  const rangeRepo = () =>
    live.dataSource.getRepository(VulnerabilityOsvAffectedRange);
  const eventRepo = () =>
    live.dataSource.getRepository(VulnerabilityOsvAffectedEvent);

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'results_import_adv',
      envPrefix: 'RESULTS_IMPORT',
      dialect,
      migrations: 'track',
    });

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

  it('two concurrent ensureAdvisories for one advisory create one root, one alias and one severity of each type, one fix chain', async () => {
    // Ten rounds; each round races two services on one fresh advisory id,
    // with two aliases, a vector and one fix.
    const roundIds: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      const id = `GHSA-race-${round}`;
      roundIds.push(id);
      const input = item({
        id,
        aliases: ['CVE-RACE-A', 'CVE-RACE-B'],
        fixes: [{ ecosystem: 'npm', packageName: 'pkg', fixed: '1.2.3' }],
      });
      await Promise.all([
        service.ensureAdvisories([input]),
        serviceB.ensureAdvisories([input]),
      ]);
    }
    for (const id of roundIds) {
      expect(await osvRepo().count({ where: { id } })).toBe(1);
      expect(
        await aliasRepo().count({ where: { vulnerability: { id } } }),
      ).toBe(2);
      expect(
        await severityRepo().count({
          where: { vulnerability: { id }, type: 'DATABASE_SPECIFIC' },
        }),
      ).toBe(1);
      expect(
        await severityRepo().count({
          where: { vulnerability: { id }, type: 'CVSS_V3' },
        }),
      ).toBe(1);
      expect(
        await affectedRepo().count({ where: { vulnerability: { id } } }),
      ).toBe(1);
      expect(
        await rangeRepo().count({
          where: { affected: { vulnerability: { id } } },
        }),
      ).toBe(1);
      expect(
        await eventRepo().count({
          where: { range: { affected: { vulnerability: { id } } } },
        }),
      ).toBe(1);
    }
  });

  it('an existing advisory keeps its summary, severities and updatedAt', async () => {
    const id = 'GHSA-kept-1';
    const past = new Date(Date.now() - 3_600_000);
    await live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsv)
      .values({
        id,
        summary: 'kept',
        details: 'kept details',
        databaseSpecific: {
          cwe_ids: ['CWE-79'],
          severity: 'LOW',
          source: 'sarif:trivy-live',
        },
        createdAt: past,
        updatedAt: past,
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsv>)
      .updateEntity(false)
      .execute();
    await live.dataSource
      .createQueryBuilder()
      .insert()
      .into(VulnerabilityOsvSeverity)
      .values({
        id: randomUUID(),
        type: 'DATABASE_SPECIFIC',
        score: 'LOW',
        vulnerability: { id },
      } as unknown as QueryDeepPartialEntity<VulnerabilityOsvSeverity>)
      .updateEntity(false)
      .execute();

    const before = await osvRepo().findOne({
      where: { id },
      relations: ['severities', 'aliases'],
    });
    expect(before?.summary).toBe('kept');

    const out = await service.ensureAdvisories([
      item({
        id,
        summary: 'CHANGED SUMMARY',
        details: 'CHANGED DETAILS',
        severity: 'critical',
        cvssV3Vector: null,
        helpUri: '',
        aliases: ['CVE-NEW-ONLY'],
        fixes: [],
      }),
    ]);

    const after = await osvRepo().findOne({
      where: { id },
      relations: ['severities', 'aliases'],
    });
    // The root was never rewritten: summary, databaseSpecific, updatedAt.
    expect(after?.summary).toBe('kept');
    expect(after?.databaseSpecific).toMatchObject({ severity: 'LOW' });
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    // The severities it had are untouched; no CVSS_V3 was added (no vector).
    expect(after?.severities.map((s) => [s.type, s.score]).sort()).toEqual([
      ['DATABASE_SPECIFIC', 'LOW'],
    ]);
    // It gained only the missing alias.
    expect(after?.aliases.map((a) => a.alias)).toEqual(['CVE-NEW-ONLY']);
    expect(out.get(id)?.summary).toBe('kept');
  });

  it('the fixed-version read of the reports finds the written chain', async () => {
    const id = 'GHSA-fix-1';
    await service.ensureAdvisories([
      item({
        id,
        fixes: [
          { ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' },
          { ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.22' },
        ],
      }),
    ]);
    // The join the reports use (I-13): _affected → _range → _event,
    // fixed IS NOT NULL.
    const rows = await live.dataSource
      .createQueryBuilder()
      .select('aff.vulnerabilityOsvId', 'osvId')
      .addSelect('evt.fixed', 'fixedVersion')
      .from('vulnerability_osv_affected', 'aff')
      .innerJoin(
        'vulnerability_osv_affected_range',
        'rng',
        'rng.affectedId = aff.id',
      )
      .innerJoin(
        'vulnerability_osv_affected_event',
        'evt',
        'evt.rangeId = rng.id',
      )
      .where('aff.vulnerabilityOsvId IN (:...ids)', { ids: [id] })
      .andWhere('evt.fixed IS NOT NULL')
      .andWhere("evt.fixed <> ''")
      .getRawMany<{ osvId: string; fixedVersion: string | null }>();
    expect(rows.map((r) => r.fixedVersion).sort()).toEqual([
      '4.17.21',
      '4.17.22',
    ]);
    expect(rows.every((r) => r.osvId === id)).toBe(true);
  });

  it('a returned advisory scores from its CVSS_V3 vector', async () => {
    const id = 'GHSA-cvss-1';
    const out = await service.ensureAdvisories([
      item({ id, cvssV3Vector: CVSS_V3_VECTOR }),
    ]);
    const advisory = out.get(id);
    expect(advisory).toBeDefined();
    expect(calculateOsvCvssScore(advisory as VulnerabilityOsv)).toBeCloseTo(
      9.8,
      6,
    );
  });
});
