/**
 * Bounds of one scan's git history fetch.
 *
 * All are pure tuning variables with a safe code default, so, per the service
 * convention, they are deliberately NOT registered in the Joi validation
 * schema (see `zip-size-gate.ts` for the same pattern).
 */

/**
 * Bytes the bare repository of one scan may occupy on disk while it is
 * fetched: 2 GiB. The repo-scan worker's 8 GiB `/tmp` must also hold the
 * zipball, the rewritten zip and the history tar, which is as large as the
 * repository.
 */
export const DEFAULT_GIT_HISTORY_BUDGET_BYTES = 2 * 1024 ** 3;

/** Tuning override for {@link DEFAULT_GIT_HISTORY_BUDGET_BYTES}, in bytes. */
export const GIT_HISTORY_BUDGET_ENV = 'GIT_HISTORY_BUDGET_BYTES';

/**
 * Time allowed to each git call: 600 s. A safety net only; the byte budget is
 * what bounds the work.
 */
export const DEFAULT_GIT_HISTORY_TIMEOUT_MS = 600_000;

/** Tuning override for {@link DEFAULT_GIT_HISTORY_TIMEOUT_MS}, in ms. */
export const GIT_HISTORY_TIMEOUT_ENV = 'GIT_HISTORY_TIMEOUT_MS';

/**
 * Time allowed to one scan's whole history fetch: 20 min. A deepening step
 * still running then is undone and the pass keeps what it has, so the
 * repo-scan job ends well before the 45-minute `waiting_for_file` watchdog.
 */
export const DEFAULT_GIT_HISTORY_DEADLINE_MS = 1_200_000;

/** Tuning override for {@link DEFAULT_GIT_HISTORY_DEADLINE_MS}, in ms. */
export const GIT_HISTORY_DEADLINE_ENV = 'GIT_HISTORY_DEADLINE_MS';

function positiveInteger(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The configured history budget, falling back to the code default. */
export function resolveGitHistoryBudgetBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    positiveInteger(env[GIT_HISTORY_BUDGET_ENV]) ??
    DEFAULT_GIT_HISTORY_BUDGET_BYTES
  );
}

/** The configured per git call timeout, falling back to the code default. */
export function resolveGitHistoryTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    positiveInteger(env[GIT_HISTORY_TIMEOUT_ENV]) ??
    DEFAULT_GIT_HISTORY_TIMEOUT_MS
  );
}

/** The configured deadline of a history fetch, falling back to the code default. */
export function resolveGitHistoryDeadlineMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    positiveInteger(env[GIT_HISTORY_DEADLINE_ENV]) ??
    DEFAULT_GIT_HISTORY_DEADLINE_MS
  );
}
