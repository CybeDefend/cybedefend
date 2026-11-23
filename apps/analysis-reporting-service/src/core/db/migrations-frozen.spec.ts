import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MYSQL_TRACK_FROZEN_AT,
  POSTGRES_BASELINE_AT,
} from './migration-tracks';

/**
 * The three migration tracks: the MySQL history is frozen, the
 * PostgreSQL track is one baseline, and every new migration is a common one
 * above the baseline. Only the migration files at the top of each folder
 * count: src/core/migrations/data/ (the catalogue code registry and the
 * Checkov pairs the MySQL migrations read) and the __tests__/ folders are
 * skipped, as are README.md and .gitkeep. The MySQL track is not exported,
 * so its cases are not here.
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

  it('the PostgreSQL baseline seeds no row', () => {
    const source = readFileSync(
      join(
        CORE,
        'migrations-postgres',
        `${POSTGRES_BASELINE_AT}-PostgresBaseline.ts`,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it('the common track exists, and every common migration is above the baseline', () => {
    // Its README.md is not exported (**/*.md), so no case here reads it.
    expect(existsSync(join(CORE, 'migrations-common'))).toBe(true);
    const files = migrationFiles('migrations-common');
    for (const f of files) {
      const m = STAMPED.exec(f);
      expect([f, m !== null]).toEqual([f, true]);
      expect([f, Number(m[1]) > POSTGRES_BASELINE_AT]).toEqual([f, true]);
    }
  });

  it('the baseline is above the freeze', () => {
    expect(MYSQL_TRACK_FROZEN_AT).toBe(1845000000000);
    expect(POSTGRES_BASELINE_AT).toBe(1845500000000);
    expect(POSTGRES_BASELINE_AT).toBeGreaterThan(MYSQL_TRACK_FROZEN_AT);
  });
});
