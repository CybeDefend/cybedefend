// DB_TYPE must be set before any module that decorates entities is loaded:
// the entity helpers of @cybedefend/db-dialect read it once, at import.
const savedDbType = process.env.DB_TYPE;
process.env.DB_TYPE = 'postgres';

/* eslint-disable @typescript-eslint/no-require-imports */
const { DataSource } = require('typeorm') as typeof import('typeorm');
const { join } = require('node:path') as typeof import('node:path');
const { entityMetadataSnapshot } =
  require('./entity-metadata') as typeof import('./entity-metadata');
const { ROOT } =
  require('./typeorm-options') as typeof import('./typeorm-options');
const { ScannerTypeValues } =
  require('../../entities/scanner.entity') as typeof import('../../entities/scanner.entity');
/* eslint-enable @typescript-eslint/no-require-imports */

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

afterAll(() => {
  if (savedDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = savedDbType;
});

describe('core entity metadata on postgres', () => {
  const openSnapshot = async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      database: 'metadata-only',
      entities: [join(ROOT, 'entities/*.entity.ts')],
    });
    return entityMetadataSnapshot(dataSource);
  };

  it('no core column keeps a MySQL-only type', async () => {
    const snapshot = await openSnapshot();
    const offenders = snapshot.columns.filter((c) =>
      MYSQL_ONLY_TYPES.includes(c.type),
    );
    expect(offenders).toEqual([]);
  });

  it('only the @UpdateDateColumn columns keep an onUpdate (TypeORM owns it on both engines)', async () => {
    const snapshot = await openSnapshot();
    const withOnUpdate = snapshot.columns.filter((c) => c.onUpdate !== null);
    // scan.updatedAt is an @UpdateDateColumn: the driver default owns its
    // onUpdate on both engines. No explicitly declared onUpdate survives.
    expect(withOnUpdate.map((c) => `${c.table}.${c.property}`)).toEqual([
      'git_history_cursor.updatedAt',
      'scan.updatedAt',
    ]);
  });

  it('every uuid primary key is varchar(36) with a database default', async () => {
    const snapshot = await openSnapshot();
    const primaries = snapshot.columns.filter((c) => c.primary);
    expect(primaries.length).toBeGreaterThan(0);
    for (const column of primaries) {
      expect(column.type).toBe('varchar');
      expect(column.length).toBe('36');
      expect(column.generationStrategy).toBeNull();
      expect(column.default).not.toBeNull();
    }
  });

  it('scan.metadata is jsonb so jsonRemoveKey works', async () => {
    const snapshot = await openSnapshot();
    const metadata = snapshot.columns.find(
      (c) => c.table === 'scan' && c.property === 'metadata',
    );
    expect(metadata).toBeDefined();
    expect(metadata?.type).toBe('jsonb');
  });

  it('the scannerType enum keeps every value, aibom included', async () => {
    const snapshot = await openSnapshot();
    const scannerType = snapshot.columns.find(
      (c) => c.table === 'scanner' && c.property === 'scannerType',
    );
    expect(scannerType).toBeDefined();
    expect(scannerType?.enum).toEqual([...ScannerTypeValues]);
    expect(scannerType?.enum).toContain('aibom');
  });
});
