import { DataSource, EntityManager } from 'typeorm';
import { currentDialect, dialectApi } from '@cybedefend/db-dialect';
import {
  RESET_LIMIT_PER_HOUR,
  RESET_TTL_MS,
  NO_REQUESTER_KEY,
  OneTimeTokenStore,
} from './one-time-token.store';
import { tokenHash } from './token-hash';

/**
 * Unit spec of the one-time token store. A scripted data source
 * answers the SELECTs and reports the `affected` rows of each UPDATE, so the
 * spec pins the statements themselves: the create runs in one transaction that
 * locks the user row (`pessimistic_write`, FOR UPDATE on both engines) before
 * counting the password_reset rows of the last hour, inserts only the SHA-256
 * of the token, and answers null at the limit; the consume is one conditional
 * UPDATE whose `affected` decides, followed by the SELECT of the user id. The
 * concurrency behaviour those statements produce is pinned against real
 * engines in one-time-token.store.live.spec.ts.
 */

const T = new Date('2026-11-03T10:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';

// The store renders through the current dialect (the live-dialect Jest setup
// mirrors LIVE_DB_TYPE into DB_TYPE), so the expectations follow it.
const { ident } = dialectApi(currentDialect());
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eqParam = (name: string) =>
  new RegExp(`${escapeRegExp(ident(name).text)} = (?:\\?|\\$\\d+)`);
const gtParam = (name: string) =>
  new RegExp(`${escapeRegExp(ident(name).text)} > (?:\\?|\\$\\d+)`);

interface Stmt {
  sql: string;
  params: unknown[];
}

type Answer = Record<string, unknown>[] | { affectedRows: number };

/**
 * A data source whose `query` plays `onQuery`, whose `transaction` runs the
 * callback on a manager bound to the same query (so `run(dataSource, …)` and
 * `run(manager, …)` both land in `statements`), and whose manager answers the
 * user-row lock through a recording query builder.
 */
function fakeDataSource(onQuery: (s: Stmt, call: number) => Answer) {
  const statements: Stmt[] = [];
  const events: string[] = [];
  const locks: string[] = [];
  let call = 0;
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    const stmt: Stmt = { sql: text, params };
    statements.push(stmt);
    return onQuery(stmt, call++);
  });
  const userQb = {
    setLock: jest.fn((mode: string) => {
      locks.push(mode);
      return userQb;
    }),
    where: jest.fn(() => userQb),
    getOne: jest.fn(async () => ({ id: USER })),
  };
  const manager = {
    queryRunner: { query },
    getRepository: jest.fn(() => ({ createQueryBuilder: () => userQb })),
  };
  const dataSource = {
    query,
    transaction: async (fn: (m: unknown) => Promise<unknown>) => {
      events.push('begin');
      try {
        const result = await fn(manager);
        events.push('commit');
        return result;
      } catch (e) {
        events.push('rollback');
        throw e;
      }
    },
  };
  return {
    dataSource: dataSource as unknown as DataSource,
    statements,
    events,
    locks,
    userQb,
    manager,
  };
}

const selects = (ss: Stmt[]) => ss.filter((s) => /^\s*SELECT/i.test(s.sql));
const updates = (ss: Stmt[]) => ss.filter((s) => /^\s*UPDATE/i.test(s.sql));
const inserts = (ss: Stmt[]) => ss.filter((s) => /^\s*INSERT/i.test(s.sql));

/** The default script: COUNT answers `count`, INSERT/UPDATE affect one row. */
const answering =
  (count = 0, affected = 1) =>
  (s: Stmt): Answer => {
    if (/^\s*SELECT/i.test(s.sql)) {
      if (/COUNT\(\*/i.test(s.sql)) return [{ n: count }];
      return [];
    }
    return { affectedRows: affected };
  };

describe('OneTimeTokenStore (SQL captured)', () => {
  it('pins the fixed values: 30 minutes, 3 per hour', () => {
    expect(RESET_TTL_MS).toBe(30 * 60 * 1000);
    expect(RESET_LIMIT_PER_HOUR).toBe(3);
  });

  it('locks the user row, counts the hour and inserts the token in one transaction', async () => {
    const { dataSource, statements, events, locks } = fakeDataSource(
      answering(0),
    );
    const store = new OneTimeTokenStore(dataSource);

    const token = await store.createPasswordReset(USER, T);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(events).toEqual(['begin', 'commit']);
    // The user row's lock comes first: FOR UPDATE on both engines, so the
    // count below sees the winners' committed rows under concurrency.
    expect(locks).toEqual(['pessimistic_write']);
    const count = selects(statements).find((s) => /COUNT\(\*\)/i.test(s.sql));
    expect(count).toBeDefined();
    expect(count!.sql).toMatch(eqParam('user_id'));
    expect(count!.sql).toMatch(eqParam('purpose'));
    expect(count!.sql).toMatch(gtParam('created_at'));
    expect(count!.params).toContain(USER);
    expect(count!.params).toContain('password_reset');
    // since = now − 1 h, computed in code
    expect(count!.params).toContainEqual(new Date(T.getTime() - 3_600_000));

    const insert = inserts(statements);
    expect(insert).toHaveLength(1);
    expect(insert[0].sql).toContain(ident('token_hash').text);
    // Only the SHA-256 of the token reaches the INSERT, never the token.
    expect(insert[0].params).toContain(tokenHash(token!));
    expect(insert[0].params).not.toContain(token);
    expect(insert[0].params).toContain(USER);
    expect(insert[0].params).toContain('password_reset');
    // expires_at = now + 30 min, created_at = now
    expect(insert[0].params).toContainEqual(
      new Date(T.getTime() + RESET_TTL_MS),
    );
    expect(insert[0].params).toContainEqual(T);
  });

  it('returns null at the hourly limit and inserts nothing', async () => {
    const { dataSource, statements, events } = fakeDataSource(answering(3));
    const store = new OneTimeTokenStore(dataSource);

    await expect(store.createPasswordReset(USER, T)).resolves.toBeNull();

    expect(events).toEqual(['begin', 'commit']);
    expect(inserts(statements)).toHaveLength(0);
  });

  it('bypasses the limit when asked (the admin CLI)', async () => {
    const { dataSource, statements } = fakeDataSource(answering(3));
    const store = new OneTimeTokenStore(dataSource);

    const token = await store.createPasswordReset(USER, T, {
      bypassLimit: true,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // No count ran, the token was inserted anyway.
    expect(
      selects(statements).filter((s) => /COUNT\(\*\)/i.test(s.sql)),
    ).toHaveLength(0);
    expect(inserts(statements)).toHaveLength(1);
  });

  it('consumePasswordReset marks the row used and returns the user id', async () => {
    const { dataSource, statements } = fakeDataSource((s) => {
      if (/^\s*UPDATE/i.test(s.sql)) return { affectedRows: 1 };
      if (/^\s*SELECT/i.test(s.sql)) return [{ userId: USER }];
      return { affectedRows: 1 };
    });
    const store = new OneTimeTokenStore(dataSource);

    await expect(store.consumePasswordReset('the-token', T)).resolves.toBe(
      USER,
    );

    const update = updates(statements);
    expect(update).toHaveLength(1);
    expect(update[0].sql).toMatch(eqParam('consumed_at'));
    expect(update[0].sql).toContain(`${ident('consumed_at').text} IS NULL`);
    expect(update[0].sql).toMatch(gtParam('expires_at'));
    expect(update[0].sql).toMatch(eqParam('token_hash'));
    expect(update[0].sql).toMatch(eqParam('purpose'));
    // the wrong-presentation counter is incremented in the same UPDATE
    expect(update[0].sql).toMatch(
      new RegExp(`${escapeRegExp(ident('attempts').text)}\\s*\\+\\s*1`),
    );
    expect(update[0].params).toContain(tokenHash('the-token'));
    expect(update[0].params).not.toContain('the-token');
    expect(update[0].params).toContain(T);
    // the user id is read after the claim, by hash
    const select = selects(statements);
    expect(select).toHaveLength(1);
    expect(select[0].sql).toMatch(eqParam('token_hash'));
  });

  it('consumePasswordReset answers null when the UPDATE matches no row and runs no SELECT', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0, 0));
    const store = new OneTimeTokenStore(dataSource);

    await expect(
      store.consumePasswordReset('a-used-or-expired-token', T),
    ).resolves.toBeNull();

    expect(updates(statements)).toHaveLength(1);
    expect(selects(statements)).toHaveLength(0);
  });

  it('consumePasswordReset runs on the given manager, so it commits with the new credential', async () => {
    const outside = fakeDataSource(answering(0, 0));
    const inside = fakeDataSource((s) => {
      if (/^\s*UPDATE/i.test(s.sql)) return { affectedRows: 1 };
      if (/^\s*SELECT/i.test(s.sql)) return [{ userId: USER }];
      return { affectedRows: 1 };
    });
    const store = new OneTimeTokenStore(outside.dataSource);

    await expect(
      store.consumePasswordReset(
        'the-token',
        T,
        inside.dataSource as unknown as EntityManager,
      ),
    ).resolves.toBe(USER);

    expect(outside.statements).toHaveLength(0);
    expect(updates(inside.statements)).toHaveLength(1);
    expect(selects(inside.statements)).toHaveLength(1);
  });

  // ─── The cap per (requester, user) and the expiry of the other links ───

  it('keys the hourly count on the requester key and the user, and stores that key as given', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0));
    const store = new OneTimeTokenStore(dataSource);
    const key = 'e'.repeat(64);

    await store.createPasswordReset(USER, T, { requesterKey: key });

    const count = selects(statements).find((s) => /COUNT\(\*\)/i.test(s.sql));
    expect(count!.sql).toMatch(eqParam('requester_key'));
    expect(count!.params).toContain(key);
    const insert = inserts(statements)[0];
    expect(insert.sql).toContain(ident('requester_key').text);
    expect(insert.params).toContain(key);
  });

  it('uses one fixed key for a caller that names no requester', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0));
    const store = new OneTimeTokenStore(dataSource);

    await store.createPasswordReset(USER, T);

    expect(NO_REQUESTER_KEY).toMatch(/^0{64}$/);
    const count = selects(statements).find((s) => /COUNT\(\*\)/i.test(s.sql));
    expect(count!.params).toContain(NO_REQUESTER_KEY);
    expect(inserts(statements)[0].params).toContain(NO_REQUESTER_KEY);
  });

  it('expireOpenPasswordResets closes every open reset token of the user in one UPDATE', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0, 2));
    const store = new OneTimeTokenStore(dataSource);

    await expect(store.expireOpenPasswordResets(USER, T)).resolves.toBe(2);

    const update = updates(statements);
    expect(update).toHaveLength(1);
    expect(update[0].sql).toMatch(eqParam('consumed_at'));
    expect(update[0].sql).toContain(`${ident('consumed_at').text} IS NULL`);
    expect(update[0].sql).toMatch(eqParam('user_id'));
    expect(update[0].sql).toMatch(eqParam('purpose'));
    expect(update[0].params).toContain(USER);
    expect(update[0].params).toContain('password_reset');
    expect(update[0].params).toContain(T);
  });
});
