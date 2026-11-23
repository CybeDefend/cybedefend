import type {
  GitHistoryGap,
  GitHistoryPass,
} from '@grpc/security-scanning/scan';

export interface CursorState {
  tipSha: string | null;
  coveredSince: string | null;
  complete: boolean;
  gaps: GitHistoryGap[];
  consecutiveFailures: number;
  lastPassOutcome: 'ok' | 'failed' | 'none' | null;
}

/** A range that fails this many passes in a row is given up as a gap. */
export const HISTORY_FAILURES_BEFORE_GAP = 3;

/**
 * The cursor after a pass, or `null` to leave the row as it is.
 *
 * Compare-and-set: a pass that started from a tip other than the stored one
 * (another scan moved it meanwhile) changes nothing.
 */
export function nextCursorState(
  current: CursorState | null,
  pass: GitHistoryPass,
  outcome: 'ok' | 'failed',
): CursorState | null {
  if ((current?.tipSha ?? null) !== (pass.baseTipSha ?? null)) return null;

  const base: CursorState = current ?? {
    tipSha: null,
    coveredSince: null,
    complete: false,
    gaps: [],
    consecutiveFailures: 0,
    lastPassOutcome: null,
  };
  // A pass that analysed no history keeps the coverage and only records
  // that, so the branch can say its history was not analysed.
  if (pass.mode === 'none' && outcome === 'ok') {
    return { ...base, lastPassOutcome: 'none' };
  }
  const first = current === null || current.tipSha === null;

  if (outcome === 'ok') {
    return {
      tipSha: pass.tipSha ?? base.tipSha,
      coveredSince: first ? (pass.oldestCommitAt ?? null) : base.coveredSince,
      complete: first ? pass.mode === 'full' : base.complete,
      gaps: pass.gap ? [...base.gaps, pass.gap] : base.gaps,
      consecutiveFailures: 0,
      lastPassOutcome: 'ok',
    };
  }

  const failures = base.consecutiveFailures + 1;
  if (failures < HISTORY_FAILURES_BEFORE_GAP) {
    return {
      ...base,
      consecutiveFailures: failures,
      lastPassOutcome: 'failed',
    };
  }
  return {
    tipSha: pass.tipSha ?? base.tipSha,
    coveredSince: first ? null : base.coveredSince,
    complete: first ? false : base.complete,
    gaps: [
      ...base.gaps,
      { fromSha: pass.baseTipSha ?? 'root', toSha: pass.tipSha ?? '' },
    ],
    consecutiveFailures: 0,
    lastPassOutcome: 'failed',
  };
}
