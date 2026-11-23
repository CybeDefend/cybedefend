/**
 * What a push on a linked repository starts.
 * - `appsec`: the full AppSec scan, as before. security-scanning still runs
 *   its own gates at StartScan (writability, AppSec project limit, trial
 *   scan).
 * - `graph_only`: the code graph only (no scanner pod, no AppSec
 *   counter), subject to security-scanning's graph-only limits.
 * - `none`: nothing; the caller logs one `WEBHOOK_IGNORED_*` line
 *   (`PENDING_RESCAN_DROPPED reason=…` for a deferred rescan).
 *
 * The rule itself (`decidePushScan`) is closed: it lives in
 * the closed edition and the services reach it through
 * `ENTITLEMENTS_PORT`. The Community Edition answers `none` with
 * `community_edition`: a push starts no scan.
 */
export type PushScanIgnoredReason =
  | 'writes_blocked'
  | 'trial_scans_exhausted'
  | 'no_product'
  | 'products_unknown'
  | 'community_edition';

export type PushScanDecision =
  | { scan: 'appsec' }
  | { scan: 'graph_only' }
  | { scan: 'none'; reason: PushScanIgnoredReason };

/** The word of the `WEBHOOK_IGNORED_<WORD>` line a push logs for a reason. */
export function webhookIgnoredLabel(reason: PushScanIgnoredReason): string {
  return reason.toUpperCase();
}
