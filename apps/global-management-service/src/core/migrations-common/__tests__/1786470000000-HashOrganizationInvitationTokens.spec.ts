import { createHash } from 'node:crypto';
import type { QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';
import { HashOrganizationInvitationTokens1786470000000 } from '../1786470000000-HashOrganizationInvitationTokens';

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * The expand step of the invitation-token hashing: a nullable CHAR(64)
 * `tokenHash`, the plaintext `token` made nullable, every stored token
 * replaced by its hash (so links already sent keep working), and a unique
 * index on the hash once the backfill is done. Its real effect on both
 * engines is checked by organization-invitation-token.live.spec.ts and
 * schema-parity.live.spec.ts.
 */
describe('HashOrganizationInvitationTokens1786470000000', () => {
  function double(
    dialect: 'mysql' | 'postgres',
    legacyRows: { id: string; token: string }[],
  ) {
    const events: string[] = [];
    const added: TableColumn[] = [];
    const changed: { from: TableColumn; to: TableColumn }[] = [];
    const indexes: TableIndex[] = [];
    const updates: unknown[][] = [];
    let pending = [...legacyRows];
    const tokenColumn = {
      name: 'token',
      type: 'varchar',
      length: '255',
      isNullable: false,
      clone() {
        return { ...this, clone: this.clone };
      },
    } as unknown as TableColumn;
    const runner = {
      connection: { options: { type: dialect } },
      release: jest.fn(),
      getTable: jest.fn(async () => ({
        findColumnByName: (name: string) =>
          name === 'token' ? tokenColumn : undefined,
      })) as unknown as (name: string) => Promise<Table>,
      addColumn: jest.fn(async (_t: string, column: TableColumn) => {
        events.push(`addColumn:${column.name}`);
        added.push(column);
      }),
      changeColumn: jest.fn(
        async (_t: string, from: TableColumn, to: TableColumn) => {
          events.push(`changeColumn:${to.name}`);
          changed.push({ from, to });
        },
      ),
      createIndex: jest.fn(async (_t: string, index: TableIndex) => {
        events.push(`createIndex:${index.name}`);
        indexes.push(index);
      }),
      query: jest.fn(async (text: string, params: unknown[]) => {
        if (/^\s*SELECT/i.test(text)) {
          events.push('select');
          const batch = pending;
          pending = [];
          return { records: batch };
        }
        events.push('update');
        updates.push([text, params]);
        return { records: { affectedRows: 1 }, affected: 1 };
      }),
    } as unknown as QueryRunner;
    return { runner, events, added, changed, indexes, updates };
  }

  it.each(['mysql', 'postgres'] as const)(
    '%s: adds the hash, backfills it, nulls the token, then indexes it unique',
    async (dialect) => {
      const legacy = [
        { id: 'inv-1', token: 'a'.repeat(64) },
        { id: 'inv-2', token: 'b'.repeat(64) },
      ];
      const { runner, events, added, changed, indexes, updates } = double(
        dialect,
        legacy,
      );

      await new HashOrganizationInvitationTokens1786470000000().up(runner);

      expect(added).toHaveLength(1);
      expect(added[0].name).toBe('tokenHash');
      expect(added[0].type).toBe('char');
      expect(String(added[0].length)).toBe('64');
      expect(added[0].isNullable).toBe(true);

      expect(changed).toHaveLength(1);
      expect(changed[0].to.name).toBe('token');
      expect(changed[0].to.isNullable).toBe(true);

      // One update per legacy row: its hash, and the plaintext gone.
      expect(updates).toHaveLength(2);
      for (const [i, row] of legacy.entries()) {
        const [text, params] = updates[i] as [string, unknown[]];
        expect(text).toMatch(/UPDATE/i);
        expect(text).toMatch(/NULL/);
        expect(params).toEqual([sha256(row.token), row.id]);
      }
      if (dialect === 'postgres') {
        expect(updates[0][0]).toContain('"tokenHash"');
      }

      expect(indexes).toHaveLength(1);
      expect(indexes[0].name).toBe('UQ_orginv_token_hash');
      expect(indexes[0].columnNames).toEqual(['tokenHash']);
      expect(indexes[0].isUnique).toBe(true);

      // The index comes after the backfill, the backfill after the columns.
      expect(
        events.indexOf('createIndex:UQ_orginv_token_hash'),
      ).toBeGreaterThan(events.lastIndexOf('update'));
      expect(events.indexOf('select')).toBeGreaterThan(
        events.indexOf('changeColumn:token'),
      );
    },
  );

  it('selects the rows still holding a token and no hash', async () => {
    const { runner } = double('mysql', []);

    await new HashOrganizationInvitationTokens1786470000000().up(runner);

    const select = (runner.query as jest.Mock).mock.calls.find(([text]) =>
      /^\s*SELECT/i.test(text),
    );
    expect(select[0]).toMatch(/token.+IS NOT NULL/);
    expect(select[0]).toMatch(/tokenHash.+IS NULL/);
  });
});
