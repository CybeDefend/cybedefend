import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

/**
 * The integration onboarding offers to link existing projects while some
 * project of the organization is linked to no repository.
 * It looked at the first page of 10 projects only, so an organization whose
 * first 10 projects were linked never saw the card, and it fetched the OTHER
 * provider's repositories to learn what each project already says in
 * isGithubLinked / isGitlabLinked.
 */

const h = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  totalProjects: 0,
  githubAdapter: vi.fn(),
  gitlabAdapter: vi.fn(),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useHref: (to: string) => to,
  useLinkClickHandler: () => vi.fn(),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));
vi.mock('@/server/hooks/useOrganizationProjects', () => ({
  default: () => ({ projects: h.projects, totalProjects: h.totalProjects, loading: false }),
}));
vi.mock('@/server/hooks/useGithubIntegrationAdapter', () => ({
  useGithubIntegrationAdapter: h.githubAdapter,
}));
vi.mock('@/server/hooks/useGitlabIntegrationAdapter', () => ({
  useGitlabIntegrationAdapter: h.gitlabAdapter,
}));
vi.mock('@/components/atoms/button/BackButton', () => ({
  default: ({ text }: { text: string }) => <button>{text}</button>,
}));

import { ProjectIntegrationOnboardingPage } from './ProjectIntegrationOnboardingPage';

const project = (i: number, linked: { github?: boolean; gitlab?: boolean } = {}) => ({
  projectId: `p-${i}`,
  name: `Project ${i}`,
  isGithubLinked: linked.github ?? false,
  isGitlabLinked: linked.gitlab ?? false,
});

/** The GitHub hook of the page: the repositories linked to the first page's projects. */
const githubRepositories = (count: number) => ({
  repositories: Array.from({ length: count }, (_, i) => ({
    id: `repo-${i}`,
    name: `repo-${i}`,
    projectId: `p-${i}`,
  })),
  isLoadingRepositories: false,
  linkRepository: vi.fn(),
  isLinkingRepository: false,
});

const config = {
  provider: 'github',
  translationKey: 'github',
  backToPath: '/integrations',
  icon: null,
} as never;

const renderPage = (useIntegrationHook: () => unknown) =>
  render(
    <Provider
      store={configureStore({
        reducer: {
          organization: () => ({
            selectedOrganization: { id: 'org-1', subscription: { writesBlocked: false } },
          }),
        },
      })}
    >
      <ProjectIntegrationOnboardingPage config={config} useIntegrationHook={useIntegrationHook as never} />
    </Provider>,
  );

const linkCard = () => document.querySelector('a[href*="/link"]');

describe('ProjectIntegrationOnboardingPage — the « link existing projects » card', () => {
  beforeEach(() => {
    h.githubAdapter.mockReset();
    h.gitlabAdapter.mockReset();
    const none = { repositories: [], isLoadingRepositories: false };
    h.githubAdapter.mockReturnValue(none);
    h.gitlabAdapter.mockReturnValue(none);
  });

  it('is offered with 15 projects whose first page of 10 is linked', () => {
    h.projects = Array.from({ length: 10 }, (_, i) => project(i, { github: true }));
    h.totalProjects = 15;

    renderPage(() => githubRepositories(10));

    expect(linkCard()).not.toBeNull();
  });

  it('is not offered when every project of the organization is linked', () => {
    h.projects = [project(0, { github: true }), project(1, { gitlab: true })];
    h.totalProjects = 2;

    renderPage(() => githubRepositories(1));

    expect(linkCard()).toBeNull();
  });

  it('counts the projects linked to no provider when they are all on the page', () => {
    h.projects = [project(0, { github: true }), project(1, { gitlab: true }), project(2), project(3)];
    h.totalProjects = 4;

    renderPage(() => githubRepositories(1));

    expect(linkCard()).not.toBeNull();
    expect(screen.getByText(/^2 projects? available/)).toBeInTheDocument();
  });

  it("does not load the other provider's repositories", () => {
    h.projects = [project(0)];
    h.totalProjects = 1;

    renderPage(() => githubRepositories(0));

    expect(h.gitlabAdapter).not.toHaveBeenCalled();
    expect(h.githubAdapter).not.toHaveBeenCalled();
  });
});
