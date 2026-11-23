import * as fs from 'fs';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import {
  KEPT_COLUMNS,
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  PROJECT_TARGET_COLUMNS,
  TEAM_PURGE_TABLES,
  TEAM_TARGET_COLUMNS,
} from './purge-tables';

const KEYED =
  /^(project_?ids?|internal_?id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

const ENTITIES_DIR = path.join(__dirname, '../../entities');

describe('data purge inventory', () => {
  beforeAll(() => {
    fs.readdirSync(ENTITIES_DIR)
      .filter((f) => f.endsWith('.entity.ts'))
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      .forEach((f) => require(path.join(ENTITIES_DIR, f))); // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
  });

  it('every column keyed by a project, team or organization is purged or kept with a reason', () => {
    const storage = getMetadataArgsStorage();
    const handled = new Set<string>([
      ...[
        ...PROJECT_PURGE_TABLES,
        ...TEAM_PURGE_TABLES,
        ...ORGANIZATION_PURGE_TABLES,
        ...PROJECT_TARGET_COLUMNS,
        ...TEAM_TARGET_COLUMNS,
      ].map((t) => `${t.table}.${t.column}`),
      ...Object.keys(KEPT_COLUMNS),
    ]);

    const keyed: string[] = [];
    for (const table of storage.tables) {
      if (typeof table.target !== 'function' || !table.name) continue;
      for (const col of storage.columns.filter(
        (c) => c.target === table.target,
      )) {
        const dbName = col.options.name ?? col.propertyName;
        if (KEYED.test(col.propertyName) || KEYED.test(dbName)) {
          keyed.push(`${table.name}.${dbName}`);
        }
      }
    }

    expect(keyed.length).toBeGreaterThanOrEqual(7);
    expect(keyed.filter((k) => !handled.has(k))).toEqual([]);
    expect(Object.values(KEPT_COLUMNS).every((r) => r.length > 10)).toBe(true);
  });
});
