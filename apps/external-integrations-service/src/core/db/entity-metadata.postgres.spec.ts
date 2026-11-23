import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityMetadataSnapshot } from './entity-metadata';
import { UPDATED_AT_COLUMNS } from './updated-at-columns';

// The entity decorators read DB_TYPE when @cybedefend/db-dialect loads, so
// this spec sets DB_TYPE=postgres and require()-s everything inside an
// isolated module registry: the entities are then decorated for postgres.
const ENTITIES_DIR = join(__dirname, '..', '..', 'entities');

const MYSQL_ONLY_TYPES = [
  'datetime',
  'longtext',
  'mediumtext',
  'tinyint',
  'mediumblob',
  'json',
  'float',
  'double',
];

async function postgresSnapshot(): Promise<EntityMetadataSnapshot> {
  let promise: Promise<EntityMetadataSnapshot> | undefined;
  jest.isolateModules(() => {
    process.env.DB_TYPE = 'postgres';
    type Builder = typeof import('./entity-metadata');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const builder: Builder = require('./entity-metadata');
    const entities = readdirSync(ENTITIES_DIR)
      .filter((f) => f.endsWith('.entity.ts'))
      .map((f) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(join(ENTITIES_DIR, f)) as Record<string, unknown>;
        return Object.values(mod).find((v) => typeof v === 'function');
      });
    promise = builder.entityMetadataSnapshot(
      builder.metadataDataSource('postgres', entities),
    );
  });
  if (!promise) throw new Error('isolateModules did not run');
  return promise;
}

describe('core entity metadata on PostgreSQL', () => {
  it('no core column keeps a MySQL-only type', async () => {
    const snapshot = await postgresSnapshot();
    const offenders = snapshot.columns.filter(
      (c) => c.type !== null && MYSQL_ONLY_TYPES.includes(c.type),
    );
    expect(offenders).toEqual([]);
  });

  it('no column relies on onUpdate', async () => {
    const snapshot = await postgresSnapshot();
    const offenders = snapshot.columns.filter(
      (c) => c.onUpdate !== null && c.onUpdate !== 'now()',
    );
    expect(offenders).toEqual([]);
  });

  it('every uuid primary key is varchar(36) with a database default', async () => {
    const snapshot = await postgresSnapshot();
    const primaries = snapshot.columns.filter((c) => c.primary);
    expect(primaries.length).toBeGreaterThan(0);
    for (const column of primaries) {
      expect(column.type).toBe('varchar');
      expect(column.length).toBe('36');
      expect(column.generationStrategy).not.toBe('uuid');
      expect(column.default).toBe('gen_random_uuid()::text');
    }
  });

  it('the onUpdate columns go through the trigger (listed for the baseline)', async () => {
    const snapshot = await postgresSnapshot();
    expect(UPDATED_AT_COLUMNS.length).toBeGreaterThan(0);
    for (const [table, column] of UPDATED_AT_COLUMNS) {
      const found = snapshot.columns.find(
        (c) => c.table === table && c.column === column,
      );
      expect(found).toBeDefined();
      expect(found?.type).toBe('timestamp');
      expect(found?.onUpdate).toBeNull();
    }
  });

  it('jira-project-mapping tinyint is smallint', async () => {
    const snapshot = await postgresSnapshot();
    const column = snapshot.columns.find(
      (c) =>
        c.table === 'jira_project_mappings' && c.column === 'autoCreateEnabled',
    );
    expect(column).toBeDefined();
    expect(column?.type).toBe('smallint');
  });
});
