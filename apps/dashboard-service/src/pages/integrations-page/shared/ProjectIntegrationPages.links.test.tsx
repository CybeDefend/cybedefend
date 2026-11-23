import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { IntegrationHook, IntegrationPageConfig } from '@/server/interfaces/IntegrationProvider';

/**
 * Where the pages of the project import through GitHub or GitLab lead. They are
 * AppSec pages: every step and every way out stays in AppSec, and the home they
 * go back to is the AppSec home, not the root (which would hand the account to
 * the landing rule).
 */

// The edition, switched per case: after a link the cloud opens the AppSec home
// (its project list), the Community Edition its project list at /appsec/projects.
const ed = vi.hoisted(() => ({ edition: 'cloud' as 'community' | 'cloud' }));
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  createProject: vi.fn(),
  linkRepository: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => h.navigate,
  useHref: (to: string) => to,
  useLinkClickHandler: () => vi.fn(),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/hooks/useOrganizationProjects', () => ({
  default: () => ({
    projects: [{ projectId: 'proj-1', name: 'Project Alpha' }],
    totalProjects: 1,
    totalPages: 1,
    currentPage: 1,
    loading: false,
    error: null,
    goToPage: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('@/server/hooks/useGithubIntegrationAdapter', () => ({
  useGithubIntegrationAdapter: () => ({ repositories: [], isLoadingRepositories: false }),
}));
vi.mock('@/server/hooks/useGitlabIntegrationAdapter', () => ({
  useGitlabIntegrationAdapter: () => ({ repositories: [], isLoadingRepositories: false }),
}));
vi.mock('@/server/hooks/useOptimizedCrossProviderLinking', () => ({
  useOptimizedCrossProviderLinking: () => ({ isProjectLinkedToOtherProvider: () => ({ isLinked: false }) }),
}));
vi.mock('@/components/molecules/pagination/Pagination', () => ({ default: () => null }));
vi.mock('@/components/atoms/modal/Modal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
}));
vi.mock('@/components/atoms/button/BackButton', () => ({
  default: ({ text, to }: { text: string; to: string }) => <a href={to}>{text}</a>,
}));
vi.mock('@/server/services/teamService', () => ({
  fetchAllTeams: vi.fn().mockResolvedValue([{ id: 'team-1', name: 'Team One' }]),
}));
vi.mock('@/server/services/projectService', () => ({
  createProject: (...args: unknown[]) => h.createProject(...args),
  deleteProject: vi.fn(),
}));
vi.mock('@/server/services/userService', () => ({ completeOnboardingStep: vi.fn().mockResolvedValue(undefined) }));

import { ProjectIntegrationOnboardingPage } from './ProjectIntegrationOnboardingPage';
import { ProjectIntegrationLinkExistingPage } from './ProjectIntegrationLinkExistingPage';
import { ProjectIntegrationCreateProjectsPage } from './ProjectIntegrationCreateProjectsPage';

const store = configureStore({
  reducer: {
    organization: () => ({ selectedOrganization: { id: 'org-1', subscription: { writesBlocked: false } } }),
  },
});

const useIntegration = (): IntegrationHook => ({
  repositories: [{ id: 'repo-1', name: 'my-repo', fullName: 'acme/my-repo', nameWithNamespace: 'acme/my-repo', projectId: null }],
  isLoadingRepositories: false,
  linkRepository: h.linkRepository,
  isLinkingRepository: false,
});

const configFor = (backToPath: string): IntegrationPageConfig => ({
  provider: 'github',
  translationKey: 'github',
  backToPath,
  icon: null,
});

const renderInStore = (page: React.ReactElement) => render(<Provider store={store}>{page}</Provider>);

beforeEach(() => {
  ed.edition = 'cloud';
  h.navigate.mockReset();
  h.createProject.mockReset();
  h.linkRepository.mockReset();
  h.linkRepository.mockResolvedValue(undefined);
});

describe('ProjectIntegrationOnboardingPage — links', () => {
  it('leads to each step of the import under the AppSec prefix', () => {
    const { container } = renderInStore(
      <ProjectIntegrationOnboardingPage config={configFor('/appsec')} useIntegrationHook={useIntegration} />,
    );
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/appsec/project/integration/github/link');
    expect(hrefs).toContain('/appsec/project/integration/github/create');
    expect(hrefs.filter((href) => href?.startsWith('/project/'))).toEqual([]);
  });

  it('goes back to the home its config names, not to the root', () => {
    renderInStore(
      <ProjectIntegrationOnboardingPage config={configFor('/appsec')} useIntegrationHook={useIntegration} />,
    );
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/appsec');
  });
});

describe('ProjectIntegrationLinkExistingPage — after a link', () => {
  it('opens the AppSec home once the repository is linked', async () => {
    const user = userEvent.setup();
    renderInStore(
      <ProjectIntegrationLinkExistingPage
        config={configFor('/appsec/project/integration/github')}
        useIntegrationHook={useIntegration}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/appsec'));
    expect(h.linkRepository).toHaveBeenCalledWith('proj-1', 'repo-1');
  });

  it('community: opens the AppSec project list once the repository is linked', async () => {
    ed.edition = 'community';
    const user = userEvent.setup();
    renderInStore(
      <ProjectIntegrationLinkExistingPage
        config={configFor('/appsec/project/integration/github')}
        useIntegrationHook={useIntegration}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/appsec/projects'));
    expect(h.linkRepository).toHaveBeenCalledWith('proj-1', 'repo-1');
  });

  it('goes back to the step its config names', () => {
    renderInStore(
      <ProjectIntegrationLinkExistingPage
        config={configFor('/appsec/project/integration/github')}
        useIntegrationHook={useIntegration}
      />,
    );
    expect(screen.getByRole('link', { name: /back to choice/i })).toHaveAttribute(
      'href',
      '/appsec/project/integration/github',
    );
  });
});

// The creation case is tested with the closed extension: it waits for the
// AI features toggle, a closed-tree slot.

describe('ProjectIntegrationCreateProjectsPage — after a creation in the Community Edition', () => {
  // The page has no edition branch: it opens the AppSec SAST page of the first
  // project created, which the Community route table serves
  // (src/routes/routeTable.test.tsx). No AI toggle is rendered there, so the
  // team picker says that the teams were read.
  it('opens the SAST page of the first project created, in AppSec, whatever AI setting the edition shows', async () => {
    h.createProject.mockResolvedValue({ projectId: 'proj-new' });
    const { container } = renderInStore(
      <ProjectIntegrationCreateProjectsPage
        config={configFor('/appsec/project/integration/github')}
        useIntegrationHook={useIntegration}
      />,
    );
    await screen.findByText('Team One');
    const checkbox = container.querySelector('input[name="repo-repo-1"]');
    if (!checkbox) throw new Error('the repository has no checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /create.*project/i }));

    // The page waits four seconds on its loader before it moves.
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/appsec/project/proj-new/sast'), {
      timeout: 6000,
    });
    expect(h.linkRepository).toHaveBeenCalledWith('proj-new', 'repo-1');
    expect(h.createProject.mock.calls[0][0]).toBe('team-1');
  }, 10000);
});
