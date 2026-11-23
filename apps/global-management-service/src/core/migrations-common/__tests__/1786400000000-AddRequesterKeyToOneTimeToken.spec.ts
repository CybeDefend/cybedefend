import type { QueryRunner, TableColumn } from 'typeorm';
import { AddRequesterKeyToOneTimeToken1786400000000 } from '../1786400000000-AddRequesterKeyToOneTimeToken';

/**
 * The common migration adds the reset requester's key through the schema API
 * only: a nullable CHAR(64) on auth_one_time_token, and `query` is never
 * called (the engine renders it). Its real effect on both engines is checked
 * by schema-parity.live.spec.ts and local-identity.schema.live.spec.ts.
 */
describe('AddRequesterKeyToOneTimeToken1786400000000', () => {
  function double() {
    const added: { table: string; column: TableColumn }[] = [];
    const dropped: { table: string; column: string }[] = [];
    const query = jest.fn();
    const runner = {
      addColumn: jest.fn(async (table: string, column: TableColumn) => {
        added.push({ table, column });
      }),
      dropColumn: jest.fn(async (table: string, column: string) => {
        dropped.push({ table, column });
      }),
      query,
    } as unknown as QueryRunner;
    return { runner, added, dropped, query };
  }

  it('adds a nullable CHAR(64) requester_key and never calls query', async () => {
    const { runner, added, query } = double();

    await new AddRequesterKeyToOneTimeToken1786400000000().up(runner);

    expect(added).toHaveLength(1);
    expect(added[0].table).toBe('auth_one_time_token');
    expect(added[0].column.name).toBe('requester_key');
    expect(added[0].column.type).toBe('char');
    expect(String(added[0].column.length)).toBe('64');
    expect(added[0].column.isNullable).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('drops it on the way down', async () => {
    const { runner, dropped } = double();

    await new AddRequesterKeyToOneTimeToken1786400000000().down(runner);

    expect(dropped).toEqual([
      { table: 'auth_one_time_token', column: 'requester_key' },
    ]);
  });
});
