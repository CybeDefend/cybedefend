import { ident, run, sql } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../../core/db/live-database';
import {
  IssuePlatform,
  VulnerabilityIssueMapping,
} from '../../entities/vulnerability-issue-mapping.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { DataPurgeService } from './data-purge.service';
import { IntegrationsAdminService } from '../integrations-admin/integrations-admin.service';

/**
 * LIVE spec: only a real database proves that the bounded purge
 * statements work on both engines — `deleteBatch` / `updateBatch` render
 * `ctid IN (SELECT … LIMIT n)` on PostgreSQL — and that `run(...).affected`
 * reports the matched rows on both.
 *
 * Skipped unless EI_PURGE_LIVE=1 (or the legacy EI_PURGE_MYSQL_LIVE=1, which
 * means LIVE_DB_TYPE=mysql). Runs once per engine:
 *   EI_PURGE_LIVE=1 LIVE_DB_TYPE=postgres EI_PURGE_PG_URL=postgres://… \
 *     pnpm exec jest data-purge.live --runInBand
 * It creates, then drops, its own throwaway database.
 */
const describeLive = liveEnabled('EI_PURGE') ? describe : describe.skip;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const FAR = () => Date.now() + 60_000;

describeLive('EI data purge on a live database', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let service: DataPurgeService;

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ei_purge',
      envPrefix: 'EI_PURGE',
    });
    const admin = {
      deleteIntegrationsForOrg: jest.fn().mockResolvedValue({}),
    } as unknown as IntegrationsAdminService;
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
    } as never;
    service = new DataPurgeService(db.dataSource, admin, logger);
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function seedMappings(projectId: string, n: number): Promise<void> {
    const repo = db.dataSource.getRepository(VulnerabilityIssueMapping);
    for (let start = 0; start < n; start += 500) {
      const rows = Array.from({ length: Math.min(500, n - start) }, (_, i) => ({
        projectId,
        vulnerabilityId: `vuln-${start + i}`,
        scannerType: 'sast',
        platform: IssuePlatform.GITHUB,
        externalIssueId: `issue-${start + i}`,
        issueTitle: `title ${start + i}`,
      }));
      await repo.insert(rows);
    }
  }

  async function countMappings(projectId: string): Promise<number> {
    const { rows } = await run(
      db.dataSource,
      sql`SELECT COUNT(*) AS cnt FROM ${ident('vulnerability_issue_mapping')} WHERE ${ident('projectId')} = ${projectId}`,
    );
    return Number(rows[0].cnt);
  }

  const deletesOf = (table: string) =>
    db.statements.filter(
      (s) => /^\s*DELETE FROM/i.test(s) && s.includes(table),
    );

  it('purges in batches of 1000 and reports the count (2 500 rows: 1000, 1000, 500, then 0)', async () => {
    await seedMappings(PROJECT, 2_500);
    expect(await countMappings(PROJECT)).toBe(2_500);

    db.statements.length = 0;
    const res = await service.purgeProject(PROJECT, ORG, FAR());

    expect(res.complete).toBe(true);
    expect(res.deleted.vulnerability_issue_mapping).toBe(2_500);
    // 1000 + 1000 + 500: the short third batch ends the loop.
    expect(deletesOf('vulnerability_issue_mapping')).toHaveLength(3);
    expect(await countMappings(PROJECT)).toBe(0);

    // Idempotent: a second call finds nothing left and issues one empty batch.
    db.statements.length = 0;
    const again = await service.purgeProject(PROJECT, ORG, FAR());
    expect(again.complete).toBe(true);
    expect(again.deleted.vulnerability_issue_mapping).toBe(0);
    expect(deletesOf('vulnerability_issue_mapping')).toHaveLength(1);
  });

  it('leaves other projects untouched', async () => {
    await seedMappings(OTHER, 3);
    const res = await service.purgeProject(PROJECT, ORG, FAR());
    expect(res.complete).toBe(true);
    expect(await countMappings(OTHER)).toBe(3);
    expect(await countMappings(PROJECT)).toBe(0);
  });

  it('detaches a project with the bounded UPDATE (projectId and scanBranch NULL, row kept)', async () => {
    const integration = await db.dataSource
      .getRepository(GithubIntegration)
      .save({
        installationId: 424242,
        organizationId: ORG,
      });
    const repo = db.dataSource.getRepository(GithubRepository);
    await repo.insert([
      {
        githubId: 9001,
        nodeId: 'n-9001',
        name: 'repo-a',
        fullName: 'org/repo-a',
        private: true,
        projectId: PROJECT,
        scanBranch: 'main',
        integrationId: integration.id,
      },
      {
        githubId: 9002,
        nodeId: 'n-9002',
        name: 'repo-b',
        fullName: 'org/repo-b',
        private: false,
        projectId: PROJECT,
        scanBranch: 'develop',
        integrationId: integration.id,
      },
    ]);

    db.statements.length = 0;
    const res = await service.purgeProject(PROJECT, ORG, FAR());

    expect(res.complete).toBe(true);
    expect(res.deleted.github_repositories).toBe(2);
    const updates = db.statements.filter(
      (s) => /^\s*UPDATE/i.test(s) && s.includes('github_repositories'),
    );
    expect(updates).toHaveLength(1);

    const { rows } = await run(
      db.dataSource,
      sql`SELECT ${ident('projectId')}, ${ident('scanBranch')} FROM ${ident('github_repositories')} WHERE ${ident('integrationId')} = ${integration.id} ORDER BY ${ident('githubId')}`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.projectId).toBeNull();
      expect(row.scanBranch).toBeNull();
    }
  });
});
