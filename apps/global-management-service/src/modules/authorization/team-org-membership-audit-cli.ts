/**
 * What the team/organisation membership data audit CLI (a one-off script
 * outside `src/`) reads
 * from its environment, beyond what it shares with the switch script
 * (`member-products-switch-cli.ts`: the database, Permify, `--apply`). Kept
 * under `src/` so the service's ordinary jest run covers it: `scripts/` is
 * outside jest's `rootDir` and out of the build.
 */

const DEFAULT_RATE = 50;

/**
 * Permify calls a second (`PERMIFY_AUDIT_RPS`, default 50): the audit makes
 * one read per team and per organisation member, so it stays under Permify's
 * `server.rate_limit` and leaves room for the live traffic.
 */
export function permifyRate(env: NodeJS.ProcessEnv): number {
  const raw = env.PERMIFY_AUDIT_RPS;
  if (raw === undefined || raw === '') return DEFAULT_RATE;
  const rate = Number(raw);
  if (!Number.isInteger(rate) || rate < 1 || rate > 1000) {
    throw new TypeError(
      'PERMIFY_AUDIT_RPS must be an integer between 1 and 1000',
    );
  }
  return rate;
}

/** Spaces successive calls by at least 1000 / `rate` milliseconds. */
export function permifyPacer(rate: number): () => Promise<void> {
  const interval = Math.ceil(1000 / rate);
  let nextSlotAt = 0;
  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextSlotAt);
    nextSlotAt = slot + interval;
    if (slot > now) {
      await new Promise((resolve) => setTimeout(resolve, slot - now));
    }
  };
}
