import { Inject, Injectable, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../core/redis/redis.module';

/**
 * Deferred rescans of refused pushes.
 *
 * A push to a project's scan branch while a scan of that branch is still
 * running is refused by security-scanning (`CheckExistingScan`, ALREADY_EXISTS).
 * Without this store the webhook would answer 409 and the pushed commit would
 * never be scanned; it is recorded here and scanned once the running scan ends.
 *
 * Layout, all under one prefix:
 *  - `<prefix>:entry:<projectId>:<branch>`: the LAST refused push of that
 *    branch (JSON), with a TTL of PENDING_RESCAN_TTL_SECONDS. A newer refused
 *    push overwrites it: at most one rescan per (project, branch), of the
 *    latest commit.
 *  - `<prefix>:due`: a sorted set of entry keys, scored by the time their
 *    next check is due. A set, so one schedule per entry whatever the number
 *    of refused pushes.
 *  - `<prefix>:started:<projectId>:<branch>`: the commit of the last scan
 *    started on that branch (same TTL). A push of that very commit refused
 *    afterwards is not recorded: the commit is already being scanned, and a
 *    rescan would scan and bill it twice (a gateway retry of a call EI did
 *    process, a manual redelivery, a manual scan that read the same head).
 *
 * Every step is one Lua script, so no interleaving of a webhook pod and a
 * consumer pod can lose a refused push, or keep an older one over a newer.
 */

/** How long a refused push waits for its rescan, at most. */
export const PENDING_RESCAN_TTL_SECONDS = 6 * 60 * 60;
/** Delay between two checks of a pending rescan (and before the first). */
export const PENDING_RESCAN_RETRY_DELAY_MS = 60_000;
/**
 * How long a consumer owns a claimed entry. A consumer that dies before it
 * settles lets another one claim the entry again after this.
 */
export const PENDING_RESCAN_CLAIM_LEASE_MS = 5 * 60_000;

/** Injection token of an optional key prefix (tests isolate their keys). */
export const PENDING_RESCAN_KEY_PREFIX = 'PENDING_RESCAN_KEY_PREFIX';
const DEFAULT_KEY_PREFIX = 'ei:pending-rescan';

interface PendingRescanBase {
  /** CybeDefend project the repository is linked to. */
  projectId: string;
  /** The project's scan branch the push went to. */
  branch: string;
  /** The pushed commit, the one to scan. */
  commitSha: string;
  /** When the refused push was recorded (epoch ms). */
  recordedAt: number;
}

export interface GithubPendingRescan extends PendingRescanBase {
  provider: 'github';
  /** GitHub's repository id (`repository.id` of the push payload). */
  githubRepositoryId: number;
}

export interface GitlabPendingRescan extends PendingRescanBase {
  provider: 'gitlab';
  /** Primary key of the GitlabRepository row. */
  gitlabRepositoryId: string;
}

export type PendingRescan = GithubPendingRescan | GitlabPendingRescan;

/** A refused push to record; the store stamps `recordedAt`. */
export type PendingRescanRequest =
  | Omit<GithubPendingRescan, 'recordedAt'>
  | Omit<GitlabPendingRescan, 'recordedAt'>;

/**
 * What a pending rescan check concluded:
 *  - `started`: the rescan was handed to the regular scan start;
 *  - `busy`: a scan still runs on the branch (or security-scanning did not
 *    answer); check again later;
 *  - `dropped`: the rescan no longer applies (repository unlinked or moved
 *    to another branch, scan-on-commit turned off, writes blocked, or an
 *    error that a retry would not fix).
 */
export type PendingRescanOutcome = 'started' | 'busy' | 'dropped';

/** An entry a consumer claimed: its key, its raw value, the value parsed. */
export interface ClaimedRescan {
  member: string;
  raw: string | null;
  entry: PendingRescan | null;
}

/**
 * SET the entry (last push wins), schedule it unless already scheduled; do
 * nothing when the refused commit is the one whose scan last started.
 */
const RECORD_SCRIPT = `
if redis.call('GET', KEYS[3]) == ARGV[4] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('ZADD', KEYS[2], 'NX', ARGV[3], KEYS[1])
return 1
`;

/** Lease the due entries: their score moves to the end of the lease. */
const CLAIM_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, member in ipairs(due) do
  redis.call('ZADD', KEYS[1], ARGV[3], member)
end
return due
`;

/**
 * Forget the entry a consumer processed. If a newer push replaced it in the
 * meantime, keep that one and schedule it instead.
 */
const SETTLE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if (not current) or current == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], KEYS[1])
  return 1
end
redis.call('ZADD', KEYS[2], ARGV[2], KEYS[1])
return 0
`;

/** Check again later, unless the entry expired meanwhile. */
const REARM_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('ZADD', KEYS[2], ARGV[1], KEYS[1])
  return 1
end
redis.call('ZREM', KEYS[2], KEYS[1])
return 0
`;

/**
 * A scan of commit ARGV[2] just started on the branch: remember that commit,
 * then drop a pending push refused BEFORE that start (the new scan covers a
 * commit at least as recent) or of that same commit (whenever it was
 * refused); keep another commit refused after the start.
 */
const SUPERSEDE_SCRIPT = `
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
local ok, entry = pcall(cjson.decode, current)
if ok and type(entry) == 'table' and entry.commitSha ~= ARGV[2] then
  local recordedAt = tonumber(entry.recordedAt)
  if recordedAt and recordedAt >= tonumber(ARGV[1]) then
    return 0
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], KEYS[1])
return 1
`;

@Injectable()
export class PendingRescanStore {
  private readonly dueKey: string;
  private readonly entryKeyPrefix: string;
  private readonly startedKeyPrefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() @Inject(PENDING_RESCAN_KEY_PREFIX) keyPrefix?: string,
  ) {
    const prefix = keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.dueKey = `${prefix}:due`;
    this.entryKeyPrefix = `${prefix}:entry:`;
    this.startedKeyPrefix = `${prefix}:started:`;
  }

  /** Key of the pending rescan of a project's branch. */
  entryKey(projectId: string, branch: string): string {
    return `${this.entryKeyPrefix}${projectId}:${branch}`;
  }

  /** Key of the commit of the last scan started on a project's branch. */
  private startedKey(projectId: string, branch: string): string {
    return `${this.startedKeyPrefix}${projectId}:${branch}`;
  }

  /**
   * Records a refused push. It replaces an older refused push of the same
   * branch; its first check is due PENDING_RESCAN_RETRY_DELAY_MS later.
   * Returns false, recording nothing, when the refused commit is the one
   * whose scan last started on the branch.
   */
  async record(
    request: PendingRescanRequest,
    now: number = Date.now(),
  ): Promise<boolean> {
    const entry = { ...request, recordedAt: now } as PendingRescan;
    const recorded = await this.redis.eval(
      RECORD_SCRIPT,
      3,
      this.entryKey(entry.projectId, entry.branch),
      this.dueKey,
      this.startedKey(entry.projectId, entry.branch),
      JSON.stringify(entry),
      PENDING_RESCAN_TTL_SECONDS,
      now + PENDING_RESCAN_RETRY_DELAY_MS,
      entry.commitSha,
    );
    return Number(recorded) === 1;
  }

  /**
   * A scan of `commitSha` started on the branch at `startedAt`: remembers the
   * commit, and forgets a push refused before the start or of the same
   * commit. Returns whether an entry was dropped.
   */
  async supersede(
    projectId: string,
    branch: string,
    startedAt: number,
    commitSha: string,
  ): Promise<boolean> {
    const dropped = await this.redis.eval(
      SUPERSEDE_SCRIPT,
      3,
      this.entryKey(projectId, branch),
      this.dueKey,
      this.startedKey(projectId, branch),
      startedAt,
      commitSha,
      PENDING_RESCAN_TTL_SECONDS,
    );
    return Number(dropped) === 1;
  }

  /** The commit of the last scan started on the branch, if remembered. */
  async startedCommit(
    projectId: string,
    branch: string,
  ): Promise<string | null> {
    return this.redis.get(this.startedKey(projectId, branch));
  }

  /** Claims, for PENDING_RESCAN_CLAIM_LEASE_MS, up to `limit` due entries. */
  async claimDue(
    limit: number,
    now: number = Date.now(),
  ): Promise<ClaimedRescan[]> {
    const members = (await this.redis.eval(
      CLAIM_SCRIPT,
      1,
      this.dueKey,
      now,
      limit,
      now + PENDING_RESCAN_CLAIM_LEASE_MS,
    )) as string[];
    if (members.length === 0) {
      return [];
    }
    const raws = await this.redis.mget(...members);
    return members.map((member, i) => ({
      member,
      raw: raws[i],
      entry: parsePendingRescan(raws[i]),
    }));
  }

  /**
   * The claimed entry was handled (started or dropped), or was gone: forget
   * it, unless a newer refused push replaced it meanwhile, which is then
   * scheduled. Returns whether the entry was forgotten.
   */
  async settle(
    claim: Pick<ClaimedRescan, 'member' | 'raw'>,
    now: number = Date.now(),
  ): Promise<boolean> {
    const forgotten = await this.redis.eval(
      SETTLE_SCRIPT,
      2,
      claim.member,
      this.dueKey,
      claim.raw ?? '',
      now + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    return Number(forgotten) === 1;
  }

  /**
   * A scan still runs on the branch: check again PENDING_RESCAN_RETRY_DELAY_MS
   * later. Returns false (and drops the schedule) when the entry expired.
   */
  async rearm(member: string, now: number = Date.now()): Promise<boolean> {
    const rearmed = await this.redis.eval(
      REARM_SCRIPT,
      2,
      member,
      this.dueKey,
      now + PENDING_RESCAN_RETRY_DELAY_MS,
    );
    return Number(rearmed) === 1;
  }
}

/** The entry stored under a key, or null when it is not a well-formed one. */
function parsePendingRescan(raw: string | null): PendingRescan | null {
  if (!raw) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const common =
    typeof entry.projectId === 'string' &&
    typeof entry.branch === 'string' &&
    typeof entry.commitSha === 'string' &&
    typeof entry.recordedAt === 'number';
  if (!common) {
    return null;
  }
  if (
    entry.provider === 'github' &&
    typeof entry.githubRepositoryId === 'number'
  ) {
    return entry as unknown as GithubPendingRescan;
  }
  if (
    entry.provider === 'gitlab' &&
    typeof entry.gitlabRepositoryId === 'string'
  ) {
    return entry as unknown as GitlabPendingRescan;
  }
  return null;
}
