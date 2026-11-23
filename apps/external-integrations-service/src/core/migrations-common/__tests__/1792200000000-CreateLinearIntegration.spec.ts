import { Table, TableColumn, type QueryRunner } from 'typeorm';
import { CreateLinearIntegration1792200000000 } from '../1792200000000-CreateLinearIntegration';

const MAPPING_COLUMNS = [
  'linearIdentifier',
  'linearTeamKey',
  'linearPriority',
  'linearAssignee',
  'linearStateType',
  'linearOrganizationId',
  'doneAt',
  'doneReason',
];

interface Presence {
  tables?: string[];
  columns?: string[];
  platforms?: string[];
}

/**
 * A query runner double that records the schema-API calls. Its `query` is
 * only reached by the dialect helpers (the enum value and the PostgreSQL
 * updated-at triggers); nothing else of the migration may call it. The MySQL
 * enum helper's INFORMATION_SCHEMA read is answered from the platform column
 * and not recorded.
 */
function double(type: 'mysql' | 'postgres', presence: Presence = {}) {
  const tables = new Set(presence.tables ?? []);
  const columns = new Set(presence.columns ?? []);
  const platform = new TableColumn({
    name: 'platform',
    type: 'enum',
    enum: presence.platforms ?? ['github', 'gitlab', 'jira'],
  });
  const created: Table[] = [];
  const added: TableColumn[] = [];
  const changed: TableColumn[] = [];
  const dropped: string[] = [];
  const queries: string[] = [];
  const deleted: unknown[] = [];
  const runner = {
    connection: { options: { type } },
    manager: {
      connection: { options: { type } },
      createQueryBuilder: () => {
        const qb = {
          delete: () => qb,
          from: () => qb,
          where: (cond: string, params: unknown) => {
            deleted.push([cond, params]);
            return qb;
          },
          execute: jest.fn(async () => undefined),
        };
        return qb;
      },
    },
    hasTable: jest.fn(async (t: string) => tables.has(t)),
    hasColumn: jest.fn(async (_t: string, c: string) => columns.has(c)),
    createTable: jest.fn(async (t: Table) => {
      created.push(t);
    }),
    dropTable: jest.fn(async (t: string) => {
      dropped.push(t);
    }),
    addColumn: jest.fn(async (_t: string, c: TableColumn) => {
      added.push(c);
    }),
    dropColumn: jest.fn(async (_t: string, c: string) => {
      dropped.push(c);
    }),
    getTable: jest.fn(async () => ({
      findColumnByName: (n: string) =>
        n === 'platform' ? platform : undefined,
    })),
    changeColumn: jest.fn(
      async (_t: string, _old: TableColumn, next: TableColumn) => {
        changed.push(next);
      },
    ),
    query: jest.fn(async (sql: string) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [
          {
            columnType: `enum(${(platform.enum ?? []).map((v) => `'${v}'`).join(',')})`,
            isNullable: 'NO',
            columnDefault: null,
            charset: 'utf8mb4',
            collation: 'utf8mb4_0900_ai_ci',
            comment: '',
            extra: '',
          },
        ];
      }
      queries.push(sql);
      return [];
    }),
  } as unknown as QueryRunner;
  return { runner, created, added, changed, dropped, queries, deleted };
}

const column = (t: Table, name: string): TableColumn =>
  t.columns.find((c) => c.name === name) as TableColumn;

describe('CreateLinearIntegration1792200000000 (common migration)', () => {
  it('keeps the class name of the MySQL-track version, so a database that ran it skips it', () => {
    expect(new CreateLinearIntegration1792200000000().name).toBe(
      'CreateLinearIntegration1792200000000',
    );
  });

  describe.each(['mysql', 'postgres'] as const)('up on %s', (type) => {
    it('creates the two tables with their keys, parent first', async () => {
      const { runner, created } = double(type);

      await new CreateLinearIntegration1792200000000().up(runner);

      expect(created.map((t) => t.name)).toEqual([
        'linear_integrations',
        'linear_project_mappings',
      ]);
      const [integrations, mappings] = created;
      expect(integrations.uniques.map((u) => [u.name, u.columnNames])).toEqual([
        ['UQ_linear_integrations_organizationId', ['organizationId']],
        [
          'UQ_linear_integrations_linearOrganizationId',
          ['linearOrganizationId'],
        ],
      ]);
      expect(mappings.uniques.map((u) => [u.name, u.columnNames])).toEqual([
        ['UQ_linear_project_mappings_projectId', ['projectId']],
      ]);
      const [fk] = mappings.foreignKeys;
      expect(fk.name).toBe('FK_linear_project_mappings_integrationId');
      expect(fk.columnNames).toEqual(['integrationId']);
      expect(fk.referencedTableName).toBe('linear_integrations');
      expect(fk.onDelete).toBe('CASCADE');
      expect(column(integrations, 'accessToken').isNullable).toBe(false);
      expect(column(integrations, 'refreshToken').isNullable).toBe(true);
      expect(String(column(integrations, 'needsReconnect').default)).toBe('0');
      expect(String(column(mappings, 'autoCreateEnabled').default)).toBe('0');
    });

    it('adds linear to the platform enum and each Linear column once', async () => {
      const { runner, added, changed, queries } = double(type);

      await new CreateLinearIntegration1792200000000().up(runner);

      expect(added.map((c) => c.name)).toEqual(MAPPING_COLUMNS);
      expect(added.every((c) => c.isNullable)).toBe(true);
      if (type === 'mysql') {
        expect(changed).toEqual([]);
        expect(queries).toEqual([
          "ALTER TABLE `vulnerability_issue_mapping` MODIFY `platform` ENUM('github','gitlab','jira','linear') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL",
        ]);
      } else {
        expect(queries).toContain(
          `ALTER TYPE "vulnerability_issue_mapping_platform_enum" ADD VALUE IF NOT EXISTS 'linear'`,
        );
      }
    });

    it('is idempotent: nothing is created on a migrated schema', async () => {
      const { runner, created, added, changed, queries } = double(type, {
        tables: ['linear_integrations', 'linear_project_mappings'],
        columns: MAPPING_COLUMNS,
        platforms: ['github', 'gitlab', 'jira', 'linear'],
      });

      await new CreateLinearIntegration1792200000000().up(runner);

      expect(created).toEqual([]);
      expect(added).toEqual([]);
      expect(changed).toEqual([]);
      expect(queries).toEqual([]);
    });
  });

  it('types the timestamps per engine: DATETIME on MySQL, TIMESTAMP(0) on PostgreSQL', async () => {
    const mysql = double('mysql');
    await new CreateLinearIntegration1792200000000().up(mysql.runner);
    const pg = double('postgres');
    await new CreateLinearIntegration1792200000000().up(pg.runner);

    const myUpdated = column(mysql.created[0], 'updatedAt');
    expect(myUpdated.type).toBe('datetime');
    expect(myUpdated.onUpdate).toBe('CURRENT_TIMESTAMP');
    expect(column(mysql.created[0], 'needsReconnect').type).toBe('tinyint');
    // no trigger on MySQL: the only raw DDL is the enum value
    expect(mysql.queries).toHaveLength(1);
    expect(mysql.queries[0]).toMatch(
      /^ALTER TABLE `vulnerability_issue_mapping` MODIFY `platform` ENUM\(/,
    );

    const pgUpdated = column(pg.created[0], 'updatedAt');
    expect(pgUpdated.type).toBe('timestamp');
    expect(pgUpdated.precision).toBe(0);
    expect(pgUpdated.onUpdate).toBeUndefined();
    expect(column(pg.created[0], 'needsReconnect').type).toBe('smallint');
    expect(String(column(pg.created[0], 'id').default)).toBe(
      'gen_random_uuid()::text',
    );
    // one updated-at trigger per new table (function + trigger each)
    expect(
      pg.queries.filter((q) => q.startsWith('CREATE TRIGGER')),
    ).toHaveLength(2);
  });

  it('down drops what up created, removing the linear rows before narrowing the enum', async () => {
    const { runner, dropped, changed, deleted } = double('mysql', {
      tables: ['linear_integrations', 'linear_project_mappings'],
      columns: MAPPING_COLUMNS,
      platforms: ['github', 'gitlab', 'jira', 'linear'],
    });

    await new CreateLinearIntegration1792200000000().down(runner);

    expect(dropped.slice(0, 2)).toEqual([
      'linear_project_mappings',
      'linear_integrations',
    ]);
    expect(dropped.slice(2)).toEqual(MAPPING_COLUMNS);
    expect(deleted).toEqual([['platform = :platform', { platform: 'linear' }]]);
    expect(changed[0].enum).toEqual(['github', 'gitlab', 'jira']);
  });
});
