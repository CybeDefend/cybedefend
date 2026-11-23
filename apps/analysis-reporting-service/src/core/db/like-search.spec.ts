import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * No core search uses a bare `LIKE`. MySQL's collation
 * makes `LIKE` case-insensitive; PostgreSQL's `LIKE` is case-sensitive. Every
 * search therefore goes through `ilike()` of `libs/db-dialect`, which writes
 * `LIKE` on MySQL (the cloud's statement stays today's) and `ILIKE` on
 * PostgreSQL. TypeORM's `Like()` find operator is refused for the same reason
 * (and `ILike()` writes `UPPER(col) LIKE UPPER(?)` on MySQL, which bypasses
 * the column's index).
 *
 * Walks the same files as `no-mysql-only-sql.spec.ts`: `src/` without `ee/`,
 * the migration folders, the generated gRPC code and the specs. Comments are
 * skipped; string and template contents are scanned, which is where SQL lives.
 */

/**
 * A `LIKE` kept on purpose, each with its reason. Never a search box.
 */
export const BARE_LIKE_ALLOWED: Record<string, string> = {
  'modules/results-import/catalogue-fallback.service.ts':
    'prefix match on upper-case catalogue codes, case-sensitive on purpose on PostgreSQL',
  'scripts/e2e-drift-merge.ts':
    "local e2e script run against the cloud's MySQL only, cleans its fixtures by id prefix",
};

const SRC = join(__dirname, '..', '..');

const SKIPPED_DIRS = [
  'ee',
  'core/grpc',
  'core/migrations',
  'core/migrations-postgres',
  'core/migrations-common',
];

const BARE_LIKE = [
  { name: 'LIKE', re: /\bLIKE\b/ },
  { name: 'Like()', re: /\bLike\s*\(/ },
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

/** The source with its `//` and block comments blanked, line by line. */
export function codeLines(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let inTemplate = false;
  for (const line of source.split('\n')) {
    let code = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (inTemplate) {
        code += c;
        if (c === '\\') {
          code += next ?? '';
          i += 2;
          continue;
        }
        if (c === '`') inTemplate = false;
        i += 1;
        continue;
      }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (c === '`') {
        inTemplate = true;
        code += c;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"') {
        code += c;
        i += 1;
        while (i < line.length) {
          const ch = line[i];
          code += ch;
          if (ch === '\\') {
            code += line[i + 1] ?? '';
            i += 2;
            continue;
          }
          i += 1;
          if (ch === c) break;
        }
        continue;
      }
      code += c;
      i += 1;
    }
    out.push(code);
  }
  return out;
}

function bareLikes(source: string): string[] {
  const hits: string[] = [];
  codeLines(source).forEach((code, i) => {
    for (const { name, re } of BARE_LIKE) {
      if (re.test(code)) hits.push(`${i + 1} ${name}: ${code.trim()}`);
    }
  });
  return hits;
}

describe('case-insensitive searches in the core of analysis-reporting', () => {
  const files = sourceFiles(SRC);

  it('skips comments and finds a LIKE in a string', () => {
    expect(bareLikes('// a LIKE in a comment\n/* LIKE */')).toEqual([]);
    expect(bareLikes('/**\n * prose about LIKE\n */')).toEqual([]);
    expect(bareLikes("qb.where('a.name LIKE :q')")).toHaveLength(1);
    expect(bareLikes('qb.where(`a.name LIKE :q`)')).toHaveLength(1);
    expect(bareLikes("find({ name: Like('%x%') })")).toHaveLength(1);
    expect(bareLikes("find({ name: ILike('%x%') })")).toEqual([]);
  });

  it('no core search uses a bare LIKE', () => {
    const hits: string[] = [];
    for (const file of files) {
      if (file in BARE_LIKE_ALLOWED) continue;
      for (const hit of bareLikes(readFileSync(join(SRC, file), 'utf8'))) {
        hits.push(`src/${file}:${hit}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('every allowed file exists, still has its LIKE and a reason', () => {
    const stale: string[] = [];
    for (const [file, reason] of Object.entries(BARE_LIKE_ALLOWED)) {
      if (!files.includes(file)) stale.push(`${file}: not a core source file`);
      else if (bareLikes(readFileSync(join(SRC, file), 'utf8')).length === 0)
        stale.push(`${file}: no bare LIKE left`);
      if (reason.trim().length === 0) stale.push(`${file}: no reason`);
    }
    expect(stale).toEqual([]);
  });
});
