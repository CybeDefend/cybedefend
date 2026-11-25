// DB_TYPE must be set before any module that decorates entities is loaded:
// the entity helpers of @cybedefend/db-dialect read it once, at import.
const savedDbType = process.env.DB_TYPE;
process.env.DB_TYPE = 'postgres';

/* eslint-disable @typescript-eslint/no-require-imports */
const { DataSource } = require('typeorm') as typeof import('typeorm');
const { join } = require('node:path') as typeof import('node:path');
const { entityMetadataSnapshot } =
  require('./entity-metadata') as typeof import('./entity-metadata');
/* eslint-enable @typescript-eslint/no-require-imports */

/** The service root (`src/`), where the entity glob points. */
const ROOT = join(__dirname, '..', '..');

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
  const open = async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      database: 'metadata-only',
      entities: [join(ROOT, 'entities/**/*.entity.ts')],
    });
    const snapshot = await entityMetadataSnapshot(dataSource);
    return { dataSource, snapshot };
  };
  const columnOf = (
    snapshot: Awaited<ReturnType<typeof open>>['snapshot'],
    table: string,
    property: string,
  ) => {
    const column = snapshot.columns.find(
      (c) => c.table === table && c.property === property,
    );
    expect(column).toBeDefined();
    return column;
  };

  it('no core column keeps a MySQL-only type', async () => {
    const { snapshot } = await open();
    expect(new Set(snapshot.columns.map((c) => c.table)).size).toBe(33);
    const offenders = snapshot.columns
      .filter((c) => MYSQL_ONLY_TYPES.includes(c.type))
      .map((c) => `${c.table}.${c.property}: ${c.type}`);
    expect(offenders).toEqual([]);
  });

  it('no column relies on onUpdate (only TypeORM’s own @UpdateDateColumn keeps one)', async () => {
    const { dataSource } = await open();
    const declared = dataSource.entityMetadatas
      .flatMap((m) => m.columns.map((c) => ({ m, c })))
      .filter(({ c }) => c.onUpdate !== undefined && !c.isUpdateDate)
      .map(({ m, c }) => `${m.tableName}.${c.propertyName}`);
    expect(declared).toEqual([]);
    // The four detection tables' updateAt columns had an explicit onUpdate.
    for (const table of [
      'vulnerability_detections_sast',
      'vulnerability_detections_iac',
      'vulnerability_detections_cicd',
      'vulnerability_detections_secret',
    ]) {
      const meta = dataSource.entityMetadatas.find(
        (m) => m.tableName === table,
      );
      expect(meta).toBeDefined();
      const updateAt = meta?.columns.find((c) => c.propertyName === 'updateAt');
      expect(updateAt).toBeDefined();
      expect(updateAt?.onUpdate).toBeUndefined();
    }
  });

  it('every uuid primary key is varchar(36) with a database default', async () => {
    const { snapshot } = await open();
    const uuidPrimaries = snapshot.columns.filter(
      (c) => c.primary && c.generationStrategy === 'uuid',
    );
    expect(uuidPrimaries).toEqual([]);
    const ported = snapshot.columns.filter(
      (c) => c.primary && c.default === 'gen_random_uuid()::text',
    );
    expect(ported.length).toBeGreaterThan(0);
    for (const column of ported) {
      expect(column.type).toBe('varchar');
      expect(column.length).toBe('36');
    }
  });

  it('package names and versions and image artifact names compare case-insensitively', async () => {
    const { snapshot } = await open();
    expect(
      columnOf(snapshot, 'sca_detected_packages', 'packageName')?.type,
    ).toBe('citext');
    expect(
      columnOf(snapshot, 'sca_detected_packages', 'packageVersion')?.type,
    ).toBe('citext');
    expect(
      columnOf(snapshot, 'container_detected_images', 'artifactName')?.type,
    ).toBe('citext');
  });

  it('the secret blob is bytea and the float is double precision', async () => {
    const { snapshot } = await open();
    expect(
      columnOf(snapshot, 'vulnerability_detections_secret', 'encryptedSecret')
        ?.type,
    ).toBe('bytea');
    expect(
      columnOf(snapshot, 'vulnerability_detections_container', 'cvssScore')
        ?.type,
    ).toBe('double precision');
  });
});
