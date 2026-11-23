import { resolveChannels } from "../channel-router";
import {
  BROAD_SCOPE_CHANNEL_PREFIXES,
  BROAD_SCOPE_PAYLOAD_TYPES,
  REALTIME_EVENT_TYPES,
  isBroadScopeChannel,
} from "../event-types";

/**
 * Inventory of the event types that reach an organisation or team channel.
 *
 * Those channels are streamed by the gateway to anyone with `read` (or
 * `manage`) on the organisation / team, which does not grant read on each of
 * its projects. The gateway therefore forwards a project event there as an
 * invalidation only (`toBroadScopeEnvelope` in gateway-service
 * `modules/realtime/broad-scope-envelope.ts`): no projectId, scanId, nor
 * payload. Only the types of BROAD_SCOPE_PAYLOAD_TYPES keep their payload
 * there (and only while their scope names no project); every other type is
 * reduced whatever its scope says. A type newly routed to such a channel
 * fails this spec until it is classified below.
 */
const FULL_SCOPE = {
  organizationId: "o",
  projectId: "p",
  teamId: "t",
  userId: "u",
  vulnerabilityId: "v",
  jobId: "j",
};
const SCOPES = [
  FULL_SCOPE,
  { organizationId: "o" },
  { organizationId: "o", teamId: "t" },
  { organizationId: "o", projectId: "p" },
];

/** Reach an org / team channel and are reduced to an invalidation there. */
const STRIPPED_ON_BROAD_CHANNELS = [
  "POLICY_EVALUATION_COMPLETED",
  "PROJECT_STATE_CHANGED",
  "SCAN_STATUS_CHANGED",
  "STATS_AGGREGATE_CHANGED",
  "VULNERABILITY_BATCH_APPENDED",
  // A closed product's usage on the organisation's billing stream: the
  // dashboard only reads the usage again through the gateway, and a member
  // of the billing stream may not hold that product.
  "VIBEDEFEND_USAGE_UPDATED",
  "ZERO_DAY_DETECTED",
];

const reachesBroadChannel = (type: string) =>
  SCOPES.some((scope) =>
    resolveChannels({ type, scope }).some(isBroadScopeChannel),
  );

describe("REALTIME_EVENT_TYPES", () => {
  it("every listed type is routed by resolveChannels with a full scope", () => {
    for (const type of REALTIME_EVENT_TYPES) {
      expect({
        type,
        channels: resolveChannels({ type, scope: FULL_SCOPE }),
      }).toEqual({
        type,
        channels: expect.arrayContaining([expect.any(String)]),
      });
    }
  });

  it("an unknown type is routed nowhere", () => {
    expect(resolveChannels({ type: "NOT_A_TYPE", scope: FULL_SCOPE })).toEqual(
      [],
    );
  });

  it("lists each type once", () => {
    expect(new Set(REALTIME_EVENT_TYPES).size).toBe(
      REALTIME_EVENT_TYPES.length,
    );
  });
});

describe("isBroadScopeChannel", () => {
  it("pins the organisation / team channel prefixes", () => {
    expect([...BROAD_SCOPE_CHANNEL_PREFIXES]).toEqual([
      "cybe:event:org:",
      "cybe:event:team:",
      "cybe:event:billing:org:",
    ]);
  });

  it("matches organisation, team and org-billing channels only", () => {
    expect(isBroadScopeChannel("cybe:event:org:o:projects")).toBe(true);
    expect(isBroadScopeChannel("cybe:event:team:t:reports")).toBe(true);
    expect(isBroadScopeChannel("cybe:event:billing:org:o")).toBe(true);
    expect(isBroadScopeChannel("cybe:event:project:p:issues")).toBe(false);
    expect(isBroadScopeChannel("cybe:event:job:j")).toBe(false);
    expect(isBroadScopeChannel("cybe:event:membership")).toBe(false);
  });
});

describe("resolveChannels — organisation / team fan-out inventory", () => {
  it("pins the payload allowlist", () => {
    expect([...BROAD_SCOPE_PAYLOAD_TYPES].sort()).toEqual([
      "AGGREGATED_REPORT_READY",
      "MEMBERSHIP_CHANGED",
      "SUBSCRIPTION_CHANGED",
      "TRIAL_UPDATED",
      "USAGE_UPDATED",
    ]);
  });

  it("every type reaching an org / team channel is either allowlisted or stripped, never both", () => {
    const reaching = REALTIME_EVENT_TYPES.filter(reachesBroadChannel);
    expect([...reaching].sort()).toEqual(
      [...BROAD_SCOPE_PAYLOAD_TYPES, ...STRIPPED_ON_BROAD_CHANNELS].sort(),
    );
    for (const type of BROAD_SCOPE_PAYLOAD_TYPES) {
      expect(STRIPPED_ON_BROAD_CHANNELS).not.toContain(type);
    }
  });

  it("a project event never keeps its payload on an org / team channel", () => {
    for (const type of REALTIME_EVENT_TYPES.filter(reachesBroadChannel)) {
      const projectEvent = resolveChannels({ type, scope: FULL_SCOPE }).some(
        (c) => c.startsWith("cybe:event:project:"),
      );
      if (projectEvent) {
        expect({
          type,
          allowlisted: BROAD_SCOPE_PAYLOAD_TYPES.includes(type),
        }).toEqual({ type, allowlisted: false });
      }
    }
  });

  it("no project-only type reaches an organisation or team channel", () => {
    const projectOnly = REALTIME_EVENT_TYPES.filter(
      (type) => !reachesBroadChannel(type),
    );
    expect([...projectOnly].sort()).toEqual([
      "AGENT_STEP_CHANGED",
      "ASYNC_TASK_COMPLETED",
      "ASYNC_TASK_PROGRESS",
      "REPORT_READY",
      "SCAN_PIPELINE_CHANGED",
      "VULNERABILITY_UPDATED",
    ]);
  });
});
