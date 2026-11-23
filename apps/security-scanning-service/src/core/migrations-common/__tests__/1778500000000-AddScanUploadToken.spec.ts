import { QueryRunner, Table, TableColumn } from 'typeorm';
import { AddScanUploadToken1778500000000 as Migration } from '../1778500000000-AddScanUploadToken';

/**
 * Community scans on a connected Kubernetes cluster: the per-container
 * upload token table is a COMMON migration (both engines),
 * written with TypeORM's schema API only. The FK columns copy the charset and
 * collation TypeORM reads off `scan.id` and `container.id` (set on MySQL only
 * when they differ from the database defaults), so a database whose parent
 * tables drifted from its default still accepts the foreign keys. The fake
 * runner records the calls; no SQL text is involved at all.
 */
type Engine = 'mysql' | 'postgres';

const parent = (name: string, key: Partial<TableColumn> = {}): Table =>
  new Table({
    name,
    columns: [
      new TableColumn({
        name: 'id',
        type: 'varchar',
        length: '36',
        isPrimary: true,
        ...key,
      }),
    ],
  });

const fakeRunner = (
  engine: Engine,
  opts: { exists?: boolean; scanKey?: Partial<TableColumn> } = {},
) => {
  const created: Table[] = [];
  const runner = {
    connection: { options: { type: engine } },
    hasTable: jest.fn(async (name: string) => {
      expect(name).toBe('scan_upload_token');
      return opts.exists ?? false;
    }),
    getTable: jest.fn(async (name: string) =>
      name === 'scan'
        ? parent('scan', opts.scanKey)
        : name === 'container'
          ? parent('container')
          : undefined,
    ),
    createTable: jest.fn(async (table: Table) => {
      expect(table).toBeInstanceOf(Table);
      created.push(table);
    }),
    dropTable: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
  };
  return { runner: runner as unknown as QueryRunner & typeof runner, created };
};

const column = (table: Table, name: string): TableColumn => {
  const c = table.findColumnByName(name);
  if (!c) throw new Error(`no column ${name}`);
  return c;
};

describe('AddScanUploadToken1778500000000', () => {
  it.each(['mysql', 'postgres'] as const)(
    'creates scan_upload_token through the schema API (%s)',
    async (engine) => {
      const { runner, created } = fakeRunner(engine);

      await new Migration().up(runner);

      expect(created).toHaveLength(1);
      const table = created[0];
      expect(table.name).toBe('scan_upload_token');
      expect(table.columns.map((c) => c.name)).toEqual([
        'id',
        'scanId',
        'containerId',
        'tokenHash',
        'category',
        'severities',
        'expiresAt',
        'usedAt',
        'createdAt',
      ]);
      expect(column(table, 'id')).toMatchObject({
        type: 'varchar',
        length: '36',
        isPrimary: true,
      });
      expect(column(table, 'scanId')).toMatchObject({
        type: 'varchar',
        length: '36',
        isNullable: false,
      });
      expect(column(table, 'containerId')).toMatchObject({
        type: 'varchar',
        length: '36',
        isNullable: false,
      });
      expect(column(table, 'tokenHash')).toMatchObject({
        type: 'char',
        length: '64',
        isNullable: false,
      });
      expect(column(table, 'category')).toMatchObject({
        type: 'varchar',
        length: '16',
      });
      expect(column(table, 'severities')).toMatchObject({
        type: 'varchar',
        length: '64',
      });
      const datetime = engine === 'mysql' ? 'datetime' : 'timestamp';
      expect(column(table, 'expiresAt')).toMatchObject({
        type: datetime,
        precision: 3,
        isNullable: false,
      });
      expect(column(table, 'usedAt')).toMatchObject({
        type: datetime,
        precision: 3,
        isNullable: true,
      });
      expect(column(table, 'createdAt')).toMatchObject({
        type: datetime,
        precision: 3,
        default: 'CURRENT_TIMESTAMP(3)',
      });
      expect(
        table.foreignKeys.map((fk) => [
          fk.columnNames,
          fk.referencedTableName,
          fk.referencedColumnNames,
          fk.onDelete,
        ]),
      ).toEqual([
        [['scanId'], 'scan', ['id'], 'CASCADE'],
        [['containerId'], 'container', ['id'], 'CASCADE'],
      ]);
      expect(
        table.indices.map((i) => [i.name, i.columnNames, i.isUnique]),
      ).toEqual([
        ['IDX_scan_upload_token_scanId', ['scanId'], false],
        ['UQ_scan_upload_token_containerId', ['containerId'], true],
        ['UQ_scan_upload_token_tokenHash', ['tokenHash'], true],
      ]);
      expect(runner.createTable).toHaveBeenCalledWith(table, true);
    },
  );

  it('the id defaults to a generated uuid on PostgreSQL only (UuidPrimaryColumn)', async () => {
    const pg = fakeRunner('postgres');
    await new Migration().up(pg.runner);
    expect(column(pg.created[0], 'id').default).toBe('gen_random_uuid()::text');

    const mysql = fakeRunner('mysql');
    await new Migration().up(mysql.runner);
    expect(column(mysql.created[0], 'id').default).toBeUndefined();
  });

  it("the FK columns copy the parent key's charset and collation", async () => {
    const { runner, created } = fakeRunner('mysql', {
      scanKey: { charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' },
    });

    await new Migration().up(runner);

    expect(column(created[0], 'scanId')).toMatchObject({
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
    });
    expect(column(created[0], 'containerId').charset).toBeUndefined();
    expect(column(created[0], 'containerId').collation).toBeUndefined();
  });

  it('creates nothing when the table already exists', async () => {
    const { runner } = fakeRunner('mysql', { exists: true });

    await new Migration().up(runner);

    expect(runner.createTable).not.toHaveBeenCalled();
  });

  it('drops the table on down, only when present', async () => {
    const present = fakeRunner('postgres', { exists: true });
    await new Migration().down(present.runner);
    expect(present.runner.dropTable).toHaveBeenCalledWith(
      'scan_upload_token',
      true,
    );

    const absent = fakeRunner('postgres');
    await new Migration().down(absent.runner);
    expect(absent.runner.dropTable).not.toHaveBeenCalled();
  });

  it('runs no SQL text', async () => {
    const up = fakeRunner('mysql').runner;
    const down = fakeRunner('mysql', { exists: true }).runner;
    await new Migration().up(up);
    await new Migration().down(down);
    expect(up.query).not.toHaveBeenCalled();
    expect(down.query).not.toHaveBeenCalled();
  });
});
