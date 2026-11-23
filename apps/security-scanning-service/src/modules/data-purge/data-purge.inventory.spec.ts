import { readdirSync } from 'fs';
import { join } from 'path';
import { DefaultNamingStrategy, getMetadataArgsStorage } from 'typeorm';
import { KEPT_TABLES, PROJECT_PURGE_TABLES } from './purge-tables';

const ENTITIES_DIR = join(__dirname, '..', '..', 'entities');
const KEY_COLUMN =
  /^(project_?id|internal_?id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

describe('data purge inventory', () => {
  beforeAll(async () => {
    for (const file of readdirSync(ENTITIES_DIR)) {
      if (file.endsWith('.entity.ts')) {
        // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
        await import(join(ENTITIES_DIR, file));
      }
    }
  });

  it('every table keyed by a project, team or organization is purged or kept with a reason', () => {
    const storage = getMetadataArgsStorage();
    const naming = new DefaultNamingStrategy();
    const keyed = new Set<string>();

    for (const table of storage.tables) {
      if (typeof table.target !== 'function') continue;
      const tableName = naming.tableName(table.target.name, table.name);
      const names = [
        ...storage.columns
          .filter((c) => c.target === table.target)
          .flatMap((c) => [c.propertyName, c.options.name]),
        ...storage.joinColumns
          .filter((c) => c.target === table.target)
          .flatMap((c) => [c.propertyName, c.name]),
      ].filter((n): n is string => typeof n === 'string');
      if (names.some((n) => KEY_COLUMN.test(n))) keyed.add(tableName);
    }

    // The inventory reads real entities: `scan` carries projectId.
    expect(keyed.has('scan')).toBe(true);

    const covered = new Set<string>([
      ...PROJECT_PURGE_TABLES.map((t) => t.table),
      ...Object.keys(KEPT_TABLES),
    ]);
    const missing = [...keyed].filter((t) => !covered.has(t)).sort();
    expect(missing).toEqual([]);
    expect(Object.values(KEPT_TABLES).every((r) => r.length > 10)).toBe(true);
  });
});
