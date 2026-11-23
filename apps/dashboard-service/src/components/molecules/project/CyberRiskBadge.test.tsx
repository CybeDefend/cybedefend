import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CyberRiskBadge } from "./CyberRiskBadge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "components.analysisTable.cyberRiskScore": "CybeRisk Score",
        "components.analysisTable.cyberRiskLevel": "CybeRisk Level",
        "common.notAvailable": "Not available",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en-US" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("CyberRiskBadge", () => {
  it("renders the level label in the Badge", () => {
    render(<CyberRiskBadge level="critical" score={4200} />);
    expect(screen.getAllByText("CRITICAL").length).toBeGreaterThan(0);
  });

  it("renders the formatted score in the tooltip without a /100 suffix", () => {
    render(<CyberRiskBadge level="high" score={4200} />);
    const tooltip = screen.getByTestId("cyberisk-tooltip");
    // 4200 is formatted with the en-US locale grouping separator.
    expect(tooltip.textContent).toContain("4,200");
    expect(tooltip.textContent).not.toContain("/100");
  });

  it("shows ONLY the score in the tooltip (no level or computed-at lines)", () => {
    render(<CyberRiskBadge level="critical" score={8611} />);
    const tooltip = screen.getByTestId("cyberisk-tooltip");
    expect(tooltip.textContent).toContain("8,611");
    expect(tooltip.textContent).not.toContain("CybeRisk Level");
    expect(tooltip.textContent).not.toContain("Computed at");
  });

  it("renders a NONE label and says the score is not available, in words, when level is none and score is undefined", () => {
    render(<CyberRiskBadge level="none" />);
    expect(screen.getAllByText("NONE").length).toBeGreaterThan(0);
    const tooltip = screen.getByTestId("cyberisk-tooltip");
    expect(tooltip.textContent).toContain("Not available");
    expect(tooltip.textContent).not.toContain("—");
  });
});
