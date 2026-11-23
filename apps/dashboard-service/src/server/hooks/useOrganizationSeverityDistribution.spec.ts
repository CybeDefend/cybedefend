import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/server/services/resultService", () => ({
  getOrganizationSeverityDistribution: (...a: unknown[]) => fetchMock(...a),
}));

import { useOrganizationSeverityDistribution } from "./useOrganizationSeverityDistribution";

describe("useOrganizationSeverityDistribution", () => {
  beforeEach(() => fetchMock.mockReset());

  it("fetches on mount and exposes data + loading transitions", async () => {
    fetchMock.mockResolvedValue({
      totalBySeverity: [{ severity: "CRITICAL", count: 2 }],
    });

    const { result } = renderHook(() =>
      useOrganizationSeverityDistribution("org-1", { branches: ["main"] }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("org-1", { branches: ["main"] });
    expect(result.current.data?.totalBySeverity).toEqual([
      { severity: "CRITICAL", count: 2 },
    ]);
  });

  it("does not fetch when organizationId is undefined", async () => {
    renderHook(() => useOrganizationSeverityDistribution(undefined, {}));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
