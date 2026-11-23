import { TableColumn, type QueryRunner } from 'typeorm';
import { AddGitlabWebhookTokenHash1792340000000 } from '../1792340000000-AddGitlabWebhookTokenHash';
import { POSTGRES_BASELINE_AT } from '../../db/migration-tracks';

function double(type: 'mysql' | 'postgres', present = false) {
  const added: Array<[string, TableColumn]> = [];
  const dropped: Array<[string, string]> = [];
  const runner = {
    connection: { options: { type } },
    hasColumn: jest.fn(async () => present),
    addColumn: jest.fn(async (t: string, c: TableColumn) => {
      added.push([t, c]);
    }),
    dropColumn: jest.fn(async (t: string, c: string) => {
      dropped.push([t, c]);
    }),
    query: jest.fn(async () => {
      throw new Error('no raw SQL expected');
    }),
  } as unknown as QueryRunner;
  return { runner, added, dropped };
}

describe('AddGitlabWebhookTokenHash1792340000000 (common migration)', () => {
  it('runs after the PostgreSQL baseline', () => {
    expect(1792340000000).toBeGreaterThan(POSTGRES_BASELINE_AT);
    expect(new AddGitlabWebhookTokenHash1792340000000().name).toBe(
      'AddGitlabWebhookTokenHash1792340000000',
    );
  });

  describe.each(['mysql', 'postgres'] as const)('on %s', (type) => {
    it('adds a nullable varchar(64) webhookTokenHash to gitlab_repositories', async () => {
      const { runner, added } = double(type);

      await new AddGitlabWebhookTokenHash1792340000000().up(runner);

      expect(added).toHaveLength(1);
      const [table, column] = added[0];
      expect(table).toBe('gitlab_repositories');
      expect(column.name).toBe('webhookTokenHash');
      expect(column.type).toBe('varchar');
      expect(column.length).toBe('64');
      expect(column.isNullable).toBe(true);
    });

    it('is idempotent: nothing is added when the column exists', async () => {
      const { runner, added } = double(type, true);

      await new AddGitlabWebhookTokenHash1792340000000().up(runner);

      expect(added).toEqual([]);
    });

    it('down drops the column, only when present', async () => {
      const present = double(type, true);
      await new AddGitlabWebhookTokenHash1792340000000().down(present.runner);
      expect(present.dropped).toEqual([
        ['gitlab_repositories', 'webhookTokenHash'],
      ]);

      const absent = double(type, false);
      await new AddGitlabWebhookTokenHash1792340000000().down(absent.runner);
      expect(absent.dropped).toEqual([]);
    });
  });
});
