import {
  decideOrgStatsDrain,
  ORG_STATS_MAX_WAIT_MS,
  ORG_STATS_MIN_INTERVAL_MS,
  ORG_STATS_TRAILING_MS,
  orgStatsRecomputeAt,
} from './organization-statistics-debounce';

const S = 1_000;
const NOW = 1_000_000; // arbitrary fixed clock

describe('org-statistics debounce policy', () => {
  it('skips when the org is not dirty', () => {
    expect(
      decideOrgStatsDrain({
        now: NOW,
        lastEventAt: NOW - 100 * S,
        dirtySince: 0,
        computedAt: NOW - 100 * S,
      }),
    ).toEqual({ action: 'skip' });
  });

  it('recomputes once the burst is quiet and the floor has passed', () => {
    // last event 4s ago (quiet > 3s), last compute 60s ago (floor passed)
    const d = decideOrgStatsDrain({
      now: NOW,
      lastEventAt: NOW - 4 * S,
      dirtySince: NOW - 4 * S,
      computedAt: NOW - 60 * S,
    });
    expect(d).toEqual({ action: 'recompute' });
  });

  it('reschedules (trailing debounce) while events are still arriving', () => {
    // last event 1s ago → wait the remaining 2s of the trailing window
    const d = decideOrgStatsDrain({
      now: NOW,
      lastEventAt: NOW - 1 * S,
      dirtySince: NOW - 1 * S,
      computedAt: NOW - 60 * S,
    });
    expect(d).toEqual({
      action: 'reschedule',
      delayMs: ORG_STATS_TRAILING_MS - 1 * S,
    });
  });

  it('honours the 30s floor after a recent compute even when quiet', () => {
    // quiet (event 5s ago) but last compute only 5s ago → wait to 30s floor
    const d = decideOrgStatsDrain({
      now: NOW,
      lastEventAt: NOW - 5 * S,
      dirtySince: NOW - 5 * S,
      computedAt: NOW - 5 * S,
    });
    expect(d).toEqual({
      action: 'reschedule',
      delayMs: ORG_STATS_MIN_INTERVAL_MS - 5 * S,
    });
  });

  it('forces a recompute via maxWait when events never stop (no freeze)', () => {
    // continuous events (last event 0.5s ago, so trailing would never fire)
    // but the cycle started 60s ago and the floor has passed → recompute NOW
    const d = decideOrgStatsDrain({
      now: NOW,
      lastEventAt: NOW - 0.5 * S,
      dirtySince: NOW - ORG_STATS_MAX_WAIT_MS,
      computedAt: NOW - 60 * S,
    });
    expect(d).toEqual({ action: 'recompute' });
  });

  it('maxWait still waits for the floor (frequency cap wins)', () => {
    // maxWait reached but last compute was 10s ago → floor (30s) defers it
    const d = decideOrgStatsDrain({
      now: NOW,
      lastEventAt: NOW - 0.5 * S,
      dirtySince: NOW - ORG_STATS_MAX_WAIT_MS,
      computedAt: NOW - 10 * S,
    });
    expect(d).toEqual({
      action: 'reschedule',
      delayMs: ORG_STATS_MIN_INTERVAL_MS - 10 * S,
    });
  });

  it('orgStatsRecomputeAt = max(min(trailing, maxWait), floor)', () => {
    const t = {
      now: NOW,
      lastEventAt: NOW - 1 * S,
      dirtySince: NOW - 50 * S,
      computedAt: NOW - 40 * S,
    };
    const trailing = t.lastEventAt + ORG_STATS_TRAILING_MS;
    const maxWait = t.dirtySince + ORG_STATS_MAX_WAIT_MS;
    const floor = t.computedAt + ORG_STATS_MIN_INTERVAL_MS;
    expect(orgStatsRecomputeAt(t)).toBe(
      Math.max(Math.min(trailing, maxWait), floor),
    );
  });
});
