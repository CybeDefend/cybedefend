import { describe, it, expect } from "vitest";
import { aggregateOverTime } from "./aggregateOverTime";

// A predictable averaging fn (plain mean) so assertions are exact.
const mean = (sum: number, numDays: number) => sum / numDays;

describe("aggregateOverTime — case-insensitive severity bucketing", () => {
  it("buckets LOWERCASE severities into the uppercase chart keys (the bug that zeroed the chart)", () => {
    const out = aggregateOverTime(
      [
        { date: "2026-03-05", severity: "high", count: 14 },
        { date: "2026-03-11", severity: "critical", count: 3 },
      ],
      "month",
      mean,
    );

    // Both early-March days fall in one month bucket (its exact start-date
    // label is timezone-dependent and not asserted here). Mean over 2 days.
    expect(out).toHaveLength(1);
    expect(out[0].HIGH).toBe(7); // 14 / 2
    expect(out[0].CRITICAL).toBe(1.5); // 3 / 2
  });

  it("merges mixed-case variants of the same severity", () => {
    const out = aggregateOverTime(
      [
        { date: "2026-03-05", severity: "HIGH", count: 10 },
        { date: "2026-03-05", severity: "high", count: 6 },
      ],
      "day",
      mean,
    );

    // 'day' timeframe uses the raw sum (no averaging).
    expect(out[0].HIGH).toBe(16);
  });

  it("ignores severities outside the chart set (e.g. 'none')", () => {
    const out = aggregateOverTime(
      [{ date: "2026-03-05", severity: "none", count: 99 }],
      "day",
      mean,
    );

    expect(out[0].CRITICAL).toBe(0);
    expect(out[0].HIGH).toBe(0);
    expect(out[0].MEDIUM).toBe(0);
    expect(out[0].LOW).toBe(0);
  });

  it("still handles already-uppercase severities", () => {
    const out = aggregateOverTime(
      [{ date: "2026-03-05", severity: "MEDIUM", count: 4 }],
      "day",
      mean,
    );

    expect(out[0].MEDIUM).toBe(4);
  });
});
