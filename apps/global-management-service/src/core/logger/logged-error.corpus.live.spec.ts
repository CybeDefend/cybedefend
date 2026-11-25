import Pino from 'pino';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { serializeLoggedError } from './logged-error';

/**
 * LIVE corpus of the error messages the two engines really return when a
 * statement carries a user's value: duplicates, values the column type
 * refuses, values too long, syntax errors near the user's text. Each error
 * goes through the serializer, directly and in pino's serialized form, and
 * must come out with none of the bound value nor the statement's text, and
 * with the engine's code.
 *
 * Skipped unless GM_LIVE=1. The engine is LIVE_DB_TYPE (mysql by default).
 * It creates a throwaway database, its own tables in it, and drops it at the
 * end. With LOGGED_ERROR_CORPUS_PRINT=1 it prints each raw message, to keep
 * the unit table of the scrubber in line with what the engines say.
 *
 *   GM_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:3306 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=logged-error.corpus.live
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=logged-error.corpus.live
 */
const describeLive = liveEnabled('GM') ? describe : describe.skip;

/** A marker in every bound value and in the text of every statement. */
const P = 'MRKPARAM';
/** A marker that only the statement's own text carries. */
const SQL_MARK = 'mrksqltxt';

interface Case {
  name: string;
  sql: string;
  params?: unknown[];
}

const MYSQL_CASES: Case[] = [
  {
    name: 'duplicate entry',
    sql: `INSERT INTO q1_c (email) VALUES (?) /* ${SQL_MARK} */`,
    params: [`${P}@x.io`],
  },
  {
    name: 'duplicate entry holding a quote',
    sql: `INSERT INTO q1_c (email) VALUES (?)`,
    params: [`O'${P}`],
  },
  {
    name: 'duplicate entry imitating the key suffix',
    sql: `INSERT INTO q1_c (email) VALUES (?)`,
    params: [`a${P}' for key 'x`],
  },
  {
    name: 'duplicate entry over two lines',
    sql: `INSERT INTO q1_c (email) VALUES (?)`,
    params: [`${P}\nline2`],
  },
  {
    name: 'duplicate entry in double quotes',
    sql: `INSERT INTO q1_c (email) VALUES (?)`,
    params: [`"${P}"`],
  },
  {
    name: 'duplicate in one statement',
    sql: `INSERT INTO q1_c (email) VALUES (?), (?)`,
    params: [`z${P}`, `z${P}`],
  },
  {
    name: 'value too long',
    sql: `INSERT INTO q1_c (nm) VALUES (?)`,
    params: [`${P}-too-long`],
  },
  {
    name: 'incorrect string value',
    sql: `INSERT INTO q1_c (legacy) VALUES (?)`,
    params: [`${P}\u{1F600}`],
  },
  {
    name: 'incorrect integer value',
    sql: `INSERT INTO q1_c (n) VALUES (?)`,
    params: [P],
  },
  {
    name: 'incorrect integer value imitating the column suffix',
    sql: `INSERT INTO q1_c (n) VALUES (?)`,
    params: [`${P}' for column 'x`],
  },
  {
    name: 'incorrect datetime value',
    sql: `INSERT INTO q1_c (d) VALUES (?)`,
    params: [`2020-13-45 ${P}`],
  },
  {
    name: 'syntax error near the text',
    sql: `SELECT * FROM q1_c WHERE email = '${P}' x ORDER`,
  },
  {
    name: 'invalid JSON',
    sql: `SELECT CAST(? AS JSON)`,
    params: [`{"a": ${P}`],
  },
  {
    name: 'foreign key',
    sql: `INSERT INTO q1_c (email, pid) VALUES (?, 999)`,
    params: [`fk${P}`],
  },
  {
    name: 'check constraint',
    sql: `INSERT INTO q1_c (email, n) VALUES (?, -1)`,
    params: [`ck${P}`],
  },
];

const POSTGRES_CASES: Case[] = [
  {
    name: 'unique violation',
    sql: `INSERT INTO q1_c (email) VALUES ($1) /* ${SQL_MARK} */`,
    params: [`${P}@x.io`],
  },
  { name: 'invalid uuid', sql: `SELECT $1::uuid`, params: [P] },
  {
    name: 'invalid uuid holding quotes',
    sql: `SELECT $1::uuid`,
    params: [`${P}" tail "x`],
  },
  { name: 'invalid integer', sql: `SELECT $1::int`, params: [P] },
  {
    name: 'invalid integer over two lines',
    sql: `SELECT $1::int`,
    params: [`${P}\nsecond "q" line`],
  },
  {
    name: 'integer out of range',
    sql: `SELECT $1::int`,
    params: ['99999999999'],
  },
  {
    name: 'invalid timestamp',
    sql: `SELECT $1::timestamp`,
    params: [`2020-13-45 ${P}`],
  },
  { name: 'invalid boolean', sql: `SELECT $1::boolean`, params: [P] },
  { name: 'invalid json', sql: `SELECT $1::json`, params: [`{"a": ${P}`] },
  {
    name: 'invalid jsonb key',
    sql: `SELECT $1::jsonb`,
    params: [`{"${P}": }`],
  },
  { name: 'invalid enum value', sql: `SELECT $1::q1e`, params: [P] },
  {
    name: 'invalid regular expression',
    sql: `SELECT 'a' ~ $1`,
    params: [`(${P}`],
  },
  {
    name: 'syntax error near the text',
    sql: `SELECT * FROM q1_c WHERE email = '${P}' x ORDER`,
  },
  { name: 'unterminated string', sql: `SELECT '${P}` },
  {
    name: 'invalid to_date',
    sql: `SELECT to_date($1, 'YYYY-MM-DD')`,
    params: [P],
  },
  { name: 'invalid bytea', sql: `SELECT $1::bytea`, params: [`\\x${P}`] },
  { name: 'invalid interval', sql: `SELECT $1::interval`, params: [P] },
  { name: 'invalid numeric', sql: `SELECT $1::numeric`, params: [P] },
  { name: 'invalid inet', sql: `SELECT $1::inet`, params: [P] },
  {
    name: 'value too long',
    sql: `INSERT INTO q1_c (nm) VALUES ($1)`,
    params: [`${P}-too-long`],
  },
  {
    name: 'check constraint',
    sql: `INSERT INTO q1_c (email, n) VALUES ($1, -1)`,
    params: [`ck${P}`],
  },
  {
    name: 'NUL byte in text',
    sql: `INSERT INTO q1_c (email) VALUES ($1)`,
    params: [`nul${P}\u0000x`],
  },
];

describeLive('serializeLoggedError on the engines’ own messages', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let db: DataSource;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_logged_error_corpus',
      envPrefix: 'GM',
      migrations: 'none',
      entities: [],
    });
    db = live.dataSource;
    if (live.dialect === 'mysql') {
      await db.query(`CREATE TABLE q1_p (id INT PRIMARY KEY)`);
      await db.query(
        `CREATE TABLE q1_c (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(60),
          nm VARCHAR(8), n INT, d DATETIME,
          legacy VARCHAR(40) CHARACTER SET utf8mb3, pid INT,
          UNIQUE KEY uq_q1_email (email),
          CONSTRAINT fk_q1 FOREIGN KEY (pid) REFERENCES q1_p (id),
          CONSTRAINT ck_q1 CHECK (n IS NULL OR n >= 0))`,
      );
      for (const value of MYSQL_CASES.slice(0, 5).map((c) => c.params[0])) {
        await db.query(`INSERT INTO q1_c (email) VALUES (?)`, [value]);
      }
    } else {
      await db.query(
        `CREATE TABLE q1_c (id SERIAL PRIMARY KEY,
          email VARCHAR(60) CONSTRAINT uq_q1_email UNIQUE,
          nm VARCHAR(8), n INT CONSTRAINT ck_q1 CHECK (n >= 0))`,
      );
      await db.query(`CREATE TYPE q1e AS ENUM ('a')`);
      await db.query(`INSERT INTO q1_c (email) VALUES ($1)`, [`${P}@x.io`]);
    }
  });

  afterAll(async () => {
    await live?.drop();
  });

  function casesOfEngine(): Case[] {
    return liveEnabled('GM') && process.env.LIVE_DB_TYPE === 'postgres'
      ? POSTGRES_CASES
      : MYSQL_CASES;
  }

  it.each(casesOfEngine().map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      let err: unknown;
      try {
        await db.query(c.sql, c.params);
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      const raw = (err as Error).message;
      if (process.env.LOGGED_ERROR_CORPUS_PRINT === '1') {
        console.log(`${live.dialect} | ${c.name} | ${JSON.stringify(raw)}`);
      }

      for (const out of [
        serializeLoggedError(err),
        serializeLoggedError(Pino.stdSerializers.err(err as Error)),
      ]) {
        const text = JSON.stringify(out);
        expect(text).not.toContain(P);
        expect(text).not.toContain(SQL_MARK);
        expect((out as { code?: string }).code).toBeDefined();
      }
    },
  );
});
