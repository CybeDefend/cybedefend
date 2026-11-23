import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { Subject } from 'typeorm/persistence/Subject.js';
import { OneToManySubjectBuilder } from 'typeorm/persistence/subject-builder/OneToManySubjectBuilder.js';
import { Container } from './container.entity';
import { Scan } from './scan.entity';
import { Scanner } from './scanner.entity';
import { SupportedLanguage } from './supported-language.entity';

// Saving a scan whose `containers` were loaded before another container row
// was inserted must not detach that row: with the default orphan handling,
// TypeORM plans `UPDATE container SET scanId = NULL`, which the NOT NULL
// column rejects ("Column 'scanId' cannot be null"), and UpdateScan answers
// INTERNAL.
describe('Container.scan relation', () => {
  it('disables orphan handling (scanId is NOT NULL, a nullify can only fail)', () => {
    const relation = getMetadataArgsStorage().relations.find(
      (r) => r.target === Container && r.propertyName === 'scan',
    );

    expect(relation?.options.orphanedRowAction).toBe('disable');
  });

  it('plans no write on a container inserted after scan.containers was loaded', async () => {
    // Metadata only: buildMetadatas() never opens a connection.
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata-only',
      entities: [Scan, Container, Scanner, SupportedLanguage],
    });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const loadedBefore = Object.assign(new Container(), {
      id: 'c-agent',
      scanId: 's1',
    });
    const staleScan = Object.assign(new Scan(), {
      id: 's1',
      state: 'running',
      containers: [loadedBefore],
    });
    const scanSubject = new Subject({
      metadata: dataSource.getMetadata(Scan),
      entity: staleScan,
      canBeUpdated: true,
    });
    // What `save(scan)` reads back from the database: the container inserted
    // in the meantime is bound to the scan there, not in the stale entity.
    scanSubject.databaseEntity = Object.assign(new Scan(), {
      id: 's1',
      containers: [{ id: 'c-agent' }, { id: 'c-inserted-meanwhile' }],
    });
    const subjects = [scanSubject];

    new OneToManySubjectBuilder(subjects).build();

    const containerWrites = subjects
      .filter((s) => s.metadata.target === Container)
      .map((s) => ({
        identifier: s.identifier,
        changes: s.changeMaps.map((c) => c.value),
      }));
    expect(containerWrites).toEqual([]);
  });
});
