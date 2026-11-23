import * as fs from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { entityMetadataSnapshot } from './entity-metadata';
import { ROOT } from './typeorm-options';

const SNAPSHOT_PATH = join(
  __dirname,
  '__snapshots__',
  'entity-metadata.mysql.json',
);

describe('core entity metadata on MySQL', () => {
  it('is the committed snapshot (UPDATE_ENTITY_SNAPSHOT=1 rewrites it)', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata-only',
      entities: [join(ROOT, 'entities/*.entity.ts')],
    });
    const snapshot = await entityMetadataSnapshot(dataSource);
    if (process.env.UPDATE_ENTITY_SNAPSHOT === '1') {
      fs.mkdirSync(join(__dirname, '__snapshots__'), { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
    }
    expect(snapshot).toEqual(
      JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')),
    );
  });
});
