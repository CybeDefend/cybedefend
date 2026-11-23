import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------

export type AsyncTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AsyncTaskRecord {
  taskId: string;
  type: 'vuln_batch_update' | 'sca_autofix' | 'report_generation';
  status: AsyncTaskStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  projectId?: string;
  organizationId?: string;
  userId: string;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
  error?: string;
  /** PR/MR URL set by autofix tasks on completion. */
  resultUrl?: string;
}

// ---------------------------------------------------------------------------
// Redis key builders
// ---------------------------------------------------------------------------

const RECORD_KEY = (taskId: string) => `cybe:asynctask:${taskId}`;
const USER_INDEX_KEY = (userId: string) => `cybe:asynctask:user:${userId}`;

/**
 * AsyncTaskStore — Redis-backed store for async bulk-update task progress.
 *
 * Two structures per task:
 *   - Record:     `cybe:asynctask:{taskId}`           JSON string
 *   - User index: `cybe:asynctask:user:{userId}`      ZSET, score = createdAt ms
 *
 * Terminal records are expired via PEXPIRE after `ttlMs` (default from
 * ASYNC_TASK_TTL_MS env, defaulting to 1 hour). `list()` lazily prunes index
 * entries whose record key has already expired.
 *
 * The `now` parameter is injectable so unit tests can use a deterministic
 * clock without relying on `Date.now()`.
 */
@Injectable()
export class AsyncTaskStore {
  private readonly logger = new Logger(AsyncTaskStore.name);

  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Persist a new task record and add it to the per-user ZSET index.
   */
  async create(record: AsyncTaskRecord): Promise<void> {
    await this.redis.set(RECORD_KEY(record.taskId), JSON.stringify(record));
    await this.redis.zadd(
      USER_INDEX_KEY(record.userId),
      record.createdAt,
      record.taskId,
    );
  }

  /**
   * Merge a partial patch into an existing record and bump `updatedAt` to
   * `now()`. Safe no-op when the `taskId` does not exist.
   */
  async update(taskId: string, patch: Partial<AsyncTaskRecord>): Promise<void> {
    const existing = await this.get(taskId);
    if (!existing) return;

    const updated: AsyncTaskRecord = {
      ...existing,
      ...patch,
      updatedAt: this.now(),
    };
    await this.redis.set(RECORD_KEY(taskId), JSON.stringify(updated));
  }

  /**
   * Return the parsed record for `taskId`, or `null` if it does not exist
   * (or has expired).
   */
  async get(taskId: string): Promise<AsyncTaskRecord | null> {
    const raw = await this.redis.get(RECORD_KEY(taskId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AsyncTaskRecord;
    } catch (err) {
      this.logger.warn(
        `AsyncTaskStore.get(${taskId}) JSON parse error: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Return all tasks for `userId`, newest-first.
   *
   * Lazily prunes index entries whose record key no longer exists (e.g.
   * because the TTL fired).
   */
  async list(userId: string): Promise<AsyncTaskRecord[]> {
    const members: string[] = await this.redis.zrange(
      USER_INDEX_KEY(userId),
      '+inf',
      '-inf',
      'BYSCORE',
      'REV',
    );

    const results: AsyncTaskRecord[] = [];
    const stale: string[] = [];

    for (const taskId of members) {
      const record = await this.get(taskId);
      if (record) {
        results.push(record);
      } else {
        stale.push(taskId);
      }
    }

    if (stale.length > 0) {
      await this.redis.zrem(USER_INDEX_KEY(userId), ...stale);
    }

    return results;
  }

  /**
   * Merge a patch, bump `updatedAt`, and schedule the record for expiry via
   * PEXPIRE after `ttlMs` milliseconds.
   *
   * Safe no-op when the `taskId` does not exist.
   */
  async markTerminal(
    taskId: string,
    patch: Partial<AsyncTaskRecord>,
    ttlMs: number,
  ): Promise<void> {
    const existing = await this.get(taskId);
    if (!existing) return;

    const updated: AsyncTaskRecord = {
      ...existing,
      ...patch,
      updatedAt: this.now(),
    };
    await this.redis.set(RECORD_KEY(taskId), JSON.stringify(updated));
    await this.redis.pexpire(RECORD_KEY(taskId), ttlMs);
  }

  /**
   * Delete the record key and remove the `taskId` from the per-user index.
   * Used for rollback when an enqueue fails after the record was written.
   */
  async delete(taskId: string): Promise<void> {
    const existing = await this.get(taskId);
    await this.redis.del(RECORD_KEY(taskId));
    if (existing) {
      await this.redis.zrem(USER_INDEX_KEY(existing.userId), taskId);
    }
  }
}
