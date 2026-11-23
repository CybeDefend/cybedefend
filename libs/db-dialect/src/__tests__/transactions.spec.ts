import type { QueryRunner } from 'typeorm';

function fresh(): typeof import('../transactions') {
  let mod: typeof import('../transactions') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../transactions');
  });
  return mod!;
}

function fakeRunner(active: boolean) {
  const calls: string[] = [];
  const runner = {
    isTransactionActive: active,
    query: jest.fn(async (text: string) => {
      calls.push(text);
      return {};
    }),
  };
  return { runner, calls };
}

describe('withSavepoint', () => {
  it('wraps fn in a savepoint and rolls back to it on error', async () => {
    const { withSavepoint } = fresh();
    const { runner, calls } = fakeRunner(true);
    const err = new Error('duplicate');
    await expect(
      withSavepoint(runner as unknown as QueryRunner, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
    expect(calls).toEqual(['SAVEPOINT cd_sp_1', 'ROLLBACK TO SAVEPOINT cd_sp_1']);
  });

  it('releases the savepoint on success', async () => {
    const { withSavepoint } = fresh();
    const { runner, calls } = fakeRunner(true);
    const out = await withSavepoint(runner as unknown as QueryRunner, async () => 42);
    expect(out).toBe(42);
    expect(calls).toEqual(['SAVEPOINT cd_sp_1', 'RELEASE SAVEPOINT cd_sp_1']);
  });

  it('names savepoints uniquely', async () => {
    const { withSavepoint } = fresh();
    const { runner, calls } = fakeRunner(true);
    await withSavepoint(runner as unknown as QueryRunner, async () => 1);
    await withSavepoint(runner as unknown as QueryRunner, async () => 2);
    expect(calls).toEqual([
      'SAVEPOINT cd_sp_1',
      'RELEASE SAVEPOINT cd_sp_1',
      'SAVEPOINT cd_sp_2',
      'RELEASE SAVEPOINT cd_sp_2',
    ]);
  });

  it('runs fn as is outside a transaction', async () => {
    const { withSavepoint } = fresh();
    const { runner } = fakeRunner(false);
    const out = await withSavepoint(runner as unknown as QueryRunner, async () => 'ok');
    expect(out).toBe('ok');
    expect(runner.query).not.toHaveBeenCalled();
  });
});
