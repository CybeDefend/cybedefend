import type { EntityManager } from 'typeorm';
import { withinSavepoint } from './within-savepoint';

describe('withinSavepoint', () => {
  it('runs as is on a manager without a transaction runner (the cloud repositories)', async () => {
    const fn = jest.fn(async () => 'ok');
    await expect(
      withinSavepoint(
        { queryRunner: undefined } as unknown as EntityManager,
        fn,
      ),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs as is when there is no manager at all (a mocked repository)', async () => {
    const fn = jest.fn(async () => 1);
    await expect(withinSavepoint(undefined, fn)).resolves.toBe(1);
  });

  it('wraps the call in a savepoint inside an active transaction, and rolls back to it on failure', async () => {
    const query = jest.fn(async () => undefined);
    const manager = {
      queryRunner: { isTransactionActive: true, query },
    } as unknown as EntityManager;
    const failure = Object.assign(new Error('dup'), { code: '23505' });

    await expect(
      withinSavepoint(manager, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const statements = query.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(statements[0]).toMatch(/^SAVEPOINT /);
    expect(statements[1]).toMatch(/^ROLLBACK TO SAVEPOINT /);
  });

  it('runs as is on a runner outside a transaction', async () => {
    const query = jest.fn();
    const manager = {
      queryRunner: { isTransactionActive: false, query },
    } as unknown as EntityManager;
    await expect(withinSavepoint(manager, async () => 'x')).resolves.toBe('x');
    expect(query).not.toHaveBeenCalled();
  });
});
