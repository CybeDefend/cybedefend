import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entityMetadataSnapshot, metadataDataSource } from './entity-metadata';

const SNAPSHOT = join(__dirname, '__snapshots__', 'entity-metadata.mysql.json');

describe('core entity metadata on MySQL', () => {
  it('is the committed snapshot', async () => {
    const snapshot = await entityMetadataSnapshot(metadataDataSource('mysql'));
    if (process.env.UPDATE_ENTITY_SNAPSHOT === '1') {
      mkdirSync(join(__dirname, '__snapshots__'), { recursive: true });
      writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
      return;
    }
    expect(snapshot).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  });
});
