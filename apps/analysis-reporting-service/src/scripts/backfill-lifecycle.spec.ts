import {
  clampNotBefore,
  computeDetectionBounds,
  decideTriageWrite,
  floorSqlTimestamp,
  formatSqlTimestamp,
  mergeDetectionBounds,
  parseSqlTimestamp,
  resolveTriageFromHistory,
  snapUtcOffsetSeconds,
} from './backfill-lifecycle';

const at = (s: string) => new Date(s);

describe('resolveTriageFromHistory', () => {
  it('returns all-null for a detection that was never triaged', () => {
    expect(resolveTriageFromHistory([])).toEqual({
      triagedAt: null,
      triagedBy: null,
      triagedByType: null,
      resolvedAt: null,
      dismissalReason: null,
      ambiguousComment: false,
      ambiguousTransition: false,
    });
  });

  it('takes the most recent status_change as the triage', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-01-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u2',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.triagedAt).toEqual(at('2026-02-01T10:00:00Z'));
    expect(out.triagedBy).toBe('u2');
    expect(out.triagedByType).toBe('user');
  });

  it('ignores non status_change rows when picking the transition', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-01-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      // Later in time, but a priority change is not a triage.
      {
        type: 'priority_change',
        value: 'urgent',
        date: at('2026-05-01T10:00:00Z'),
        userId: 'u9',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.triagedAt).toEqual(at('2026-01-01T10:00:00Z'));
    expect(out.triagedBy).toBe('u1');
  });

  it('classifies a null userId as system, not as an unknown user', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'resolved',
        date: at('2026-03-01T10:00:00Z'),
        userId: null,
        source: null,
      },
    ]);
    expect(out.triagedByType).toBe('system');
    expect(out.triagedBy).toBeNull();
  });

  // `userId = 'system'` is the AI agent's marker, not "the machine in
  // general": `result.service.ts` counts `userId='system' AND
  // type='status_change' AND value='ignored'` as the AGENT's false-positive
  // verdicts, and four mappers repeat "<the agent> creates history items with
  // userId = 'system'". It must classify as `agent`.
  // It is still not a user id, so `triaged_by` stays NULL
  // (`agent-audit.helper.ts` SYSTEM_USER_IDS = {'system','cron',''}).
  it("treats the literal userId 'system' as the AI agent, not the system", () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-03-01T10:00:00Z'),
        userId: 'system',
        source: 'system',
      },
    ]);
    expect(out.triagedByType).toBe('agent');
    expect(out.triagedBy).toBeNull();
  });

  // The agent's rows predate the `source` column: 51 of the 85 local
  // `status_change` rows with `userId='system'` carry `source = NULL`.
  it("treats userId 'system' with no source as the AI agent", () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-03-01T10:00:00Z'),
        userId: 'system',
        source: null,
      },
    ]);
    expect(out.triagedByType).toBe('agent');
    expect(out.triagedBy).toBeNull();
  });

  it("treats the literal userId 'cron' as the system actor", () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-03-01T10:00:00Z'),
        userId: 'cron',
        source: null,
      },
    ]);
    expect(out.triagedByType).toBe('system');
    expect(out.triagedBy).toBeNull();
  });

  // `markResolved` (sast-iac.utils.ts) writes the scan's auto-resolve with NO
  // userId and `applyAgentAuditFields(item, {}, 'system')`. That is the machine,
  // not the agent — the agent always stamps `userId = 'system'`.
  it("classifies the auto-resolve shape (no userId, source 'system') as system", () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'resolved',
        date: at('2026-03-01T10:00:00Z'),
        userId: null,
        source: 'system',
      },
    ]);
    expect(out.triagedByType).toBe('system');
    expect(out.triagedBy).toBeNull();
  });

  it("classifies source 'system' as system even with a real userId", () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-03-01T10:00:00Z'),
        userId: 'u1',
        source: 'system',
      },
    ]);
    expect(out.triagedByType).toBe('system');
  });

  it('classifies a chat_agent_assisted source as agent', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-03-01T10:00:00Z'),
        userId: 'u1',
        source: 'chat_agent_assisted',
      },
    ]);
    expect(out.triagedByType).toBe('agent');
    // The human who confirmed the HITL tool call is still the accountable actor.
    expect(out.triagedBy).toBe('u1');
  });

  it('records resolved_at when the latest transition is resolved', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-01-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'status_change',
        value: 'resolved',
        date: at('2026-02-01T10:00:00Z'),
        userId: null,
        source: null,
      },
    ]);
    expect(out.resolvedAt).toEqual(at('2026-02-01T10:00:00Z'));
  });

  it('records resolved_at from the latest resolved transition', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'resolved',
        date: at('2026-01-01T10:00:00Z'),
        userId: null,
        source: null,
      },
      {
        type: 'status_change',
        value: 'to_verify',
        date: at('2026-02-01T10:00:00Z'),
        userId: null,
        source: null,
      },
    ]);
    // Reopened: no longer resolved, so resolved_at is cleared.
    expect(out.resolvedAt).toBeNull();
  });

  it('recovers the dismissal reason from the comment sharing the transition second', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'comment',
        value: 'Not reachable from any entrypoint',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.dismissalReason).toBe('Not reachable from any entrypoint');
    expect(out.ambiguousComment).toBe(false);
  });

  it('does not attach a comment written in a different second', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'comment',
        value: 'written one second later',
        date: at('2026-02-01T10:00:01Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.dismissalReason).toBeNull();
    expect(out.ambiguousComment).toBe(false);
  });

  // The other half of "a different second". A detection accumulates analyst
  // comments over its life and the dismissal comment is written LAST, so an
  // earlier unrelated note is the realistic corpus shape — and the one a `<=`
  // join would silently promote into `dismissal_reason`.
  it('does not attach a comment written BEFORE the transition second', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'comment',
        value: 'triage note written days earlier',
        date: at('2026-01-20T09:15:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.dismissalReason).toBeNull();
    expect(out.ambiguousComment).toBe(false);
  });

  it('picks the comment sharing the second, not an earlier one', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'comment',
        value: 'triage note written days earlier',
        date: at('2026-01-20T09:15:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
      {
        type: 'comment',
        value: 'accepted risk: internal tool, no external route',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: 'dashboard_manual',
      },
    ]);
    expect(out.dismissalReason).toBe(
      'accepted risk: internal tool, no external route',
    );
    expect(out.ambiguousComment).toBe(false);
  });

  it('flags ambiguity when two comments share the transition second', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'ignored',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: null,
      },
      {
        type: 'comment',
        value: 'first',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: null,
      },
      {
        type: 'comment',
        value: 'second',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: null,
      },
    ]);
    expect(out.ambiguousComment).toBe(true);
    expect(out.dismissalReason).toBeNull();
  });

  it('does not attach a comment to a non-ignored transition', () => {
    const out = resolveTriageFromHistory([
      {
        type: 'status_change',
        value: 'confirmed',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: null,
      },
      {
        type: 'comment',
        value: 'looks real',
        date: at('2026-02-01T10:00:00Z'),
        userId: 'u1',
        source: null,
      },
    ]);
    expect(out.dismissalReason).toBeNull();
  });

  // Deliberate: a (detection, second) pair can carry two to four status_change rows with DIFFERENT values.
  // `date` has second precision, so which one is last is unknowable; picking the
  // tail of an ORDER BY date is a guess dressed as a fact.
  describe('same-second transition ties', () => {
    it('refuses to derive a state from a tie with differing values', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'ignored',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
      ]);
      expect(out.ambiguousTransition).toBe(true);
      // The SECOND is certain even when the winning value is not.
      expect(out.triagedAt).toEqual(at('2026-05-09T15:20:26Z'));
      // Both rows agree on the actor, so the actor survives the tie.
      expect(out.triagedBy).toBe('u1');
      expect(out.triagedByType).toBe('user');
      // The value-derived fields do not.
      expect(out.resolvedAt).toBeNull();
      expect(out.dismissalReason).toBeNull();
    });

    // The two tests below exist because the tie guard is only reachable when
    // the row the tie-break WOULD have picked is the one that carries the
    // value. Both other tie tests happen to end on a row whose value the guard
    // discards anyway, so they pass with the guard removed. These do not:
    // reading `latest.value` instead of the tie-aware `state` fabricates a
    // `resolved_at` here, and a `dismissal_reason` in the next one.
    it('refuses a resolved_at when the unreadable tie ENDS on resolved', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'ignored',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
      ]);
      expect(out.ambiguousTransition).toBe(true);
      expect(out.triagedAt).toEqual(at('2026-05-09T15:20:26Z'));
      expect(out.resolvedAt).toBeNull();
    });

    it('refuses a dismissal_reason when the unreadable tie ENDS on ignored', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'ignored',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'comment',
          value: 'not reachable from any entrypoint',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
      ]);
      expect(out.ambiguousTransition).toBe(true);
      expect(out.dismissalReason).toBeNull();
      expect(out.ambiguousComment).toBe(false);
    });

    it('drops the actor too when the tied rows disagree on who acted', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'ignored',
          date: at('2026-05-09T15:20:26Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: null,
          source: null,
        },
      ]);
      expect(out.ambiguousTransition).toBe(true);
      expect(out.triagedBy).toBeNull();
      expect(out.triagedByType).toBeNull();
    });

    it('is not a tie when the rows in the same second agree on the value', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: null,
          source: null,
        },
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-05-09T15:20:26Z'),
          userId: null,
          source: null,
        },
      ]);
      expect(out.ambiguousTransition).toBe(false);
      expect(out.resolvedAt).toEqual(at('2026-05-09T15:20:26Z'));
    });

    it('only ties the LAST second, not an earlier one', () => {
      const out = resolveTriageFromHistory([
        {
          type: 'status_change',
          value: 'confirmed',
          date: at('2026-01-01T10:00:00Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'ignored',
          date: at('2026-01-01T10:00:00Z'),
          userId: 'u1',
          source: 'dashboard_manual',
        },
        {
          type: 'status_change',
          value: 'resolved',
          date: at('2026-02-01T10:00:00Z'),
          userId: null,
          source: null,
        },
      ]);
      expect(out.ambiguousTransition).toBe(false);
      expect(out.resolvedAt).toEqual(at('2026-02-01T10:00:00Z'));
      expect(out.triagedByType).toBe('system');
    });
  });
});

// ---------------------------------------------------------------------------
// Timestamp base
//
// `history_item.date` and `vulnerability_detection_history.detectedAt` are
// DATETIME — a wall clock in the timezone of whichever process wrote them, with
// no offset recorded. `createdAt` is a TIMESTAMP whose value MySQL generates
// itself (`DEFAULT_GENERATED CURRENT_TIMESTAMP`, verified in
// information_schema; TypeORM deliberately does not send one, see the comment
// in InsertQueryBuilder "we don't do it because this constant is already in
// default value of the column"). Copying a DATETIME into a TIMESTAMP therefore
// re-reads the wall clock in the SESSION timezone and lands on a different
// instant whenever the writing process was not on the session's offset.
//
// Measured on the local corpus: `MIN(detectedAt) - createdAt` is 0/1/2 s on
// some rows and 3600/7200 s on others IN THE SAME TABLE — the DB was written by
// both a UTC process and a Europe/Paris one. So no single conversion exists;
// the only per-row anchor is `createdAt`.
// ---------------------------------------------------------------------------

describe('SQL timestamp literals', () => {
  it('round-trips a literal without consulting the process timezone', () => {
    // Deliberately not `new Date(string)`: that would resolve against TZ.
    const parsed = parseSqlTimestamp('2026-04-21 15:22:35');
    expect(formatSqlTimestamp(parsed)).toBe('2026-04-21 15:22:35');
    // The Date carries the literal's digits, nothing else.
    expect(parsed.getTime()).toBe(Date.UTC(2026, 3, 21, 15, 22, 35));
  });

  it('floors a fractional literal instead of rounding it', () => {
    // `createdAt` is datetime(6) on sca/container and the lifecycle columns are
    // TIMESTAMP(0); MySQL ROUNDS on that narrowing, which would put the first
    // sighting after the record of it.
    expect(floorSqlTimestamp('2026-05-02 00:20:34.684227')).toBe(
      '2026-05-02 00:20:34',
    );
    expect(floorSqlTimestamp('2026-05-02 00:20:34.000000')).toBe(
      '2026-05-02 00:20:34',
    );
    expect(floorSqlTimestamp('2026-05-02 00:20:34')).toBe(
      '2026-05-02 00:20:34',
    );
  });
});

describe('computeDetectionBounds', () => {
  it('falls back to createdAt for BOTH bounds when there is no trail', () => {
    const b = computeDetectionBounds('2026-05-02 00:20:34.684227', null, null);
    expect(b.firstDetectedAt).toBe('2026-05-02 00:20:34');
    expect(b.lastDetectedAt).toBe('2026-05-02 00:20:34');
    expect(b.spanFrom).toBe('createdAt');
    expect(b.trailSkewSeconds).toBeNull();
  });

  it('anchors the origin on createdAt and takes only the SPAN from the trail', () => {
    // The trail is on the same base here: it starts 1 s after the row exists.
    const b = computeDetectionBounds(
      '2026-04-21 15:22:35',
      '2026-04-21 15:22:36',
      '2026-04-28 15:22:36',
    );
    expect(b.firstDetectedAt).toBe('2026-04-21 15:22:35');
    expect(b.lastDetectedAt).toBe('2026-04-28 15:22:35');
    expect(b.spanFrom).toBe('trail');
    expect(b.trailSkewSeconds).toBe(1);
  });

  it('never puts the first sighting after the row that records it, whatever base the trail is on', () => {
    // Same detection as above, but the trail was written by a UTC+2 process
    // while the DB session is UTC: every trail literal reads 2 h late.
    const b = computeDetectionBounds(
      '2026-04-21 15:22:35',
      '2026-04-21 17:22:36',
      '2026-04-28 17:22:36',
    );
    expect(b.firstDetectedAt).toBe('2026-04-21 15:22:35');
    // The SPAN is base-invariant — seven days, exactly as the trail says.
    expect(b.lastDetectedAt).toBe('2026-04-28 15:22:35');
    expect(b.trailSkewSeconds).toBe(7201);
  });

  it('keeps the trail as the origin when it genuinely predates createdAt', () => {
    const b = computeDetectionBounds(
      '2026-04-21 15:22:35',
      '2026-04-21 13:22:36',
      '2026-04-21 14:00:00',
    );
    expect(b.firstDetectedAt).toBe('2026-04-21 13:22:36');
    expect(b.lastDetectedAt).toBe('2026-04-21 14:00:00');
    expect(b.trailSkewSeconds).toBe(-7199);
  });

  it('reports a single-sighting trail as a zero-length window', () => {
    const b = computeDetectionBounds(
      '2026-04-21 15:22:35',
      '2026-04-21 17:22:36',
      '2026-04-21 17:22:36',
    );
    expect(b.firstDetectedAt).toBe('2026-04-21 15:22:35');
    expect(b.lastDetectedAt).toBe('2026-04-21 15:22:35');
  });

  // The span is a difference between two literals, so it survives a change of
  // base ONLY while the base is the same at both ends of the trail. A process
  // on Europe/Paris writing `datetime(0)` crosses CET<->CEST every March and
  // October, and every finding alive across that night gets a span 3600 s wrong.
  // The flip is real in a test corpus: the scans before a date wrote at
  // +3600/+7200, the scans after it at +0.
  it('subtracts a KNOWN base change from the span instead of trusting it', () => {
    // First sighting written at UTC+0, last written at UTC+1 after the DST jump.
    // Raw literals say 25 h; the real window is 24 h.
    const b = computeDetectionBounds(
      '2026-03-28 10:00:00',
      '2026-03-28 10:00:01',
      '2026-03-29 11:00:01',
      3600,
    );
    expect(b.firstDetectedAt).toBe('2026-03-28 10:00:00');
    expect(b.lastDetectedAt).toBe('2026-03-29 10:00:00');
    expect(b.baseDriftSeconds).toBe(3600);
  });

  it('adds back a base change in the other direction', () => {
    // The autumn transition: the last sighting is written an hour BEHIND the
    // first one's base, so the raw literals under-state the window.
    const b = computeDetectionBounds(
      '2026-10-25 10:00:00',
      '2026-10-25 10:00:01',
      '2026-10-26 09:00:01',
      -3600,
    );
    expect(b.lastDetectedAt).toBe('2026-10-26 10:00:00');
    expect(b.baseDriftSeconds).toBe(-3600);
  });

  it('never lets a base correction invert the window', () => {
    const b = computeDetectionBounds(
      '2026-03-28 10:00:00',
      '2026-03-28 10:00:01',
      '2026-03-28 10:30:01',
      3600,
    );
    expect(b.lastDetectedAt).toBe(b.firstDetectedAt);
  });

  it('reports a zero drift when no base change was established', () => {
    const b = computeDetectionBounds(
      '2026-04-21 15:22:35',
      '2026-04-21 15:22:36',
      '2026-04-28 15:22:36',
    );
    expect(b.baseDriftSeconds).toBe(0);
    expect(b.lastDetectedAt).toBe('2026-04-28 15:22:35');
  });

  it('holds first <= last and first <= createdAt on every shape', () => {
    const shapes: Array<[string, string | null, string | null]> = [
      ['2026-04-21 15:22:35', null, null],
      ['2026-04-21 15:22:35', '2026-04-21 15:22:36', '2026-04-28 15:22:36'],
      ['2026-04-21 15:22:35', '2026-04-21 17:22:36', '2026-04-28 17:22:36'],
      ['2026-04-21 15:22:35', '2026-04-21 13:22:36', '2026-04-21 14:00:00'],
      [
        '2026-05-02 00:20:34.684227',
        '2026-05-02 02:20:35',
        '2026-05-02 02:20:35',
      ],
    ];
    for (const [createdAt, first, last] of shapes) {
      const b = computeDetectionBounds(createdAt, first, last);
      expect(b.firstDetectedAt <= b.lastDetectedAt ? true : b).toBe(true);
      expect(b.firstDetectedAt <= floorSqlTimestamp(createdAt) ? true : b).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// What the backfill is allowed to overwrite.
//
// This script is not the only writer of these columns: the live re-detection
// and triage paths write them too, and they know things `history_item` never
// records. Container in particular has NO ingestion trail at all
// (`vulnerability_detection_history` carries five FKs, no container one), so
// its reconstruction is always `createdAt` — replaying it over a live stamp
// would freeze `last_detected_at` at row-creation time forever, which is
// exactly the difference between "fixed" and "not scanned in three months"
// that the column exists to express.
//
// Both decisions are pure functions so the guard itself is under test: the
// driver's `continue` is one line away from being deleted by a refactor, and
// nothing else in the suite would notice.
// ---------------------------------------------------------------------------

describe('mergeDetectionBounds', () => {
  it('takes the reconstruction when nothing is stored', () => {
    expect(
      mergeDetectionBounds(
        { first: null, last: null },
        { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
      ),
    ).toEqual({
      first: '2026-04-21 15:22:35',
      last: '2026-04-28 15:22:35',
      changed: true,
    });
  });

  it('KEEPS a stored last_detected_at that is later than the reconstruction', () => {
    // The live re-detection path saw this finding again yesterday; the trail
    // (or, for container, the absence of one) knows nothing about it.
    const out = mergeDetectionBounds(
      { first: '2026-05-02 15:39:05', last: '2026-08-06 09:00:00' },
      { first: '2026-05-02 15:39:05', last: '2026-05-02 15:39:05' },
    );
    expect(out.last).toBe('2026-08-06 09:00:00');
    expect(out.changed).toBe(false);
  });

  it('advances last_detected_at when the reconstruction is later', () => {
    const out = mergeDetectionBounds(
      { first: '2026-05-02 15:39:05', last: '2026-05-02 15:39:05' },
      { first: '2026-05-02 15:39:05', last: '2026-06-01 08:00:00' },
    );
    expect(out.last).toBe('2026-06-01 08:00:00');
    expect(out.changed).toBe(true);
  });

  it('corrects a stored first_detected_at that postdates the reconstruction', () => {
    // This is the timezone damage the previous pass fixed: 2097 of 3276 rows
    // had `first_detected_at` up to 2 h AFTER their own `createdAt`.
    const out = mergeDetectionBounds(
      { first: '2026-04-21 17:22:36', last: '2026-04-28 17:22:36' },
      { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
    );
    expect(out.first).toBe('2026-04-21 15:22:35');
    // …but the stored `last` is still the latest evidence of a sighting.
    expect(out.last).toBe('2026-04-28 17:22:36');
    expect(out.changed).toBe(true);
  });

  it('keeps a stored first_detected_at that is earlier than the reconstruction', () => {
    const out = mergeDetectionBounds(
      { first: '2026-01-01 00:00:00', last: '2026-04-28 15:22:35' },
      { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
    );
    expect(out.first).toBe('2026-01-01 00:00:00');
    expect(out.changed).toBe(false);
  });

  it('reports changed=false when both bounds already match', () => {
    const out = mergeDetectionBounds(
      { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
      { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
    );
    expect(out.changed).toBe(false);
  });

  it('reports changed=true when only one bound moves', () => {
    const out = mergeDetectionBounds(
      { first: '2026-04-21 15:22:35', last: null },
      { first: '2026-04-21 15:22:35', last: '2026-04-28 15:22:35' },
    );
    expect(out.changed).toBe(true);
  });
});

describe('decideTriageWrite', () => {
  const reconstructed = {
    triagedAt: '2026-05-27 14:02:43',
    triagedBy: null,
    triagedByType: 'agent',
    resolvedAt: null,
    dismissalReason: '# Verdict **False positive**',
  };

  it('writes when the row carries no triage yet', () => {
    expect(
      decideTriageWrite(
        {
          triagedAt: null,
          triagedBy: null,
          triagedByType: null,
          resolvedAt: null,
          dismissalReason: null,
        },
        reconstructed,
      ),
    ).toBe('write');
  });

  it('writes when there is no stored row at all', () => {
    expect(decideTriageWrite(null, reconstructed)).toBe('write');
  });

  it('leaves an identical row alone', () => {
    expect(decideTriageWrite({ ...reconstructed }, reconstructed)).toBe(
      'unchanged',
    );
  });

  it('rewrites the other columns when the timestamps agree', () => {
    // Same transition, better reading of it — this is how the agent verdicts
    // were reclassified from `system` to `agent`.
    expect(
      decideTriageWrite(
        { ...reconstructed, triagedByType: 'system' },
        reconstructed,
      ),
    ).toBe('write');
  });

  it('rewrites a stored triage that predates the reconstruction', () => {
    expect(
      decideTriageWrite(
        { ...reconstructed, triagedAt: '2026-01-01 00:00:00' },
        reconstructed,
      ),
    ).toBe('write');
  });

  // The reason this function exists. `handleUpdateSast/Iac/Cicd/Secret` (and the
  // sca/container equivalents) write a `status_change` row ONLY when
  // `dto.status !== oldStatus`. Re-triaging a finding that is already `ignored`
  // — changing the dismissal reason, or a human overriding the agent — leaves
  // NO history row, so the reconstruction still describes the older verdict.
  // Replaying it would flip `triaged_by_type` from `user` back to `agent` and
  // restore the agent's text over a human risk acceptance: a falsified
  // accountability record in an audit export, not a hole.
  it('PRESERVES a stored triage newer than the last status_change', () => {
    expect(
      decideTriageWrite(
        {
          triagedAt: '2026-08-01 10:00:00',
          triagedBy: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          triagedByType: 'user',
          resolvedAt: null,
          dismissalReason: 'Human analyst: accepted risk, compensating control',
        },
        reconstructed,
      ),
    ).toBe('preserve-newer');
  });

  it('preserves a stored triage when the reconstruction has none', () => {
    expect(
      decideTriageWrite(
        {
          triagedAt: '2026-08-01 10:00:00',
          triagedBy: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          triagedByType: 'user',
          resolvedAt: null,
          dismissalReason: 'Human analyst: accepted risk',
        },
        { ...reconstructed, triagedAt: null },
      ),
    ).toBe('preserve-newer');
  });
});

describe('snapUtcOffsetSeconds', () => {
  // A real UTC offset is a whole number of quarter hours. The estimate is
  // `detectedAt - createdAt` on a detection's CREATION sighting, so it is the
  // offset plus a sub-second insert gap that rounds to 0-2 s.
  it('snaps an estimate that sits on a quarter hour', () => {
    expect(snapUtcOffsetSeconds(0)).toBe(0);
    expect(snapUtcOffsetSeconds(1)).toBe(0);
    expect(snapUtcOffsetSeconds(3601)).toBe(3600);
    expect(snapUtcOffsetSeconds(7199)).toBe(7200);
    expect(snapUtcOffsetSeconds(-3600)).toBe(-3600);
    expect(snapUtcOffsetSeconds(19800)).toBe(19800); // UTC+5:30
  });

  // An estimate far from any quarter hour is elapsed time, not an offset: the
  // scan re-detected findings it did not create. Returning null keeps it out of
  // the base-change comparison instead of inventing an offset from it.
  it('rejects an estimate that is elapsed time, not an offset', () => {
    expect(snapUtcOffsetSeconds(64586)).toBeNull();
    expect(snapUtcOffsetSeconds(1417605)).toBeNull();
    expect(snapUtcOffsetSeconds(300)).toBeNull();
    expect(snapUtcOffsetSeconds(null)).toBeNull();
  });

  // The quarter-hour test alone does NOT separate an offset from elapsed time:
  // elapsed time lands on the grid roughly once every 900 s, and the two cases
  // above only pass because neither happens to. An estimate
  // of 966600 s — 11 days 4 h, an exact multiple of 900 — would be accepted as a
  // "UTC offset" and reported alongside 0s. No zone on Earth is further from UTC
  // than +14:00, so the magnitude is what tells them apart.
  //
  // The consequence is not cosmetic. A bogus offset feeds the base-change
  // comparison, where the DIFFERENCE between two ends is subtracted from a
  // detection's span — so a span could be shortened by eleven days, silently,
  // and first_detected_at is a compliance-facing date.
  it('rejects elapsed time that happens to land on the quarter-hour grid', () => {
    expect(966600 % 900).toBe(0); // it really is on the grid
    expect(snapUtcOffsetSeconds(966600)).toBeNull();
    expect(snapUtcOffsetSeconds(-966600)).toBeNull();
    expect(snapUtcOffsetSeconds(86400)).toBeNull(); // exactly one day
  });

  it('still accepts the extremes of the real offset range', () => {
    expect(snapUtcOffsetSeconds(50400)).toBe(50400); // UTC+14 (Kiritimati)
    expect(snapUtcOffsetSeconds(-43200)).toBe(-43200); // UTC-12
  });
});

describe('clampNotBefore', () => {
  it('lifts a value that predates the floor', () => {
    // A triage cannot happen before the finding was first detected. It reads
    // that way only because `history_item.date` carries no offset.
    expect(clampNotBefore('2026-04-21 13:22:36', '2026-04-21 15:22:35')).toBe(
      '2026-04-21 15:22:35',
    );
  });

  it('leaves a value that already sits after the floor', () => {
    expect(clampNotBefore('2026-04-21 17:22:36', '2026-04-21 15:22:35')).toBe(
      '2026-04-21 17:22:36',
    );
  });

  it('keeps NULL as NULL — an absent triage is not lifted to the floor', () => {
    expect(clampNotBefore(null, '2026-04-21 15:22:35')).toBeNull();
  });

  it('passes the value through when there is no floor to clamp against', () => {
    expect(clampNotBefore('2026-04-21 17:22:36', null)).toBe(
      '2026-04-21 17:22:36',
    );
  });
});
