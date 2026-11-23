import 'reflect-metadata';
import * as crypto from 'crypto';
import { Column, DataSource, Entity } from 'typeorm';
import {
  AdvisoryLockTimeoutError,
  Dialect,
  Sql,
  addEnumValue,
  createUpdatedAtTrigger,
  dialectApi,
  ensureExtension,
  isUniqueViolation,
  registerPostgresTypeParsers,
  run,
  withAdvisoryLock,
  withSavepoint,
} from '../index';

const describeLive = process.env.DB_DIALECT_LIVE === '1' ? describe : describe.skip;

const MYSQL_URL = process.env.DB_DIALECT_MYSQL_URL ?? 'mysql://root:password@127.0.0.1:3308';
const PG_URL = process.env.DB_DIALECT_PG_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432';

jest.setTimeout(60000);

describeLive.each(['mysql', 'postgres'] as const)('db-dialect live (%s)', (engine: Dialect) => {
  const api = dialectApi(engine);
  const dbName = 'dbdialect_' + crypto.randomBytes(6).toString('hex');

  // splice raw SQL text written in this spec into a statement
  const raw = (s: string): Sql => api.sql([s] as unknown as TemplateStringsArray);

  @Entity()
  class Thing {
    @(api.UuidPrimaryColumn())
    id!: string;

    @Column()
    name!: string;
  }

  let ds: DataSource;
  let admin: { query: (text: string) => Promise<unknown>; end: () => Promise<void> };

  const insertT = (id: string, createdAt: Date, n: number, label: string, meta: string, csv: string) =>
    run(
      ds,
      api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('createdAt')}, ${api.ident('n')}, ${api.ident('label')}, ${api.ident('meta')}, ${api.ident('csv')}) VALUES (${id}, ${createdAt}, ${n}, ${label}, ${meta}, ${csv})`,
    );

  beforeAll(async () => {
    process.env.TZ = 'Europe/Paris';
    const base = engine === 'mysql' ? MYSQL_URL : PG_URL;
    const u = new URL(base);
    const host = u.hostname;
    const port = Number(u.port || (engine === 'mysql' ? 3306 : 5432));
    const user = decodeURIComponent(u.username);
    const password = decodeURIComponent(u.password);
    if (engine === 'mysql') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mysql2 = require('mysql2/promise');
      admin = await mysql2.createConnection({ host, port, user, password });
      await admin.query(`CREATE DATABASE \`${dbName}\``);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pg = require('pg');
      pg.defaults.parseInputDatesAsUTC = true;
      registerPostgresTypeParsers(pg.types);
      const client = new pg.Client({ host, port, user, password, database: 'postgres' });
      await client.connect();
      admin = client;
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
    const appUrl = `${u.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(password)}@${u.host}/${dbName}`;
    ds = new DataSource(
      engine === 'mysql'
        ? { type: 'mysql', url: appUrl, timezone: 'Z', entities: [Thing], synchronize: false, logging: false }
        : {
            type: 'postgres',
            url: appUrl,
            extra: { options: '-c TimeZone=UTC' },
            entities: [Thing],
            synchronize: false,
            logging: false,
          },
    );
    await ds.initialize();

    if (engine === 'postgres') {
      const runner = ds.createQueryRunner();
      await runner.connect();
      await ensureExtension(runner, 'citext');
      await runner.release();
    }

    await run(
      ds,
      api.sql`CREATE TABLE ${api.ident('t')} (${api.ident('id')} ${raw('varchar(36) primary key')}, ${api.ident('createdAt')} ${raw(`${api.columnType('datetime')}(3)`)}, ${api.ident('n')} ${raw('int')}, ${api.ident('label')} ${raw(`${api.ciText()}${engine === 'mysql' ? '(64)' : ''} unique`)}, ${api.ident('meta')} ${raw(String(api.columnType('json')))}, ${api.ident('csv')} ${raw('varchar(64)')})`,
    );
    await run(ds, api.sql`CREATE TABLE ${api.ident('jb')} (${api.ident('id')} ${raw('varchar(36) primary key')})`);
    await run(
      ds,
      api.sql`CREATE TABLE ${api.ident('pj')} (${api.ident('id')} ${raw('varchar(36) primary key')}, ${api.ident('jobId')} ${raw('varchar(36)')}, ${api.ident('status')} ${raw('varchar(16)')})`,
    );
    await run(
      ds,
      api.sql`CREATE TABLE ${api.ident('thing')} (${api.ident('id')} ${raw(
        engine === 'mysql'
          ? 'varchar(36) primary key'
          : `varchar(36) primary key default ${api.uuidExpr().text}`,
      )}, ${api.ident('name')} ${raw('varchar(255)')})`,
    );
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
    if (admin) {
      if (engine === 'mysql') await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      else await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await run(ds, api.sql`DELETE FROM ${api.ident('t')}`);
    await run(ds, api.sql`DELETE FROM ${api.ident('pj')}`);
    await run(ds, api.sql`DELETE FROM ${api.ident('jb')}`);
  });

  it('a camelCase alias comes back as written', async () => {
    await insertT('id1', new Date('2026-11-02T23:30:00.000Z'), 1, 'Acme', '{}', 'a,b');
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.ident('createdAt')} AS ${api.ident('createdAt')} FROM ${api.ident('t')}`,
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(['createdAt']);
  });

  it('timestamps round-trip in UTC whatever TZ is', async () => {
    const d = new Date('2026-11-02T23:30:00.000Z');
    await insertT('id1', d, 1, 'Acme', '{}', 'a,b');
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.ident('createdAt')} AS ${api.ident('createdAt')} FROM ${api.ident('t')}`,
    );
    expect((rows[0].createdAt as Date).getTime()).toBe(d.getTime());
    const bucket = await run(
      ds,
      api.sql`SELECT ${api.dateBucket(api.ident('createdAt'), 'day')} AS ${api.ident('b')} FROM ${api.ident('t')}`,
    );
    expect(bucket.rows[0].b).toBe('2026-11-02');
  });

  it('COUNT(*) is a string on both engines', async () => {
    await insertT('id1', new Date(), 1, 'A', '{}', 'a,b');
    await insertT('id2', new Date(), 2, 'B', '{}', 'a,b');
    const { rows } = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')}`,
    );
    expect(typeof rows[0].c).toBe('string');
    expect(Number(rows[0].c)).toBe(2);
  });

  it('upsert twice on the same key leaves one row with the second value', async () => {
    const up = (n: number, label: string) =>
      api.upsert(
        't',
        { id: 'k', n, label },
        { conflict: ['id'], update: { n: api.sql`${api.ident('t')}.${api.ident('n')} + ${10}`, label: 'excluded' } },
      );
    await run(ds, up(1, 'L1'));
    await run(ds, up(5, 'L2'));
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.ident('n')} AS ${api.ident('n')}, ${api.ident('label')} AS ${api.ident('label')} FROM ${api.ident('t')} WHERE ${api.ident('id')} = ${'k'}`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].n)).toBe(11);
    expect(rows[0].label).toBe('L2');
  });

  it('insertIgnore twice leaves one row', async () => {
    await run(ds, api.insertIgnore('t', { id: 'k', n: 1, label: 'A' }));
    await run(ds, api.insertIgnore('t', { id: 'k', n: 2, label: 'B' }));
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.ident('n')} AS ${api.ident('n')} FROM ${api.ident('t')} WHERE ${api.ident('id')} = ${'k'}`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].n)).toBe(1);
  });

  it('deleteBatch deletes at most limit rows and reports affected', async () => {
    for (let i = 1; i <= 5; i++) await insertT(`id${i}`, new Date(), i, `b${i}`, '{}', 'a,b');
    const res = await run(ds, api.deleteBatch('t', api.sql`${api.ident('n')} <= ${5}`, 2));
    expect(res.affected).toBe(2);
    const { rows } = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')} WHERE ${api.ident('n')} <= ${5}`,
    );
    expect(Number(rows[0].c)).toBe(3);
  });

  it('updateBatch updates at most limit rows and reports affected', async () => {
    for (let i = 1; i <= 5; i++) await insertT(`id${i}`, new Date(), i, `b${i}`, '{}', 'a,b');
    const res = await run(
      ds,
      api.updateBatch('t', { csv: 'done' }, api.sql`${api.ident('n')} <= ${5}`, 2),
    );
    expect(res.affected).toBe(2);
    const { rows } = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')} WHERE ${api.ident('csv')} = ${'done'}`,
    );
    expect(Number(rows[0].c)).toBe(2);
  });

  it('updateJoin updates only the joined rows', async () => {
    await run(ds, api.sql`INSERT INTO ${api.ident('jb')} (${api.ident('id')}) VALUES (${'j1'})`);
    await run(ds, api.sql`INSERT INTO ${api.ident('pj')} (${api.ident('id')}, ${api.ident('jobId')}, ${api.ident('status')}) VALUES (${'p1'}, ${'j1'}, ${'todo'})`);
    await run(ds, api.sql`INSERT INTO ${api.ident('pj')} (${api.ident('id')}, ${api.ident('jobId')}, ${api.ident('status')}) VALUES (${'p2'}, ${'j2'}, ${'todo'})`);
    const res = await run(
      ds,
      api.updateJoin({
        table: 'pj',
        alias: 's',
        join: { table: 'jb', alias: 'j', on: api.sql`${api.ident('j.id')} = ${api.ident('s.jobId')}` },
        set: { status: 'done' },
        where: api.sql`${api.ident('s.status')} = ${'todo'}`,
      }),
    );
    expect(res.affected).toBe(1);
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.ident('id')} AS ${api.ident('id')}, ${api.ident('status')} AS ${api.ident('status')} FROM ${api.ident('pj')} ORDER BY ${api.ident('id')}`,
    );
    expect(rows).toEqual([
      { id: 'p1', status: 'done' },
      { id: 'p2', status: 'todo' },
    ]);
  });

  it('diffDays and diffSeconds agree on both engines', async () => {
    await insertT('a', new Date('2026-11-01T10:00:00.000Z'), 1, 'A', '{}', 'a,b');
    await insertT('b', new Date('2026-11-03T09:00:00.000Z'), 2, 'B', '{}', 'a,b');
    const sel = (x: number, y: number) =>
      api.sql`SELECT ${api.diffDays(api.ident('a.createdAt'), api.ident('b.createdAt'))} AS ${api.ident('d')}, ${api.diffSeconds(api.ident('a.createdAt'), api.ident('b.createdAt'))} AS ${api.ident('s')} FROM ${api.ident('t')} ${api.ident('a')}, ${api.ident('t')} ${api.ident('b')} WHERE ${api.ident('a.n')} = ${x} AND ${api.ident('b.n')} = ${y}`;
    const fwd = await run(ds, sel(1, 2));
    expect(Number(fwd.rows[0].d)).toBe(1);
    expect(Number(fwd.rows[0].s)).toBe(169200);
    const rev = await run(ds, sel(2, 1));
    expect(Number(rev.rows[0].d)).toBe(-1);
    expect(Number(rev.rows[0].s)).toBe(-169200);
  });

  it('jsonArrayLength and jsonRemoveKey run', async () => {
    await insertT('id1', new Date(), 1, 'A', '{"registryAuth":"x","other":1}', 'a,b');
    const len = await run(
      ds,
      api.sql`SELECT ${api.jsonArrayLength(api.param('["a","b"]'))} AS ${api.ident('l')}`,
    );
    expect(Number(len.rows[0].l)).toBe(2);
    const rem = await run(
      ds,
      api.sql`SELECT ${api.jsonRemoveKey(api.ident('meta'), 'registryAuth')} AS ${api.ident('m')} FROM ${api.ident('t')}`,
    );
    const v = typeof rem.rows[0].m === 'string' ? JSON.parse(rem.rows[0].m as string) : rem.rows[0].m;
    expect(v.registryAuth).toBeUndefined();
    expect(v.other).toBe(1);
  });

  it('inCsv, ilike and caseSensitiveEquals run', async () => {
    await insertT('id1', new Date(), 1, 'ABC', '{}', 'System');
    const csv = await run(ds, api.sql`SELECT ${api.inCsv(api.param('b'), api.param('a,b'))} AS ${api.ident('m')}`);
    expect(Boolean(csv.rows[0].m)).toBe(true);
    const like = await run(
      ds,
      api.sql`SELECT ${api.ilike(api.ident('label'), api.param('%bc%'))} AS ${api.ident('m')} FROM ${api.ident('t')}`,
    );
    expect(Boolean(like.rows[0].m)).toBe(true);
    const cs = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')} WHERE ${api.caseSensitiveEquals(api.ident('csv'), api.param('system'))}`,
    );
    expect(Number(cs.rows[0].c)).toBe(0);
  });

  it('anyValue, uuidExpr, castInt and nowPrecise run', async () => {
    await insertT('id1', new Date(), 1, 'ABC', '{}', 'a,b');
    const { rows } = await run(
      ds,
      api.sql`SELECT ${api.anyValue(api.ident('label'))} AS ${api.ident('a')}, ${api.uuidExpr()} AS ${api.ident('u')}, ${api.castInt(api.param('42'))} AS ${api.ident('i')}, ${api.nowPrecise(3)} AS ${api.ident('now')} FROM ${api.ident('t')} LIMIT 1`,
    );
    expect(String(rows[0].a)).toBe('ABC');
    expect(String(rows[0].u)).toHaveLength(36);
    expect(Number(rows[0].i)).toBe(42);
    expect(rows[0].now).toBeTruthy();
  });

  it('intervalAgo and ifThen run', async () => {
    await insertT('id1', new Date(), 1, 'A', '{}', 'a,b');
    const { rows } = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')} WHERE ${api.ident('createdAt')} > ${api.intervalAgo(1, 'day')}`,
    );
    expect(Number(rows[0].c)).toBe(1);
    const cond = await run(
      ds,
      api.sql`SELECT ${api.ifThen(api.sql`${1} = ${1}`, api.param('yes'), api.param('no'))} AS ${api.ident('v')}`,
    );
    expect(cond.rows[0].v).toBe('yes');
  });

  it('ciText makes the unique case-insensitive', async () => {
    await run(ds, api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('label')}) VALUES (${'u1'}, ${'Acme'})`);
    let err: unknown;
    try {
      await run(ds, api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('label')}) VALUES (${'u2'}, ${'ACME'})`);
    } catch (e) {
      err = e;
    }
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('withSavepoint keeps the transaction usable after a duplicate', async () => {
    await run(ds, api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('label')}) VALUES (${'s1'}, ${'S'})`);
    await ds.transaction(async (em) => {
      const runner = em.queryRunner!;
      let caught: unknown;
      try {
        await withSavepoint(runner, () =>
          run(
            runner,
            api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('label')}) VALUES (${'s1'}, ${'dup'})`,
          ),
        );
      } catch (e) {
        caught = e;
      }
      expect(isUniqueViolation(caught)).toBe(true);
      await run(
        runner,
        api.sql`INSERT INTO ${api.ident('t')} (${api.ident('id')}, ${api.ident('label')}) VALUES (${'s2'}, ${'ok'})`,
      );
    });
    const { rows } = await run(
      ds,
      api.sql`SELECT COUNT(*) AS ${api.ident('c')} FROM ${api.ident('t')} WHERE ${api.ident('id')} IN ${api.inList(['s1', 's2'])}`,
    );
    expect(Number(rows[0].c)).toBe(2);
  });

  it('withAdvisoryLock excludes a second holder until release', async () => {
    const r1 = ds.createQueryRunner();
    const r2 = ds.createQueryRunner();
    await r1.connect();
    await r2.connect();
    try {
      await withAdvisoryLock(r1, 'dbdialect_lock', 10, async () => {
        await expect(
          withAdvisoryLock(r2, 'dbdialect_lock', 1, async () => 'second'),
        ).rejects.toThrow(AdvisoryLockTimeoutError);
      });
      await expect(withAdvisoryLock(r2, 'dbdialect_lock', 5, async () => 'after')).resolves.toBe('after');
    } finally {
      await r1.release();
      await r2.release();
    }
  });

  it('UuidPrimaryColumn gets its id back from the database on save', async () => {
    const repo = ds.getRepository(Thing);
    const saved = await repo.save(repo.create({ name: 'x' }));
    expect(saved.id).toHaveLength(36);
    const found = await repo.findOneByOrFail({ id: saved.id });
    expect(found.name).toBe('x');
  });

  const itPostgres = engine === 'postgres' ? it : it.skip;
  itPostgres(
    'createUpdatedAtTrigger touches the column only when the row changes',
    async () => {
      await run(
        ds,
        api.sql`CREATE TABLE ${api.ident('u')} (${api.ident('id')} ${raw('varchar(36) primary key')}, ${api.ident('n')} ${raw('int')}, ${api.ident('updatedAt')} ${raw('timestamp(3) DEFAULT CURRENT_TIMESTAMP(3)')})`,
      );
      const runner = ds.createQueryRunner();
      await runner.connect();
      await createUpdatedAtTrigger(runner, 'u', 'updatedAt');
      await runner.release();
      await run(ds, api.sql`INSERT INTO ${api.ident('u')} (${api.ident('id')}, ${api.ident('n')}) VALUES (${'u1'}, ${1})`);
      const read = async () =>
        (
          await run(
            ds,
            api.sql`SELECT ${api.ident('updatedAt')} AS ${api.ident('updatedAt')} FROM ${api.ident('u')} WHERE ${api.ident('id')} = ${'u1'}`,
          )
        ).rows[0].updatedAt as Date;
      const t0 = await read();
      await new Promise((r) => setTimeout(r, 30));
      await run(ds, api.sql`UPDATE ${api.ident('u')} SET ${api.ident('n')} = ${2} WHERE ${api.ident('id')} = ${'u1'}`);
      const t1 = await read();
      expect(t1.getTime()).toBeGreaterThan(t0.getTime());
      const fixed = new Date('2020-01-01T00:00:00.000Z');
      await run(
        ds,
        api.sql`UPDATE ${api.ident('u')} SET ${api.ident('updatedAt')} = ${fixed} WHERE ${api.ident('id')} = ${'u1'}`,
      );
      const t2 = await read();
      expect(t2.getTime()).toBe(fixed.getTime());
      await new Promise((r) => setTimeout(r, 30));
      await run(ds, api.sql`UPDATE ${api.ident('u')} SET ${api.ident('n')} = ${2} WHERE ${api.ident('id')} = ${'u1'}`);
      const t3 = await read();
      expect(t3.getTime()).toBe(t2.getTime());
      await run(ds, api.sql`DROP TABLE ${api.ident('u')}`);
    },
  );

  const itMysql = engine === 'mysql' ? it : it.skip;
  itMysql('addEnumValue extends an enum with an explicit collation and keeps the rest of the column', async () => {
    // TypeORM writes a column's COLLATE only when it differs from the database
    // default: give the database another default so the column's own collation
    // is the explicit one a changeColumn would have spliced into the enum type
    await ds.query(`ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await ds.query(
      "CREATE TABLE `em` (`id` varchar(36) PRIMARY KEY, `platform` ENUM('github','gitlab','it''s') " +
        "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'gitlab' COMMENT 'where it''s tracked') " +
        'DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
    await ds.query("INSERT INTO `em` (`id`, `platform`) VALUES ('r1', 'gitlab'), ('r2', 'it''s')");
    const describeColumn = async () =>
      (
        (await ds.query(
          'SELECT COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault, ' +
            'CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment ' +
            'FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
          ['em', 'platform'],
        )) as Record<string, string>[]
      )[0];
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await addEnumValue(runner, 'em', 'platform', ['linear', "o'k"]);
      const after = await describeColumn();
      expect(after).toEqual({
        columnType: "enum('github','gitlab','it''s','linear','o''k')",
        isNullable: 'NO',
        columnDefault: 'gitlab',
        charset: 'utf8mb4',
        collation: 'utf8mb4_0900_ai_ci',
        comment: "where it's tracked",
      });
      const stored = (await ds.query('SELECT `id`, `platform` FROM `em` ORDER BY `id`')) as Record<string, string>[];
      expect(stored).toEqual([
        { id: 'r1', platform: 'gitlab' },
        { id: 'r2', platform: "it's" },
      ]);
      await ds.query("INSERT INTO `em` (`id`, `platform`) VALUES ('r3', 'linear')");

      // a second call finds every value and issues nothing
      const spy = jest.spyOn(runner, 'query');
      await addEnumValue(runner, 'em', 'platform', ['linear']);
      expect(spy.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('ALTER'))).toEqual([]);
      spy.mockRestore();
      expect(await describeColumn()).toEqual(after);

      await expect(addEnumValue(runner, 'em', 'nope', ['x'])).rejects.toThrow('DB_DIALECT_UNKNOWN_COLUMN: em.nope');
    } finally {
      await runner.release();
      // later cases in this file create tables with the server's default again
      await ds.query(`ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    }
  });

  itPostgres('addEnumValue adds a value to the enum type once', async () => {
    await ds.query(`CREATE TYPE "ep_platform_enum" AS ENUM ('github', 'gitlab')`);
    await ds.query(`CREATE TABLE "ep" ("id" varchar(36) PRIMARY KEY, "platform" "ep_platform_enum" NOT NULL)`);
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await addEnumValue(runner, 'ep', 'platform', ['linear']);
      await addEnumValue(runner, 'ep', 'platform', ['linear']);
    } finally {
      await runner.release();
    }
    const rows = (await ds.query(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ep_platform_enum' ORDER BY e.enumsortorder`,
    )) as { label: string }[];
    expect(rows.map((r) => r.label)).toEqual(['github', 'gitlab', 'linear']);
  });

  itMysql('addEnumValue refuses a column whose INVISIBLE or generation expression a MODIFY would drop', async () => {
    await ds.query(
      "CREATE TABLE `ex` (`id` varchar(36) PRIMARY KEY, `hidden` ENUM('a','b') NULL INVISIBLE, " +
        "`derived` ENUM('a','b') GENERATED ALWAYS AS (IF(`id` = 'x', 'a', 'b')) VIRTUAL)",
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await expect(addEnumValue(runner, 'ex', 'hidden', ['c'])).rejects.toThrow(
        'DB_DIALECT_UNSUPPORTED_COLUMN: ex.hidden has INVISIBLE',
      );
      await expect(addEnumValue(runner, 'ex', 'derived', ['c'])).rejects.toThrow(
        'DB_DIALECT_UNSUPPORTED_COLUMN: ex.derived has VIRTUAL GENERATED',
      );
      // a value already there is still a no-op
      await addEnumValue(runner, 'ex', 'hidden', ['a']);
    } finally {
      await runner.release();
    }
    const types = (await ds.query(
      'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS ' +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ex' AND COLUMN_NAME <> 'id' ORDER BY COLUMN_NAME",
    )) as Record<string, string>[];
    expect(types).toEqual([
      { name: 'derived', columnType: "enum('a','b')", extra: 'VIRTUAL GENERATED' },
      { name: 'hidden', columnType: "enum('a','b')", extra: 'INVISIBLE' },
    ]);
  });
});
