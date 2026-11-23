import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  categories,
  integrations,
  isMonochromeDarkLogo,
} from "./integrationData";

const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

const find = (name: string, category: string) =>
  integrations.find((i) => i.name === name && i.category === category);

describe("integration catalogue", () => {
  it("files every integration under a declared category", () => {
    // The page groups cards by matching `category` against a category label: a
    // typo leaves the card out of every tab but "All".
    const labels = new Set(categories.map((c) => c.label));
    for (const integration of integrations) {
      expect(labels.has(integration.category), integration.name).toBe(true);
    }
  });

  it("ships every logo it references", () => {
    for (const integration of integrations) {
      expect(
        fs.existsSync(path.join(PUBLIC_DIR, integration.imgSrc)),
        integration.imgSrc,
      ).toBe(true);
    }
  });

  it("offers a Compliance tab whose Comp AI card opens trycomp.ai", () => {
    const compliance = categories.find((c) => c.id === "compliance");
    expect(compliance).toBeDefined();
    expect(find("Comp AI", compliance!.label)).toMatchObject({
      available: true,
      link: "https://www.trycomp.ai/",
    });
  });

  it("keeps Cybe MCP a direct integration rather than an agents-space one", () => {
    expect(find("Cybe MCP", "Agent AI")?.poweredBy).toBeUndefined();
  });

  it("offers Linear as an available issue tracker, next to Jira", () => {
    expect(find("Linear", "Issue Tracking")).toMatchObject({ available: true });
    expect(find("Jira", "Issue Tracking")).toMatchObject({ available: true });
  });
});

describe("isMonochromeDarkLogo", () => {
  it("flags the monochrome black-on-transparent logos that vanish on a dark card", () => {
    // These assets are pure black artwork (octocat, terminal glyph, gear, swirl,
    // wave, Copilot head, compliance block) and become invisible on the dark-mode
    // card background.
    expect(isMonochromeDarkLogo("/image/integrations/github.png")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/cli.png")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/api.png")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/mcp.png")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/windsurf.png")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/copilot.svg")).toBe(true);
    expect(isMonochromeDarkLogo("/image/integrations/compai.svg")).toBe(true);
  });

  it("leaves already-coloured brand logos untouched", () => {
    expect(isMonochromeDarkLogo("/image/integrations/gitlab.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/jira.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/slack.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/vscode.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/dockerhub.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/intellij.png")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/claude-code.svg")).toBe(false);
    // Codex ships its purple-to-blue gradient mark: visible on both themes.
    expect(isMonochromeDarkLogo("/image/integrations/codex.svg")).toBe(false);
    expect(isMonochromeDarkLogo("/image/integrations/linear.svg")).toBe(false);
    // grey metallic gradient cube — its light faces stay visible and inverting
    // would distort the brand mark, so it is intentionally NOT flagged.
    expect(isMonochromeDarkLogo("/image/integrations/cursor.png")).toBe(false);
    // OpenCode ships a dark rounded square with a white frame: visible on both
    // themes, and inverted it would turn the frame black on a dark tile.
    expect(isMonochromeDarkLogo("/image/integrations/opencode.png")).toBe(false);
  });

  it("keys on the asset, so every integration reusing github.png is covered", () => {
    const githubUses = integrations.filter(
      (i) => i.imgSrc === "/image/integrations/github.png",
    );
    // github.png backs GitHub, GitHub Actions, GitHub Issues and the GitHub
    // container registry — flagging the asset fixes all of them at once.
    expect(githubUses.length).toBeGreaterThan(1);
    expect(githubUses.every((i) => isMonochromeDarkLogo(i.imgSrc))).toBe(true);
  });
});
