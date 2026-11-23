import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The role explanations per edition: billing is the cloud's, so the Community
 * Edition says nothing about billing, plans or invoices:
 * the creator, administrator and manager descriptions have their own wording,
 * and no role lists the « billing » permission. The cloud is unchanged. The
 * popover reads `EDITION` once at load, so each case re-imports it.
 */
const ed = vi.hoisted(() => ({ edition: "community" as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock("@/edition/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/edition/edition")>()),
  get EDITION() {
    return ed.edition;
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18n-mock")).reactI18nextMock());

const BILLING = /billing|invoice/i;

const openIn = async (edition: string, role: string) => {
  ed.edition = edition;
  vi.resetModules();
  const Popover = (await import("./RoleExplanationPopover")).default;
  render(<Popover scope="organization" role={role} />);
  fireEvent.mouseEnter(screen.getByTestId("role-explanation-trigger"));
  return screen.getByTestId("role-explanation-content").textContent ?? "";
};

describe("RoleExplanationPopover per edition", () => {
  it.each(["creator", "administrator", "manager"])(
    "community: the %s says nothing about billing",
    async (role) => {
      const text = await openIn("community", role);
      expect(text).not.toMatch(BILLING);
      expect(text).toMatch(/integrations/);
    },
  );

  it.each(["creator", "administrator", "manager"])(
    "cloud: the %s keeps its wording about billing",
    async (role) => {
      expect(await openIn("cloud", role)).toMatch(BILLING);
    },
  );
});
