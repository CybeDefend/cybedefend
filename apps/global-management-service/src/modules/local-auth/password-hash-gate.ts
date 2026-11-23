import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

export interface PasswordHashGateLimits {
  /** argon2id runs at once in this process (19 MiB each). */
  maxConcurrent: number;
  /** Runs waiting for a slot; one more is refused at once. */
  maxQueued: number;
  /** How long a run waits for a slot before it is refused. */
  queueTimeoutMs: number;
}

/**
 * 4 runs at once is at most 76 MiB of argon2 memory, and libuv's default
 * pool has 4 threads. A queue bounded in size and in time keeps a flood of
 * logins from piling up behind them: the overflow is refused, the gateway
 * answers 503 AUTH_UNAVAILABLE, and the login is not counted against the
 * account.
 */
export const PASSWORD_HASH_GATE_DEFAULTS: Readonly<PasswordHashGateLimits> =
  Object.freeze({ maxConcurrent: 4, maxQueued: 64, queueTimeoutMs: 2000 });

/** The refusal of a run the gate cannot take. */
export const PASSWORD_VERIFICATION_BUSY = 'PASSWORD_VERIFICATION_BUSY';

function busy(): RpcException {
  return new RpcException({
    code: status.UNAVAILABLE,
    message: PASSWORD_VERIFICATION_BUSY,
  });
}

interface Waiter {
  start: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A process-wide semaphore in front of every argon2id hash and verification
 * (login, password change, setup, sign-up, reset, invitation acceptance).
 */
export class PasswordHashGate {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(readonly limits: Readonly<PasswordHashGateLimits>) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limits.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    if (this.queue.length >= this.limits.maxQueued) {
      return Promise.reject(busy());
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        start: () => {
          clearTimeout(waiter.timer);
          this.running++;
          resolve();
        },
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(busy());
        }, this.limits.queueTimeoutMs),
      };
      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.running--;
    this.queue.shift()?.start();
  }
}

function intFrom(
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

/**
 * The gate's bounds from PASSWORD_HASH_MAX_CONCURRENCY (>= 1),
 * PASSWORD_HASH_MAX_QUEUED (>= 0) and PASSWORD_HASH_QUEUE_TIMEOUT_MS (>= 1).
 * Tuning variables with a safe default, unregistered in Joi like the other
 * tuning variables; a malformed value keeps the default.
 */
export function passwordHashGateFromEnv(
  env: Record<string, string | undefined> = process.env,
): PasswordHashGate {
  const d = PASSWORD_HASH_GATE_DEFAULTS;
  return new PasswordHashGate({
    maxConcurrent: intFrom(
      env.PASSWORD_HASH_MAX_CONCURRENCY,
      d.maxConcurrent,
      1,
    ),
    maxQueued: intFrom(env.PASSWORD_HASH_MAX_QUEUED, d.maxQueued, 0),
    queueTimeoutMs: intFrom(
      env.PASSWORD_HASH_QUEUE_TIMEOUT_MS,
      d.queueTimeoutMs,
      1,
    ),
  });
}
