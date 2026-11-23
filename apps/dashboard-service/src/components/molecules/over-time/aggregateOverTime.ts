import { SeverityType } from "@/server/interfaces/Vulnerability";

export type OverTimeTimeframe = "day" | "week" | "month";

export interface OverTimeSeriesPoint {
  date: string;
  severity: string;
  count: number;
}

export interface OverTimeChartPoint {
  date: string;
  CRITICAL?: number;
  HIGH?: number;
  MEDIUM?: number;
  LOW?: number;
}

const ALL_SEVERITIES: SeverityType[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Start of week (Monday) for a given date, as YYYY-MM-DD. */
const getStartOfWeek = (date: Date): string => {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().split("T")[0];
};

/** Start of month for a given date, as YYYY-MM-DD. */
const getStartOfMonth = (date: Date): string => {
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  return startOfMonth.toISOString().split("T")[0];
};

/**
 * Aggregates a daily vulnerability-over-time series into chart points bucketed
 * by `timeframe`, keyed by the canonical UPPERCASE severities.
 *
 * Severities are normalized with `.toUpperCase()` before matching the chart's
 * bucket set, so a backend that emits lowercase (the `effectiveSeveritySql`
 * default) or mixed-case severities still renders instead of silently
 * collapsing to a flat zero line. Severities outside the set (e.g. 'none') are
 * ignored.
 *
 * For 'day' the raw per-day sum is used; for 'week'/'month' the per-period sum
 * is passed through `average(sum, numDays)` so callers keep their own rounding
 * (e.g. Math.ceil vs 1-decimal).
 */
export function aggregateOverTime(
  rawData: OverTimeSeriesPoint[],
  timeframe: OverTimeTimeframe,
  average: (sum: number, numDays: number) => number,
): OverTimeChartPoint[] {
  type Bucket = {
    date: string;
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    contributingDays: Set<string>;
  };

  const aggregated: Record<string, Bucket> = {};

  rawData.forEach((item) => {
    const itemDayString = item.date;
    const itemDate = new Date(itemDayString + "T00:00:00");

    let periodStartDate: string;
    switch (timeframe) {
      case "week":
        periodStartDate = getStartOfWeek(itemDate);
        break;
      case "month":
        periodStartDate = getStartOfMonth(itemDate);
        break;
      case "day":
      default:
        periodStartDate = itemDayString;
        break;
    }

    if (!aggregated[periodStartDate]) {
      aggregated[periodStartDate] = {
        date: periodStartDate,
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        contributingDays: new Set<string>(),
      };
    }

    const sev = (item.severity ?? "").toString().toUpperCase() as SeverityType;
    if (ALL_SEVERITIES.includes(sev)) {
      aggregated[periodStartDate][sev] += item.count;
    }
    aggregated[periodStartDate].contributingDays.add(itemDayString);
  });

  return Object.values(aggregated)
    .map((bucket) => {
      const numDays = bucket.contributingDays.size;
      const point: OverTimeChartPoint = { date: bucket.date };

      ALL_SEVERITIES.forEach((sev) => {
        if (timeframe === "day") {
          point[sev] = bucket[sev];
        } else if (numDays > 0) {
          point[sev] = average(bucket[sev], numDays);
        } else {
          point[sev] = 0;
        }
      });

      return point;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
