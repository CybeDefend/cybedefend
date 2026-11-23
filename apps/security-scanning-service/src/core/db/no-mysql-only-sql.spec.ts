import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findMysqlOnlySql } from '@cybedefend/db-dialect';

/**
 * No MySQL-only SQL in the core. The spec walks src/, skipping the closed
 * code, the three migration folders (engine-specific
 * by design) and the specs (they never run in production), and fails on any
 * `findMysqlOnlySql` hit outside MYSQL_ONLY_OPS, naming file:line:pattern.
 *
 * The migration folder names are joined as segments so this spec itself never
 * carries a quoted literal pointing into the frozen MySQL track (the export
 * checks that no exported file names a path it leaves out).
 */

/** src/ of this service. */
const SRC_ROOT = join(__dirname, '..', '..');

/** Directory names skipped wherever they appear under src/. */
const SKIPPED_DIRS = new Set(['ee']);

/** src/core migration folders, engine-specific by design. */
const SKIPPED_CORE_DIRS = new Set([
  'migrations',
  'migrations-postgres',
  'migrations-common',
]);

/**
 * Files allowed to keep MySQL-only SQL, with the reason. Every entry must
 * still exist and still hold at least one hit, so a fixed file drops out.
 */
const MYSQL_ONLY_OPS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'src/modules/scan/registry-auth-cleanup.ts',
    reason: 'one-off cloud tool on a direct mysql2 connection',
  },
  {
    file: 'src/core/db/live-database.ts',
    reason:
      'the two-engine live helper: its CREATE/DROP DATABASE statements are per-dialect',
  },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (
        relative(SRC_ROOT, dir) === 'core' &&
        SKIPPED_CORE_DIRS.has(entry.name)
      )
        continue;
      yield* walk(path);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

function hitsOf(file: string) {
  return findMysqlOnlySql(readFileSync(file, 'utf8')).map((hit) => ({
    ...hit,
    file: relative(process.cwd(), file).split('\\').join('/'),
  }));
}

describe('no MySQL-only SQL in the core', () => {
  it('fails on any MySQL-only construct outside MYSQL_ONLY_OPS', () => {
    const allowed = new Set(MYSQL_ONLY_OPS.map((op) => op.file));
    const offenders = [...walk(SRC_ROOT)]
      .flatMap(hitsOf)
      .filter((hit) => !allowed.has(hit.file));
    expect(
      offenders.map(
        (hit) => `${hit.file}:${hit.line} ${hit.pattern} — ${hit.text}`,
      ),
    ).toEqual([]);
  });

  it('keeps MYSQL_ONLY_OPS honest: every entry exists and still hits', () => {
    for (const op of MYSQL_ONLY_OPS) {
      const path = join(process.cwd(), op.file);
      const hits = hitsOf(path);
      expect(
        hits.length > 0
          ? 'ok'
          : `${op.file} no longer holds MySQL-only SQL: drop its MYSQL_ONLY_OPS entry (${op.reason})`,
      ).toBe('ok');
    }
  });
});
