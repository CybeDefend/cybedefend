import { AsyncTaskStore, AsyncTaskRecord } from './async-task-store.service';

// ---------------------------------------------------------------------------
// Minimal in-memory Redis fake — only the commands AsyncTaskStore uses.
// ---------------------------------------------------------------------------
function createRedisFake() {
  const kv = new Map<string, string>();
  // ZSET: key -> Map<member, score>
  const zsets = new Map<string, Map<string, number>>();
  const pexpiries = new Map<string, number>();

  return {
    // key-value
    set: jest.fn(async (key: string, value: string) => {
      kv.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => kv.get(key) ?? null),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (kv.delete(k)) count++;
      }
      return count;
    }),
    pexpire: jest.fn(async (key: string, ms: number) => {
      pexpiries.set(key, ms);
      return 1;
    }),
    // sorted-set
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      if (!zsets.has(key)) zsets.set(key, new Map());
      const z = zsets.get(key)!;
      const isNew = !z.has(member);
      z.set(member, score);
      return isNew ? 1 : 0;
    }),
    // Returns members newest-first (score DESC). Args: key, max, min, 'BYSCORE', 'REV'
    // We implement a subset: zrangebyscore(key, '+inf', '-inf', 'REV') semantics
    // The service calls zrange(key, '+inf', '-inf', 'BYSCORE', 'REV') (ioredis v5 variadic).
    zrange: jest.fn(async (key: string) => {
      const z = zsets.get(key);
      if (!z) return [];
      // Sort members by score descending
      return Array.from(z.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([m]) => m);
    }),
    zrem: jest.fn(async (key: string, ...members: string[]) => {
      const z = zsets.get(key);
      if (!z) return 0;
      let removed = 0;
      for (const m of members) {
        if (z.delete(m)) removed++;
      }
      return removed;
    }),
    // Expose internal state for assertions
    _kv: kv,
    _zsets: zsets,
    _pexpiries: pexpiries,
    _reset() {
      kv.clear();
      zsets.clear();
      pexpiries.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRecord(overrides: Partial<AsyncTaskRecord> = {}): AsyncTaskRecord {
  return {
    taskId: 'task-1',
    type: 'vuln_batch_update',
    status: 'queued',
    total: 100,
    processed: 0,
    succeeded: 0,
    failed: 0,
    userId: 'user-abc',
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

const RECORD_KEY = (id: string) => `cybe:asynctask:${id}`;
const USER_INDEX_KEY = (uid: string) => `cybe:asynctask:user:${uid}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AsyncTaskStore', () => {
  let redis: ReturnType<typeof createRedisFake>;
  let store: AsyncTaskStore;
  const NOW = 2_000_000;
  const now = () => NOW;

  beforeEach(() => {
    redis = createRedisFake();
    store = new AsyncTaskStore(redis as any, now);
  });

  afterEach(() => redis._reset());

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('serialises the record to the record key', async () => {
      const rec = makeRecord();
      await store.create(rec);

      const raw = redis._kv.get(RECORD_KEY('task-1'));
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toMatchObject({
        taskId: 'task-1',
        userId: 'user-abc',
      });
    });

    it('adds the taskId to the user ZSET with createdAt as score', async () => {
      const rec = makeRecord({ createdAt: 1_234_567 });
      await store.create(rec);

      const z = redis._zsets.get(USER_INDEX_KEY('user-abc'));
      expect(z).toBeDefined();
      expect(z!.get('task-1')).toBe(1_234_567);
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------
  describe('get', () => {
    it('returns the parsed record for an existing taskId', async () => {
      await store.create(makeRecord());
      const result = await store.get('task-1');
      expect(result).not.toBeNull();
      expect(result!.taskId).toBe('task-1');
    });

    it('returns null for an unknown taskId', async () => {
      const result = await store.get('does-not-exist');
      expect(result).toBeNull();
    });

    it('round-trips a sca_autofix record through create → get', async () => {
      const rec = makeRecord({
        taskId: 'sca-autofix-p1-0',
        type: 'sca_autofix',
        resultUrl: 'https://example.com/pr/1',
      });
      await store.create(rec);

      const result = await store.get('sca-autofix-p1-0');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('sca_autofix');
      expect(result!.taskId).toBe('sca-autofix-p1-0');
      expect(result!.resultUrl).toBe('https://example.com/pr/1');
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('merges the patch into the existing record and bumps updatedAt to now()', async () => {
      await store.create(makeRecord({ updatedAt: 1_000_000 }));
      await store.update('task-1', { processed: 42, status: 'running' });

      const result = await store.get('task-1');
      expect(result!.processed).toBe(42);
      expect(result!.status).toBe('running');
      expect(result!.taskId).toBe('task-1'); // original fields preserved
      expect(result!.updatedAt).toBe(NOW); // clock injected
    });

    it('is a safe no-op when the taskId does not exist', async () => {
      await expect(
        store.update('ghost', { processed: 1 }),
      ).resolves.toBeUndefined();
      // Verify nothing was written
      expect(redis._kv.has(RECORD_KEY('ghost'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe('list', () => {
    it('returns records newest-first', async () => {
      await store.create(
        makeRecord({ taskId: 'task-older', userId: 'u1', createdAt: 1_000 }),
      );
      await store.create(
        makeRecord({ taskId: 'task-newer', userId: 'u1', createdAt: 2_000 }),
      );

      const results = await store.list('u1');
      expect(results.map((r) => r.taskId)).toEqual([
        'task-newer',
        'task-older',
      ]);
    });

    it('lazily prunes index entries whose record key no longer exists', async () => {
      await store.create(
        makeRecord({ taskId: 'task-alive', userId: 'u1', createdAt: 1_000 }),
      );
      await store.create(
        makeRecord({ taskId: 'task-expired', userId: 'u1', createdAt: 900 }),
      );

      // Simulate TTL expiry by deleting the record key directly
      redis._kv.delete(RECORD_KEY('task-expired'));

      const results = await store.list('u1');
      expect(results.map((r) => r.taskId)).toEqual(['task-alive']);

      // The stale index entry must have been ZREMed
      const z = redis._zsets.get(USER_INDEX_KEY('u1'));
      expect(z!.has('task-expired')).toBe(false);
    });

    it('returns an empty array when the user has no tasks', async () => {
      const results = await store.list('unknown-user');
      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // markTerminal
  // -------------------------------------------------------------------------
  describe('markTerminal', () => {
    it('merges the patch, sets updatedAt, and PEXPIREs the record by ttlMs', async () => {
      await store.create(makeRecord());
      await store.markTerminal(
        'task-1',
        { status: 'completed', succeeded: 100 },
        3_600_000,
      );

      const result = await store.get('task-1');
      expect(result!.status).toBe('completed');
      expect(result!.succeeded).toBe(100);
      expect(result!.updatedAt).toBe(NOW);

      expect(redis.pexpire).toHaveBeenCalledWith(
        RECORD_KEY('task-1'),
        3_600_000,
      );
    });

    it('is a safe no-op when the taskId does not exist', async () => {
      await expect(
        store.markTerminal('ghost', { status: 'failed' }, 3_600_000),
      ).resolves.toBeUndefined();
      expect(redis.pexpire).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('removes the record key and the user index entry', async () => {
      const rec = makeRecord({ userId: 'user-xyz' });
      await store.create(rec);
      await store.delete('task-1');

      expect(redis._kv.has(RECORD_KEY('task-1'))).toBe(false);

      const z = redis._zsets.get(USER_INDEX_KEY('user-xyz'));
      // Either the ZSET entry is gone, or the ZSET itself never had it
      const stillInIndex = z ? z.has('task-1') : false;
      expect(stillInIndex).toBe(false);
    });

    it('does not throw when the record does not exist', async () => {
      await expect(store.delete('no-such-task')).resolves.toBeUndefined();
    });
  });
});
