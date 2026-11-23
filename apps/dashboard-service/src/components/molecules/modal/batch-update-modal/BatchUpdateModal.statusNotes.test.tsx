import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BatchUpdateModal from "./BatchUpdateModal";

// `t` renders its interpolation values so the test can check that the
// warning names the status to pick instead through its translation.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("../../../../utils/data/historyVulnData", () => ({
  priorityOptions: [
    { value: "normal", label: "PRIO_NORMAL" },
    { value: "low", label: "PRIO_LOW" },
  ],
  settableStatusOptions: [
    { value: "to_verify", label: "STAT_TO_VERIFY" },
    { value: "confirmed", label: "STAT_CONFIRMED" },
    { value: "ignored", label: "STAT_IGNORED" },
    { value: "resolved", label: "STAT_RESOLVED" },
  ],
}));

const PLACEHOLDER_STATUS = "components.modal.batchUpdate.selectStatus";
const WARNING = "components.modal.batchUpdate.resolvedWarning";
const IGNORED_STATUS_KEY = "components.analyseWrapper.status.labels.ignored";
const IGNORED_NOTE = "components.modal.batchUpdate.ignoredInfo";

/** Open the status select (showing `from`) and pick `to`. */
function pickStatus(from: string, to: string) {
  fireEvent.click(screen.getByText(from));
  fireEvent.click(screen.getByText(to));
}

/**
 * Bulk-resolving a batch of false positives is the costliest way to hit the
 * lifecycle rule: every one of them is reopened by the next scan that still
 * detects it. Same warning as the single-update modal.
 */
describe("BatchUpdateModal — warning on `resolved`", () => {
  it("warns that resolved findings come back on a later scan, naming the ignored status by its translation", () => {
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();

    pickStatus(PLACEHOLDER_STATUS, "STAT_RESOLVED");

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(WARNING);
    // Never the dropdown's raw label: it is untranslated English, which a
    // French sentence would embed as is.
    expect(warning).toHaveTextContent(IGNORED_STATUS_KEY);
    expect(warning).not.toHaveTextContent("STAT_IGNORED");
  });

  it("drops the warning when another status is picked", () => {
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={vi.fn()} />);
    pickStatus(PLACEHOLDER_STATUS, "STAT_RESOLVED");
    pickStatus("STAT_RESOLVED", "STAT_CONFIRMED");

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * The counterpart: a manual `ignored` is kept on re-detection, so a batch of
 * false positives or accepted risks does not come back. Informational only.
 */
describe("BatchUpdateModal — note on `ignored`", () => {
  it("tells that the selected findings stay ignored on later scans once `ignored` is picked", () => {
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();

    pickStatus(PLACEHOLDER_STATUS, "STAT_IGNORED");

    expect(screen.getByRole("status")).toHaveTextContent(IGNORED_NOTE);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("drops the note when another status is picked", () => {
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={vi.fn()} />);
    pickStatus(PLACEHOLDER_STATUS, "STAT_IGNORED");
    pickStatus("STAT_IGNORED", "STAT_CONFIRMED");

    expect(screen.queryByRole("status")).toBeNull();
  });
});
