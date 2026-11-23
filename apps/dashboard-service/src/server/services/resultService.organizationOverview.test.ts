import { describe, it, expect, vi, beforeEach } from "vitest";

import gatewayAPI from "@/server/api/gatewayAPI";

vi.mock("@/server/api/gatewayAPI", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import { getOrganizationOverview } from "./resultService";

const mockedGet = gatewayAPI.get as unknown as ReturnType<typeof vi.fn>;

describe("resultService.getOrganizationOverview — inert pagination params", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue({ data: {} });
  });

  it("does not forward page/limit to the gateway (the overview DTO ignores them)", async () => {
    await getOrganizationOverview("org-1", {
      sortBy: "critical_count",
      sortOrder: "DESC",
      // page/limit are not part of the filter type anymore, but a caller could
      // still smuggle them in — they must never reach the gateway.
      page: 1,
      limit: 10,
    } as never);

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const [url, config] = mockedGet.mock.calls[0];
    expect(url).toBe("/organization/org-1/results/overview");
    expect(config.params).not.toHaveProperty("page");
    expect(config.params).not.toHaveProperty("limit");
    // Sorting params still pass through — they ARE honored by the gateway.
    expect(config.params.sortBy).toBe("critical_count");
    expect(config.params.sortOrder).toBe("DESC");
  });
});
