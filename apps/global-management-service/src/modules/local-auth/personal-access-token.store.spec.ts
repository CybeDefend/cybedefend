import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { currentDialect, dialectApi } from '@cybedefend/db-dialect';
import { User } from 'src/entities/user.entity';
import {
  MAX_ACTIVE_PATS_PER_USER,
  PAT_NAME_MAX_LENGTH,
  PAT_PATTERN,
  PAT_PREFIX,
  PersonalAccessTokenStore,
} from './personal-access-token.store';
import { tokenHash } from './token-hash';

/**
 * Unit spec of the personal access token store. A scripted data
 * source answers the SELECTs and reports the `affected` rows of each UPDATE,
 * so the spec pins the statements themselves: the token is minted as
 * `cdp_` + 43 base64url characters and only its SHA-256 reaches the INSERT,
 * the name and the expiry are refused before any query, the create runs in
 * a transaction that locks the user row (pessimistic_write) before counting
 * the active tokens, and a unique violation on the INSERT (the transaction's
 * last statement) is mapped to PAT_NAME_TAKEN after the rollback. The
 * concurrency behaviour those statements produce is pinned against real
 * engines in personal-access-token.store.live.spec.ts.
 */

const T = new Date('2026-11-03T10:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '44444444-4444-4444-8444-444444444444';

// The store renders through the current dialect (the live-dialect Jest setup
// mirrors LIVE_DB_TYPE into DB_TYPE), so the expectations follow it.
const { ident } = dialectApi(currentDialect());
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eqParam = (name: string) =>
  new RegExp(`${escapeRegExp(ident(name).text)} = (?:\\?|\\$\\d+)`);
/** Matches `<quoted ident> > <placeholder>` on either engine. */
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

async function refusalOf(promise: Promise<unknown>): Promise<RpcException> {
  const thrown = await promise.catch((e: unknown) => e);
  expect(thrown).toBeInstanceOf(RpcException);
  return thrown as RpcException;
}

describe('PersonalAccessTokenStore (SQL captured)', () => {
  it('creates cdp_ + 43 base64url characters and stores only its SHA-256', async () => {
    const { dataSource, statements, locks, events, manager } = fakeDataSource(
      answering(0, 1),
    );
    const store = new PersonalAccessTokenStore(dataSource);

    const { pat, token } = await store.create(USER, 'ci', null, T);

    expect(token).toMatch(PAT_PATTERN);
    expect(token.startsWith(PAT_PREFIX)).toBe(true);
    expect(token).toHaveLength(47);
    const insert = inserts(statements);
    expect(insert).toHaveLength(1);
    // Only the SHA-256 hash and the last four characters are stored, never
    // the secret itself.
    expect(insert[0].params).toContain(tokenHash(token));
    expect(insert[0].params).not.toContain(token);
    expect(
      insert[0].params.some((p) => typeof p === 'string' && p.includes(token)),
    ).toBe(false);
    expect(pat.id).toEqual(expect.any(String));
    expect(pat.name).toBe('ci');
    expect(pat.createdAt).toEqual(T);
    expect(pat.lastUsedAt).toBeNull();
    expect(pat.expiresAt).toBeNull();
    // The create ran in a transaction that locked the user row first.
    expect(events).toEqual(['begin', 'commit']);
    expect(locks).toEqual(['pessimistic_write']);
    expect(manager.getRepository).toHaveBeenCalledWith(User);
    // the expired tokens retired, the COUNT, then the INSERT
    expect(statements).toHaveLength(3);
    expect(updates(statements)[0].sql).toMatch(/expires_at.? <= /);
    expect(updates(statements)[0].params).toEqual([T, USER, T]);
  });

  it('keeps the last four characters', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0, 1));
    const store = new PersonalAccessTokenStore(dataSource);

    const { pat, token } = await store.create(USER, 'deploy', null, T);

    expect(pat.lastFour).toBe(token.slice(-4));
    const insert = inserts(statements);
    expect(insert[0].params).toContain(token.slice(-4));
  });

  it('refuses 10 or more active tokens with PAT_LIMIT_REACHED and no INSERT', async () => {
    const { dataSource, statements, events } = fakeDataSource(
      answering(MAX_ACTIVE_PATS_PER_USER, 1),
    );
    const store = new PersonalAccessTokenStore(dataSource);

    const error = await refusalOf(store.create(USER, 'ci', null, T));

    expect(error.getError()).toEqual({
      code: status.RESOURCE_EXHAUSTED,
      message: 'PAT_LIMIT_REACHED',
    });
    expect(inserts(statements)).toHaveLength(0);
    expect(events).toEqual(['begin', 'rollback']);
    // The active count is revoked_at IS NULL AND (expires_at IS NULL OR > now).
    const count = selects(statements)[0];
    expect(count.sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(count.sql).toMatch(gtParam('expires_at'));
    expect(count.params).toContain(USER);
    expect(count.params).toContain(T);
  });

  it('maps a unique violation on the INSERT to PAT_NAME_TAKEN after the rollback', async () => {
    const { dataSource, events } = fakeDataSource((s) => {
      if (/^\s*SELECT/i.test(s.sql)) return [{ n: 0 }];
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    });
    const store = new PersonalAccessTokenStore(dataSource);

    const error = await refusalOf(store.create(USER, 'ci', null, T));

    expect(error.getError()).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'PAT_NAME_TAKEN',
    });
    // The INSERT is the transaction's last statement: the rollback happens
    // and the violation is mapped after it, no savepoint.
    expect(events).toEqual(['begin', 'rollback']);
  });

  it('refuses an empty or 101-character name with PAT_NAME_INVALID, without a query', async () => {
    const { dataSource, statements, locks } = fakeDataSource(answering());
    const store = new PersonalAccessTokenStore(dataSource);

    for (const name of ['', '   ', 'x'.repeat(PAT_NAME_MAX_LENGTH + 1)]) {
      const error = await refusalOf(store.create(USER, name, null, T));
      expect(error.getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'PAT_NAME_INVALID',
      });
    }
    expect(statements).toHaveLength(0);
    expect(locks).toHaveLength(0);
  });

  it('refuses an expiry that is not in the future with PAT_EXPIRY_INVALID, without a query', async () => {
    const { dataSource, statements } = fakeDataSource(answering());
    const store = new PersonalAccessTokenStore(dataSource);

    for (const expiresAt of [T, new Date(T.getTime() - 1)]) {
      const error = await refusalOf(store.create(USER, 'ci', expiresAt, T));
      expect(error.getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'PAT_EXPIRY_INVALID',
      });
    }
    expect(statements).toHaveLength(0);
  });

  it('refuses a malformed bearer without a query', async () => {
    const { dataSource, statements } = fakeDataSource(answering());
    const store = new PersonalAccessTokenStore(dataSource);

    await expect(store.verify('not-a-cdp-token', T)).resolves.toBeNull();
    await expect(store.verify(PAT_PREFIX + 'short', T)).resolves.toBeNull();
    await expect(store.verify('cdp_' + 'a'.repeat(44), T)).resolves.toBeNull();

    expect(statements).toHaveLength(0);
  });

  it('refuses a revoked or expired token: the SELECT filters them out', async () => {
    const { dataSource, statements } = fakeDataSource(answering());
    const store = new PersonalAccessTokenStore(dataSource);

    const token = PAT_PREFIX + 'a'.repeat(43);
    await expect(store.verify(token, T)).resolves.toBeNull();

    const select = selects(statements);
    expect(select).toHaveLength(1);
    expect(select[0].sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(select[0].sql).toMatch(gtParam('expires_at'));
    expect(select[0].sql).toMatch(eqParam('token_hash'));
    // Only the hash is queried, never the bearer itself.
    expect(select[0].params).toContain(tokenHash(token));
    expect(select[0].params).not.toContain(token);
    expect(updates(statements)).toHaveLength(0);
  });

  it('writes last_used_at at most once a minute', async () => {
    const row = { id: '55555555-5555-4555-8555-555555555555', userId: USER };
    const { dataSource, statements } = fakeDataSource((s) => {
      if (/^\s*SELECT/i.test(s.sql)) return [{ ...row }];
      return { affectedRows: 1 };
    });
    const store = new PersonalAccessTokenStore(dataSource);

    const found = await store.verify(PAT_PREFIX + 'a'.repeat(43), T);

    expect(found).toEqual({ userId: USER, tokenId: row.id });
    const update = updates(statements);
    expect(update).toHaveLength(1);
    expect(update[0].sql).toMatch(eqParam('last_used_at'));
    expect(update[0].sql).toContain(`${ident('last_used_at').text} IS NULL`);
    // staleBefore = now − 60 s, computed in code, is a parameter.
    expect(update[0].sql).toMatch(
      new RegExp(
        `${escapeRegExp(ident('last_used_at').text)} < (?:\\?|\\$\\d+)`,
      ),
    );
    expect(update[0].params).toContain(T);
    expect(update[0].params).toContainEqual(new Date(T.getTime() - 60_000));
  });

  it('lists the active tokens of the user, newest first, never a value', async () => {
    const rows = [
      {
        id: '1',
        name: 'ci',
        lastFour: 'wxyz',
        createdAt: T,
        lastUsedAt: null,
        expiresAt: null,
      },
    ];
    const { dataSource, statements } = fakeDataSource(() => rows);
    const store = new PersonalAccessTokenStore(dataSource);

    const list = await store.list(USER, T);

    expect(list).toEqual([
      {
        id: '1',
        name: 'ci',
        lastFour: 'wxyz',
        createdAt: T,
        lastUsedAt: null,
        expiresAt: null,
      },
    ]);
    const select = selects(statements)[0];
    expect(select.sql).toMatch(eqParam('user_id'));
    expect(select.sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(select.sql).toMatch(/ORDER BY/i);
    expect(select.sql).toMatch(gtParam('expires_at'));
    // No token_hash in the listing: the stored hash never leaves the store.
    expect(select.sql).not.toMatch(eqParam('token_hash'));
  });

  it('revoke answers PAT_NOT_FOUND when no active row matches', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0, 0));
    const store = new PersonalAccessTokenStore(dataSource);

    const error = await refusalOf(
      store.revoke(USER, '66666666-6666-4666-8666-666666666666', T),
    );
    expect(error.getError()).toEqual({
      code: status.NOT_FOUND,
      message: 'PAT_NOT_FOUND',
    });
    const update = updates(statements)[0];
    expect(update.sql).toMatch(eqParam('id'));
    expect(update.sql).toMatch(eqParam('user_id'));
    expect(update.sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(update.params).toContain(USER);
    expect(update.params).toContain(T);
  });

  it('revokeByName revokes the active token of that name', async () => {
    const { dataSource, statements } = fakeDataSource(answering(0, 1));
    const store = new PersonalAccessTokenStore(dataSource);

    await store.revokeByName(USER, 'ci', T);

    const update = updates(statements)[0];
    expect(update.sql).toMatch(eqParam('name'));
    expect(update.sql).toMatch(eqParam('user_id'));
    expect(update.params).toContain('ci');
  });

  it('rename maps a unique violation to PAT_NAME_TAKEN and a miss to PAT_NOT_FOUND', async () => {
    const duplicate = fakeDataSource(() => {
      throw Object.assign(new Error('duplicate'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      });
    });
    const store = new PersonalAccessTokenStore(duplicate.dataSource);
    const taken = await refusalOf(store.rename(USER, 'ci', 'cd'));
    expect(taken.getError()).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'PAT_NAME_TAKEN',
    });
    // One UPDATE outside any wider transaction.
    expect(duplicate.events).toEqual([]);
    expect(updates(duplicate.statements)).toHaveLength(1);

    const miss = fakeDataSource(answering(0, 0));
    const store2 = new PersonalAccessTokenStore(miss.dataSource);
    const notFound = await refusalOf(store2.rename(USER, 'ci', 'cd'));
    expect(notFound.getError()).toEqual({
      code: status.NOT_FOUND,
      message: 'PAT_NOT_FOUND',
    });
  });

  it('countActiveForOrganization counts the active tokens of the members only', async () => {
    const { dataSource, statements } = fakeDataSource((s) => {
      if (/COUNT\(\*/i.test(s.sql)) return [{ n: '3' }];
      return [];
    });
    const store = new PersonalAccessTokenStore(dataSource);

    await expect(store.countActiveForOrganization(ORG, T)).resolves.toBe(3);

    const select = selects(statements)[0];
    // user_id IN (the organisation's members), as a subquery over
    // users_organizations_members, never raw text with unquoted identifiers.
    expect(select.sql).toMatch(/IN \(\s*SELECT/i);
    expect(select.sql).toContain(ident('users_organizations_members').text);
    expect(select.sql).toMatch(eqParam('uom.organizationId'));
    expect(select.params).toContain(ORG);
    expect(select.sql).toContain(`${ident('revoked_at').text} IS NULL`);
  });

  it("revokeAllForOrganization revokes the members' active tokens and returns affected", async () => {
    const { dataSource, statements } = fakeDataSource(() => ({
      affectedRows: 3,
    }));
    const store = new PersonalAccessTokenStore(dataSource);

    await expect(store.revokeAllForOrganization(ORG, T)).resolves.toBe(3);

    const update = updates(statements)[0];
    expect(update.sql).toMatch(/^\s*UPDATE/i);
    expect(update.sql).not.toMatch(/\bJOIN\b/i);
    expect(update.sql).toMatch(/IN \(\s*SELECT/i);
    expect(update.sql).toContain(ident('users_organizations_members').text);
    expect(update.sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(update.params).toContain(ORG);
    expect(update.params).toContain(T);
  });
});
