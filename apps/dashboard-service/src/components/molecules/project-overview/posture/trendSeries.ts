/**
 * The two lines of the trend block, from the over-time series both overview
 * pages already load: `{ date, severity, count }` per day, where the count is
 * a LEVEL (the project's discovery timeline of what is still open, filled
 * forward; the organisation's net open balance), not a flow. A level is not
 * averaged over a week: the week is worth what it was worth on its last day.
 */

export type TrendTimeframe = 'day' | 'week' | 'month';

export interface TrendInput {
  date: string;
  severity: string;
  count: number;
}

export interface TrendPoint {
  /** The first day of the period, `YYYY-MM-DD`. */
  date: string;
  /** Every severity. */
  open: number;
  /** Critical and high only. */
  priority: number;
}

const PRIORITY = new Set(['CRITICAL', 'HIGH']);

/** The Monday of the week holding `day` (ISO weeks), read in UTC so no time zone moves a day. */
const startOfWeek = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (weekday - 1));
  return d.toISOString().slice(0, 10);
};

const startOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

const bucketOf = (day: string, timeframe: TrendTimeframe): string =>
  timeframe === 'week' ? startOfWeek(day) : timeframe === 'month' ? startOfMonth(day) : day;

const isDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(value);

/**
 * Sums the severities of each day into `open` and `priority`, then keeps the
 * last day of each period. Days arrive in any order; a row with no readable
 * date or a count that is not a number is left out.
 */
export function trendSeries(raw: ReadonlyArray<TrendInput>, timeframe: TrendTimeframe): TrendPoint[] {
  const perDay = new Map<string, { open: number; priority: number }>();
  for (const row of raw) {
    if (!row || typeof row.date !== 'string' || !isDay(row.date)) continue;
    const count = Number(row.count);
    if (!Number.isFinite(count)) continue;
    const day = row.date.slice(0, 10);
    const point = perDay.get(day) ?? { open: 0, priority: 0 };
    point.open += count;
    if (PRIORITY.has(String(row.severity ?? '').toUpperCase())) point.priority += count;
    perDay.set(day, point);
  }

  const days = [...perDay.keys()].sort();
  const perBucket = new Map<string, TrendPoint>();
  for (const day of days) {
    const bucket = bucketOf(day, timeframe);
    const point = perDay.get(day)!;
    // Days are ascending, so the last write of a bucket is its last day.
    perBucket.set(bucket, { date: bucket, open: point.open, priority: point.priority });
  }
  return [...perBucket.keys()].sort().map((bucket) => perBucket.get(bucket)!);
}

/** The headline figures of a series: where it stands, and how far it moved over the window. */
export function trendFigures(series: ReadonlyArray<TrendPoint>): { open: number; priority: number; delta: number } | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  return { open: last.open, priority: last.priority, delta: last.open - series[0].open };
}
