import { UNLABELLED_SEVERITY } from 'src/modules/cvss/effective-severity-sql';

export interface OverTimeRawRow {
  // Both fields come straight out of `getRawMany()` and CAN be null:
  // `effectiveSeveritySql()` evaluates to NULL when a row has no CVSS score and
  // both label columns (effective_severity, currentSeverity) are NULL/empty,
  // and DATE_FORMAT() returns NULL on a null date.
  date: string | null;
  severity: string | null;
  count: string | number;
  action?: string;
}

export interface OverTimePoint {
  date: string;
  severity: string;
  count: number;
}

const parseUtcDay = (dateStr: string): Date => new Date(`${dateStr}T00:00:00Z`);
const toDayStr = (d: Date): string => d.toISOString().split('T')[0];

/**
 * Cumulative count of vulnerabilities DISCOVERED (created) over time.
 *
 * The over-time chart must show a historical record that is NOT erased once the
 * vulnerabilities are resolved. The previous implementation computed a net
 * "currently open" balance — `cumsum(created) - cumsum(resolved)` floored at 0 —
 * so once everything was resolved the line returned to zero, and a vuln created
 * and resolved on the same day cancelled out entirely, leaving a flat zero
 * chart ("I never had vulnerabilities").
 *
 * We now accumulate only rows explicitly tagged `action === 'created'` (resolved
 * rows — and any other/untagged action — are ignored), producing a monotonic
 * non-decreasing series per severity that preserves history. Counts are filled
 * forward up to `now` so the latest cumulative value stays visible on the chart.
 *
 * The callers (fetchCreatedOverTime / getProjectOverview) now pre-
 * filter the created rows to active states, so the "preserved history" here is
 * the discovery timeline of the *currently-open* backlog — resolved / ignored /
 * not_exploitable detections are dropped upstream so the latest point matches
 * the dashboard's open counts instead of overcounting every detection ever
 * opened.
 */
export function accumulateCreatedOverTime(
  rawData: OverTimeRawRow[],
  now: Date = new Date(),
): OverTimePoint[] {
  // Normalise BEFORE anything sorts or indexes on these fields: a NULL severity
  // reaching `sort()` threw "Cannot read properties of null (reading
  // 'localeCompare')" and turned the whole project/organization overview into a
  // 500. An unlabelled row is bucketed under 'none' — the same band
  // `effectiveSeveritySql()` uses for a zero score — so its count is preserved
  // instead of silently vanishing. A row with no date cannot be placed on a
  // timeline at all, so it is dropped.
  const created = rawData
    .filter((row) => row.action === 'created' && Boolean(row.date))
    .map((row) => ({
      ...row,
      severity: row.severity?.trim() ? row.severity : UNLABELLED_SEVERITY,
    }));

  const allSeverities = Array.from(
    new Set(created.map((row) => row.severity)),
  ).sort((a, b) => a.localeCompare(b));

  // Sum the per-day created counts per severity.
  const dailyData = new Map<string, Record<string, number>>();
  created.forEach((item) => {
    if (!dailyData.has(item.date)) {
      dailyData.set(item.date, {});
    }
    const dayMap = dailyData.get(item.date)!;
    dayMap[item.severity] = (dayMap[item.severity] ?? 0) + Number(item.count);
  });

  const allDates = Array.from(dailyData.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const cumulative = new Map<string, number>();
  const result: OverTimePoint[] = [];

  allDates.forEach((day) => {
    allSeverities.forEach((sev) => {
      const next =
        (cumulative.get(sev) ?? 0) + (dailyData.get(day)?.[sev] ?? 0);
      cumulative.set(sev, next);
      result.push({ date: day, severity: sev, count: next });
    });
  });

  // Fill forward up to `now` so the chart shows the current discovered total.
  if (allDates.length > 0) {
    const cursor = parseUtcDay(allDates[allDates.length - 1]);
    const today = parseUtcDay(toDayStr(now));
    while (cursor.getTime() < today.getTime()) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const dateStr = toDayStr(cursor);
      allSeverities.forEach((sev) => {
        result.push({
          date: dateStr,
          severity: sev,
          count: cumulative.get(sev) ?? 0,
        });
      });
    }
  }

  return result;
}

/**
 * What was OPEN at the end of each day.
 *
 * A detection counts from the day it was created up to, and excluding, the
 * day it was closed (resolved / ignored / not_exploitable). Rows tagged
 * `action === 'created'` add to the running balance, rows tagged `'closed'`
 * subtract from it; anything else is ignored. The balance is floored at zero
 * per severity (legacy rows can carry a triage date older than their creation
 * date) and filled forward to `now`, so the last point is the currently-open
 * count — the same number as the dashboard cards — while every earlier point
 * keeps the finding for as long as it was actually open.
 *
 * This replaces an earlier version, which pre-filtered the created series
 * to active states and therefore erased a resolved finding from the WHOLE
 * history, and differs from the discovered-total, which never decreased.
 */
export function accumulateOpenOverTime(
  rawData: OverTimeRawRow[],
  now: Date = new Date(),
): OverTimePoint[] {
  const events = rawData
    .filter(
      (row) =>
        (row.action === 'created' || row.action === 'closed') &&
        Boolean(row.date),
    )
    .map((row) => ({
      date: row.date as string,
      severity: row.severity?.trim()
        ? (row.severity as string)
        : UNLABELLED_SEVERITY,
      delta: (row.action === 'created' ? 1 : -1) * Number(row.count),
    }));
  if (events.length === 0) return [];

  const allSeverities = Array.from(new Set(events.map((e) => e.severity))).sort(
    (a, b) => a.localeCompare(b),
  );
  const dailyDelta = new Map<string, Record<string, number>>();
  events.forEach((e) => {
    if (!dailyDelta.has(e.date)) dailyDelta.set(e.date, {});
    const dayMap = dailyDelta.get(e.date)!;
    dayMap[e.severity] = (dayMap[e.severity] ?? 0) + e.delta;
  });
  const allDates = Array.from(dailyDelta.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const open = new Map<string, number>();
  const result: OverTimePoint[] = [];
  allDates.forEach((day) => {
    allSeverities.forEach((sev) => {
      const next = Math.max(
        0,
        (open.get(sev) ?? 0) + (dailyDelta.get(day)?.[sev] ?? 0),
      );
      open.set(sev, next);
      result.push({ date: day, severity: sev, count: next });
    });
  });
  // Fill forward up to `now` so the chart ends on the currently-open count.
  const cursor = parseUtcDay(allDates[allDates.length - 1]);
  const today = parseUtcDay(toDayStr(now));
  while (cursor.getTime() < today.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dateStr = toDayStr(cursor);
    allSeverities.forEach((sev) => {
      result.push({ date: dateStr, severity: sev, count: open.get(sev) ?? 0 });
    });
  }
  return result;
}
