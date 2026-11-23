import { randomUUID } from 'node:crypto';
import type {
  EntitySubscriberInterface,
  ObjectLiteral,
  QueryRunner,
} from 'typeorm';
import { isUniqueViolation, parseDialect } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from '../../core/db/live-database';
import { SastIacUtilsService } from './sast-iac.utils';
import { ScaService } from '../sca/sca.service';
import { ContainerService } from '../container/container.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { CodeSnippet } from '../../entities/code-snippet.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';

/**
 * LIVE spec: a duplicate the ingestion catches and goes past keeps
 * the batch transaction usable, on the engine LIVE_DB_TYPE selects. On
 * PostgreSQL the first failed statement aborts the whole transaction (25P02),
 * so every « catch the duplicate, go on » runs inside a savepoint there.
 *
 *   AR_DUPLICATE_TX_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_DUPLICATE_TX_MYSQL_URL=mysql://root:password@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=duplicate-in-transaction
 *   AR_DUPLICATE_TX_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_DUPLICATE_TX_PG_URL=postgres://postgres:postgres@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=duplicate-in-transaction
 *
 * The schema is built by the dialect's migration tracks (the
 * `(projectId, branch, fingerprint)` uniques come from migrations). Each case
 * opens one transaction, reaches the duplicate path of one catch site, saves a
 * third, distinct row, commits, and counts two rows.
 *
 * Where the save looks its row up by id first (a code snippet, an advisory
 * stub), the race is reproduced as it happens between two workers: the other
 * worker commits its row, on its own connection, after the lookup and just
 * before the INSERT (a subscriber does it once). The batch transaction is
 * READ COMMITTED on both engines, so it then sees the winner's row, as the
 * autocommit statements of the ingestion do.
 */
const LIVE = liveEnabled('AR_DUPLICATE_TX');
const describeLive = LIVE ? describe : describe.skip;

interface SastIacUtilsInternals {
  saveNewDetection(
    detection: SastVulnerabilityDetections,
    context: { vulnType: string; path: string },
  ): Promise<boolean>;
}
interface ScaServiceInternals {
  insertNewDetection(
    detection: ScaVulnerabilityDetections,
  ): Promise<ScaVulnerabilityDetections>;
}
interface ContainerServiceInternals {
  findOrCreateOsvStub(vulnerabilityId: string): Promise<VulnerabilityOsv>;
}

const logger = {
  warn: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

describeLive('a caught duplicate keeps the batch transaction usable', () => {
  jest.setTimeout(120_000);
  const HOOK_TIMEOUT = 240_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let live: LiveDatabase;
  let runner: QueryRunner;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_dup_tx',
      envPrefix: 'AR_DUPLICATE_TX',
      dialect,
      migrations: 'track',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    runner = live.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction('READ COMMITTED');
  });

  afterEach(async () => {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    live.dataSource.subscribers.length = 0;
  });

  const repo = <T extends ObjectLiteral>(entity: new () => T) =>
    runner.manager.getRepository(entity);

  /**
   * The other worker's row, committed once on another connection right
   * before the first INSERT of `entity` (after TypeORM's lookup by id).
   */
  const raceOnFirstInsert = <T extends ObjectLiteral>(
    entity: new () => T,
    winner: () => Promise<void>,
  ) => {
    let armed = true;
    const subscriber: EntitySubscriberInterface<T> = {
      listenTo: () => entity,
      beforeInsert: async () => {
        if (!armed) return;
        armed = false;
        await winner();
      },
    };
    live.dataSource.subscribers.push(subscriber as EntitySubscriberInterface);
  };

  const sastDetection = (fingerprint: string, path: string) =>
    Object.assign(new SastVulnerabilityDetections(), {
      projectId: 'p-dup',
      branch: 'main',
      fingerprint,
      scannerType: 'opengrep',
      currentState: 'to_verify',
      currentSeverity: 'high',
      currentPriority: 'high',
      language: 'python',
      path,
      vulnerableStartLine: 1,
      vulnerableEndLine: 1,
    });

  it('a twin detection that hits the unique keeps the batch transaction usable on both engines', async () => {
    const utils = Object.assign(
      Object.create(SastIacUtilsService.prototype) as SastIacUtilsService,
      {
        sastVulnDetectRepository: repo(SastVulnerabilityDetections),
        logger,
      },
    ) as unknown as SastIacUtilsInternals;
    const context = { vulnType: 'sast', path: 'app.py' };

    expect(
      await utils.saveNewDetection(sastDetection('fp-1', 'app.py'), context),
    ).toBe(true);
    // Its twin: another rule, the same (projectId, branch, fingerprint).
    expect(
      await utils.saveNewDetection(sastDetection('fp-1', 'app.py'), context),
    ).toBe(false);
    expect(
      await utils.saveNewDetection(sastDetection('fp-2', 'other.py'), context),
    ).toBe(true);

    await runner.commitTransaction();
    expect(
      await live.dataSource
        .getRepository(SastVulnerabilityDetections)
        .count({ where: { projectId: 'p-dup' } }),
    ).toBe(2);
  });

  it('a code snippet written concurrently keeps the batch transaction usable on both engines', async () => {
    const utils = Object.assign(
      Object.create(SastIacUtilsService.prototype) as SastIacUtilsService,
      { codeSnippetRepository: repo(CodeSnippet), logger },
    ) as unknown as Pick<SastIacUtilsService, 'addCodeSnippet'>;
    const snippet = (id: string) =>
      Object.assign(new CodeSnippet(), {
        id,
        vulnerableStartLine: 1,
        vulnerableEndLine: 1,
        startLine: 1,
        endLine: 1,
        code: [{ line: 1, content: 'x' }] as unknown as string,
        language: 'python',
      });
    const raced = randomUUID();
    raceOnFirstInsert(CodeSnippet, async () => {
      await live.dataSource
        .createQueryBuilder()
        .insert()
        .into(CodeSnippet)
        .values(snippet(raced))
        .callListeners(false)
        .updateEntity(false)
        .execute();
    });

    await utils.addCodeSnippet(snippet(raced));
    await utils.addCodeSnippet(snippet(randomUUID()));

    await runner.commitTransaction();
    expect(await live.dataSource.getRepository(CodeSnippet).count()).toBe(2);
  });

  it('a twin SCA detection keeps the batch transaction usable on both engines', async () => {
    const pkg = await repo(ScaDetectedPackages).save(
      Object.assign(new ScaDetectedPackages(), {
        projectId: 'p-dup',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        branch: 'main',
        fileName: 'package.json',
        ecosystem: 'npm',
        isDev: false,
        isTransitive: false,
      }),
    );
    const [advisoryA, advisoryB] = await repo(VulnerabilityOsv).save([
      Object.assign(new VulnerabilityOsv(), { id: `GHSA-a-${randomUUID()}` }),
      Object.assign(new VulnerabilityOsv(), { id: `GHSA-b-${randomUUID()}` }),
    ]);
    const sca = Object.assign(
      Object.create(ScaService.prototype) as ScaService,
      { scaVulnDetectRepo: repo(ScaVulnerabilityDetections), logger },
    ) as unknown as ScaServiceInternals;
    const detection = (advisory: VulnerabilityOsv) =>
      repo(ScaVulnerabilityDetections).create({
        projectId: 'p-dup',
        scaDetectedPackage: pkg,
        vulnerability: advisory,
        branch: 'main',
        currentState: 'to_verify',
        currentSeverity: 'high',
        currentPriority: 'high',
        currentCVSS: 7.5,
      });

    await sca.insertNewDetection(detection(advisoryA));
    // Another pod created it: the duplicate path fetches it in the same
    // transaction.
    const twin = await sca
      .insertNewDetection(detection(advisoryA))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isUniqueViolation(twin)).toBe(true);
    expect(
      await repo(ScaVulnerabilityDetections).findOne({
        where: {
          scaDetectedPackage: { id: pkg.id },
          vulnerability: { id: advisoryA.id },
          branch: 'main',
        },
      }),
    ).not.toBeNull();
    await sca.insertNewDetection(detection(advisoryB));

    await runner.commitTransaction();
    expect(
      await live.dataSource
        .getRepository(ScaVulnerabilityDetections)
        .count({ where: { projectId: 'p-dup' } }),
    ).toBe(2);
  });

  it('an advisory stub written concurrently keeps the batch transaction usable on both engines', async () => {
    const container = Object.assign(
      Object.create(ContainerService.prototype) as ContainerService,
      { osvRepo: repo(VulnerabilityOsv), logger },
    ) as unknown as ContainerServiceInternals;
    const raced = `CVE-RACE-${randomUUID()}`;
    raceOnFirstInsert(VulnerabilityOsv, async () => {
      await live.dataSource
        .createQueryBuilder()
        .insert()
        .into(VulnerabilityOsv)
        .values({ id: raced })
        .callListeners(false)
        .updateEntity(false)
        .execute();
    });

    // The loser adopts the winner's row.
    expect((await container.findOrCreateOsvStub(raced)).id).toBe(raced);
    const other = `CVE-OTHER-${randomUUID()}`;
    expect((await container.findOrCreateOsvStub(other)).id).toBe(other);

    await runner.commitTransaction();
    expect(
      await live.dataSource
        .getRepository(VulnerabilityOsv)
        .createQueryBuilder('v')
        .where('v.id IN (:...ids)', { ids: [raced, other] })
        .getCount(),
    ).toBe(2);
  });
});
