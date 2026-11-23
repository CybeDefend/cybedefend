import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Its first case imports the edition entry, which evaluates the closed tree
// (several seconds alone); under the full suite's load that passed 5 s.
vi.setConfig({ testTimeout: 30_000 });
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { EMPTY_EXTENSIONS } from '@/edition/extensions';

/*
  The wizard of a build with no closed space (EMPTY_EXTENSIONS, what the
  Community Edition registers): the core steps alone, whatever space the
  caller names, and the wizard closes once the project is created. Each case
  re-imports the modal under a mocked `@/edition/active`, so the product
  registry is read as it would be in that edition.
*/

const h = vi.hoisted(() => ({
  generateGitlabInstallUrl: vi.fn(),
  toastError: vi.fn(),
  githubAppUrl: '',
  githubLinked: true,
}));
vi.mock('@/server/hooks/useIntegrationsOverview', () => ({
  useCombinedIntegrations: () => ({
    isGithubLinked: h.githubLinked,
    isGitlabLinked: false,
    githubRepositories: [{ id: 'r-1', name: 'api', fullName: 'org/api', nameWithNamespace: 'org/api', projectId: null }],
    gitlabRepositories: [],
    isLoadingGithubRepos: false,
    isLoadingGitlabRepos: false,
    isLoadingOverview: false,
    isLoadingAny: false,
  }),
}));
vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({ linkGithubRepository: vi.fn() }));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  generateGitlabInstallUrl: (...a: unknown[]) => h.generateGitlabInstallUrl(...a),
  linkGitlabRepository: vi.fn(),
}));
vi.mock('@/config/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/runtimeConfig')>()),
  getGithubAppUrl: () => h.githubAppUrl,
}));
vi.mock('@/server/services/projectService', () => ({ createProjectAndLinkRepository: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'current' in opts && 'total' in opts ? `${key} ${String(opts.current)}/${String(opts.total)}` : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const TITLES = [
  'components.modal.createProject.step1Title',
  'components.modal.createProject.step2Title',
  'components.modal.createProject.step3Title',
];

async function renderModal(props: Record<string, unknown> = {}) {
  const { default: CreateProjectModal } = await import('./CreateProjectModal');
  const store = configureStore({
    reducer: { organization: () => ({ selectedOrganization: { id: 'org-1', subscription: { writesBlocked: false } } }) },
  });
  const onClose = vi.fn();
  const onCreateProject = vi.fn().mockResolvedValue({ projectId: 'p-1', name: 'api' });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <CreateProjectModal
          onClose={onClose}
          onCreateProject={onCreateProject}
          teams={[{ label: 'Team A', value: 'team-a' }]}
          {...(props as object)}
        />
      </MemoryRouter>
    </Provider>,
  );
  return { onClose, onCreateProject };
}

const stepTitles = (): string[] =>
  TITLES.filter((title) => screen.queryByText(title) !== null);

describe('CreateProjectModal with no closed space', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/edition/active', () => ({ ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS, ACTIVE_SLOTS: [] }));
  });
  afterEach(() => {
    vi.doUnmock('@/edition/active');
  });

  it('with no closed space the wizard shows the AppSec steps only, and never names another product', async () => {
    // A space the build does not know is the AppSec space.
    await renderModal({ product: 'other' });
    expect(screen.queryByText(/vibe/i)).toBeNull();
    expect(stepTitles()).toEqual(TITLES);
    expect(screen.getByText(/stepIndicator\.current/)).toHaveTextContent('1/3');
  });

  it('closes once the project is created: there is no step after the creation', async () => {
    const { onClose, onCreateProject } = await renderModal({ product: 'other' });
    fireEvent.click(screen.getByRole('button', { name: /components\.modal\.createProject\.manualCreation/ }));
    fireEvent.change(screen.getByPlaceholderText(/enterProjectName/), { target: { value: 'api' } });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.next/ }));
    fireEvent.click(screen.getByRole('button', { name: /buttons\.skipAndCreate/ }));
    await waitFor(() => expect(onCreateProject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/vibe/i)).toBeNull();
  });
});

// On a self-hosted instance GitHub or GitLab may have no credentials: the
// wizard says so and points to the setup guide instead of failing silently.
describe('CreateProjectModal, a source not configured on this instance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/edition/active', () => ({ ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS, ACTIVE_SLOTS: [] }));
    h.toastError.mockReset();
    h.generateGitlabInstallUrl.mockReset();
  });
  afterEach(() => {
    vi.doUnmock('@/edition/active');
  });

  it('says GitLab is not configured when the server answers GITLAB_NOT_CONFIGURED', async () => {
    h.generateGitlabInstallUrl.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 400, data: { message: 'GITLAB_NOT_CONFIGURED' } } }),
    );
    await renderModal({ product: 'other', initialSource: 'gitlab' });
    fireEvent.click(screen.getByText('components.modal.createProject.step1.connectGitlab'));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toContain('components.integrationNotConfigured.gitlab');
    expect(within(notice.container).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/#optional-integrations$/));
  });

  it('says GitHub is not configured when the instance has no GitHub App address', async () => {
    h.githubAppUrl = '';
    h.githubLinked = false;
    try {
      await renderModal({ product: 'other', initialSource: 'github' });
      fireEvent.click(screen.getByText('components.modal.createProject.step1.connectGithub'));
      expect(h.toastError).toHaveBeenCalledTimes(1);
      const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
      expect(notice.container.textContent).toContain('components.integrationNotConfigured.github');
      expect(within(notice.container).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/#optional-integrations$/));
    } finally {
      h.githubLinked = true;
    }
  });
});
