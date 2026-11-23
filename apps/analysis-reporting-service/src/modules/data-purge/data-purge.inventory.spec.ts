import * as fs from 'fs';
import * as path from 'path';
import { DefaultNamingStrategy, getMetadataArgsStorage } from 'typeorm';
import {
  KEPT_TABLES,
  ORGANIZATION_PURGE_TABLES,
  PROJECT_PURGE_TABLES,
  TEAM_PURGE_TABLES,
} from './purge-tables';

const ENTITIES_DIR = path.join(__dirname, '..', '..', 'entities');
const KEY_COLUMN =
  /^(project_?id|internal_?id|team_?ids?|organization_?id|org_?id|scope_?id)$/i;

function entityFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    // cybedefend-ignore[CD-SAST-1455]: the test joins its own source directory with the file names readdir returns there; no input reaches it
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return entityFiles(full);
    return e.name.endsWith('.entity.ts') ? [full] : [];
  });
}

type EntityClass = abstract new (...args: never[]) => unknown;

/** Tables (database names) that carry a project, team or organization key. */
async function keyedTables(): Promise<string[]> {
  for (const file of entityFiles(ENTITIES_DIR)) await import(file);
  const storage = getMetadataArgsStorage();
  const naming = new DefaultNamingStrategy();
  const keyed = new Set<string>();
  for (const table of storage.tables) {
    const target = table.target as EntityClass;
    if (typeof target !== 'function') continue;
    const tableName = table.name ?? naming.tableName(target.name, undefined);
    const hasKey = storage.columns.some(
      (c) =>
        (c.target === target ||
          (typeof c.target === 'function' &&
            target.prototype instanceof (c.target as EntityClass))) &&
        (KEY_COLUMN.test(c.propertyName) ||
          KEY_COLUMN.test(String(c.options?.name ?? ''))),
    );
    if (hasKey) keyed.add(tableName);
  }
  return [...keyed].sort();
}

describe('analysis-reporting data purge inventory', () => {
  it('every table keyed by a project, team or organization is purged or kept with a reason', async () => {
    const covered = new Set<string>([
      ...PROJECT_PURGE_TABLES.map((t) => t.table),
      ...TEAM_PURGE_TABLES.map((t) => t.table),
      ...ORGANIZATION_PURGE_TABLES.map((t) => t.table),
      ...Object.keys(KEPT_TABLES),
    ]);
    const selected = await keyedTables();
    // The scan found the tables it should: guards against a broken import.
    expect(selected).toEqual(
      expect.arrayContaining([
        'vulnerability_detections_secret',
        'vulnerability_detections_cicd',
        'aggregated_reports',
      ]),
    );
    const missing = selected.filter((t) => !covered.has(t));
    expect(missing).toEqual([]);
    expect(Object.values(KEPT_TABLES).every((r) => r.length > 10)).toBe(true);
  });
});
