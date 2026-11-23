import { describe, it, expect, vi } from "vitest";

import { pollReportUntilSettled } from "./reportPolling";

const noSleep = () => Promise.resolve();

describe("pollReportUntilSettled", () => {
  it("returns immediately when the first fetch is already ready", async () => {
    const fetchReport = vi.fn().mockResolvedValue({ status: "ready" });

    const result = await pollReportUntilSettled(fetchReport, {
      intervalMs: 10,
      timeoutMs: 1000,
      sleep: noSleep,
    });

    expect(result.status).toBe("ready");
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while status is queued, then resolves on ready", async () => {
    const fetchReport = vi
      .fn()
      .mockResolvedValueOnce({ status: "queued" })
      .mockResolvedValueOnce({ status: "queued" })
      .mockResolvedValueOnce({ status: "ready", downloadUrl: "u" });

    const result = await pollReportUntilSettled(fetchReport, {
      intervalMs: 10,
      timeoutMs: 1000,
      sleep: noSleep,
    });

    expect(result.status).toBe("ready");
    expect(fetchReport).toHaveBeenCalledTimes(3);
  });

  it("resolves on a failed status (terminal)", async () => {
    const fetchReport = vi.fn().mockResolvedValue({ status: "failed" });

    const result = await pollReportUntilSettled(fetchReport, {
      intervalMs: 10,
      timeoutMs: 1000,
      sleep: noSleep,
    });

    expect(result.status).toBe("failed");
  });

  it("treats a transient fetch error (e.g. 404 not yet persisted) as retryable", async () => {
    const fetchReport = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({ status: "ready" });

    const result = await pollReportUntilSettled(fetchReport, {
      intervalMs: 10,
      timeoutMs: 1000,
      sleep: noSleep,
    });

    expect(result.status).toBe("ready");
    expect(fetchReport).toHaveBeenCalledTimes(2);
  });

  it("waits startDelayMs before the first poll (stream is the primary path)", async () => {
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    const fetchReport = vi.fn().mockResolvedValue({ status: "ready" });

    const result = await pollReportUntilSettled(fetchReport, {
      intervalMs: 4000,
      timeoutMs: 600_000,
      startDelayMs: 30_000,
      sleep,
    });

    expect(result.status).toBe("ready");
    // The grace delay is awaited BEFORE the first fetch. The report is already
    // settled on the first poll, so the interval is never slept — the only
    // sleep is the start delay.
    expect(sleeps).toEqual([30_000]);
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  it("does not call fetchReport until the startDelay has elapsed", async () => {
    const fetchReport = vi.fn().mockResolvedValue({ status: "ready" });
    let releaseDelay!: () => void;
    const sleep = (_ms: number) =>
      new Promise<void>((resolve) => {
        releaseDelay = resolve;
      });

    const settled = pollReportUntilSettled(fetchReport, {
      intervalMs: 4000,
      timeoutMs: 600_000,
      startDelayMs: 30_000,
      sleep,
    });

    // Still inside the grace window — no network call yet.
    await Promise.resolve();
    expect(fetchReport).not.toHaveBeenCalled();

    releaseDelay();
    await settled;
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  it("counts the startDelay toward the timeout deadline", async () => {
    // deadline is measured from enqueue (now=0) + timeoutMs, BEFORE the grace.
    // After a grace that already pushes the clock past the deadline, a single
    // queued poll must trip the timeout rather than loop forever.
    let clock = 0;
    const now = () => clock;
    const sleep = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };
    const fetchReport = vi.fn().mockResolvedValue({ status: "queued" });

    await expect(
      pollReportUntilSettled(fetchReport, {
        intervalMs: 100,
        timeoutMs: 200,
        startDelayMs: 500,
        now,
        sleep,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  it("throws once the timeout elapses while still queued", async () => {
    let clock = 0;
    const now = () => clock;
    const sleep = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };
    const fetchReport = vi.fn().mockResolvedValue({ status: "queued" });

    await expect(
      pollReportUntilSettled(fetchReport, {
        intervalMs: 100,
        timeoutMs: 250,
        now,
        sleep,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
