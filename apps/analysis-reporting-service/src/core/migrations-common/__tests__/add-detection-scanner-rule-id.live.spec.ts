import { randomUUID } from 'node:crypto';
import type { ObjectLiteral, Repository } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from '../../db/live-database';
import { SastVulnerabilityDetections } from '../../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../../entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from '../../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../../entities/secret-vulnerability-detections.entity';
import { AddDetectionScannerRuleId1846200000000 } from '../1846200000000-AddDetectionScannerRuleId';

/**
 * LIVE spec of the common migration 1846200000000, on the engine
 * LIVE_DB_TYPE selects:
 *
 *   AR_SCANNER_RULE_ID_LIVE=1 LIVE_DB_TYPE=mysql \
 *     AR_SCANNER_RULE_ID_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/add-detection-scanner-rule-id.live.spec.ts
 *   AR_SCANNER_RULE_ID_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_SCANNER_RULE_ID_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/add-detection-scanner-rule-id.live.spec.ts
 *
 * The schema is built by the dialect's tracks (the migration runs there), then
 * the spec checks: each of the four detection tables has a nullable
 * `scannerRuleId` of 255 characters that keeps a 255-character id; `down`
 * removes the column; `up` is idempotent.
 */
const LIVE = process.env.AR_SCANNER_RULE_ID_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ENTITIES = {
  vulnerability_detections_sast: SastVulnerabilityDetections,
  vulnerability_detections_iac: IacVulnerabilityDetections,
  vulnerability_detections_cicd: CicdVulnerabilityDetections,
  vulnerability_detections_secret: SecretVulnerabilityDetections,
} as const;
const TABLES = Object.keys(ENTITIES) as Array<keyof typeof ENTITIES>;

describeLive('AddDetectionScannerRuleId on a real database', () => {
  jest.setTimeout(240_000);
  const HOOK_TIMEOUT = 240_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  let live: LiveDatabase;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_scanner_rule_id',
      envPrefix: 'AR_SCANNER_RULE_ID',
      dialect,
      migrations: 'track',
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await live?.drop();
  }, HOOK_TIMEOUT);

  const columnOf = async (table: string) => {
    const read = await live.dataSource.createQueryRunner().getTable(table);
    return read?.findColumnByName('scannerRuleId');
  };

  it.each(TABLES)(
    '%s has a nullable 255-character scannerRuleId after the tracks ran',
    async (table) => {
      const column = await columnOf(table);
      expect(column).toBeDefined();
      expect(column.isNullable).toBe(true);
      expect(Number(column.length)).toBe(255);
    },
  );

  it.each(TABLES)('%s keeps a 255-character rule id', async (table) => {
    const repo = live.dataSource.getRepository(
      ENTITIES[table],
    ) as unknown as Repository<ObjectLiteral>;
    const id = randomUUID();
    const ruleId = 'r'.repeat(255);
    await repo
      .createQueryBuilder()
      .insert()
      .values({
        id,
        projectId: randomUUID(),
        branch: 'main',
        path: 'src/a.js',
        language: 'generic',
        vulnerableStartLine: 1,
        vulnerableEndLine: 1,
        scannerType: 'semgrep',
        currentState: 'to_verify',
        currentSeverity: 'high',
        currentPriority: 'high',
        scannerRuleId: ruleId,
      })
      .updateEntity(false)
      .execute();
    const row = await repo.findOne({ where: { id } });
    expect(row.scannerRuleId).toBe(ruleId);
  });

  it('down removes the column from the four tables, and up is idempotent', async () => {
    const migration = new AddDetectionScannerRuleId1846200000000();
    const runner = live.dataSource.createQueryRunner();
    try {
      await migration.down(runner);
      await migration.down(runner);
      for (const table of TABLES) {
        expect(await columnOf(table)).toBeUndefined();
      }
      await migration.up(runner);
      await migration.up(runner);
      for (const table of TABLES) {
        expect(await columnOf(table)).toBeDefined();
      }
    } finally {
      await runner.release();
    }
  });
});
