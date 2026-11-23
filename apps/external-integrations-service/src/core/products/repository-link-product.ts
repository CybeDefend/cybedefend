/**
 * How a repository scan is started. `graphOnly`: the repository was linked
 * from a closed product, so the scan builds the code graph and mines the
 * project's rules only (no scanner pod, no AppSec counter; security-scanning reads the flag
 * from the scan row it stores).
 */
export interface RepositoryScanOptions {
  graphOnly?: boolean;
}

/**
 * What the scan of a repository link (or a re-analysis started from that
 * product) is. The cloud answers `appsec` or `graph_only` (the closed rule
 * lives in the closed edition, reached through
 * `ENTITLEMENTS_PORT`); the Community Edition answers `none` with
 * `community_edition`: a link starts no scan. An unknown product is refused
 * INVALID_ARGUMENT 'Unknown product' in both editions, before any read.
 */
export type LinkScanDecision =
  | { scan: 'appsec' }
  | { scan: 'graph_only' }
  | { scan: 'none'; reason: 'community_edition' };
