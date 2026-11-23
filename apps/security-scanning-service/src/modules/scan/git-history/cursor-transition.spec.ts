import type { GitHistoryPass } from '@grpc/security-scanning/scan';
import {
  CursorState,
  HISTORY_FAILURES_BEFORE_GAP,
  nextCursorState,
} from './cursor-transition';

const pass = (over: Partial<GitHistoryPass> = {}): GitHistoryPass => ({
  mode: 'full',
  tipSha: 'tip1',
  excludeShas: [],
  bytes: '10',
  firstPass: true,
  repositoryKey: 'github:o/r',
  ...over,
});

const state = (over: Partial<CursorState> = {}): CursorState => ({
  tipSha: 'tip1',
  coveredSince: '2020-01-01T00:00:00Z',
  complete: true,
  gaps: [],
  consecutiveFailures: 0,
  lastPassOutcome: 'ok',
  ...over,
});

describe('nextCursorState', () => {
  it('a first full pass covers the branch completely', () => {
    const next = nextCursorState(
      null,
      pass({ oldestCommitAt: '2019-05-05T00:00:00Z' }),
      'ok',
    );
    expect(next).toEqual(
      state({ coveredSince: '2019-05-05T00:00:00Z', complete: true }),
    );
  });

  it('a partial first pass records its oldest commit and stays incomplete', () => {
    const next = nextCursorState(
      null,
      pass({ mode: 'partial', oldestCommitAt: '2023-01-01T00:00:00Z' }),
      'ok',
    );
    expect(next).toMatchObject({
      tipSha: 'tip1',
      coveredSince: '2023-01-01T00:00:00Z',
      complete: false,
    });
  });

  it('an incremental pass moves the tip and keeps the coverage date', () => {
    const next = nextCursorState(
      state({ complete: false }),
      pass({
        mode: 'incremental',
        tipSha: 'tip2',
        baseTipSha: 'tip1',
        firstPass: false,
        oldestCommitAt: '2024-01-01T00:00:00Z',
      }),
      'ok',
    );
    expect(next).toMatchObject({
      tipSha: 'tip2',
      coveredSince: '2020-01-01T00:00:00Z',
      complete: false,
    });
  });

  it('a gap is appended, never replaced', () => {
    const old = { fromSha: 'a', toSha: 'b' };
    const gap = { fromSha: 'tip1', toSha: 'tip2' };
    const next = nextCursorState(
      state({ gaps: [old] }),
      pass({
        mode: 'incremental_with_gap',
        tipSha: 'tip2',
        baseTipSha: 'tip1',
        firstPass: false,
        gap,
      }),
      'ok',
    );
    expect(next?.gaps).toEqual([old, gap]);
  });

  it('a pass whose base tip is stale does not move the cursor', () => {
    expect(
      nextCursorState(
        state({ tipSha: 'tip9' }),
        pass({ baseTipSha: 'tip1', firstPass: false }),
        'ok',
      ),
    ).toBeNull();
    expect(
      nextCursorState(state(), pass({ baseTipSha: undefined }), 'ok'),
    ).toBeNull();
  });

  it('a none pass on a branch without a cursor records that the history was not analysed', () => {
    expect(
      nextCursorState(null, pass({ mode: 'none', tipSha: undefined }), 'ok'),
    ).toEqual({
      tipSha: null,
      coveredSince: null,
      complete: false,
      gaps: [],
      consecutiveFailures: 0,
      lastPassOutcome: 'none',
    });
  });

  it('a none pass keeps the existing tip and coverage', () => {
    const current = state({
      gaps: [{ fromSha: 'a', toSha: 'b' }],
      consecutiveFailures: 2,
    });
    expect(
      nextCursorState(
        current,
        pass({ mode: 'none', baseTipSha: 'tip1', firstPass: false }),
        'ok',
      ),
    ).toEqual({ ...current, lastPassOutcome: 'none' });
  });

  it('a none pass with a stale base changes nothing', () => {
    expect(
      nextCursorState(
        state({ tipSha: 'tip9' }),
        pass({ mode: 'none', baseTipSha: 'tip1', firstPass: false }),
        'ok',
      ),
    ).toBeNull();
  });

  it('an ok pass after a none pass sets the outcome back to ok', () => {
    const next = nextCursorState(
      state({ lastPassOutcome: 'none' }),
      pass({ mode: 'incremental', tipSha: 'tip2', baseTipSha: 'tip1' }),
      'ok',
    );
    expect(next?.lastPassOutcome).toBe('ok');
  });

  it('three failures in a row turn the range into a gap and move on', () => {
    const p = pass({
      mode: 'incremental',
      tipSha: 'tip2',
      baseTipSha: 'tip1',
      firstPass: false,
    });
    let s: CursorState | null = state();
    for (let i = 1; i < HISTORY_FAILURES_BEFORE_GAP; i++) {
      s = nextCursorState(s, p, 'failed');
      expect(s).toMatchObject({
        tipSha: 'tip1',
        consecutiveFailures: i,
        lastPassOutcome: 'failed',
        gaps: [],
      });
    }
    s = nextCursorState(s, p, 'failed');
    expect(s).toMatchObject({
      tipSha: 'tip2',
      consecutiveFailures: 0,
      gaps: [{ fromSha: 'tip1', toSha: 'tip2' }],
    });
  });

  it('a success resets the failure count', () => {
    const next = nextCursorState(
      state({ consecutiveFailures: 2, lastPassOutcome: 'failed' }),
      pass({ mode: 'incremental', tipSha: 'tip2', baseTipSha: 'tip1' }),
      'ok',
    );
    expect(next).toMatchObject({
      consecutiveFailures: 0,
      lastPassOutcome: 'ok',
    });
  });

  it('a first pass that fails creates a state with one failure', () => {
    expect(nextCursorState(null, pass(), 'failed')).toEqual({
      tipSha: null,
      coveredSince: null,
      complete: false,
      gaps: [],
      consecutiveFailures: 1,
      lastPassOutcome: 'failed',
    });
  });

  it('a first pass failing three times becomes a root gap, incomplete', () => {
    let s = nextCursorState(null, pass(), 'failed');
    s = nextCursorState(s, pass(), 'failed');
    s = nextCursorState(s, pass(), 'failed');
    expect(s).toMatchObject({
      tipSha: 'tip1',
      complete: false,
      coveredSince: null,
      consecutiveFailures: 0,
      gaps: [{ fromSha: 'root', toSha: 'tip1' }],
    });
  });
});
