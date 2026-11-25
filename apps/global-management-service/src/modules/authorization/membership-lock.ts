import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { DataSource, QueryRunner } from 'typeorm';
import {
  AdvisoryLockTimeoutError,
  withAdvisoryLock,
} from '@cybedefend/db-dialect';

/**
 * What a membership lock serialises:
 * - `organization`: every role change, add, removal and invitation
 *   acceptance of one user in one organisation;
 * - `team`: every add, role change and removal of one user in one team;
 * - `creator`: every organisation creation by one user.
 */
export type MembershipLockScope = 'organization' | 'team' | 'creator';

/** How long a membership write waits for the one before it, in seconds. */
export const MEMBERSHIP_LOCK_TIMEOUT_S = 15;

/**
 * At most this many lock holders per process, whatever the pool size, and
 * never more than half the pool: each holder keeps one pooled connection
 * for its lock while its work borrows others, so holders must always leave
 * connections for that work. Tunable with MEMBERSHIP_LOCK_HOLDERS.
 */
export const MAX_MEMBERSHIP_LOCK_HOLDERS = 4;

/** mysql2 and pg both default to 10 connections. */
const DEFAULT_POOL_SIZE = 10;

function poolSizeOf(dataSource: DataSource): number {
  const options = (dataSource.options ?? {}) as {
    poolSize?: number;
    extra?: { connectionLimit?: number; max?: number };
  };
  const size =
    options.extra?.connectionLimit ??
    options.extra?.max ??
    options.poolSize ??
    DEFAULT_POOL_SIZE;
  return Number.isInteger(size) && size > 0 ? size : DEFAULT_POOL_SIZE;
}

/** The number of lock holders this process allows on `dataSource`'s pool. */
export function membershipLockHolders(
  dataSource: DataSource,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const cap = Math.max(1, Math.floor(poolSizeOf(dataSource) / 2));
  const tuned = Number(env.MEMBERSHIP_LOCK_HOLDERS);
  const wanted =
    Number.isInteger(tuned) && tuned > 0 ? tuned : MAX_MEMBERSHIP_LOCK_HOLDERS;
  return Math.min(wanted, cap);
}

const unavailable = () =>
  new RpcException({
    code: status.UNAVAILABLE,
    message: 'Membership is being changed, retry',
  });

/**
 * The queue of each lock name in this process. Callers of one process wait
 * here, in memory, one behind the other: a burst on one member holds no
 * connection while it waits.
 */
const queues = new Map<string, Promise<void>>();

async function inProcessQueue<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(name) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  queues.set(name, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(name) === tail) queues.delete(name);
  }
}

/**
 * The lock holders of each pool: a counting semaphore whose waiters queue in
 * memory and give up after MEMBERSHIP_LOCK_TIMEOUT_S.
 */
class HolderSlots {
  private used = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly size: number) {}

  async acquire(timeoutMs: number): Promise<void> {
    if (this.used < this.size) {
      this.used += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(grant);
        if (at !== -1) this.waiting.splice(at, 1);
        reject(unavailable());
      }, timeoutMs);
      this.waiting.push(grant);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.used -= 1;
    }
  }
}

const slotsByPool = new WeakMap<DataSource, HolderSlots>();

function slotsOf(dataSource: DataSource): HolderSlots {
  let slots = slotsByPool.get(dataSource);
  if (!slots) {
    slots = new HolderSlots(membershipLockHolders(dataSource));
    slotsByPool.set(dataSource, slots);
  }
  return slots;
}

/** The lock connection and the lock names the current call chain holds. */
interface HeldLocks {
  dataSource: DataSource;
  runner: QueryRunner;
  names: Set<string>;
}

const held = new AsyncLocalStorage<HeldLocks>();

/**
 * The database lock name: MySQL caps GET_LOCK names at 64 characters, so the
 * ids are hashed.
 */
export function membershipLockName(
  scope: MembershipLockScope,
  scopeId: string,
  userId: string,
): string {
  const digest = createHash('sha256')
    .update(`${scope}:${scopeId}:${userId}`)
    .digest('hex')
    .slice(0, 40);
  return `gm:membership:${digest}`;
}

/**
 * Runs `fn` alone for this (scope, scopeId, user), across every replica of
 * the service: a database advisory lock (MySQL GET_LOCK, PostgreSQL
 * pg_advisory_lock) held for the whole of `fn`, which covers both the
 * membership rows and the permission-engine writes. Without it, a role
 * change and a removal of the same member could each read the membership,
 * then write the permission engine in the wrong order, and leave a role
 * nobody can see.
 *
 * `fn` must read the membership again: what was read before the lock may
 * have changed while it waited.
 *
 * See withMembershipLocks for how the locks share the connection pool.
 */
export async function withMembershipLock<T>(
  dataSource: DataSource,
  scope: MembershipLockScope,
  scopeId: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withMembershipLocks(dataSource, scope, [scopeId], userId, fn);
}

/**
 * withMembershipLock for one user in several organisations or teams at once
 * (a user removed from every team of an organisation).
 *
 * How the locks use the connection pool, so that they can never starve the
 * work they protect:
 * - a caller first waits in memory behind the callers of the same keys;
 * - then for one of the process's few lock-holder slots (at most half the
 *   pool, MAX_MEMBERSHIP_LOCK_HOLDERS at most), answered UNAVAILABLE after
 *   MEMBERSHIP_LOCK_TIMEOUT_S;
 * - the holder takes ONE connection for its locks, and a lock taken inside
 *   `fn` (an organisation lock around team locks) reuses that connection
 *   and slot, and runs at once on a key the chain already holds.
 * The locks of one call are taken in sorted order; an organisation lock is
 * taken before team locks, never the reverse.
 *
 * A lock not granted in time answers UNAVAILABLE with nothing changed. A
 * lock connection lost while `fn` runs makes its release fail, and the call
 * fails (UNAVAILABLE) instead of reporting success.
 */
export async function withMembershipLocks<T>(
  dataSource: DataSource,
  scope: MembershipLockScope,
  scopeIds: readonly string[],
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const outer = held.getStore();
  const chain = outer?.dataSource === dataSource ? outer : undefined;
  const names = [
    ...new Set(
      scopeIds.map((scopeId) => membershipLockName(scope, scopeId, userId)),
    ),
  ]
    .filter((name) => !chain?.names.has(name))
    .sort();
  if (names.length === 0) return fn();

  const lockAll = (runner: QueryRunner, chainNames: Set<string>) =>
    names.reduceRight<() => Promise<T>>(
      (inner, name) => () =>
        inProcessQueue(name, () =>
          withAdvisoryLock(
            runner,
            name,
            MEMBERSHIP_LOCK_TIMEOUT_S,
            async () => {
              chainNames.add(name);
              try {
                return await inner();
              } finally {
                chainNames.delete(name);
              }
            },
          ),
        ),
      fn,
    );

  try {
    if (chain) {
      // Nested: the chain's connection and slot, never a new one.
      return await lockAll(chain.runner, chain.names)();
    }
    // Wait in memory behind the same keys BEFORE taking a slot, so that a
    // burst on one member holds no slot while it waits.
    return await names.reduceRight<() => Promise<T>>(
      (inner, name) => () => inProcessQueue(`slot:${name}`, inner),
      async () => {
        const slots = slotsOf(dataSource);
        await slots.acquire(MEMBERSHIP_LOCK_TIMEOUT_S * 1000);
        try {
          const runner = dataSource.createQueryRunner();
          await runner.connect();
          try {
            const store: HeldLocks = { dataSource, runner, names: new Set() };
            return await held.run(store, () => lockAll(runner, store.names)());
          } finally {
            await runner.release();
          }
        } finally {
          slots.release();
        }
      },
    )();
  } catch (error) {
    if (error instanceof AdvisoryLockTimeoutError) throw unavailable();
    if (error instanceof RpcException) throw error;
    // The lock connection failed (its release included): the work may have
    // run without the lock held to the end, so it is not reported done.
    if (isConnectionError(error)) throw unavailable();
    throw error;
  }
}

/** An error of the lock connection itself, never one of `fn`'s own. */
function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = String((error as Error)?.message ?? '');
  return (
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    /closed state|Connection terminated|Client has encountered a connection error/i.test(
      message,
    )
  );
}
