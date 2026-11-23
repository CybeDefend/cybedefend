import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { currentDialect, dialectApi } from '@cybedefend/db-dialect';
import {
  REFRESH_FAMILY_TTL_MS,
  REFRESH_RACE_WINDOW_MS,
  RefreshTokenStore,
} from './refresh-token.store';
import { newOpaqueToken, tokenHash } from './token-hash';

/**
 * Unit spec of the refresh token store. A scripted data source
 * answers the SELECTs and reports the `affected` rows of each UPDATE, so the
 * spec pins the statements themselves: the one conditional UPDATE that claims
 * the old token, the INSERT of the replacement inside the same transaction,
 * the family expiry kept on rotation, and the family revocation on a reuse.
 * The concurrency behaviour those statements produce is pinned against real
 * engines in refresh-token.store.live.spec.ts.
 */

const T = new Date('2026-11-03T10:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

// The store renders through the current dialect (the live-dialect Jest setup
// mirrors LIVE_DB_TYPE into DB_TYPE), so the expectations follow it: the
// identifier quoting comes from dialectApi and the placeholder is ? on MySQL,
// $n on PostgreSQL.
const { ident } = dialectApi(currentDialect());
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches `<quoted ident> = <placeholder>` on either engine. */
const eqParam = (name: string) =>
  new RegExp(`${escapeRegExp(ident(name).text)} = (?:\\?|\\$\\d+)`);

interface Row {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

const baseRow = (): Row => ({
  id: ID,
  userId: USER,
  familyId: FAMILY,
  tokenHash: tokenHash('tok'),
  expiresAt: new Date(T.getTime() + REFRESH_FAMILY_TTL_MS),
  rotatedAt: null,
  revokedAt: null,
});

interface Stmt {
  sql: string;
  params: unknown[];
}

type Answer = Record<string, unknown>[] | { affectedRows: number };

/**
 * A data source whose `query` plays `onQuery` and whose `transaction` runs the
 * callback on a manager bound to the same query, recording begin/commit, so
 * `run(dataSource, …)` and `run(manager, …)` both land in `statements`.
 */
function fakeDataSource(onQuery: (s: Stmt, call: number) => Answer) {
  const statements: Stmt[] = [];
  const events: string[] = [];
  let call = 0;
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    const stmt: Stmt = { sql: text, params };
    statements.push(stmt);
    return onQuery(stmt, call++);
  });
  const manager = { queryRunner: { query } };
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
  };
}

const selects = (ss: Stmt[]) => ss.filter((s) => /^\s*SELECT/i.test(s.sql));
const updates = (ss: Stmt[]) => ss.filter((s) => /^\s*UPDATE/i.test(s.sql));
const inserts = (ss: Stmt[]) => ss.filter((s) => /^\s*INSERT/i.test(s.sql));

/** Answers every SELECT with `row` and every UPDATE/INSERT with `affected`. */
const answering =
  (row: Row | undefined, affected = 1) =>
  (s: Stmt): Answer => {
    if (/^\s*SELECT/i.test(s.sql)) return row ? [{ ...row }] : [];
    return { affectedRows: affected };
  };

describe('token-hash', () => {
  it('mints 43-character base64url tokens and stores their sha256 hex', () => {
    const token = newOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(token)).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    );
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newOpaqueToken()).not.toBe(token);
  });
});

describe('RefreshTokenStore (SQL captured)', () => {
  it('claims the old token with one conditional UPDATE', async () => {
    const row = baseRow();
    const { dataSource, statements, events } = fakeDataSource(answering(row));
    const store = new RefreshTokenStore(dataSource);

    const outcome = await store.rotate('tok', T);

    expect(outcome.kind).toBe('rotated');
    const claim = updates(statements);
    expect(claim).toHaveLength(1);
    // Every claim condition lives in the WHERE of that one UPDATE.
    expect(claim[0].sql).toMatch(eqParam('rotated_at'));
    expect(claim[0].sql).toMatch(eqParam('replaced_by'));
    expect(claim[0].sql).toContain(`${ident('rotated_at').text} IS NULL`);
    expect(claim[0].sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(claim[0].sql).toMatch(
      new RegExp(`${escapeRegExp(ident('expires_at').text)} > (?:\\?|\\$\\d+)`),
    );
    expect(claim[0].sql).toMatch(eqParam('id'));
    expect(claim[0].params).toContain(ID);
    expect(claim[0].params).toContain(T);
    // The replacement row is inserted in the same transaction, after the claim.
    const replacement = inserts(statements);
    expect(replacement).toHaveLength(1);
    expect(events).toEqual(['begin', 'commit']);
    expect(statements.indexOf(claim[0])).toBeLessThan(
      statements.indexOf(replacement[0]),
    );
  });

  it('keeps the family expiry on rotation', async () => {
    const row = baseRow();
    const { dataSource, statements } = fakeDataSource(answering(row));
    const store = new RefreshTokenStore(dataSource);

    const issued = await store.issue(USER, T);
    expect(issued.expiresAt.getTime()).toBe(
      T.getTime() + REFRESH_FAMILY_TTL_MS,
    );

    const outcome = await store.rotate(
      'tok',
      new Date(T.getTime() + 3_600_000),
    );

    expect(outcome.kind).toBe('rotated');
    if (outcome.kind === 'rotated') {
      expect(outcome.userId).toBe(USER);
      expect(outcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(outcome.expiresAt.getTime()).toBe(issued.expiresAt.getTime());
    }
    const all = inserts(statements);
    expect(all).toHaveLength(2); // issue, then the rotation's replacement
    const rotationInsert = all[1];
    expect(rotationInsert.params).toContain(FAMILY);
    expect(
      rotationInsert.params.some(
        (p) => p instanceof Date && p.getTime() === issued.expiresAt.getTime(),
      ),
    ).toBe(true);
  });

  it('answers invalid for an unknown token without any UPDATE or INSERT', async () => {
    const { dataSource, statements } = fakeDataSource(answering(undefined));
    const store = new RefreshTokenStore(dataSource);

    await expect(store.rotate('nope', T)).resolves.toEqual({ kind: 'invalid' });

    expect(selects(statements)).toHaveLength(1);
    expect(updates(statements)).toHaveLength(0);
    expect(inserts(statements)).toHaveLength(0);
  });

  it('answers race inside the 20 s window and revokes nothing', async () => {
    const row = {
      ...baseRow(),
      rotatedAt: new Date(T.getTime() - (REFRESH_RACE_WINDOW_MS - 1)),
    };
    const { dataSource, statements } = fakeDataSource(
      answering(row, 0), // the claim UPDATE matches no row
    );
    const store = new RefreshTokenStore(dataSource);

    await expect(store.rotate('tok', T)).resolves.toEqual({ kind: 'race' });

    // Only the claim UPDATE ran; no family revocation followed.
    expect(updates(statements)).toHaveLength(1);
    expect(
      updates(statements).filter((u) => eqParam('revoked_at').test(u.sql)),
    ).toHaveLength(0);
  });

  it('revokes the whole family on a reuse 20 s after the rotation', async () => {
    const row = {
      ...baseRow(),
      rotatedAt: new Date(T.getTime() - REFRESH_RACE_WINDOW_MS),
    };
    const { dataSource, statements } = fakeDataSource(answering(row, 0));
    const store = new RefreshTokenStore(dataSource);

    await expect(store.rotate('tok', T)).resolves.toEqual({
      kind: 'reused',
      userId: USER,
      familyId: FAMILY,
    });

    const revoke = updates(statements).filter((u) =>
      eqParam('revoked_at').test(u.sql),
    );
    expect(revoke).toHaveLength(1);
    expect(revoke[0].sql).toMatch(eqParam('family_id'));
    expect(revoke[0].sql).toContain(`${ident('revoked_at').text} IS NULL`);
    expect(revoke[0].params).toContain(FAMILY);
  });

  it('answers invalid for a revoked token', async () => {
    const row = { ...baseRow(), revokedAt: new Date(T.getTime() - 1_000) };
    const { dataSource } = fakeDataSource(answering(row, 0));
    const store = new RefreshTokenStore(dataSource);

    await expect(store.rotate('tok', T)).resolves.toEqual({ kind: 'invalid' });
  });

  it('answers invalid for an expired family', async () => {
    const row = { ...baseRow(), expiresAt: new Date(T.getTime() - 1) };
    const { dataSource } = fakeDataSource(answering(row, 0));
    const store = new RefreshTokenStore(dataSource);

    await expect(store.rotate('tok', T)).resolves.toEqual({ kind: 'invalid' });
  });

  it('logout revokes the whole family of the token', async () => {
    const row = baseRow();
    const { dataSource, statements } = fakeDataSource(answering(row));
    const store = new RefreshTokenStore(dataSource);

    await store.revokeFamilyOf('tok', T);

    const revoke = updates(statements);
    expect(revoke).toHaveLength(1);
    expect(revoke[0].sql).toMatch(eqParam('revoked_at'));
    expect(revoke[0].sql).toMatch(eqParam('family_id'));
    expect(revoke[0].params).toContain(FAMILY);
  });

  it('logout of an unknown token is a no-op', async () => {
    const { dataSource, statements } = fakeDataSource(answering(undefined));
    const store = new RefreshTokenStore(dataSource);

    await expect(store.revokeFamilyOf('nope', T)).resolves.toBeUndefined();

    expect(updates(statements)).toHaveLength(0);
  });

  it('revokeAllOfUser revokes every family of the user in one UPDATE', async () => {
    const { dataSource, statements } = fakeDataSource(() => ({
      affectedRows: 3,
    }));
    const store = new RefreshTokenStore(dataSource);

    await store.revokeAllOfUser(USER, T);

    const revoke = updates(statements);
    expect(revoke).toHaveLength(1);
    expect(revoke[0].sql).toMatch(eqParam('revoked_at'));
    expect(revoke[0].sql).toMatch(eqParam('user_id'));
    expect(revoke[0].params).toContain(USER);
  });
});
