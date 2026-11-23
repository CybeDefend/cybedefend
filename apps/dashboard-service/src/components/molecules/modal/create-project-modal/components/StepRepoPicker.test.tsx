import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import StepRepoPicker from "./StepRepoPicker";
import type { Repository } from "@/server/interfaces/IntegrationProvider";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const baseProps = {
  source: "github" as const,
  selectedRepo: null,
  onRepoChange: vi.fn(),
  linked: true,
  repositories: [],
  loading: false,
  onConnect: vi.fn(),
};

const repo = (id: string, name: string): Repository => ({
  id,
  name,
  fullName: `org/${name}`,
  nameWithNamespace: `org/${name}`,
  projectId: null,
});

describe("StepRepoPicker", () => {
  it("renders the repo search input when linked", () => {
    render(<StepRepoPicker {...baseProps} repositories={[repo("r1", "alpha")]} />);
    expect(
      screen.getByPlaceholderText(/searchRepoPlaceholder/i),
    ).toBeInTheDocument();
  });

  it("names the search field, not only through its placeholder", () => {
    render(<StepRepoPicker {...baseProps} repositories={[repo("r1", "alpha")]} />);
    expect(
      screen.getByRole("textbox", { name: "components.modal.createProject.step1.searchRepoLabel" }),
    ).toBeInTheDocument();
  });

  it("says when no repository is left to link", () => {
    render(
      <StepRepoPicker
        {...baseProps}
        repositories={[{ ...repo("r1", "alpha"), projectId: "p-existing" }]}
      />,
    );
    expect(screen.getByText(/noReposAvailable/)).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("says the provider is not connected (github)", () => {
    render(<StepRepoPicker {...baseProps} source="github" linked={false} />);
    expect(screen.getByText(/notConnectedGithub/)).toBeInTheDocument();
  });

  it("does NOT render any source-choice cards", () => {
    render(<StepRepoPicker {...baseProps} repositories={[repo("r1", "alpha")]} />);
    expect(
      screen.queryByRole("button", { name: /sources\.none/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sources\.github/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sources\.gitlab/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the connect CTA when not linked (github)", () => {
    const onConnect = vi.fn();
    render(
      <StepRepoPicker
        {...baseProps}
        source="github"
        linked={false}
        onConnect={onConnect}
      />,
    );
    const cta = screen.getByRole("button", { name: /connectGithub/i });
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("shows the connect CTA when not linked (gitlab)", () => {
    const onConnect = vi.fn();
    render(
      <StepRepoPicker
        {...baseProps}
        source="gitlab"
        linked={false}
        onConnect={onConnect}
      />,
    );
    const cta = screen.getByRole("button", { name: /connectGitlab/i });
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("filters out already-linked repositories (projectId set)", () => {
    render(
      <StepRepoPicker
        {...baseProps}
        repositories={[
          repo("r1", "alpha"),
          repo("r2", "beta"),
          { ...repo("r3", "gamma"), projectId: "p-existing" },
        ]}
      />,
    );
    expect(screen.getByText("org/alpha")).toBeInTheDocument();
    expect(screen.getByText("org/beta")).toBeInTheDocument();
    expect(screen.queryByText("org/gamma")).not.toBeInTheDocument();
  });

  it("calls onRepoChange when a repository is clicked", () => {
    const onRepoChange = vi.fn();
    render(
      <StepRepoPicker
        {...baseProps}
        repositories={[repo("r1", "alpha")]}
        onRepoChange={onRepoChange}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: /alpha/i }));
    expect(onRepoChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
  });

  it("filters repositories by the search input", () => {
    render(
      <StepRepoPicker
        {...baseProps}
        repositories={[repo("r1", "alpha"), repo("r2", "beta")]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/searchRepoPlaceholder/i), {
      target: { value: "bet" },
    });
    expect(screen.queryByText("org/alpha")).not.toBeInTheDocument();
    expect(screen.getByText("org/beta")).toBeInTheDocument();
  });

  it("renders a loader when loading", () => {
    const { container } = render(
      <StepRepoPicker
        {...baseProps}
        loading={true}
        repositories={[repo("r1", "alpha")]}
      />,
    );
    expect(
      screen.queryByPlaceholderText(/searchRepoPlaceholder/i),
    ).not.toBeInTheDocument();
    // The Loader component renders something non-trivial
    expect(container.querySelector("[class*='animate']")).not.toBeNull();
  });

  it("renders the loader (not the connect CTA) while loading even if linked is still false (github)", () => {
    const { container } = render(
      <StepRepoPicker
        {...baseProps}
        source="github"
        linked={false}
        loading={true}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /connectGithub/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/notConnectedGithub/i),
    ).not.toBeInTheDocument();
    expect(container.querySelector("[class*='animate']")).not.toBeNull();
  });

  it("renders the loader (not the connect CTA) while loading even if linked is still false (gitlab)", () => {
    const { container } = render(
      <StepRepoPicker
        {...baseProps}
        source="gitlab"
        linked={false}
        loading={true}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /connectGitlab/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/notConnectedGitlab/i),
    ).not.toBeInTheDocument();
    expect(container.querySelector("[class*='animate']")).not.toBeNull();
  });

  it("renders the error message when error prop is set", () => {
    render(
      <StepRepoPicker
        {...baseProps}
        repositories={[repo("r1", "alpha")]}
        error="my-error"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("my-error");
  });
});
