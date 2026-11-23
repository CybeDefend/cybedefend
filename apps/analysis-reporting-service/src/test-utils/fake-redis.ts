/**
 * In-memory fake Redis, written by hand: this service has no `ioredis-mock`,
 * and above all an auto-mock cannot express the behaviour that matters here —
 * the SEMANTICS of `SET … NX` (only the first caller wins) and of the
 * compare-and-delete release script.
 *
 * It is meant to be SHARED by several service instances: that sharing, and it
 * alone, reproduces a race between two simultaneous requests — on the same
 * pod as on two pods.
 *
 * Same pattern as `scan-queue.service.spec.ts` (`createRedisMock`, whose
 * decisive line is the `NX`) and as the `FakeRedis` of
 * `external-integrations-service/src/core/cache/registry-tags-cache.service.spec.ts`.
 */
type FakeRedisCommand = 'set' | 'get' | 'del' | 'eval' | 'exists';

export class FakeRedis {
  readonly store = new Map<string, string>();
  /** Arguments of each `SET`, as Redis would receive them. */
  readonly setCalls: unknown[][] = [];
  readonly evalCalls: unknown[][] = [];
  readonly existsCalls: string[][] = [];

  /** Injectable failure, per command: the promise REJECTS. */
  failOn: Set<FakeRedisCommand> = new Set();

  /**
   * Injectable failure, per command: the promise HANGS and never settles.
   *
   * That is the shape a Redis outage really takes behind this service's
   * client. `getRedisClient()` returns a `duplicate()` of the BullMQ `Queue`
   * connection, which is NON-blocking: BullMQ therefore does not force
   * `maxRetriesPerRequest: null` on it, the ioredis defaults apply
   * (`enableOfflineQueue: true`, `maxRetriesPerRequest: 20`), and a command
   * issued on a closed socket goes to the offline queue — it is rejected only
   * at the 21st attempt, about 258 s with BullMQ's `retryStrategy`. A
   * `try/catch` alone sees NONE of this: it only catches a rejection.
   */
  hangOn: Set<FakeRedisCommand> = new Set();

  /**
   * Commands whose EFFECT happens normally but whose REPLY is late.
   *
   * The third failure shape, and the trickiest: a client-side timeout rejects
   * the PROMISE, it does not cancel the COMMAND. The server applied the write;
   * the caller believes it failed. A fake that only modelled « rejects » and
   * « hangs » would let through the orphaned locks this gap produces.
   */
  slowOn: Set<FakeRedisCommand> = new Set();
  slowMs = 0;

  private async guard(cmd: FakeRedisCommand): Promise<void> {
    if (this.failOn.has(cmd)) throw new Error(`redis down (${cmd})`);
    if (this.hangOn.has(cmd)) await new Promise<never>(() => undefined);
  }

  /** Delays the REPLY, once the effect has already been applied. */
  private async lag(cmd: FakeRedisCommand): Promise<void> {
    if (!this.slowOn.has(cmd)) return;
    await new Promise<void>((r) => setTimeout(r, this.slowMs));
  }

  async set(
    key: string,
    value: string,
    ...args: unknown[]
  ): Promise<'OK' | null> {
    await this.guard('set');
    this.setCalls.push([key, value, ...args]);
    // What makes a `SET` a lock: `NX` never overwrites an existing key, so
    // exactly one caller gets 'OK'.
    if (args.includes('NX') && this.store.has(key)) {
      await this.lag('set');
      return null;
    }
    // The write lands BEFORE the delay: the server applied it, the reply is
    // what lags.
    this.store.set(key, value);
    await this.lag('set');
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    await this.guard('get');
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async exists(...keys: string[]): Promise<number> {
    await this.guard('exists');
    this.existsCalls.push(keys);
    return keys.filter((k) => this.store.has(k)).length;
  }

  async del(...keys: string[]): Promise<number> {
    await this.guard('del');
    let deleted = 0;
    for (const k of keys) if (this.store.delete(k)) deleted++;
    return deleted;
  }

  /**
   * The service sends only ONE script — the compare-and-delete release — so
   * the fake honours that contract instead of interpreting Lua: it deletes
   * `KEYS[1]` only while its value still equals `ARGV[1]`. Simulating it with
   * an unconditional `DEL` would let the lock-token tests pass against the
   * very bug they pin.
   */
  async eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number> {
    await this.guard('eval');
    this.evalCalls.push([script, numKeys, ...args]);
    const [key, expected] = args;
    if (this.store.get(key) !== expected) return 0;
    this.store.delete(key);
    return 1;
  }
}
