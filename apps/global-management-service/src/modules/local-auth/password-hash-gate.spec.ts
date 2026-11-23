import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  PASSWORD_HASH_GATE_DEFAULTS,
  PasswordHashGate,
  passwordHashGateFromEnv,
} from './password-hash-gate';
import { PasswordHasher } from './password-hasher';

/** A task the test finishes by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setImmediate(r));

function expectBusy(err: unknown) {
  expect(err).toBeInstanceOf(RpcException);
  expect((err as RpcException).getError()).toEqual({
    code: status.UNAVAILABLE,
    message: 'PASSWORD_VERIFICATION_BUSY',
  });
}

describe('PasswordHashGate', () => {
  afterEach(() => jest.useRealTimers());

  it('has bounded defaults', () => {
    expect(PASSWORD_HASH_GATE_DEFAULTS).toEqual({
      maxConcurrent: 4,
      maxQueued: 64,
      queueTimeoutMs: 2000,
    });
  });

  it('runs at most maxConcurrent tasks at once and queues the others', async () => {
    const gate = new PasswordHashGate({
      maxConcurrent: 2,
      maxQueued: 10,
      queueTimeoutMs: 10_000,
    });
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () => deferred());
    const results = tasks.map((t, i) =>
      gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await t.promise;
        running--;
        return i;
      }),
    );
    await flush();
    expect(running).toBe(2);
    for (const t of tasks) {
      t.resolve();
      await flush();
    }
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('refuses at once, UNAVAILABLE, past maxQueued waiting tasks', async () => {
    const gate = new PasswordHashGate({
      maxConcurrent: 1,
      maxQueued: 1,
      queueTimeoutMs: 10_000,
    });
    const block = deferred();
    const first = gate.run(() => block.promise);
    const second = gate.run(async () => 'queued');
    const third = jest.fn(async () => 'never');
    const err = await gate.run(third).catch((e: unknown) => e);
    expectBusy(err);
    expect(third).not.toHaveBeenCalled();
    block.resolve();
    await first;
    await expect(second).resolves.toBe('queued');
  });

  it('refuses a task that waited past queueTimeoutMs and never runs it', async () => {
    jest.useFakeTimers();
    const gate = new PasswordHashGate({
      maxConcurrent: 1,
      maxQueued: 10,
      queueTimeoutMs: 2000,
    });
    const block = deferred();
    const first = gate.run(() => block.promise);
    const late = jest.fn(async () => 'never');
    const waiting = gate.run(late).catch((e: unknown) => e);
    jest.advanceTimersByTime(2001);
    expectBusy(await waiting);
    block.resolve();
    await first;
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });

  it('frees its slot when a task fails', async () => {
    const gate = new PasswordHashGate({
      maxConcurrent: 1,
      maxQueued: 0,
      queueTimeoutMs: 10,
    });
    await expect(
      gate.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('reads its bounds from the environment, a bad value keeping the default', () => {
    expect(
      passwordHashGateFromEnv({
        PASSWORD_HASH_MAX_CONCURRENCY: '8',
        PASSWORD_HASH_MAX_QUEUED: '0',
        PASSWORD_HASH_QUEUE_TIMEOUT_MS: 'nope',
      }).limits,
    ).toEqual({ maxConcurrent: 8, maxQueued: 0, queueTimeoutMs: 2000 });
    expect(
      passwordHashGateFromEnv({ PASSWORD_HASH_MAX_CONCURRENCY: '0' }).limits,
    ).toEqual(PASSWORD_HASH_GATE_DEFAULTS);
  });
});

describe('PasswordHasher behind the gate', () => {
  it('refuses a verification UNAVAILABLE when the gate is full, instead of answering false', async () => {
    const gate = new PasswordHashGate({
      maxConcurrent: 1,
      maxQueued: 0,
      queueTimeoutMs: 10,
    });
    const hasher = new PasswordHasher(gate);
    const hash = await hasher.hash('correct horse battery');
    const block = deferred();
    const held = gate.run(() => block.promise);
    expectBusy(
      await hasher
        .verify(hash, 'correct horse battery')
        .catch((e: unknown) => e),
    );
    expectBusy(await hasher.hash('another password').catch((e: unknown) => e));
    expectBusy(
      await hasher.verifyAgainstDummy('whatever').catch((e: unknown) => e),
    );
    block.resolve();
    await held;
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
  });
});
