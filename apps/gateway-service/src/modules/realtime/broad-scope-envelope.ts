/**
 * A realtime event about a project reaches broader-scope subscribers only as
 * an invalidation.
 *
 * Organisation and team SSE streams are guarded by Permify `read` / `manage`
 * on the organisation or team, which is weaker than the readable-project
 * rule: a member can read the organisation without reading every project in
 * it. The publisher fans project events (SCAN_STATUS_CHANGED,
 * PROJECT_STATE_CHANGED, VULNERABILITY_BATCH_APPENDED, ZERO_DAY_DETECTED,
 * POLICY_EVALUATION_COMPLETED) out to `org:<o>:projects` / `org:<o>:overview`
 * with the project id, the scan id and a payload that can hold a scan's error
 * text.
 *
 * On a broad channel the decision is made by TYPE first: only the types of
 * `BROAD_SCOPE_PAYLOAD_TYPES`, whose publishers put nothing but organisation,
 * team and user ids in the payload, keep their payload, and only while their
 * scope names no project-level resource. Every other envelope is reduced to
 * `{ eventId, type, timestamp, scope: { organizationId, teamId? } }`: the
 * dashboard refetches through the gateway, whose routes apply the
 * readable-project rule. Members still see the type and the timing of a
 * project event: accepted metadata.
 */

/**
 * Types whose payload is forwarded on organisation / team channels. Checked
 * against every publisher (billing: usage, trial, subscription; global
 * management: organisation and team membership; analysis-reporting:
 * aggregated reports, ids only). Pinned in `broad-scope-envelope.spec.ts` and
 * in libs/realtime-publisher `channel-router.broad-scope.spec.ts`.
 */
export const BROAD_SCOPE_PAYLOAD_TYPES: ReadonlySet<string> = new Set([
  'USAGE_UPDATED',
  'TRIAL_UPDATED',
  'SUBSCRIPTION_CHANGED',
  'MEMBERSHIP_CHANGED',
  'AGGREGATED_REPORT_READY',
]);

/**
 * Channel prefixes streamed to organisation or team subscribers. The factory
 * applies `toBroadScopeEnvelope` on these from the channel name itself, so a
 * new organisation or team handler cannot forget it.
 */
const BROAD_SCOPE_CHANNEL_PREFIXES = [
  'cybe:event:org:',
  'cybe:event:team:',
  'cybe:event:billing:org:',
] as const;

export function isBroadScopeChannel(channel: string): boolean {
  return BROAD_SCOPE_CHANNEL_PREFIXES.some((p) => channel.startsWith(p));
}

const PROJECT_LEVEL_SCOPE_KEYS = [
  'projectId',
  'scanId',
  'vulnerabilityId',
  'jobId',
] as const;

interface RealtimeEnvelopeLike {
  eventId?: string;
  event_id?: string;
  type?: string;
  timestamp?: string;
  scope?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BroadScopeEnvelope {
  eventId?: string;
  type?: string;
  timestamp?: string;
  scope: { organizationId?: unknown; teamId?: unknown };
}

export function toBroadScopeEnvelope<T>(env: T): T | BroadScopeEnvelope {
  if (!env || typeof env !== 'object') return env;
  const e = env as RealtimeEnvelopeLike;
  const scope =
    e.scope && typeof e.scope === 'object'
      ? e.scope
      : ({} as Record<string, unknown>);
  const namesProject = PROJECT_LEVEL_SCOPE_KEYS.some(
    (k) => scope[k] !== undefined && scope[k] !== null && scope[k] !== '',
  );
  if (
    !namesProject &&
    typeof e.type === 'string' &&
    BROAD_SCOPE_PAYLOAD_TYPES.has(e.type)
  ) {
    return env;
  }

  const broadScope: BroadScopeEnvelope['scope'] = {};
  if (scope.organizationId !== undefined) {
    broadScope.organizationId = scope.organizationId;
  }
  if (scope.teamId !== undefined) broadScope.teamId = scope.teamId;

  const out: BroadScopeEnvelope = { scope: broadScope };
  const eventId = e.eventId ?? e.event_id;
  if (eventId !== undefined) out.eventId = eventId;
  if (e.type !== undefined) out.type = e.type;
  if (e.timestamp !== undefined) out.timestamp = e.timestamp;
  return out;
}
