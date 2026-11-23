import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import {
  KEPT_TABLES,
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  TEAM_PURGE_TABLES,
} from './data-purge.service';

const KEY_COLUMN =
  /^(project_?id|internal_?id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

const ENTITIES_DIR = path.join(__dirname, '..', '..', 'entities');

async function loadEveryEntity(): Promise<void> {
  const files = fs
    .readdirSync(ENTITIES_DIR)
    .filter((file) => /\.entity\.ts$/.test(file));
  // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
  await Promise.all(files.map((file) => import(path.join(ENTITIES_DIR, file))));
}

function tableName(target: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  const name = (target as { name: string }).name;
  // TypeORM's default naming: snake_case of the class name.
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

describe('data purge inventory', () => {
  it('every table keyed by a project, team or organization is purged or kept with a reason', async () => {
    await loadEveryEntity();
    const storage = getMetadataArgsStorage();

    const keyed = new Set<string>();
    for (const table of storage.tables) {
      const columns = storage.columns.filter((c) => c.target === table.target);
      const hasKey = columns.some(
        (c) =>
          KEY_COLUMN.test(c.propertyName) ||
          (c.options?.name !== undefined && KEY_COLUMN.test(c.options.name)),
      );
      if (hasKey) keyed.add(tableName(table.target, table.name));
    }

    expect(keyed.size).toBeGreaterThan(0);

    const covered = new Set<string>([
      ...PROJECT_PURGE_TABLES.map((t) => t.table),
      ...TEAM_PURGE_TABLES.map((t) => t.table),
      ...ORGANIZATION_PURGE_TABLES.map((t) => t.table),
      ...Object.keys(KEPT_TABLES),
    ]);
    const missing = [...keyed].filter((t) => !covered.has(t)).sort();

    expect(missing).toEqual([]);
    expect(Object.values(KEPT_TABLES).every((r) => r.length > 10)).toBe(true);
  });

  it('purges file_scan by its projectId', () => {
    expect(PROJECT_PURGE_TABLES).toEqual([
      { table: 'file_scan', column: 'projectId' },
    ]);
  });
});
