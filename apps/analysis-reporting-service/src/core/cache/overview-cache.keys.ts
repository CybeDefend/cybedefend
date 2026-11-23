/**
 * Redis key helpers for the org-overview block cache. Kept in a
 * dependency-free module so both OverviewCacheService (reads/writes block
 * entries) and RealtimeBatchPublisher (bumps the generation on stats events)
 * agree on the key layout without a service-level coupling.
 */
export type OverviewBlock = 'sev' | 'state' | 'time';

/** Per-org generation counter. INCR on any stats change → old block keys orphaned. */
export const overviewGenerationKey = (orgId: string): string =>
  `ovw:gen:${orgId}`;

/** A block entry key, scoped by org + user (Permify scope) + generation + filter hash. */
export const overviewBlockKey = (
  block: OverviewBlock,
  orgId: string,
  userId: string,
  generation: number,
  filterHash: string,
): string => `ovw:${block}:${orgId}:${userId}:${generation}:${filterHash}`;

/** TTL (seconds) for a cached block entry. Override via OVERVIEW_BLOCK_CACHE_TTL_SECONDS. */
export const OVERVIEW_BLOCK_CACHE_TTL_SECONDS = 60;
/** TTL (seconds) for the generation counter — long enough to outlive block TTLs. */
export const OVERVIEW_GENERATION_TTL_SECONDS = 86400;
