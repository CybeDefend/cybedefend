import {
  allContainersClosed,
  isFinalOutcome,
  isHeldForResults,
  isResultState,
  mustHoldForResults,
} from './resultsHold';

/**
 * A scan whose containers are all closed is not over until analysis-reporting
 * has finalized the results its scanners sent: those are ingested
 * asynchronously, so a client reading the results right after `completed`
 * got a part of them.
 */
describe('mustHoldForResults', () => {
  const codeScan = {
    isGraphOnly: false,
    importFormat: null,
    resultsFinalizedAt: null,
  };

  it('holds a code scan computed completed', () => {
    expect(mustHoldForResults(codeScan, 'completed')).toBe(true);
  });

  it('holds a code scan computed completed_degraded', () => {
    expect(mustHoldForResults(codeScan, 'completed_degraded')).toBe(true);
  });

  it('holds a scan whose finalization column was never read (undefined)', () => {
    expect(
      mustHoldForResults(
        { isGraphOnly: false, importFormat: undefined },
        'completed',
      ),
    ).toBe(true);
  });

  it('reads isGraphOnly as a TINYINT 0/1 by truthiness', () => {
    const tinyint = (isGraphOnly: number) =>
      ({ ...codeScan, isGraphOnly }) as unknown as typeof codeScan;
    expect(mustHoldForResults(tinyint(0), 'completed')).toBe(true);
    expect(mustHoldForResults(tinyint(1), 'completed')).toBe(false);
  });

  it('isResultState names the two states a scan with results computes', () => {
    expect(isResultState('completed')).toBe(true);
    expect(isResultState('completed_degraded')).toBe(true);
    expect(isResultState('failed')).toBe(false);
    expect(isResultState('running')).toBe(false);
  });

  it('does not hold a failed scan: no scanner produced results', () => {
    expect(mustHoldForResults(codeScan, 'failed')).toBe(false);
  });

  it('does not hold a scan still running or queued', () => {
    expect(mustHoldForResults(codeScan, 'running')).toBe(false);
    expect(mustHoldForResults(codeScan, 'queued')).toBe(false);
  });

  it('does not hold a graph-only scan: it has no finding', () => {
    expect(
      mustHoldForResults({ ...codeScan, isGraphOnly: true }, 'completed'),
    ).toBe(false);
  });

  it('does not hold an import scan: it ends through CompleteImportScan, sent by analysis-reporting', () => {
    expect(
      mustHoldForResults({ ...codeScan, importFormat: 'sarif' }, 'completed'),
    ).toBe(false);
  });

  it('does not hold a scan whose results are already final', () => {
    expect(
      mustHoldForResults(
        { ...codeScan, resultsFinalizedAt: new Date() },
        'completed',
      ),
    ).toBe(false);
  });
});

describe('isFinalOutcome', () => {
  it('is false for waiting: analysis-reporting still finalizes the results', () => {
    expect(isFinalOutcome('waiting')).toBe(false);
  });

  it.each([
    'dispatched',
    'already_dispatched',
    'deferred',
    'diff_scan',
    'nothing_finalized',
    undefined,
  ])('is true for %s', (outcome) => {
    expect(isFinalOutcome(outcome)).toBe(true);
  });
});

describe('allContainersClosed', () => {
  it('is true when every container is completed, completed_degraded or failed', () => {
    expect(
      allContainersClosed([
        { status: 'completed' },
        { status: 'completed_degraded' },
        { status: 'failed' },
      ]),
    ).toBe(true);
  });

  it.each(['queued', 'starting', 'running', 'parsing_completed'])(
    'is false while a container is %s',
    (open) => {
      expect(
        allContainersClosed([{ status: 'completed' }, { status: open }]),
      ).toBe(false);
    },
  );

  it('is false for a scan with no container: nothing has closed', () => {
    expect(allContainersClosed([])).toBe(false);
    expect(allContainersClosed(undefined)).toBe(false);
  });
});

describe('isHeldForResults', () => {
  const held = {
    state: 'running',
    isGraphOnly: false,
    importFormat: null,
    resultsFinalizedAt: null,
    containers: [{ status: 'completed' }, { status: 'failed' }],
  };

  it('is true for a running code scan whose containers are all closed and whose results are not final', () => {
    expect(isHeldForResults(held)).toBe(true);
  });

  it('is false while a container is open', () => {
    expect(
      isHeldForResults({
        ...held,
        containers: [{ status: 'completed' }, { status: 'running' }],
      }),
    ).toBe(false);
  });

  it('is false for a scan with no container', () => {
    expect(isHeldForResults({ ...held, containers: [] })).toBe(false);
  });

  it('is false once the results are final: only the terminal write is left', () => {
    expect(isHeldForResults({ ...held, resultsFinalizedAt: new Date() })).toBe(
      false,
    );
  });

  it('is false for a graph-only scan (TINYINT 1 included) and an import scan', () => {
    expect(isHeldForResults({ ...held, isGraphOnly: true })).toBe(false);
    expect(
      isHeldForResults({
        ...held,
        isGraphOnly: 1 as unknown as boolean,
      }),
    ).toBe(false);
    expect(isHeldForResults({ ...held, importFormat: 'sarif' })).toBe(false);
  });

  it('is false for a scan that is not running', () => {
    expect(isHeldForResults({ ...held, state: 'completed' })).toBe(false);
  });
});
