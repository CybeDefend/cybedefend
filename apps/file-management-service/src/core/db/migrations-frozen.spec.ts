import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MYSQL_TRACK_FROZEN_AT,
  POSTGRES_BASELINE_AT,
} from './migration-tracks';

/**
 * The three migration tracks: the MySQL history is frozen, the
 * PostgreSQL track is one baseline, and every new migration is a common one
 * above the baseline. The MySQL track is not exported: its case is tested
 * with the closed edition.
 */
const CORE = join(__dirname, '..');
const STAMPED = /^(\d{13})-.+\.ts$/;

function migrationFiles(folder: string): string[] {
  const dir = join(CORE, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name);
}

describe('migration tracks', () => {
  it('the PostgreSQL track is one baseline', () => {
    const name = `${POSTGRES_BASELINE_AT}-PostgresBaseline.ts`;
    expect(migrationFiles('migrations-postgres')).toEqual([name]);
    const source = readFileSync(
      join(CORE, 'migrations-postgres', name),
      'utf8',
    );
    const className = `PostgresBaseline${POSTGRES_BASELINE_AT}`;
    expect(source).toContain(`export class ${className} `);
    expect(source).toContain(`name = '${className}'`);
  });

  it('every common migration is above the baseline', () => {
    const files = migrationFiles('migrations-common');
    for (const f of files) {
      const m = STAMPED.exec(f);
      expect([f, m !== null]).toEqual([f, true]);
      expect([f, Number(m[1]) > POSTGRES_BASELINE_AT]).toEqual([f, true]);
    }
  });

  it('the baseline is above the freeze', () => {
    expect(POSTGRES_BASELINE_AT).toBeGreaterThan(MYSQL_TRACK_FROZEN_AT);
  });
});
