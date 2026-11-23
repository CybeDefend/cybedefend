/**
 * Every realtime event type `resolveChannels` routes. Kept in step with the
 * router by `channel-router.broad-scope.spec.ts`, which calls
 * `resolveChannels` with a full scope for each one. AGENT_STEP_CHANGED,
 * TRIAL_UPDATED, SUBSCRIPTION_CHANGED and VIBEDEFEND_USAGE_UPDATED are emitted
 * by cloud-only code; they stay here so both editions share the router.
 */
export const REALTIME_EVENT_TYPES: readonly string[] = [
  "SCAN_STATUS_CHANGED",
  "VULNERABILITY_BATCH_APPENDED",
  "PROJECT_STATE_CHANGED",
  "POLICY_EVALUATION_COMPLETED",
  "ZERO_DAY_DETECTED",
  "VULNERABILITY_UPDATED",
  "REPORT_READY",
  "AGGREGATED_REPORT_READY",
  "AGENT_STEP_CHANGED",
  "SCAN_PIPELINE_CHANGED",
  "STATS_AGGREGATE_CHANGED",
  "MEMBERSHIP_CHANGED",
  "TRIAL_UPDATED",
  "SUBSCRIPTION_CHANGED",
  "USAGE_UPDATED",
  "VIBEDEFEND_USAGE_UPDATED",
  "ASYNC_TASK_PROGRESS",
  "ASYNC_TASK_COMPLETED",
];

/**
 * Channel prefixes streamed to organisation or team subscribers. Permify
 * `read` / `manage` on an organisation or team does not grant read on each of
 * its projects, so the gateway forwards a project event on these channels as
 * an invalidation only.
 */
export const BROAD_SCOPE_CHANNEL_PREFIXES: readonly string[] = [
  "cybe:event:org:",
  "cybe:event:team:",
  "cybe:event:billing:org:",
];

export function isBroadScopeChannel(channel: string): boolean {
  return BROAD_SCOPE_CHANNEL_PREFIXES.some((p) => channel.startsWith(p));
}

/**
 * The only types whose payload the gateway forwards on a broad channel, and
 * only while their scope names no projectId, scanId, vulnerabilityId or
 * jobId. Each publisher was checked: organisation, team and user ids only.
 * gateway-service keeps a copy in `modules/realtime/broad-scope-envelope.ts`
 * (it does not depend on this library); a gateway spec imports this list to
 * keep the two equal.
 */
export const BROAD_SCOPE_PAYLOAD_TYPES: readonly string[] = [
  "USAGE_UPDATED",
  "TRIAL_UPDATED",
  "SUBSCRIPTION_CHANGED",
  "MEMBERSHIP_CHANGED",
  "AGGREGATED_REPORT_READY",
];
