import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findPostgresStrictSql } from '@cybedefend/db-dialect';

/**
 * No SQL that MySQL accepts and PostgreSQL refuses in external-integrations's
 * core code, beyond identifier case
 * (`no-unquoted-camelcase-sql.spec.ts`) and the MySQL-only constructs
 * (`no-mysql-only-sql.spec.ts`): a DISTINCT ordered by an expression outside
 * its select list (42P10: the branch picker answered 500), a boolean column
 * compared with 0 or 1, `IFNULL(`, `GROUP_CONCAT(`, `LIMIT offset, count`, and
 * `+` / `||` string concatenation. The boolean columns are read from the
 * entities. What the scanner cannot see (a GROUP BY missing a selected
 * column) is left to the live specs on both engines.
 */

/**
 * Files whose hits are no SQL a Community PostgreSQL runs, one per line with
 * the reason. Every entry must still exist and still hold a hit.
 */
export const POSTGRES_STRICT_ALLOWED: Record<string, string> = {};

const SRC = join(__dirname, '..', '..');

const SKIPPED_DIRS = [
  'ee',
  'core/grpc',
  'core/migrations',
  'core/migrations-postgres',
  'core/migrations-common',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(SRC, path).split(sep).join('/');
    if (statSync(path).isDirectory()) {
      if (SKIPPED_DIRS.includes(rel)) continue;
      out.push(...sourceFiles(path));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.d.ts')
    ) {
      out.push(rel);
    }
  }
  return out;
}

/** The property and column names of every boolean column of the entities. */
function booleanColumns(files: string[]): Set<string> {
  const names = new Set<string>();
  const column = /@Column\(([^)]*)\)\s*(\w+)\s*[!?]?:\s*boolean\b/g;
  for (const file of files.filter((f) => f.endsWith('.entity.ts'))) {
    const source = readFileSync(join(SRC, file), 'utf8');
    for (const m of source.matchAll(column)) {
      names.add(m[2]);
      const named = /name:\s*['"](\w+)['"]/.exec(m[1]);
      if (named) names.add(named[1]);
    }
  }
  return names;
}

describe('no PostgreSQL-refused SQL in the core of external-integrations', () => {
  const files = sourceFiles(SRC);
  const booleans = booleanColumns(files);

  it('finds the core source files and the boolean columns', () => {
    expect(files).toContain('modules/github/github.service.ts');
    expect(booleans.size).toBeGreaterThan(0);
  });

  it('no DISTINCT ordered by an expression, boolean = 0/1, MySQL-only function or + concatenation', () => {
    const hits: string[] = [];
    for (const file of files) {
      if (file in POSTGRES_STRICT_ALLOWED) continue;
      for (const hit of findPostgresStrictSql(
        readFileSync(join(SRC, file), 'utf8'),
        { booleanColumns: booleans },
      )) {
        hits.push(
          `src/${file}:${hit.line} ${hit.kind} ${hit.construct}: ${hit.text}`,
        );
      }
    }
    expect(hits).toEqual([]);
  });

  it('every allowed file exists, still needs its entry and has a reason', () => {
    const stale: string[] = [];
    for (const [file, reason] of Object.entries(POSTGRES_STRICT_ALLOWED)) {
      if (!files.includes(file) || reason.trim() === '') {
        stale.push(`${file}: not a core source file, or no reason`);
        continue;
      }
      if (
        findPostgresStrictSql(readFileSync(join(SRC, file), 'utf8'), {
          booleanColumns: booleans,
        }).length === 0
      ) {
        stale.push(`${file}: no hit left`);
      }
    }
    expect(stale).toEqual([]);
  });
});
