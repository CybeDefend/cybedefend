/**
 * Test double of the connection a membership lock runs on (see
 * membership-lock.ts), for specs whose DataSource is a double: every
 * advisory lock is granted at once, every other statement answers no row.
 * The ordering under the lock is proven on real engines by
 * membership-races.live.spec.ts, never with this double.
 */
export function grantingLockRunner() {
  return {
    manager: { connection: { options: { type: 'mysql' } } },
    connect: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    // Both engines' lock probes answer one `acquired` column.
    query: jest.fn(async (text: string) =>
      /\bAS acquired\b/.test(text) ? [{ acquired: 1 }] : [],
    ),
  };
}

/** A `createQueryRunner` for a DataSource double: runners that grant locks. */
export function grantingCreateQueryRunner(): jest.Mock {
  return jest.fn(() => grantingLockRunner());
}
