import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';

import {
  HistorySource,
  resolveHistorySource,
} from '../result/agent-audit.helper';

/**
 * GRC lifecycle stamps — the single write-path rule for the six detection
 * families (see migration 1809000002000 and src/scripts/backfill-lifecycle.ts).
 *
 * WHY ONE FUNCTION. `handleUpdateSast/Iac/Cicd/Secret/Sca/Container` are six
 * near-identical handlers in three files. A rule copied six times drifts five
 * ways; the export then reports a different lifecycle depending on which
 * scanner found the finding, which is exactly the inconsistency an auditor
 * probes. Everything below lives here and is called, never re-implemented.
 *
 * WHY IT MUST AGREE WITH THE BACKFILL. `backfill-lifecycle.ts` reconstructs the
 * same five columns from `history_item`. If this path classified an actor
 * differently from that script, a re-run of the backfill would fight the live
 * writes row by row. The actor rules below are therefore the same rules, in the
 * same order, expressed on the update payload instead of a history row — and
 * the discriminator they read (`HistorySource`) is produced by the very helper
 * that stamps the accompanying `history_item.source`.
 */

/** Detection columns this module writes on a triage. */
export interface LifecycleBearing {
  triagedAt: Date | null;
  triagedBy: string | null;
  triagedByType: 'user' | 'agent' | 'system' | null;
  resolvedAt: Date | null;
  dismissalReason: string | null;
}

/** Detection columns this module writes when a scan sees the finding. */
export interface SightingBearing {
  firstDetectedAt: Date | null;
  lastDetectedAt: Date | null;
}

/**
 * The subset of `UpdateResultRequest` a triage decision depends on.
 * `dismissalReason` is not on the wire yet — Phase C adds it and makes it
 * mandatory on `ignored`; until then it simply arrives undefined.
 */
export interface TriagePayload {
  status?: string;
  userId?: string;
  dismissalReason?: string;
  agentToolCallId?: string;
  agentConversationId?: string;
  agentStreamId?: string;
}

/**
 * User ids that name a machine rather than a person. Same set as
 * `agent-audit.helper.ts` (`SYSTEM_USER_IDS`) and `backfill-lifecycle.ts`.
 */
const SYSTEM_USER_IDS = new Set(['system', 'cron', '']);

/**
 * `userId = 'system'` is the AI AGENT's marker, not "a machine in general" —
 * `result.service.ts` (getAgentActivityCounts), `sast-iac.mapper.ts`,
 * `sca.mapper.ts` and `grouped-vulnerability.service.ts` all read it that way.
 * The machine that is NOT the agent (the scan's auto-resolve, the cron) carries
 * no userId at all.
 */
const AGENT_USER_ID = 'system';

function isSystemUserId(userId: string | null | undefined): boolean {
  return userId === null || userId === undefined || SYSTEM_USER_IDS.has(userId);
}

/**
 * Who performed the transition. Mirrors `backfill-lifecycle.ts:actorType`,
 * including its order: `resolveHistorySource` maps a sentinel userId onto
 * `source = 'system'`, so an agent write reads `userId='system',
 * source='system'` and the userId test HAS to run first or every agent verdict
 * is filed as a machine action.
 */
export function triageActorType(
  userId: string | undefined,
  source: HistorySource,
): 'user' | 'agent' | 'system' {
  if (userId === AGENT_USER_ID) return 'agent';
  if (source === 'chat_agent_assisted') return 'agent';
  if (source === 'system') return 'system';
  if (isSystemUserId(userId)) return 'system';
  return 'user';
}

/**
 * The id to attribute the transition to, or null when the actor is not a
 * person. `'system'` classifies as the AGENT above but still identifies
 * nobody, so it must never reach `triaged_by` (a VARCHAR(36) user id).
 * Mirrors `backfill-lifecycle.ts:actorId`.
 */
export function triageActorId(userId: string | undefined): string | null {
  return isSystemUserId(userId) ? null : userId;
}

/**
 * A finding may only be dismissed with a justification.
 *
 * WHY THIS EXISTS ALONGSIDE THE GATEWAY DTO, not instead of it. The DTO gives an
 * HTTP caller a clean 400. It is NOT the control: the async batch job rebuilds
 * each `UpdateResultRequest` from queue data and never constructs the DTO, and
 * neither does mcp-service or any future gRPC caller. A validation that only
 * exists at the edge is not a control — this repo's own rule.
 *
 * Blank counts as absent. `''` is both what the gateway sends for an unset
 * optional string and the proto3 default for the field, and whitespace is what a
 * client sends to satisfy a required field without saying anything; neither is a
 * justification an auditor can read.
 *
 * Call it BEFORE any mutation in the handler: a half-applied dismissal would
 * leave the row changed and the caller told it failed.
 *
 * @throws RpcException INVALID_ARGUMENT when the transition is a dismissal with
 *   no readable reason. Every other status is untouched — requiring a reason to
 *   resolve or confirm would make every triage in the product need one.
 */
export function assertDismissalReason(dto: TriagePayload): void {
  if (dto.status !== 'ignored') return;
  if (dto.dismissalReason && dto.dismissalReason.trim()) return;
  throw new RpcException({
    code: GrpcStatus.INVALID_ARGUMENT,
    message: 'dismissalReason is required when status is "ignored"',
  });
}

/**
 * Stamp a triage decision onto a detection.
 *
 * A payload without a status leaves every field untouched: a priority-only or
 * comment-only update is not a triage, and `status` arrives as the proto3
 * empty-string default when the caller sent none.
 *
 * @param detection - the row being updated, mutated in place.
 * @param dto - the update payload (any `UpdateResultRequest` fits).
 * @param now - the handler's clock. Passed in, never read from `new Date()`
 *   here, so the detection stamp and the `history_item.date` written for the
 *   same decision are the SAME instant — `backfill-lifecycle.ts` joins those
 *   two on equality to the second.
 * @param sourceOverride - as in `applyAgentAuditFields`: `'system'` for the
 *   scan's auto-resolve, which has no actor at all.
 */
export function applyTriageToDetection(
  detection: LifecycleBearing,
  dto: TriagePayload,
  now: Date,
  sourceOverride?: HistorySource,
): void {
  if (!dto.status) return;

  const source = resolveHistorySource(dto, sourceOverride);
  const actorId = triageActorId(dto.userId);
  const actorType = triageActorType(dto.userId, source);

  // Computed BEFORE the three assignments below overwrite the stored actor.
  // A justification is evidence attached to ONE actor's decision, so the
  // fallback further down may only fire when this write is the SAME actor
  // deciding again — the common no-op re-save. Compare the RESOLVED actor, not
  // the raw payload: the agent arrives as `userId='system'` and lands on
  // `triagedBy = null`, so a raw comparison would never match its own row.
  const sameActor =
    detection.triagedBy === actorId && detection.triagedByType === actorType;

  detection.triagedAt = now;
  detection.triagedBy = actorId;
  detection.triagedByType = actorType;

  detection.resolvedAt = dto.status === 'resolved' ? now : null;
  // The SAME actor entering or staying `ignored` without a supplied reason
  // PRESERVES what is stored; leaving `ignored` still clears it, and so does a
  // DIFFERENT actor dismissing the finding with no justification of their own.
  //
  // WHY THE FALLBACK EXISTS. `UpdateResultRequest` carries no `dismissalReason`
  // until Phase C, so today EVERY `ignored` triage arrives without one. Writing
  // NULL on those would erase exactly the values `backfill-lifecycle.ts`
  // reconstructed from `history_item`, and its preserve-newer guard
  // (`decideTriageWrite`) would then refuse to restore them — the stored triage
  // is newer than the last reconstructable transition. That is permanent
  // evidence loss, and it would make this phase depend on Phase C shipping in
  // the same release. Once Phase C makes the field mandatory the payload always
  // carries one, the fallback is unreachable for new writes, and the behaviour
  // is unchanged.
  //
  // WHY IT IS GATED ON THE ACTOR. Without that gate the AI agent filing a
  // false-positive verdict (which maps to `ignored`) inherits the sentence a
  // named human wrote — while this very call erases that human from
  // `triaged_by`. The export would then read "dismissed by the AI agent,
  // justification: accepted risk — CFO signed off", which is a fabricated
  // attribution. A hole self-heals on the next write and is visibly a hole; a
  // plausible-looking wrong value does not.
  const preserved = sameActor ? (detection.dismissalReason ?? null) : null;
  detection.dismissalReason =
    dto.status === 'ignored' ? (dto.dismissalReason ?? preserved) : null;
}

/**
 * Record that a scan saw this finding.
 *
 * Deliberately narrow: it moves `last_detected_at` forward and seeds
 * `first_detected_at` exactly once. It never resets a triage — task 5's
 * backfill only ever ADDS evidence and this path holds the same line. Without
 * `last_detected_at` a GRC platform cannot tell "fixed" from "not scanned in
 * three months", which is the ambiguity the export exists to remove.
 *
 * @param detection - the row being re-detected, mutated in place.
 * @param now - the ingestion clock, shared with the detection-history row.
 */
export function applySightingToDetection(
  detection: SightingBearing,
  now: Date,
): void {
  if (!detection.firstDetectedAt) {
    detection.firstDetectedAt = now;
  }
  if (!detection.lastDetectedAt || detection.lastDetectedAt < now) {
    detection.lastDetectedAt = now;
  }
}

/**
 * States that must NOT be auto-resolved when a finding disappears from a
 * re-scan: `ignored` is an explicit decision and `resolved` is already closed
 * (same muted-state convention as the closed reanalysis's MUTED_STATES).
 * Only ACTIVE detections (`to_verify` / `confirmed`) auto-resolve.
 */
const MUTED_STATES = ['ignored', 'resolved'];

/**
 * Whether the scan may close this finding on its own.
 *
 * Lives here rather than next to any one scanner because the auto-resolve is
 * now a LIFECYCLE write: since the GRC columns landed it does not merely change
 * `currentState`, it overwrites `triaged_by`, `triaged_by_type` and
 * `dismissal_reason` with the machine's own. One predicate, every family.
 *
 * WHY `stateManuallyModified` IS NOT READ HERE. The flag protects a
 * user/agent decision against RE-EVALUATION: a code change must not send a
 * `confirmed` finding back to `to_verify`, and that freeze stays where the
 * re-detection paths apply it. A disappearance re-evaluates nothing. Closing a
 * `confirmed` finding the scan no longer reports completes the decision instead
 * of contradicting it. Gating it on the flag left fixed findings open: GitHub
 * Actions pinned by SHA and images given a digest stayed `confirmed` once the
 * scan stopped reporting them.
 * The confirm stays readable: the person's `status_change` row is kept, and the
 * resolution is stamped as the machine's.
 *
 * A dismissal is the opposite case: its reason and actor would be overwritten,
 * and container keeps that reason nowhere else. So `ignored` is left alone
 * whether or not the flag was ever set, since the flag backfill could not prove
 * every container dismissal.
 */
export function shouldAutoResolveOnDisappearance(detection: {
  currentState: string;
}): boolean {
  return !MUTED_STATES.includes(detection.currentState);
}

/**
 * SCA's gate: {@link shouldAutoResolveOnDisappearance} with one exception.
 *
 * SCA is the one family where the SCAN files `ignored` itself: the reachability
 * auto-ignore of an `unused` package, written without the freeze flag. That
 * verdict closes with the package that produced it, as it always has. A
 * dismissal a person or the agent filed goes through `handleUpdateSca`, which
 * flags every status it applies, so it is left alone as in every other family.
 */
export function shouldAutoResolveScaOnDisappearance(detection: {
  currentState: string;
  stateManuallyModified?: boolean;
}): boolean {
  if (detection.currentState === 'ignored') {
    return !detection.stateManuallyModified;
  }
  return shouldAutoResolveOnDisappearance(detection);
}

/** The triage a merge has to reconcile: the lifecycle stamps plus the state they explain. */
export interface TriageBearing extends LifecycleBearing {
  currentState?: string;
  stateManuallyModified?: boolean;
}

/**
 * How strongly a row claims to carry the finding's current decision.
 *
 * 0 — nobody ever decided anything about this row.
 * 1 — a MACHINE decided (the scan's auto-resolve, the cron).
 * 2 — a PERSON or the agent decided. A row frozen by the freeze flag with no
 *     `triaged_by_type` yet (legacy, or backfilled flag-first) also lands here:
 *     the flag exists precisely to mark an explicit user/agent decision.
 */
function triageAuthority(detection: TriageBearing): 0 | 1 | 2 {
  const decided =
    Boolean(detection.stateManuallyModified) ||
    detection.triagedAt != null ||
    detection.triagedBy != null ||
    detection.triagedByType != null ||
    detection.dismissalReason != null;
  if (!decided) return 0;
  return detection.triagedByType === 'system' ? 1 : 2;
}

/**
 * A verdict the AI agent reached on its own: filed as the agent with nobody
 * accountable in `triaged_by`. A chat write a person approved names that
 * person there, so it is their decision relayed by the agent.
 */
function isAgentAloneVerdict(detection: TriageBearing): boolean {
  return detection.triagedByType === 'agent' && detection.triagedBy == null;
}

/**
 * An `ignored` a person decided. An unattributed frozen row counts, like
 * everywhere in {@link triageAuthority}.
 */
function isPersonDismissal(detection: TriageBearing): boolean {
  return (
    detection.currentState === 'ignored' &&
    triageAuthority(detection) === 2 &&
    !isAgentAloneVerdict(detection)
  );
}

/**
 * Reconcile the triage of two rows that describe ONE finding, keeping the
 * decided side. The survivor is mutated in place; the other row is about to be
 * deleted.
 *
 * WHY THIS EXISTS. `sast-iac.utils.ts`'s line-drift repair merges two
 * detections and then DELETES one of them, choosing the survivor purely by
 * `createdAt` — and `areVulnsSimilar` filters on type/rule/path/snippet with no
 * state filter at all, so an `ignored`, frozen detection is a legal merge
 * candidate. `history_item`'s six detection FKs are ON DELETE CASCADE, so that
 * delete takes the `status_change` row AND the `comment` row
 * `backfill-lifecycle.ts` reconstructs `dismissal_reason` from: the evidence
 * and its only recovery source go together. Nothing can restore it afterwards.
 *
 * THE RULE, in order:
 *
 * 1. Only a PERSON's or the agent's decision transfers (authority 2). A row
 *    nobody decided anything about carries nothing, and neither does a MACHINE
 *    stamp — see below, this is the load-bearing half of the rule.
 * 2. A PERSON's `ignored` is settled only by a person. A verdict the agent
 *    reached alone never displaces one and never survives against one,
 *    whatever the dates: the agent analyses a duplicate row as a brand-new
 *    finding, blind to the dismissal on its twin, so being later proves
 *    nothing. Adopting it flipped a person's `ignored` to the agent's
 *    `confirmed` and dropped the justification. Only a dismissal is
 *    protected, as a scan never undoes one either (`shouldAutoResolveOnDisappearance`); other states follow rule 3.
 * 3. At equal authority the LATER `triaged_at` stands. An undated decision
 *    never displaces a dated one, and a tie keeps what is STORED rather than
 *    guessing — the degraded path must not invent a winner.
 *
 * WHY A MACHINE STAMP CARRIES NOTHING HERE, not even against an undecided row.
 * This merge runs ONLY on a finding the current scan has just seen: one of the
 * two rows has a detection-history row for this scan, and `updateAndRemove`
 * stamps the survivor with today's sighting three lines before calling us. A
 * machine stamp says exactly one thing — "a scan stopped seeing this finding
 * and closed it" — which the scan performing the merge has just contradicted.
 * Adopting it wrote `current_state = 'resolved'` and a months-old `resolved_at`
 * onto a row whose `last_detected_at` is today: a record that contradicts
 * itself in the one dimension this export exists to disambiguate, reached with
 * no human triage anywhere in the sequence. It also removed the millisecond
 * lottery between two rows closed by one `markResolved` pass (which takes
 * `new Date()` per detection) from deciding anything. The survivor's own scan
 * evidence is fresher than any machine verdict on the row being deleted, by
 * construction.
 *
 * Adoption is otherwise wholesale: a decision is a state, an actor, a date and
 * a justification together, and splitting them is what produces the fabricated
 * attributions this feature keeps paying for. The single exception is the
 * `dismissal_reason` fallback below, which mirrors `applyTriageToDetection`.
 *
 * @param survivor - the row that stays, mutated in place.
 * @param discarded - the row about to be deleted.
 * @returns whether the survivor adopted the discarded row's decision.
 */
export function mergeDetectionTriage(
  survivor: TriageBearing,
  discarded: TriageBearing,
): boolean {
  const discardedRank = triageAuthority(discarded);
  if (discardedRank < 2) return false;

  // Rule 2: a person's dismissal against a verdict the agent reached alone.
  if (isPersonDismissal(survivor) && isAgentAloneVerdict(discarded)) {
    return false;
  }
  const dismissalOverAgent =
    isPersonDismissal(discarded) && isAgentAloneVerdict(survivor);

  const survivorRank = triageAuthority(survivor);
  if (!dismissalOverAgent && discardedRank === survivorRank) {
    const theirs = discarded.triagedAt ? discarded.triagedAt.getTime() : null;
    const ours = survivor.triagedAt ? survivor.triagedAt.getTime() : null;
    if (ours !== null && (theirs === null || theirs <= ours)) return false;
  }

  // The SAME actor whose decision is being adopted, staying `ignored` with no
  // justification of their own, keeps the stored one. Identical rule and
  // identical reason to the fallback in `applyTriageToDetection`: Phase B puts
  // no `dismissalReason` on the wire, so every live dismissal lands NULL and the
  // only rows carrying a reason are the ones `backfill-lifecycle.ts`
  // reconstructed from `history_item`. Clearing one here is permanent — the
  // discarded row's history rows cascade away with it, and the backfill's
  // preserve-newer guard then refuses to write the reason back, because the
  // stored `triaged_at` we are about to move forward is newer than the last
  // reconstructable transition.
  //
  // Gated on the actor for the same reason as there: a justification is
  // evidence attached to ONE person's decision. Lending it to whoever decided
  // last would export "dismissed by u2, justification: <what u1 wrote>", a
  // fabricated attribution. A hole self-heals and is visibly a hole.
  const sameActor =
    survivor.triagedBy === (discarded.triagedBy ?? null) &&
    survivor.triagedByType === (discarded.triagedByType ?? null);
  const preserved = sameActor ? (survivor.dismissalReason ?? null) : null;

  if (discarded.currentState !== undefined) {
    survivor.currentState = discarded.currentState;
  }
  survivor.stateManuallyModified = Boolean(discarded.stateManuallyModified);
  survivor.triagedAt = discarded.triagedAt ?? null;
  survivor.triagedBy = discarded.triagedBy ?? null;
  survivor.triagedByType = discarded.triagedByType ?? null;
  survivor.resolvedAt = discarded.resolvedAt ?? null;
  survivor.dismissalReason =
    discarded.dismissalReason ??
    (discarded.currentState === 'ignored' ? preserved : null);
  return true;
}

/**
 * A re-detected finding that has just been reopened no longer has a resolution
 * date. Called at the revive sites, AFTER `currentState` has been reassigned —
 * the guard reads the new state so a row that stayed `resolved` keeps its
 * timestamp.
 *
 * This is not a triage: `triaged_at/by/by_type` are untouched, because nobody
 * decided anything. Only the contradiction is removed — a `to_verify` row
 * carrying a `resolved_at` reads, in an export, as a fixed finding that is
 * somehow still open.
 */
export function clearResolutionOnRevive(
  detection: Pick<LifecycleBearing, 'resolvedAt'> & { currentState?: string },
): void {
  if (detection.currentState === 'resolved') return;
  detection.resolvedAt = null;
}
