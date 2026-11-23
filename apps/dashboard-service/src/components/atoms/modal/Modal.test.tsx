import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal";

/**
 * The modal closes on a document-level `mousedown` whose target sits outside
 * its own box. When a modal opens a second one (a confirmation) rendered as a
 * SIBLING, that second modal's DOM is outside the first — so a mousedown on
 * its "confirm" button used to close the parent, unmounting the button before
 * its `click` handler ever ran. The confirmed action silently never fired: no
 * network request, both modals gone.
 *
 * Callers worked around it one by one with `closeOnOverlayClick={!confirmOpen}`
 * and every modal that forgot re-introduced the bug (JiraIntegrationModal,
 * SlackIntegrationModal, ManageAPIKeyModal, ManageUserModal). The rule belongs
 * here: a click that landed inside ANOTHER modal's overlay is not "outside".
 */
describe("Modal outside-click", () => {
  it("closes when the click lands on its own overlay backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Parent" onClose={onClose}>
        <p>content</p>
      </Modal>,
    );

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the click lands inside a modal stacked above it", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <>
        <Modal title="Parent" onClose={onClose}>
          <p>content</p>
        </Modal>
        <Modal title="Confirm" onClose={vi.fn()}>
          <button onClick={onConfirm}>Yes</button>
        </Modal>
      </>,
    );

    const confirmButton = screen.getByRole("button", { name: "Yes" });
    fireEvent.mouseDown(confirmButton);
    fireEvent.click(confirmButton);

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
