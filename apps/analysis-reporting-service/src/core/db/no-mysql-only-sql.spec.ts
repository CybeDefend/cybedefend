import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findMysqlOnlySql } from '@cybedefend/db-dialect';

/**
 * No MySQL-only SQL in analysis-reporting's core code: any
 * engine-specific line goes through `libs/db-dialect`, so the Community
 * Edition's PostgreSQL runs every statement the core sends.
 *
 * Walks `src/`, skipping `src/ee/` (closed code, cloud only), the migration
 * folders (the frozen MySQL track, the PostgreSQL baseline, the common
 * migrations written with TypeORM's schema API), the generated gRPC code and
 * the specs.
 */

/**
 * Files still to port, one per line with its reason. Empty:
 * a new MySQL-only construct is ported, never listed here.
 */
export const NO_MYSQL_ONLY_SQL_PENDING: Record<string, string> = {};

/**
 * Files whose matches are not SQL, each with the reason: a backtick escaped
 * inside a template literal that builds Markdown.
 */
const NOT_SQL: Record<string, string> = {
  'modules/vulnerability/issue-integration.service.ts':
    'Markdown inline code in issue comments, no SQL',
};

/**
 * Cloud operations tools still in the core, run against the cloud's MySQL
 * only, each with its reason.
 */
const MYSQL_ONLY_OPS: Record<string, string> = {
  'scripts/backfill-fingerprints.ts':
    "cloud ops tool, run against the cloud's MySQL only",
  'scripts/backfill-lifecycle.ts':
    "cloud ops tool, run against the cloud's MySQL only",
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

describe('no MySQL-only SQL in the core of analysis-reporting', () => {
  const files = sourceFiles(SRC);

  it('finds the core source files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('modules/sca/sca.service.ts');
    expect(files.some((f) => f.startsWith('ee/'))).toBe(false);
  });

  it('every MySQL-only construct goes through libs/db-dialect', () => {
    const hits: string[] = [];
    for (const file of files) {
      if (
        file in NO_MYSQL_ONLY_SQL_PENDING ||
        file in MYSQL_ONLY_OPS ||
        file in NOT_SQL
      )
        continue;
      for (const hit of findMysqlOnlySql(
        readFileSync(join(SRC, file), 'utf8'),
      )) {
        hits.push(`src/${file}:${hit.line} ${hit.pattern}: ${hit.text}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('every listed file exists and still needs its entry', () => {
    const stale: string[] = [];
    for (const file of [
      ...Object.keys(NO_MYSQL_ONLY_SQL_PENDING),
      ...Object.keys(MYSQL_ONLY_OPS),
      ...Object.keys(NOT_SQL),
    ]) {
      if (!files.includes(file)) {
        stale.push(`${file}: not a core source file`);
        continue;
      }
      if (
        findMysqlOnlySql(readFileSync(join(SRC, file), 'utf8')).length === 0
      ) {
        stale.push(`${file}: no MySQL-only construct left`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('every entry has a reason', () => {
    for (const reason of [
      ...Object.values(NO_MYSQL_ONLY_SQL_PENDING),
      ...Object.values(MYSQL_ONLY_OPS),
      ...Object.values(NOT_SQL),
    ]) {
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
