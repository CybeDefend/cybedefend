import {
  accumulateCreatedOverTime,
  accumulateOpenOverTime,
} from './over-time.util';

describe('accumulateCreatedOverTime', () => {
  const highCounts = (
    series: { date: string; severity: string; count: number }[],
  ) => series.filter((p) => p.severity === 'HIGH').map((p) => p.count);

  it('keeps the historical peak after the vulnerabilities are resolved', () => {
    // 5 HIGH created on 06-01, all resolved on 06-10. The old net-balance
    // computation drove the series back to 0 ("I never had vulnerabilities").
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '5', action: 'created' },
      { date: '2026-06-10', severity: 'HIGH', count: '5', action: 'resolved' },
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-10T00:00:00Z'),
    );

    const counts = highCounts(series);
    // The discovered total must stay visible — never erased to zero.
    expect(Math.max(...counts)).toBe(5);
    expect(counts[counts.length - 1]).toBe(5);
  });

  it('does not collapse to a flat zero line when created and resolved on the same day', () => {
    // The exact reported symptom: same-day create + resolve cancelled to zero.
    const raw = [
      {
        date: '2026-06-01',
        severity: 'CRITICAL',
        count: '3',
        action: 'created',
      },
      {
        date: '2026-06-01',
        severity: 'CRITICAL',
        count: '3',
        action: 'resolved',
      },
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-01T00:00:00Z'),
    );

    expect(series).toContainEqual({
      date: '2026-06-01',
      severity: 'CRITICAL',
      count: 3,
    });
  });

  it('produces a monotonic non-decreasing cumulative series, ignoring resolved rows', () => {
    const raw = [
      { date: '2026-06-01', severity: 'LOW', count: '2', action: 'created' },
      { date: '2026-06-03', severity: 'LOW', count: '4', action: 'created' },
      { date: '2026-06-03', severity: 'LOW', count: '1', action: 'resolved' },
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-03T00:00:00Z'),
    );

    const low = series.filter((p) => p.severity === 'LOW').map((p) => p.count);
    // 06-01 -> 2, 06-03 -> 2 + 4 = 6 (the resolved row is ignored).
    expect(low).toEqual([2, 6]);
  });

  it('fills the series forward to today with the last cumulative value', () => {
    const raw = [
      { date: '2026-06-01', severity: 'MEDIUM', count: '7', action: 'created' },
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-04T00:00:00Z'),
    );

    const medium = series.filter((p) => p.severity === 'MEDIUM');
    expect(medium.map((p) => p.date)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
    expect(medium.every((p) => p.count === 7)).toBe(true);
  });

  it('returns an empty series when there is no data', () => {
    expect(
      accumulateCreatedOverTime([], new Date('2026-06-04T00:00:00Z')),
    ).toEqual([]);
  });

  it('does not crash on a NULL severity and buckets it under "none"', () => {
    // effectiveSeveritySql() returns NULL when both CVSS scores AND both label
    // columns (effective_severity, currentSeverity) are NULL/empty — the raw
    // row then carries `severity: null`, and the sort comparator blew up with
    // "Cannot read properties of null (reading 'localeCompare')" (a 500
    // on GET project overview).
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '2', action: 'created' },
      { date: '2026-06-01', severity: null, count: '3', action: 'created' },
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-01T00:00:00Z'),
    );

    expect(series).toContainEqual({
      date: '2026-06-01',
      severity: 'none',
      count: 3,
    });
    expect(series).toContainEqual({
      date: '2026-06-01',
      severity: 'HIGH',
      count: 2,
    });
  });

  it('buckets an empty-string severity under "none" too', () => {
    const raw = [
      { date: '2026-06-01', severity: '', count: '4', action: 'created' },
    ];

    expect(
      accumulateCreatedOverTime(raw, new Date('2026-06-01T00:00:00Z')),
    ).toEqual([{ date: '2026-06-01', severity: 'none', count: 4 }]);
  });

  it('drops rows without a usable date instead of crashing the sort', () => {
    const raw = [
      { date: null, severity: 'HIGH', count: '9', action: 'created' },
      { date: '2026-06-01', severity: 'HIGH', count: '2', action: 'created' },
    ];

    expect(
      accumulateCreatedOverTime(raw, new Date('2026-06-01T00:00:00Z')),
    ).toEqual([{ date: '2026-06-01', severity: 'HIGH', count: 2 }]);
  });

  it('only accumulates rows explicitly tagged created (ignores resolved, unknown and untagged actions)', () => {
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '4', action: 'created' },
      { date: '2026-06-01', severity: 'HIGH', count: '3', action: 'resolved' },
      { date: '2026-06-01', severity: 'HIGH', count: '5', action: 'ignored' },
      { date: '2026-06-01', severity: 'HIGH', count: '9' }, // untagged
    ];

    const series = accumulateCreatedOverTime(
      raw,
      new Date('2026-06-01T00:00:00Z'),
    );

    // Only the 4 'created' are counted; resolved/ignored/untagged are excluded.
    expect(series.filter((p) => p.severity === 'HIGH')).toEqual([
      { date: '2026-06-01', severity: 'HIGH', count: 4 },
    ]);
  });
});

describe('accumulateOpenOverTime', () => {
  // The "Vulnerability Trends" line shows what was OPEN at the end of each day:
  // a finding counts from the day it was created up to (and excluding) the day
  // it was closed (resolved / ignored / not_exploitable). So a resolved vuln
  // disappears from the current point but stays on the dates it was open —
  // unlike the discovered-total (never decreasing) and unlike an earlier
  // version (which erased a resolved vuln from the whole history).
  const highByDate = (
    series: { date: string; severity: string; count: number }[],
  ) =>
    Object.fromEntries(
      series.filter((p) => p.severity === 'HIGH').map((p) => [p.date, p.count]),
    );

  it('keeps the history while the vulnerabilities were open and drops them once closed', () => {
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '5', action: 'created' },
      { date: '2026-06-10', severity: 'HIGH', count: '5', action: 'closed' },
    ];
    const byDate = highByDate(
      accumulateOpenOverTime(raw, new Date('2026-06-12T00:00:00Z')),
    );
    expect(byDate['2026-06-01']).toBe(5);
    expect(byDate['2026-06-10']).toBe(0);
    expect(byDate['2026-06-12']).toBe(0);
  });

  it('ends on the currently open count', () => {
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '3', action: 'created' },
      { date: '2026-06-05', severity: 'HIGH', count: '2', action: 'closed' },
    ];
    const series = accumulateOpenOverTime(
      raw,
      new Date('2026-06-08T00:00:00Z'),
    );
    const highs = series.filter((p) => p.severity === 'HIGH');
    expect(highs[highs.length - 1]).toEqual({
      date: '2026-06-08',
      severity: 'HIGH',
      count: 1,
    });
  });

  it('never goes below zero when a closing predates the creation it belongs to', () => {
    // Legacy rows can carry a triage date older than their (re)creation date.
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '2', action: 'closed' },
      { date: '2026-06-03', severity: 'HIGH', count: '2', action: 'created' },
    ];
    const byDate = highByDate(
      accumulateOpenOverTime(raw, new Date('2026-06-03T00:00:00Z')),
    );
    expect(byDate['2026-06-01']).toBe(0);
    expect(byDate['2026-06-03']).toBe(2);
  });

  it('counts a finding created and closed the same day as closed at the end of that day', () => {
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '1', action: 'created' },
      { date: '2026-06-01', severity: 'HIGH', count: '1', action: 'closed' },
    ];
    const byDate = highByDate(
      accumulateOpenOverTime(raw, new Date('2026-06-01T00:00:00Z')),
    );
    expect(byDate['2026-06-01']).toBe(0);
  });

  it('fills forward to today with the last open value and keeps severities independent', () => {
    const raw = [
      { date: '2026-06-01', severity: 'HIGH', count: '2', action: 'created' },
      { date: '2026-06-01', severity: 'LOW', count: '4', action: 'created' },
      { date: '2026-06-02', severity: 'LOW', count: '4', action: 'closed' },
    ];
    const series = accumulateOpenOverTime(
      raw,
      new Date('2026-06-04T00:00:00Z'),
    );
    expect(series.filter((p) => p.date === '2026-06-04')).toEqual(
      expect.arrayContaining([
        { date: '2026-06-04', severity: 'HIGH', count: 2 },
        { date: '2026-06-04', severity: 'LOW', count: 0 },
      ]),
    );
  });

  it('ignores untagged rows, buckets a NULL severity under "none" and returns [] without data', () => {
    expect(accumulateOpenOverTime([], new Date())).toEqual([]);
    const raw = [
      { date: '2026-06-01', severity: null, count: '1', action: 'created' },
      { date: '2026-06-01', severity: 'HIGH', count: '9', action: 'resolved' },
      { date: null, severity: 'HIGH', count: '9', action: 'created' },
    ];
    const series = accumulateOpenOverTime(
      raw,
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(series).toEqual([
      { date: '2026-06-01', severity: 'none', count: 1 },
    ]);
  });
});
