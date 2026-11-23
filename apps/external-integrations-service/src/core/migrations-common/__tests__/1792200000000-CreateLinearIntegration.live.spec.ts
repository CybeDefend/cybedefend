import { randomUUID } from 'node:crypto';
import type { Dialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from '../../db/live-database';
import { CreateLinearIntegration1792200000000 } from '../1792200000000-CreateLinearIntegration';

/**
 * The Linear migration on real engines: each database is built by its whole
 * track (MySQL history or PostgreSQL baseline, then the common migrations),
 * so the migration has already run once. The spec checks what it built, that
 * a second run changes nothing, and that down then up gives it back.
 *
 *   EI_LINEAR_MIGRATION_LIVE=1 \
 *   EI_LINEAR_MIGRATION_MYSQL_URL=mysql://root:password@127.0.0.1:3308 \
 *   EI_LINEAR_MIGRATION_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *   pnpm exec jest --ci --runInBand --testPathPatterns=CreateLinearIntegration.live
 */
const describeLive =
  process.env.EI_LINEAR_MIGRATION_LIVE === '1' ? describe : describe.skip;

const q = (dialect: Dialect, ident: string) =>
  dialect === 'mysql' ? `\`${ident}\`` : `"${ident}"`;

function ph(dialect: Dialect, text: string): string {
  if (dialect === 'mysql') return text;
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

describeLive.each(['mysql', 'postgres'] as const)(
  'CreateLinearIntegration1792200000000 on %s',
  (dialect) => {
    let db: LiveDatabase;

    beforeAll(async () => {
      db = await createLiveDatabase({
        prefix: 'ei_linear',
        envPrefix: 'EI_LINEAR_MIGRATION',
        entities: [],
        dialect,
      });
    }, 300_000);

    afterAll(async () => {
      await db?.drop();
    });

    async function run<T = unknown>(sql: string, params: unknown[] = []) {
      return (await db.dataSource.query(ph(dialect, sql), params)) as T;
    }

    async function insertLinearTicket(): Promise<string> {
      const id = randomUUID();
      const c = (n: string) => q(dialect, n);
      await run(
        `INSERT INTO ${c('vulnerability_issue_mapping')} (${c('id')}, ${c('projectId')}, ${c('vulnerabilityId')}, ${c('scannerType')}, ${c('platform')}, ${c('externalIssueId')}, ${c('issueTitle')}, ${c('linearIdentifier')}, ${c('doneAt')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          'p1',
          'v1',
          'sast',
          'linear',
          'issue-uuid',
          'A finding',
          'ENG-42',
          new Date('2026-11-04T10:00:00Z'),
        ],
      );
      return id;
    }

    it('built the tables, the Linear columns and the enum value', async () => {
      const runner = db.dataSource.createQueryRunner();
      try {
        expect(await runner.hasTable('linear_integrations')).toBe(true);
        expect(await runner.hasTable('linear_project_mappings')).toBe(true);
        const mapping = await runner.getTable('vulnerability_issue_mapping');
        expect(mapping?.findColumnByName('platform')?.enum).toContain('linear');
        expect(mapping?.findColumnByName('linearIdentifier')?.isNullable).toBe(
          true,
        );
      } finally {
        await runner.release();
      }
      await insertLinearTicket();
    });

    it('cascades the project settings with their integration', async () => {
      const c = (n: string) => q(dialect, n);
      const integrationId = randomUUID();
      await run(
        `INSERT INTO ${c('linear_integrations')} (${c('id')}, ${c('organizationId')}, ${c('linearOrganizationId')}, ${c('workspaceName')}, ${c('workspaceUrlKey')}, ${c('accessToken')}) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          integrationId,
          randomUUID(),
          `lin-${integrationId}`,
          'Acme',
          'acme',
          'enc',
        ],
      );
      await run(
        `INSERT INTO ${c('linear_project_mappings')} (${c('id')}, ${c('integrationId')}, ${c('projectId')}, ${c('teamId')}, ${c('teamKey')}, ${c('teamName')}) VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), integrationId, randomUUID(), 't1', 'ENG', 'Engineering'],
      );
      await run(
        `DELETE FROM ${c('linear_integrations')} WHERE ${c('id')} = ?`,
        [integrationId],
      );
      const left = await run<Array<Record<string, unknown>>>(
        `SELECT ${c('id')} FROM ${c('linear_project_mappings')} WHERE ${c('integrationId')} = ?`,
        [integrationId],
      );
      expect(left).toEqual([]);
    });

    it('a second run changes nothing', async () => {
      const runner = db.dataSource.createQueryRunner();
      try {
        await new CreateLinearIntegration1792200000000().up(runner);
      } finally {
        await runner.release();
      }
      const rows = await run<Array<Record<string, unknown>>>(
        `SELECT COUNT(*) AS n FROM ${q(dialect, 'vulnerability_issue_mapping')} WHERE ${q(dialect, 'platform')} = ?`,
        ['linear'],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('down removes it all, up builds it again', async () => {
      const runner = db.dataSource.createQueryRunner();
      try {
        await new CreateLinearIntegration1792200000000().down(runner);
        expect(await runner.hasTable('linear_integrations')).toBe(false);
        expect(await runner.hasTable('linear_project_mappings')).toBe(false);
        const narrowed = await runner.getTable('vulnerability_issue_mapping');
        expect(narrowed?.findColumnByName('platform')?.enum).not.toContain(
          'linear',
        );
        expect(narrowed?.findColumnByName('doneAt')).toBeUndefined();

        await new CreateLinearIntegration1792200000000().up(runner);
        expect(await runner.hasTable('linear_integrations')).toBe(true);
      } finally {
        await runner.release();
      }
      await insertLinearTicket();
    });
  },
);
