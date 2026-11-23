import type { QueryRunner, Table } from 'typeorm';
import { CreateLocalIdentityTables1786300000000 } from '../1786300000000-CreateLocalIdentityTables';

/**
 * The local identity tables' common migration builds its schema with TypeORM's schema API
 * only, so this spec asserts the `Table` objects handed to `createTable`, never
 * SQL text: the engine decides the rendering, and `query` must never be
 * called (the charset of the `user_id` FK columns is read through
 * `getTable('user')`, not through information_schema).
 */
describe('CreateLocalIdentityTables1786300000000', () => {
  const TABLES = [
    'local_credential',
    'auth_refresh_token',
    'auth_one_time_token',
    'personal_access_token',
    'auth_signing_key',
  ];
  const USER_KEYED = TABLES.slice(0, 4);

  interface Captured {
    runner: QueryRunner;
    created: Table[];
    dropped: (string | Table)[];
    query: jest.Mock;
    createMetadataTable: jest.Mock;
  }

  function double(
    dialect: 'mysql' | 'postgres',
    userId?: { charset?: string; collation?: string },
  ): Captured {
    const created: Table[] = [];
    const dropped: (string | Table)[] = [];
    const query = jest.fn(async () => [] as unknown[]);
    // Stands in for the driver's RdbmsSchemaBuilder: the migration makes sure
    // typeorm_metadata exists (a stored generated column is recorded there)
    // before its createTable calls, because the migration executor creates it
    // only when entities are loaded.
    const createMetadataTable = jest.fn(async () => undefined);
    const runner = {
      connection: {
        options: { type: dialect },
        driver: {
          createSchemaBuilder: () => ({
            '@instanceof': Symbol.for('RdbmsSchemaBuilder'),
            createTypeormMetadataTable: createMetadataTable,
          }),
        },
      },
      getTable: jest.fn(async (name: string) =>
        name === 'user'
          ? {
              findColumnByName: (column: string) =>
                column === 'id' ? userId : undefined,
            }
          : undefined,
      ),
      createTable: jest.fn(async (table: Table) => {
        created.push(table);
      }),
      dropTable: jest.fn(async (table: string | Table) => {
        dropped.push(table);
      }),
      query,
    } as unknown as QueryRunner;
    return { runner, created, dropped, query, createMetadataTable };
  }

  const byName = (created: Table[], name: string): Table =>
    created.find((t) => t.name === name)!;
  const column = (table: Table, name: string) =>
    table.columns.find((c) => c.name === name)!;
  const columnNames = (table: Table) => table.columns.map((c) => c.name);

  it('creates the five tables through the schema API and never calls query', async () => {
    const { runner, created, query, createMetadataTable } = double('mysql', {
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
    });
    await new CreateLocalIdentityTables1786300000000().up(runner);
    expect(created.map((t) => t.name)).toEqual(TABLES);
    expect(query).not.toHaveBeenCalled();
    // typeorm_metadata first: active_name's expression is recorded in it.
    expect(createMetadataTable).toHaveBeenCalledTimes(1);
  });

  it('declares every column of the five tables', async () => {
    const { runner, created } = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().up(runner);
    expect(columnNames(byName(created, 'local_credential'))).toEqual([
      'user_id',
      'password_hash',
      'password_changed_at',
      'created_at',
    ]);
    expect(columnNames(byName(created, 'auth_refresh_token'))).toEqual([
      'id',
      'user_id',
      'family_id',
      'token_hash',
      'expires_at',
      'rotated_at',
      'revoked_at',
      'replaced_by',
      'created_at',
    ]);
    expect(columnNames(byName(created, 'auth_one_time_token'))).toEqual([
      'id',
      'user_id',
      'purpose',
      'token_hash',
      'expires_at',
      'consumed_at',
      'attempts',
      'created_at',
    ]);
    expect(columnNames(byName(created, 'personal_access_token'))).toEqual([
      'id',
      'user_id',
      'name',
      'token_hash',
      'last_four',
      'last_used_at',
      'expires_at',
      'revoked_at',
      'created_at',
      'active_name',
    ]);
    expect(columnNames(byName(created, 'auth_signing_key'))).toEqual([
      'kid',
      'private_key_encrypted',
      'public_jwk',
      'created_at',
      'retired_at',
    ]);
  });

  it('copies the charset and collation of user.id onto every user_id column', async () => {
    const { runner, created } = double('mysql', {
      charset: 'utf8mb4',
      collation: 'utf8mb4_unicode_ci',
    });
    await new CreateLocalIdentityTables1786300000000().up(runner);
    for (const name of USER_KEYED) {
      const userId = column(byName(created, name), 'user_id');
      expect(userId.charset).toBe('utf8mb4');
      expect(userId.collation).toBe('utf8mb4_unicode_ci');
      expect(userId.type).toBe('varchar');
      expect(userId.length).toBe('36');
    }
    // auth_signing_key is instance-level: no user_id column at all.
    expect(columnNames(byName(created, 'auth_signing_key'))).not.toContain(
      'user_id',
    );
  });

  it('sets no charset on any column when user.id carries none (PostgreSQL, or a database on its defaults)', async () => {
    const { runner, created, query } = double('postgres', {});
    await new CreateLocalIdentityTables1786300000000().up(runner);
    for (const table of created) {
      for (const col of table.columns) {
        expect(col.charset).toBeUndefined();
        expect(col.collation).toBeUndefined();
      }
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('writes the datetime columns with columnType and their defaults with nowPrecise', async () => {
    const mysql = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().up(mysql.runner);
    const myCreatedAt = column(
      byName(mysql.created, 'local_credential'),
      'created_at',
    );
    expect(myCreatedAt.type).toBe('datetime');
    expect(myCreatedAt.precision).toBe(3);
    expect(myCreatedAt.default).toBe('NOW(3)');

    const pg = double('postgres', {});
    await new CreateLocalIdentityTables1786300000000().up(pg.runner);
    const pgCreatedAt = column(
      byName(pg.created, 'local_credential'),
      'created_at',
    );
    expect(pgCreatedAt.type).toBe('timestamp');
    expect(pgCreatedAt.precision).toBe(3);
    expect(pgCreatedAt.default).toBe('CURRENT_TIMESTAMP(3)');
    // rotated_at was added for the 20 s race window.
    expect(
      column(byName(pg.created, 'auth_refresh_token'), 'rotated_at').isNullable,
    ).toBe(true);
  });

  it('declares the enums, the uniques, the primary keys and the indexes', async () => {
    const { runner, created } = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().up(runner);

    const aott = byName(created, 'auth_one_time_token');
    expect(column(aott, 'purpose')).toMatchObject({
      type: 'enum',
      enum: ['password_reset', 'setup'],
    });
    expect(column(aott, 'attempts')).toMatchObject({
      type: 'int',
      default: '0',
    });

    for (const name of [
      'auth_refresh_token',
      'auth_one_time_token',
      'personal_access_token',
    ]) {
      expect(column(byName(created, name), 'token_hash')).toMatchObject({
        type: 'char',
        length: '64',
        isUnique: true,
      });
    }

    expect(
      column(byName(created, 'local_credential'), 'user_id').isPrimary,
    ).toBe(true);
    for (const name of [
      'auth_refresh_token',
      'auth_one_time_token',
      'personal_access_token',
    ]) {
      expect(column(byName(created, name), 'id').isPrimary).toBe(true);
    }
    expect(column(byName(created, 'auth_signing_key'), 'kid').isPrimary).toBe(
      true,
    );

    const art = byName(created, 'auth_refresh_token');
    expect(art.indices.map((i) => [i.name, i.columnNames])).toEqual([
      ['IDX_art_family', ['family_id']],
      ['IDX_art_user', ['user_id']],
    ]);
    expect(
      byName(created, 'auth_one_time_token').indices.map((i) => [
        i.name,
        i.columnNames,
      ]),
    ).toEqual([
      ['IDX_aott_user_purpose_created', ['user_id', 'purpose', 'created_at']],
    ]);
    const pat = byName(created, 'personal_access_token');
    expect(pat.indices.map((i) => [i.name, i.columnNames, i.isUnique])).toEqual(
      [['UQ_pat_user_active_name', ['user_id', 'active_name'], true]],
    );
  });

  it('declares a cascading FK to user(id) on each user-keyed table', async () => {
    const { runner, created } = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().up(runner);
    for (const name of USER_KEYED) {
      const fks = byName(created, name).foreignKeys;
      expect(fks).toHaveLength(1);
      expect(fks[0].columnNames).toEqual(['user_id']);
      expect(fks[0].referencedTableName).toBe('user');
      expect(fks[0].referencedColumnNames).toEqual(['id']);
      expect(fks[0].onDelete).toBe('CASCADE');
    }
    expect(byName(created, 'auth_signing_key').foreignKeys).toEqual([]);
  });

  it('active_name is a STORED generated column with the CASE expression, not a partial index', async () => {
    const { runner, created } = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().up(runner);
    const activeName = column(
      byName(created, 'personal_access_token'),
      'active_name',
    );
    expect(activeName.generatedType).toBe('STORED');
    expect(activeName.asExpression).toBe(
      'CASE WHEN revoked_at IS NULL THEN name ELSE NULL END',
    );
    expect(activeName.isNullable).toBe(true);
  });

  it('down drops the five tables in reverse order, again without query', async () => {
    const { runner, dropped, query } = double('mysql', {});
    await new CreateLocalIdentityTables1786300000000().down(runner);
    expect(dropped).toEqual([...TABLES].reverse());
    expect(query).not.toHaveBeenCalled();
  });
});
