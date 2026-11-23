import {
  applySightingToDetection,
  applyTriageToDetection,
  clearResolutionOnRevive,
  mergeDetectionTriage,
  shouldAutoResolveOnDisappearance,
  shouldAutoResolveScaOnDisappearance,
} from './lifecycle.util';

const now = new Date('2026-08-05T12:00:00Z');
const earlier = new Date('2026-01-02T03:04:05Z');

describe('applyTriageToDetection', () => {
  it('stamps triaged_at/by/by_type on a human status change', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'confirmed', userId: 'u1' },
      now,
    );
    expect(d.triagedAt).toEqual(now);
    expect(d.triagedBy).toBe('u1');
    expect(d.triagedByType).toBe('user');
  });

  it('marks an agent-assisted change as agent but keeps the human accountable', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      {
        status: 'ignored',
        userId: 'u1',
        agentToolCallId: 'call-1',
        dismissalReason: 'no sink',
      },
      now,
    );
    expect(d.triagedByType).toBe('agent');
    // The HITL flow is proposed by the agent and CONFIRMED by a person; the
    // person stays the accountable actor, exactly as the backfill reads it.
    expect(d.triagedBy).toBe('u1');
  });

  // The AI agent's own writes carry userId='system' — six read paths in this
  // service already read that marker as "the agent". Filing them as a user
  // would put the literal string 'system' in a VARCHAR(36) user id column and
  // contradict src/scripts/backfill-lifecycle.ts:actorType.
  it("files the agent's own userId='system' writes as agent with a null actor id", () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'system' },
      now,
    );
    expect(d.triagedByType).toBe('agent');
    expect(d.triagedBy).toBeNull();
  });

  it.each(['cron', ''])(
    'files the machine sentinel userId=%p as system with a null actor id',
    (userId) => {
      const d: Record<string, unknown> = {};
      applyTriageToDetection(d as never, { status: 'resolved', userId }, now);
      expect(d.triagedByType).toBe('system');
      expect(d.triagedBy).toBeNull();
    },
  );

  it('files an actor-less change as system', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(d as never, { status: 'resolved' }, now);
    expect(d.triagedByType).toBe('system');
    expect(d.triagedBy).toBeNull();
  });

  it("honours an explicit 'system' source override (the scan's auto-resolve)", () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(d as never, { status: 'resolved' }, now, 'system');
    expect(d.triagedByType).toBe('system');
    expect(d.triagedBy).toBeNull();
    expect(d.resolvedAt).toEqual(now);
    expect(d.triagedAt).toEqual(now);
  });

  it('stores the dismissal reason only for ignored', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'u1', dismissalReason: 'accepted risk' },
      now,
    );
    expect(d.dismissalReason).toBe('accepted risk');
  });

  it('clears the dismissal reason when leaving ignored', () => {
    const d: Record<string, unknown> = { dismissalReason: 'accepted risk' };
    applyTriageToDetection(
      d as never,
      { status: 'confirmed', userId: 'u1' },
      now,
    );
    expect(d.dismissalReason).toBeNull();
  });

  // `UpdateResultRequest` carries no `dismissalReason` until Phase C, so EVERY
  // triage that sets `ignored` today arrives without one. Blanking the column on
  // such a write would erase what task 5 reconstructed from history — and the
  // backfill's preserve-newer guard would then refuse to restore it, because the
  // stored triage is newer than the last reconstructable transition. That is
  // permanent evidence loss, and it makes Phase B unshippable without Phase C.
  it('preserves a stored dismissal reason when the SAME actor re-dismisses with none', () => {
    const d: Record<string, unknown> = {
      triagedBy: 'u1',
      triagedByType: 'user',
      dismissalReason: 'accepted risk',
    };
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'u1' },
      now,
    );
    expect(d.dismissalReason).toBe('accepted risk');
  });

  // The agent identifies itself by userId='system' and lands on triagedBy=null,
  // so "same actor" has to compare the RESOLVED actor, not the raw payload.
  it("preserves the agent's own stored reason when the agent re-dismisses", () => {
    const d: Record<string, unknown> = {
      triagedBy: null,
      triagedByType: 'agent',
      dismissalReason: 'no sink',
    };
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'system' },
      now,
    );
    expect(d.dismissalReason).toBe('no sink');
  });

  // A justification is evidence attached to ONE actor's decision. `triagedBy` /
  // `triagedByType` are overwritten by this same call, so a fallback keyed on
  // the status alone re-attributes a named human's written sentence to whoever
  // dismissed the finding next — a plausible-looking wrong value in an export
  // whose whole purpose is auditable evidence. A hole self-heals; this does not.
  it("does not lend a human's justification to the agent's verdict", () => {
    const d: Record<string, unknown> = {
      triagedBy: 'u1',
      triagedByType: 'user',
      dismissalReason: 'accepted risk — CFO signed off 2026-02-02',
    };
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'system' },
      now,
    );
    expect(d.triagedByType).toBe('agent');
    expect(d.triagedBy).toBeNull();
    expect(d.dismissalReason).toBeNull();
  });

  it("does not lend one person's justification to another person", () => {
    const d: Record<string, unknown> = {
      triagedBy: 'u1',
      triagedByType: 'user',
      dismissalReason: 'accepted risk',
    };
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'u2' },
      now,
    );
    expect(d.triagedBy).toBe('u2');
    expect(d.dismissalReason).toBeNull();
  });

  it('lets a supplied reason override the stored one (Phase C behaviour)', () => {
    const d: Record<string, unknown> = { dismissalReason: 'accepted risk' };
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'u1', dismissalReason: 'false positive' },
      now,
    );
    expect(d.dismissalReason).toBe('false positive');
  });

  it('reports null when an ignored triage has no reason on either side', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'ignored', userId: 'u1' },
      now,
    );
    expect(d.dismissalReason).toBeNull();
  });

  // The rule is "a dismissal reason attaches to `ignored` and to nothing else".
  // Without this test the `status === 'ignored'` condition can be deleted
  // outright and the whole suite stays green.
  it('never stores a dismissal reason supplied alongside a non-ignored status', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'confirmed', userId: 'u1', dismissalReason: 'accepted risk' },
      now,
    );
    expect(d.dismissalReason).toBeNull();
  });

  it('sets resolved_at on resolved and clears it on reopen', () => {
    const d: Record<string, unknown> = {};
    applyTriageToDetection(
      d as never,
      { status: 'resolved', userId: 'u1' },
      now,
    );
    expect(d.resolvedAt).toEqual(now);
    applyTriageToDetection(
      d as never,
      { status: 'to_verify', userId: 'u1' },
      now,
    );
    expect(d.resolvedAt).toBeNull();
  });

  it('does nothing when the payload carries no status', () => {
    const d: Record<string, unknown> = {
      triagedAt: null,
      triagedBy: null,
      triagedByType: null,
      resolvedAt: earlier,
      dismissalReason: 'accepted risk',
    };
    applyTriageToDetection(
      d as never,
      { priority: 'urgent', userId: 'u1' } as never,
      now,
    );
    expect(d.triagedAt).toBeNull();
    expect(d.triagedBy).toBeNull();
    expect(d.triagedByType).toBeNull();
    expect(d.resolvedAt).toBe(earlier);
    expect(d.dismissalReason).toBe('accepted risk');
  });

  it('treats the proto3 empty-string default as no status', () => {
    const d: Record<string, unknown> = { triagedAt: null };
    applyTriageToDetection(d as never, { status: '', userId: 'u1' }, now);
    expect(d.triagedAt).toBeNull();
  });

  it('never touches the detection timestamps', () => {
    const d: Record<string, unknown> = {
      firstDetectedAt: earlier,
      lastDetectedAt: earlier,
    };
    applyTriageToDetection(
      d as never,
      { status: 'confirmed', userId: 'u1' },
      now,
    );
    expect(d.firstDetectedAt).toBe(earlier);
    expect(d.lastDetectedAt).toBe(earlier);
  });
});

describe('applySightingToDetection', () => {
  it('moves last_detected_at forward and seeds first_detected_at once', () => {
    const d: Record<string, unknown> = {
      firstDetectedAt: null,
      lastDetectedAt: null,
    };
    applySightingToDetection(d as never, earlier);
    expect(d.firstDetectedAt).toBe(earlier);
    expect(d.lastDetectedAt).toBe(earlier);

    applySightingToDetection(d as never, now);
    expect(d.firstDetectedAt).toBe(earlier);
    expect(d.lastDetectedAt).toBe(now);
  });

  it('seeds first_detected_at when the column was never written (undefined)', () => {
    const d: Record<string, unknown> = {};
    applySightingToDetection(d as never, now);
    expect(d.firstDetectedAt).toBe(now);
    expect(d.lastDetectedAt).toBe(now);
  });

  it('never rewinds last_detected_at', () => {
    const d: Record<string, unknown> = {
      firstDetectedAt: earlier,
      lastDetectedAt: now,
    };
    applySightingToDetection(d as never, earlier);
    expect(d.lastDetectedAt).toBe(now);
  });

  // Task 5's backfill only ever ADDS evidence; a scan sighting must obey the
  // same rule — it says "still here", never "un-triaged".
  it('leaves every triage field untouched', () => {
    const d: Record<string, unknown> = {
      triagedAt: earlier,
      triagedBy: 'u1',
      triagedByType: 'user',
      resolvedAt: earlier,
      dismissalReason: 'accepted risk',
      firstDetectedAt: null,
      lastDetectedAt: null,
    };
    applySightingToDetection(d as never, now);
    expect(d.triagedAt).toBe(earlier);
    expect(d.triagedBy).toBe('u1');
    expect(d.triagedByType).toBe('user');
    expect(d.resolvedAt).toBe(earlier);
    expect(d.dismissalReason).toBe('accepted risk');
  });
});

// The line-drift repair DELETES one of the two rows it merges, and
// `history_item`'s detection FKs are ON DELETE CASCADE — so the decision and
// the rows the backfill would rebuild it from are destroyed together. These
// pin the rule that decides which decision stands; the merge is exercised
// through its production caller in sast-iac.fingerprint-ingestion.spec.ts.
describe('shouldAutoResolveOnDisappearance', () => {
  // The flag protects a decision against RE-EVALUATION. A disappearance
  // does not re-evaluate anything: closing a confirmed finding nobody detects
  // any more completes the confirm. Only a dismissal and a closed row stay put.
  it.each<[string, boolean, boolean]>([
    ['to_verify', false, true],
    ['confirmed', false, true],
    ['confirmed', true, true],
    ['ignored', true, false],
    // A dismissal the flag backfill could not prove (container rows with no
    // deliberate status_change) is still a dismissal: its reason must survive.
    ['ignored', false, false],
    ['resolved', true, false],
    ['resolved', false, false],
  ])(
    'a %s detection (stateManuallyModified=%p) auto-resolves: %p',
    (currentState, stateManuallyModified, expected) => {
      const detection = { currentState, stateManuallyModified };
      expect(shouldAutoResolveOnDisappearance(detection)).toBe(expected);
    },
  );
});

describe('shouldAutoResolveScaOnDisappearance', () => {
  it.each<[string, boolean, boolean]>([
    ['to_verify', false, true],
    // handleUpdateSca flags every status it applies, `to_verify` included.
    ['to_verify', true, true],
    ['confirmed', true, true],
    // The reachability auto-ignore is the scan's own verdict, written unflagged:
    // it closes with the package that produced it.
    ['ignored', false, true],
    ['ignored', true, false],
    ['resolved', true, false],
    ['resolved', false, false],
  ])(
    'a %s SCA detection (stateManuallyModified=%p) auto-resolves: %p',
    (currentState, stateManuallyModified, expected) => {
      const detection = { currentState, stateManuallyModified };
      expect(shouldAutoResolveScaOnDisappearance(detection)).toBe(expected);
    },
  );
});

describe('mergeDetectionTriage', () => {
  const decided = (over: Record<string, unknown> = {}) => ({
    currentState: 'ignored',
    stateManuallyModified: true,
    triagedAt: earlier,
    triagedBy: 'u1',
    triagedByType: 'user' as const,
    resolvedAt: null,
    dismissalReason: 'accepted risk',
    ...over,
  });

  const undecided = () => ({
    currentState: 'to_verify',
    stateManuallyModified: false,
    triagedAt: null,
    triagedBy: null,
    triagedByType: null,
    resolvedAt: null,
    dismissalReason: null,
  });

  it('adopts the whole decision of the deleted row, state included', () => {
    const survivor = undecided();
    expect(mergeDetectionTriage(survivor, decided())).toBe(true);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.stateManuallyModified).toBe(true);
    expect(survivor.triagedBy).toBe('u1');
    expect(survivor.dismissalReason).toBe('accepted risk');
  });

  it('is a no-op when the deleted row was never decided', () => {
    const survivor = decided();
    expect(mergeDetectionTriage(survivor, undecided())).toBe(false);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.dismissalReason).toBe('accepted risk');
  });

  it('never lets a machine stamp displace a person, however recent', () => {
    const survivor = decided();
    const machine = decided({
      currentState: 'resolved',
      stateManuallyModified: false,
      triagedAt: now,
      triagedBy: null,
      triagedByType: 'system',
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, machine)).toBe(false);
    expect(survivor.triagedByType).toBe('user');
    expect(survivor.dismissalReason).toBe('accepted risk');
  });

  it('lets a person displace a machine stamp, however old', () => {
    const survivor = decided({
      triagedAt: now,
      triagedBy: null,
      triagedByType: 'system',
      currentState: 'resolved',
      stateManuallyModified: false,
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, decided())).toBe(true);
    expect(survivor.triagedByType).toBe('user');
    expect(survivor.currentState).toBe('ignored');
  });

  // A tie or an undated rival keeps what is STORED: a degraded path must not
  // invent a winner.
  it.each([
    ['an undated decision', null],
    ['an equally-dated one', earlier],
  ])('keeps the stored decision against %s', (_label, theirDate) => {
    const survivor = decided();
    const rival = decided({
      triagedAt: theirDate,
      triagedBy: 'u2',
      dismissalReason: 'their reason',
    });
    expect(mergeDetectionTriage(survivor, rival)).toBe(false);
    expect(survivor.triagedBy).toBe('u1');
  });

  // The merge only ever runs on a finding the CURRENT scan has just seen — the
  // survivor is stamped with today's sighting three lines earlier. A machine
  // stamp says "the scan stopped seeing this", which that same scan has just
  // contradicted, so it carries nothing worth transferring. Adopting it wrote a
  // `resolved` state and a months-old `resolved_at` onto a live finding.
  it('never carries a machine stamp onto the survivor', () => {
    const survivor = undecided();
    const machine = {
      currentState: 'resolved',
      stateManuallyModified: false,
      triagedAt: now,
      triagedBy: null,
      triagedByType: 'system' as const,
      resolvedAt: now,
      dismissalReason: null,
    };
    expect(mergeDetectionTriage(survivor, machine)).toBe(false);
    expect(survivor.currentState).toBe('to_verify');
    expect(survivor.resolvedAt).toBeNull();
    expect(survivor.triagedByType).toBeNull();
  });

  // `markResolved` takes `new Date()` per detection, inside its loop, so two
  // rows closed by ONE auto-resolve pass differ by milliseconds. That ordering
  // accident must not decide anything.
  it('does not let one machine stamp displace another', () => {
    const survivor = {
      currentState: 'to_verify',
      stateManuallyModified: false,
      triagedAt: new Date('2026-03-03T10:00:00.000Z'),
      triagedBy: null,
      triagedByType: 'system' as const,
      resolvedAt: null,
      dismissalReason: null,
    };
    const machineLater = {
      currentState: 'resolved',
      stateManuallyModified: false,
      triagedAt: new Date('2026-03-03T10:00:00.500Z'),
      triagedBy: null,
      triagedByType: 'system' as const,
      resolvedAt: new Date('2026-03-03T10:00:00.500Z'),
      dismissalReason: null,
    };
    expect(mergeDetectionTriage(survivor, machineLater)).toBe(false);
    expect(survivor.currentState).toBe('to_verify');
    expect(survivor.resolvedAt).toBeNull();
  });

  // Two legacy rows from before the lifecycle columns: neither carries a
  // decision, so the closed state of the deleted one is not evidence of
  // anything and must not close the row the scan just saw.
  it('is a no-op between two undecided rows even when the deleted one is closed', () => {
    const survivor = undecided();
    const legacyClosed = { ...undecided(), currentState: 'resolved' };
    expect(mergeDetectionTriage(survivor, legacyClosed)).toBe(false);
    expect(survivor.currentState).toBe('to_verify');
  });

  // Same rule, same reason, as the `sameActor` fallback in
  // `applyTriageToDetection`: Phase B puts no `dismissalReason` on the wire, so
  // every live dismissal lands NULL and the only rows carrying a reason are the
  // ones `backfill-lifecycle.ts` reconstructed. Clearing one here destroys it —
  // the discarded row's `history_item` rows cascade away with it, and the
  // backfill's preserve-newer guard then refuses to write it back.
  it("keeps the survivor's justification when the same actor re-dismisses without one", () => {
    const survivor = decided();
    const sameActorLater = decided({
      triagedAt: now,
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, sameActorLater)).toBe(true);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.triagedAt).toEqual(now);
    expect(survivor.dismissalReason).toBe('accepted risk');
  });

  it('does not lend a justification to a different actor across a merge', () => {
    const survivor = decided();
    const otherActorLater = decided({
      triagedAt: now,
      triagedBy: 'u2',
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, otherActorLater)).toBe(true);
    expect(survivor.triagedBy).toBe('u2');
    expect(survivor.dismissalReason).toBeNull();
  });

  it('drops the justification when the same actor leaves ignored', () => {
    const survivor = decided();
    const sameActorConfirms = decided({
      currentState: 'confirmed',
      triagedAt: now,
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, sameActorConfirms)).toBe(true);
    expect(survivor.currentState).toBe('confirmed');
    expect(survivor.dismissalReason).toBeNull();
  });

  // The freeze flag alone marks an explicit user/agent decision, so a row frozen
  // before the lifecycle columns existed must still outrank a machine stamp.
  it('treats a frozen row with no lifecycle stamps as a person decision', () => {
    const survivor = decided({
      triagedAt: now,
      triagedByType: 'system',
      triagedBy: null,
      dismissalReason: null,
      currentState: 'resolved',
      stateManuallyModified: false,
    });
    const legacy = {
      currentState: 'ignored',
      stateManuallyModified: true,
      triagedAt: null,
      triagedBy: null,
      triagedByType: null,
      resolvedAt: null,
      dismissalReason: null,
    };
    expect(mergeDetectionTriage(survivor, legacy)).toBe(true);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.stateManuallyModified).toBe(true);
    expect(survivor.triagedAt).toBeNull();
  });

  // ── a person's dismissal against a verdict the agent reached alone ──
  // The agent analyses a duplicate row as a brand-new finding, blind to the
  // dismissal on its twin. Its later verdict won the merge and flipped a
  // person's `ignored` to `confirmed`.
  // Only a dismissal is protected: every other state keeps "later wins".
  const agentAlone = (over: Record<string, unknown> = {}) =>
    decided({
      currentState: 'confirmed',
      triagedAt: now,
      triagedBy: null,
      triagedByType: 'agent',
      dismissalReason: null,
      ...over,
    });

  it.each([
    ['confirmed', null],
    ['ignored', 'agent verdict: not exploitable'],
  ])(
    "keeps a person's dismissal against a later %s the agent reached alone",
    (state, reason) => {
      const survivor = decided();
      const verdict = agentAlone({
        currentState: state,
        dismissalReason: reason,
      });
      expect(mergeDetectionTriage(survivor, verdict)).toBe(false);
      expect(survivor.currentState).toBe('ignored');
      expect(survivor.triagedBy).toBe('u1');
      expect(survivor.triagedByType).toBe('user');
      expect(survivor.dismissalReason).toBe('accepted risk');
    },
  );

  it("adopts a person's dismissal over a later verdict the agent reached alone", () => {
    const survivor = agentAlone();
    expect(mergeDetectionTriage(survivor, decided())).toBe(true);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.triagedBy).toBe('u1');
    expect(survivor.triagedByType).toBe('user');
    expect(survivor.triagedAt).toBe(earlier);
    expect(survivor.dismissalReason).toBe('accepted risk');
  });

  // A chat write the person approved names them as the accountable actor: it
  // is their decision, relayed by the agent.
  it('counts a dismissal a person approved in the chat as theirs', () => {
    const survivor = decided({ triagedByType: 'agent' });
    expect(mergeDetectionTriage(survivor, agentAlone())).toBe(false);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.triagedBy).toBe('u1');
  });

  // An unattributed frozen row counts as a person's decision (see the test
  // above), so its dismissal is protected the same way.
  it('protects a legacy frozen dismissal that has no lifecycle stamps', () => {
    const legacy = {
      ...undecided(),
      currentState: 'ignored',
      stateManuallyModified: true,
    };
    expect(mergeDetectionTriage(legacy, agentAlone())).toBe(false);
    expect(legacy.currentState).toBe('ignored');
  });

  it("still lets a later person's decision replace a person's dismissal", () => {
    const survivor = decided();
    const later = decided({
      currentState: 'confirmed',
      triagedAt: now,
      triagedBy: 'u2',
      dismissalReason: null,
    });
    expect(mergeDetectionTriage(survivor, later)).toBe(true);
    expect(survivor.currentState).toBe('confirmed');
    expect(survivor.triagedBy).toBe('u2');
  });

  it("lets a later verdict the agent reached alone replace a person's confirm", () => {
    const survivor = decided({
      currentState: 'confirmed',
      dismissalReason: null,
    });
    const verdict = agentAlone({
      currentState: 'ignored',
      dismissalReason: 'agent verdict: not exploitable',
    });
    expect(mergeDetectionTriage(survivor, verdict)).toBe(true);
    expect(survivor.currentState).toBe('ignored');
    expect(survivor.triagedByType).toBe('agent');
  });

  it("lets a later verdict replace the agent's own earlier dismissal", () => {
    const survivor = agentAlone({
      currentState: 'ignored',
      triagedAt: earlier,
      dismissalReason: 'agent verdict: not exploitable',
    });
    expect(mergeDetectionTriage(survivor, agentAlone())).toBe(true);
    expect(survivor.currentState).toBe('confirmed');
  });
});

describe('clearResolutionOnRevive', () => {
  it('drops resolved_at once the row is open again', () => {
    const d: Record<string, unknown> = {
      currentState: 'to_verify',
      resolvedAt: earlier,
    };
    clearResolutionOnRevive(d as never);
    expect(d.resolvedAt).toBeNull();
  });

  it('keeps resolved_at while the row is still resolved', () => {
    const d: Record<string, unknown> = {
      currentState: 'resolved',
      resolvedAt: earlier,
    };
    clearResolutionOnRevive(d as never);
    expect(d.resolvedAt).toBe(earlier);
  });

  it('does not re-attribute the triage', () => {
    const d: Record<string, unknown> = {
      currentState: 'to_verify',
      resolvedAt: earlier,
      triagedAt: earlier,
      triagedBy: 'u1',
      triagedByType: 'user',
    };
    clearResolutionOnRevive(d as never);
    expect(d.triagedAt).toBe(earlier);
    expect(d.triagedBy).toBe('u1');
    expect(d.triagedByType).toBe('user');
  });
});
