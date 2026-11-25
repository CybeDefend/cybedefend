import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import {
  membershipLockHolders,
  withMembershipLock,
  withMembershipLocks,
} from './membership-lock';

/**
 * The membership lock with a DataSource double: how many lock holders a pool
 * allows, the connection a nested lock reuses, and what happens when the
 * lock connection is lost. The ordering itself is proven on real engines
 * (membership-lock.live.spec.ts, membership-races.live.spec.ts).
 */
function doubleDataSource(
  options: Record<string, unknown> = {},
  onQuery: (text: string) => unknown = () => [],
) {
  const runners: Array<{ release: jest.Mock }> = [];
  const dataSource = {
    options: { type: 'mysql', ...options },
    createQueryRunner: jest.fn(() => {
      const runner = {
        manager: { connection: { options: { type: 'mysql' } } },
        connect: jest.fn(async () => undefined),
        release: jest.fn(async () => undefined),
        query: jest.fn(async (text: string) => {
          if (/\bAS acquired\b/.test(text)) return [{ acquired: 1 }];
          return onQuery(text);
        }),
      };
      runners.push(runner);
      return runner;
    }),
  } as unknown as DataSource & { createQueryRunner: jest.Mock };
  return { dataSource, runners };
}

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RpcException);
  return ((error as RpcException).getError() as { code: number }).code;
};

describe('membership locks', () => {
  it('allow at most half the pool as lock holders, 4 at most', () => {
    const at = (extra: Record<string, unknown>) =>
      membershipLockHolders(
        doubleDataSource({ extra }).dataSource,
        {} as NodeJS.ProcessEnv,
      );
    expect(at({})).toBe(4); // the default pool of 10
    expect(at({ connectionLimit: 3 })).toBe(1);
    expect(at({ max: 6 })).toBe(3);
    expect(at({ max: 40 })).toBe(4);
    expect(
      membershipLockHolders(
        doubleDataSource({ extra: { max: 40 } }).dataSource,
        {
          MEMBERSHIP_LOCK_HOLDERS: '8',
        } as NodeJS.ProcessEnv,
      ),
    ).toBe(8);
  });

  it('a nested lock reuses the connection of the lock around it', async () => {
    const { dataSource } = doubleDataSource();
    await withMembershipLock(dataSource, 'organization', 'o1', 'u1', () =>
      withMembershipLocks(dataSource, 'team', ['t2', 't1'], 'u1', () =>
        withMembershipLock(dataSource, 'team', 't1', 'u1', async () => 'done'),
      ),
    );
    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
  });

  it('a lost lock connection fails the call instead of reporting success', async () => {
    const { dataSource } = doubleDataSource({}, (text) => {
      if (/RELEASE_LOCK/.test(text)) {
        throw new Error(
          "Can't add new command when connection is in closed state",
        );
      }
      return [];
    });
    const fn = jest.fn(async () => 'written');

    expect(
      await codeOf(
        withMembershipLock(dataSource, 'organization', 'o1', 'u1', fn),
      ),
    ).toBe(status.UNAVAILABLE);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('an error of the work itself goes through unchanged', async () => {
    const { dataSource } = doubleDataSource();
    const refusal = new RpcException({
      code: status.PERMISSION_DENIED,
      message: 'no',
    });
    expect(
      await codeOf(
        withMembershipLock(dataSource, 'organization', 'o1', 'u1', async () => {
          throw refusal;
        }),
      ),
    ).toBe(status.PERMISSION_DENIED);
  });
});
