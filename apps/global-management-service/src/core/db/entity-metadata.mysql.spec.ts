import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { entityMetadataSnapshot } from './entity-metadata';

/** The service root (`src/`), where the entity glob points. */
const ROOT = join(__dirname, '..', '..');

const SNAPSHOT_PATH = join(
  __dirname,
  '__snapshots__',
  'entity-metadata.mysql.json',
);

/**
 * The metadata of the core entities on MySQL, built without connecting
 * (`buildMetadatas()`), is the committed snapshot. `UPDATE_ENTITY_SNAPSHOT=1`
 * rewrites the snapshot instead of comparing — run it once on the untouched
 * entities, never after an entity edit that means to keep MySQL
 * unchanged.
 */
async function mysqlSnapshot() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: '127.0.0.1',
    port: 1,
    username: 'unused',
    password: 'unused',
    database: 'unused',
    entities: [join(ROOT, 'entities/*.entity.ts')],
  });
  return entityMetadataSnapshot(dataSource);
}

describe('core entity metadata on MySQL', () => {
  it('is the committed snapshot', async () => {
    const snapshot = await mysqlSnapshot();
    if (process.env.UPDATE_ENTITY_SNAPSHOT === '1') {
      mkdirSync(join(__dirname, '__snapshots__'), { recursive: true });
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
    }
    expect(snapshot).toEqual(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')));
  });
});
