import { describe, it, expect } from "vitest";
import { orderSeverities } from "./orderSeverities";

describe("orderSeverities — unrated buckets (UNKNOWN) always last", () => {
  it("sinks UNKNOWN to the bottom even when it has the highest count", () => {
    const out = orderSeverities([
      { severity: "UNKNOWN", count: 2978 },
      { severity: "HIGH", count: 1982 },
      { severity: "CRITICAL", count: 500 },
      { severity: "LOW", count: 100 },
    ]);

    expect(out.map((d) => d.severity)).toEqual([
      "HIGH",
      "CRITICAL",
      "LOW",
      "UNKNOWN",
    ]);
  });

  it("orders rated severities by count desc, then by canonical rank on ties", () => {
    const out = orderSeverities([
      { severity: "LOW", count: 50 },
      { severity: "MEDIUM", count: 50 },
      { severity: "CRITICAL", count: 50 },
    ]);

    expect(out.map((d) => d.severity)).toEqual(["CRITICAL", "MEDIUM", "LOW"]);
  });

  it("keeps every unrated bucket after all rated ones", () => {
    const out = orderSeverities([
      { severity: "UNKNOWN", count: 10 },
      { severity: "WEIRD", count: 99 },
      { severity: "HIGH", count: 5 },
    ]);

    expect(out.map((d) => d.severity)).toEqual(["HIGH", "WEIRD", "UNKNOWN"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { severity: "UNKNOWN", count: 1 },
      { severity: "HIGH", count: 2 },
    ];
    const snapshot = JSON.stringify(input);
    orderSeverities(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
