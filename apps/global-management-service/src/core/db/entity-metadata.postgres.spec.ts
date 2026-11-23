import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import type { EntityMetadataSnapshot } from './entity-metadata';

/**
 * The same metadata with the decorators evaluated for PostgreSQL
 * (DB_TYPE=postgres set before the entities load). The Community Edition's
 * entities must not keep a MySQL-only column type, an onUpdate, a uuid
 * generation strategy, or a case-sensitive team/project name.
 */
const savedDbType = process.env.DB_TYPE;
process.env.DB_TYPE = 'postgres';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { entityMetadataSnapshot } = require('./entity-metadata') as {
  entityMetadataSnapshot: (ds: DataSource) => Promise<EntityMetadataSnapshot>;
};

const ROOT = join(__dirname, '..', '..');

afterAll(() => {
  if (savedDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = savedDbType;
});

describe('core entity metadata on postgres', () => {
  let snapshot: EntityMetadataSnapshot;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DataSource } = require('typeorm') as typeof import('typeorm');
    const dataSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: 1,
      username: 'unused',
      password: 'unused',
      database: 'unused',
      entities: [join(ROOT, 'entities/*.entity.ts')],
    });
    snapshot = await entityMetadataSnapshot(dataSource);
  });

  it('no core column keeps a MySQL-only type', () => {
    const mysqlOnly = new Set([
      'datetime',
      'longtext',
      'mediumtext',
      'tinyint',
      'mediumblob',
      'json',
      'float',
      'double',
    ]);
    expect(snapshot.columns.filter((c) => mysqlOnly.has(c.type))).toEqual([]);
  });

  it('no column relies on onUpdate', () => {
    expect(snapshot.columns.filter((c) => c.onUpdate !== null)).toEqual([]);
  });

  it('every primary key is varchar(36), the generated ones by a database default', () => {
    // no generationStrategy: 'uuid' anymore — the id is a plain varchar(36)
    // column whose default the database generates
    expect(
      snapshot.columns.filter((c) => c.generationStrategy !== null),
    ).toEqual([]);
    // the ten generated ids: primary varchar(36) columns with a database default
    const generated = snapshot.columns.filter(
      (c) => c.default === 'gen_random_uuid()::text',
    );
    expect(generated).toHaveLength(10);
    expect(
      generated.every(
        (c) => c.primary && c.type === 'varchar' && String(c.length) === '36',
      ),
    ).toBe(true);
    for (const column of generated) {
      expect(column.property).toBe('id');
    }
  });

  it('team and project names compare case-insensitively', () => {
    const teamName = snapshot.columns.find(
      (c) => c.table === 'team' && c.property === 'name',
    );
    const projectName = snapshot.columns.find(
      (c) => c.table === 'project' && c.property === 'name',
    );
    expect(teamName?.type).toBe('citext');
    expect(projectName?.type).toBe('citext');
  });
});
