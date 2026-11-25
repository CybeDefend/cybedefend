import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findMysqlOnlySql } from '@cybedefend/db-dialect';

/**
 * No core file outside `libs/db-dialect` writes MySQL-only SQL: `ON DUPLICATE KEY`, `INSERT IGNORE`, `GET_LOCK`,
 * `DATE_FORMAT`, `DATE_SUB`, `TIMESTAMPDIFF`, `FIND_IN_SET`, `JSON_REMOVE`,
 * `JSON_LENGTH`, `ANY_VALUE`, `CAST(… AS BINARY)`, `IF(`, an escaped backtick
 * in a SQL template, `ER_DUP_ENTRY` / `1062`.
 *
 * The walk covers every `.ts` file under `src`, skipping `src/ee`, the three migration
 * folders (frozen MySQL history, the PostgreSQL baseline, the common track),
 * specs, `src/test-utils/**` and `src/core/db/**` (the engine-dispatching
 * helper quotes the throwaway database name per engine there).
 */

/** Files still to port, each with the task that ports it. `[]` once the last port merges. */
const NO_MYSQL_ONLY_SQL_PENDING: ReadonlyArray<{ file: string; task: string }> =
  [];

/** Files whose hits are intentional, each with its reason. */
const MYSQL_ONLY_OPS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'src/modules/issue/markdown-text.ts',
    reason:
      'markdown escapes and code spans in GitHub and GitLab ticket text, not SQL',
  },
  {
    file: 'src/modules/slack/slack-text.ts',
    reason: 'code spans in Slack message text, not SQL',
  },
  {
    file: 'src/modules/linear/linear-description.service.ts',
    reason: 'markdown escapes and code spans in Linear ticket text, not SQL',
  },
  {
    file: 'src/modules/linear/linear-finding-states.service.ts',
    reason: 'markdown escapes in a Linear comment, not SQL',
  },
];

const SRC = join(__dirname, '..', '..');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

function skipped(rel: string): boolean {
  if (rel.endsWith('.spec.ts')) return true;
  const segs = rel.split(sep);
  if (segs.includes('ee')) return true;
  if (segs.includes('test-utils')) return true;
  if (segs.length >= 3 && segs[0] === 'core' && segs[1] === 'db') return true;
  if (
    segs.length >= 3 &&
    segs[0] === 'core' &&
    (segs[1] === 'migrations' ||
      segs[1] === 'migrations-postgres' ||
      segs[1] === 'migrations-common')
  ) {
    return true;
  }
  return false;
}

function hits(): Array<{ file: string; line: number; pattern: string }> {
  const out: Array<{ file: string; line: number; pattern: string }> = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (skipped(rel)) continue;
    for (const hit of findMysqlOnlySql(readFileSync(file, 'utf8'))) {
      out.push({
        file: join('src', rel),
        line: hit.line,
        pattern: hit.pattern,
      });
    }
  }
  return out;
}

describe('no-mysql-only-sql', () => {
  it('no core file outside libs/db-dialect writes MySQL-only SQL', () => {
    const pending = new Set(NO_MYSQL_ONLY_SQL_PENDING.map((e) => e.file));
    const ops = new Set(MYSQL_ONLY_OPS.map((e) => e.file));
    const offenders = hits().filter(
      (h) => !pending.has(h.file) && !ops.has(h.file),
    );
    expect(offenders.map((h) => `${h.file}:${h.line} ${h.pattern}`)).toEqual(
      [],
    );
  });

  it('the pending and ops lists hold no file without a hit', () => {
    const all = new Set(hits().map((h) => h.file));
    const stale = [...NO_MYSQL_ONLY_SQL_PENDING, ...MYSQL_ONLY_OPS].filter(
      (e) => !all.has(e.file),
    );
    expect(stale.map((e) => e.file)).toEqual([]);
  });
});
