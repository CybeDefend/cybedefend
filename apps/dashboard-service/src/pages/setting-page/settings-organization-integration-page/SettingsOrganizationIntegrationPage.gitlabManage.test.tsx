import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const state = vi.hoisted(() => ({
  organization: { selectedOrganization: { id: 'org-1', subscription: { writesBlocked: false } } },
  user: { id: 'user-1', isProfileLoaded: true },
}));
vi.mock('react-redux', () => ({
  useSelector: (select: (s: typeof state) => unknown) => select(state),
}));

// The member's one relation to the organization; useAuthorization answers from
// it as the real hook does from the loaded entities.
const relation = vi.hoisted(() => ({ current: 'member' }));
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization', relation: relation.current }] }),
  useAuthorization: (entityId: string, entityType: string, relationships: string[]) =>
    entityId === 'org-1' && entityType === 'organization' && relationships.includes(relation.current),
}));

vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));
vi.mock('@/server/hooks/useIntegrationsOverview', () => ({
  useIntegrationsOverview: () => ({
    isGithubLinked: false,
    isGitlabLinked: true,
    isJiraLinked: false,
    isLinearLinked: false,
    isSlackLinked: false,
    isGitlabReconnectRequired: false,
    githubInstallationOwnerId: null,
    gitlabInstallationOwnerId: 'user-2',
    getRegistryCountByType: () => 0,
    refetch: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock('@/server/services/integrations/gitlabIntegrationsService', () => ({
  generateGitlabInstallUrl: vi.fn(),
}));
vi.mock('./SettingsOrganizationIntegrationTemplate', () => ({
  default: (props: { canManageGitlab?: boolean }) => (
    <div data-testid="integrations-template" data-can-manage-gitlab={String(props.canManageGitlab)} />
  ),
}));

import SettingsOrganizationIntegrationPage from './SettingsOrganizationIntegrationPage';

describe('Integrations page, who may reconnect or disconnect GitLab', () => {
  // Permify: manage_integration = writable and (creator or administrator or manager).
  it.each([
    ['creator', 'true'],
    ['administrator', 'true'],
    ['manager', 'true'],
    ['member', 'false'],
  ])('an organization %s: %s', (role, expected) => {
    relation.current = role;

    render(<SettingsOrganizationIntegrationPage />);

    expect(screen.getByTestId('integrations-template').getAttribute('data-can-manage-gitlab')).toBe(expected);
  });
});
