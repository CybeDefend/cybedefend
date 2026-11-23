import { DataSource } from 'typeorm';
import { dialectApi } from '@cybedefend/db-dialect';
import { MysqlOrganizationDeletionCodeStore } from './organization-deletion-code.store';

/**
 * The attempt and the code it is compared with must be the same code:
 * counting the attempt and then reading the hash would let a
 * `saveCode` in between count the attempt on code A (and reset the count) and
 * hand back code B. The hash is read first and the counting UPDATE matches
 * it, so the attempt is counted on exactly the code returned.
 *
 * A scripted data source plays a new code saved between any two statements.
 */
describe('MysqlOrganizationDeletionCodeStore.countAttempt: one code per attempt', () => {
  const NOW = new Date('2026-10-27T10:00:00.000Z');
  const LATER = new Date('2026-10-27T10:10:00.000Z');
  const A = { codeHash: 'a'.repeat(64), codeSalt: 'b'.repeat(32) };
  const B = { codeHash: 'c'.repeat(64), codeSalt: 'd'.repeat(32) };

  function scripted() {
    // The row; any statement after the first one sees code B saved.
    let row = {
      userId: 'u1',
      ...A,
      expiresAt: LATER,
      attempts: 0,
      lockedUntil: null,
    };
    let statements = 0;
    const updates: { sql: string; params: unknown[] }[] = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        statements++;
        if (statements === 2) row = { ...row, ...B, attempts: 0 };
        if (/^\s*SELECT/i.test(sql)) return [{ ...row }];
        updates.push({ sql, params });
        // The UPDATE matches only if its conditions hold on the current row.
        const hashParam = params.find(
          (p) => p === A.codeHash || p === B.codeHash,
        );
        const matches = hashParam === undefined || hashParam === row.codeHash;
        if (matches) row = { ...row, attempts: row.attempts + 1 };
        return { affectedRows: matches ? 1 : 0 };
      }),
    };
    const store = new MysqlOrganizationDeletionCodeStore(
      dataSource as unknown as DataSource,
    );
    return { store, updates, row: () => row };
  }

  it('an allowed attempt was counted on the code it hands back', async () => {
    const { store, updates } = scripted();
    const outcome = await store.countAttempt('o1', 'u1', NOW);

    // The MySQL text the store sends (identifiers quoted by db-dialect).
    const { ident } = dialectApi('mysql');
    const attempts = ident('attempts').text;
    const counting = updates.find((u) =>
      u.sql.includes(`${attempts} = ${attempts} + 1`),
    );
    expect(counting).toBeDefined();
    expect(counting!.sql).toContain(`${ident('codeHash').text} = ?`);
    if (outcome.outcome === 'allowed') {
      expect(counting!.params).toContain(outcome.stored.hash);
    }
  });

  it('a code replaced between the read and the count is invalid, never compared', async () => {
    const { store, row } = scripted();
    const outcome = await store.countAttempt('o1', 'u1', NOW);
    // The read saw A, the count found B: no attempt on B, nothing allowed.
    expect(outcome).toEqual({ outcome: 'invalid' });
    expect(row().attempts).toBe(0);
  });
});
