import { describe, expect, it } from 'vitest';
import { trendFigures, trendSeries } from './trendSeries';

// The over-time series is a LEVEL per day and severity (what is open), so the
// two lines sum the severities of a day and a coarser period is worth its last
// day, never an average of its days.

const day = (date: string, counts: Record<string, number>) =>
  Object.entries(counts).map(([severity, count]) => ({ date, severity, count }));

describe('trendSeries', () => {
  it('sums every severity into « open » and critical plus high into « priority », day by day', () => {
    const series = trendSeries(
      [...day('2026-10-02', { CRITICAL: 2, HIGH: 3, MEDIUM: 5, LOW: 1 }), ...day('2026-10-01', { critical: 1, high: 1, low: 4 })],
      'day',
    );
    expect(series).toEqual([
      { date: '2026-10-01', open: 6, priority: 2 },
      { date: '2026-10-02', open: 11, priority: 5 },
    ]);
  });

  it('keeps the last day of a week, not the average of its days', () => {
    // Monday 2026-09-28 to Sunday 2026-10-04 is one ISO week; 2026-10-05 opens the next.
    const series = trendSeries(
      [...day('2026-09-28', { HIGH: 10 }), ...day('2026-10-04', { HIGH: 40 }), ...day('2026-10-05', { HIGH: 41 })],
      'week',
    );
    expect(series).toEqual([
      { date: '2026-09-28', open: 40, priority: 40 },
      { date: '2026-10-05', open: 41, priority: 41 },
    ]);
  });

  it('buckets a month on its first day', () => {
    const series = trendSeries([...day('2026-09-03', { LOW: 1 }), ...day('2026-09-30', { LOW: 7 }), ...day('2026-10-01', { LOW: 8 })], 'month');
    expect(series.map((p) => [p.date, p.open])).toEqual([
      ['2026-09-01', 7],
      ['2026-10-01', 8],
    ]);
  });

  it('leaves out a row with no readable date or count', () => {
    const series = trendSeries(
      [
        { date: '2026-10-01', severity: 'LOW', count: 3 },
        { date: '', severity: 'LOW', count: 9 },
        { date: '2026-10-01', severity: 'HIGH', count: Number.NaN },
        { date: 'not a date', severity: 'HIGH', count: 2 },
      ],
      'day',
    );
    expect(series).toEqual([{ date: '2026-10-01', open: 3, priority: 0 }]);
  });
});

describe('trendFigures', () => {
  it('reads where the lines stand today and how far open moved over the window', () => {
    expect(
      trendFigures([
        { date: '2026-10-01', open: 80, priority: 20 },
        { date: '2026-10-06', open: 90, priority: 30 },
      ]),
    ).toEqual({ open: 90, priority: 30, delta: 10 });
    expect(trendFigures([])).toBeNull();
  });
});
