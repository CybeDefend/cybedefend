import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findUnquotedCamelCaseSql } from '@cybedefend/db-dialect';

/**
 * No camelCase identifier that PostgreSQL would fold to lower case in
 * external-integrations's core SQL. MySQL resolves a column name
 * whatever its case; PostgreSQL folds an unquoted name to lower case, while
 * the columns are created quoted (`"organizationId"`). TypeORM quotes
 * `alias.property` only for an alias it registered from an entity, so an
 * alias declared inside a raw string (`EXISTS (SELECT 1 FROM t uom WHERE
 * uom.userId = …)`), any `.query()` text and an output alias `x AS fooBar`
 * reach the engine as written: build them with `ident()` (libs/db-dialect).
 * The Community stack's project lists answered 500 that way
 * (`column uom.organizationid does not exist`, 42703).
 *
 * Walks `src/` like `no-mysql-only-sql.spec.ts`: skips `src/ee/` (closed code,
 * cloud only), the migration folders, the generated gRPC code and the specs.
 * What the scanner cannot see (see `findUnquotedCamelCaseSql`) is left to the
 * live specs on both engines.
 */

/**
 * Files whose hits are no SQL a Community PostgreSQL runs, one per line with
 * the reason. Every entry must still exist and still hold a hit.
 */
export const UNQUOTED_IDENTIFIERS_ALLOWED: Record<string, string> = {
  'modules/pending-rescan/pending-rescan.store.ts':
    'a Redis Lua script (entry.commitSha is a Lua table field), no SQL',
  'core/utils/git-history/fetch-branch-history.ts':
    'git configuration keys passed with -c (fetch.unpackLimit), no SQL',
};

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

describe('no unquoted camelCase identifier in the core SQL of external-integrations', () => {
  const files = sourceFiles(SRC);

  it('finds the core source files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('modules/github/github.service.ts');
    expect(files.some((f) => f.startsWith('ee/'))).toBe(false);
  });

  it('every camelCase identifier of a raw SQL fragment is quoted', () => {
    const hits: string[] = [];
    for (const file of files) {
      if (file in UNQUOTED_IDENTIFIERS_ALLOWED) continue;
      for (const hit of findUnquotedCamelCaseSql(
        readFileSync(join(SRC, file), 'utf8'),
      )) {
        hits.push(
          `src/${file}:${hit.line} ${hit.kind} ${hit.identifier}: ${hit.text}`,
        );
      }
    }
    expect(hits).toEqual([]);
  });

  it('every allowed file exists and still needs its entry', () => {
    const stale: string[] = [];
    for (const file of Object.keys(UNQUOTED_IDENTIFIERS_ALLOWED)) {
      if (!files.includes(file)) {
        stale.push(`${file}: not a core source file`);
        continue;
      }
      if (
        findUnquotedCamelCaseSql(readFileSync(join(SRC, file), 'utf8'))
          .length === 0
      ) {
        stale.push(`${file}: no unquoted identifier left`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('every entry has a reason', () => {
    for (const reason of Object.values(UNQUOTED_IDENTIFIERS_ALLOWED)) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
