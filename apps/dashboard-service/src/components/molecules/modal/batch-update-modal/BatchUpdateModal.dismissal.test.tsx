import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BatchUpdateModal from "./BatchUpdateModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
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
const REASON_LABEL = "components.modal.batchUpdate.dismissalReasonLabel";
const CONFIRM = "components.modal.batchUpdate.updateButton";

function pickIgnored() {
  fireEvent.click(screen.getByText(PLACEHOLDER_STATUS));
  fireEvent.click(screen.getByText("STAT_IGNORED"));
}

/**
 * Bulk dismissal is a real caller of the now-mandatory
 * justification: `BatchUpdateVulnerabilityItemDto` carries a PER-ITEM
 * `dismissalReason` and `assertDismissalReason` runs on every item of the async
 * job. Without this the "Ignore" option in the bulk bar 400s for every user.
 *
 * As with the single modal, the disabled button is UX; the control is the
 * gateway DTO plus `assertDismissalReason`.
 */
describe("BatchUpdateModal — dismissal reason", () => {
  it("reveals a required reason field once `ignored` is picked", () => {
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(REASON_LABEL)).toBeNull();

    pickIgnored();

    const field = screen.getByLabelText(REASON_LABEL) as HTMLTextAreaElement;
    expect(field).toBeTruthy();
    expect(field.required).toBe(true);
  });

  it("does not submit a dismissal with an empty or blank reason", () => {
    const onSubmit = vi.fn();
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={onSubmit} />);
    pickIgnored();

    const confirm = screen.getByText(CONFIRM).closest("button") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();

    // A blank string is refused by the gateway too (@Matches(/\S/)).
    fireEvent.change(screen.getByLabelText(REASON_LABEL), {
      target: { value: "   " },
    });
    expect(
      (screen.getByText(CONFIRM).closest("button") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByText(CONFIRM));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the trimmed reason with the status", () => {
    const onSubmit = vi.fn();
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={onSubmit} />);
    pickIgnored();
    fireEvent.change(screen.getByLabelText(REASON_LABEL), {
      target: { value: "  compensating control deployed  " },
    });
    fireEvent.click(screen.getByText(CONFIRM));

    expect(onSubmit).toHaveBeenCalledWith({
      status: "ignored",
      dismissalReason: "compensating control deployed",
    });
  });

  it("sends no dismissalReason on a non-dismissal status", () => {
    const onSubmit = vi.fn();
    render(<BatchUpdateModal selectedCount={3} onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText(PLACEHOLDER_STATUS));
    fireEvent.click(screen.getByText("STAT_RESOLVED"));
    fireEvent.click(screen.getByText(CONFIRM));

    expect(onSubmit).toHaveBeenCalledWith({ status: "resolved" });
  });
});
