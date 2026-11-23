import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  generateGitlabInstallUrl: vi.fn(),
  githubAppUrl: '',
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: h.toastError, info: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const state = vi.hoisted(() => ({
  organization: { selectedOrganization: { id: 'org-1', subscription: { writesBlocked: false } } },
  user: { id: 'user-1', isProfileLoaded: true },
}));
vi.mock('react-redux', () => ({
  useSelector: (select: (s: typeof state) => unknown) => select(state),
}));
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: 'administrator' }] }),
  useAuthorization: () => true,
}));
vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
vi.mock('@/server/hooks/useIntegrationsOverview', () => ({
  useIntegrationsOverview: () => ({
    isGithubLinked: false,
    isGitlabLinked: false,
    isJiraLinked: false,
    isLinearLinked: false,
    isSlackLinked: false,
    isGitlabReconnectRequired: false,
    githubInstallationOwnerId: null,
    gitlabInstallationOwnerId: null,
    getRegistryCountByType: () => 0,
    refetch: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  generateGitlabInstallUrl: (...a: unknown[]) => h.generateGitlabInstallUrl(...a),
}));
vi.mock('@/config/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/runtimeConfig')>()),
  getGithubAppUrl: () => h.githubAppUrl,
}));
vi.mock('./SettingsOrganizationIntegrationTemplate', () => ({
  default: (props: { onGitlabClick: () => void; onGithubClick: () => void }) => (
    <div>
      <button onClick={props.onGitlabClick}>gitlab</button>
      <button onClick={props.onGithubClick}>github</button>
    </div>
  ),
}));

import SettingsOrganizationIntegrationPage from './SettingsOrganizationIntegrationPage';

beforeEach(() => {
  h.toastError.mockReset();
  h.generateGitlabInstallUrl.mockReset();
  h.githubAppUrl = '';
});

// On a self-hosted instance an integration may have no credentials: the page
// says so and points to the setup guide instead of a generic failure.
describe('Integrations page, an integration not configured on this instance', () => {
  it('says GitLab is not configured when the server answers GITLAB_NOT_CONFIGURED', async () => {
    h.generateGitlabInstallUrl.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { status: 400, data: { message: 'GITLAB_NOT_CONFIGURED' } } }),
    );
    render(<SettingsOrganizationIntegrationPage />);
    fireEvent.click(screen.getByText('gitlab'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toMatch(/^GitLab is not configured on this instance\./);
    expect(within(notice.container).getByRole('link', { name: /Optional integrations/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/deploy\/community\/README\.md#optional-integrations$/),
    );
  });

  it('keeps the GitLab install error for any other failure', async () => {
    h.generateGitlabInstallUrl.mockRejectedValue(new Error('network'));
    render(<SettingsOrganizationIntegrationPage />);
    fireEvent.click(screen.getByText('gitlab'));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).not.toMatch(/not configured on this instance/);
  });

  it('says GitHub is not configured when the instance has no GitHub App address', () => {
    render(<SettingsOrganizationIntegrationPage />);
    fireEvent.click(screen.getByText('github'));

    expect(h.toastError).toHaveBeenCalledTimes(1);
    const notice = render(<>{h.toastError.mock.calls[0][0]}</>);
    expect(notice.container.textContent).toMatch(/^GitHub is not configured on this instance\./);
    expect(within(notice.container).getByRole('link', { name: /Optional integrations/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/deploy\/community\/README\.md#optional-integrations$/),
    );
  });
});
