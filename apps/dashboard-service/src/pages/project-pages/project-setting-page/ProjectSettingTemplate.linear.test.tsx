import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  The Issues tab is there when the project can send findings somewhere: a
  linked repository (GitHub, GitLab) or a connected tracker. Linear alone is
  enough, as Jira alone is, and the tab hands the Linear settings down.
*/

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-rebac', () => ({
  AuthorizedContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthorization: () => true,
}));
vi.mock('react-redux', () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({ organization: { selectedOrganization: { id: 'org-1' } } }),
}));
vi.mock('@/components/molecules/wrapper/ProjectTemplateWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/molecules/project-id-actions/ProjectIdActions', () => ({
  default: () => null,
}));
vi.mock('@/components/molecules/banners/SecurityContextBanner', () => ({
  default: () => null,
}));
vi.mock('@/components/organismes/project-settings/ScanningSettings', () => ({
  default: () => null,
}));
vi.mock('@/components/organismes/project-settings/NotificationsSettings', () => ({
  default: () => null,
}));
const issuesSettings = vi.hoisted(() => vi.fn());
vi.mock('@/components/organismes/project-settings/IssuesSettings', () => ({
  default: (props: unknown) => {
    issuesSettings(props);
    return <div data-testid="issues-settings" />;
  },
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ProjectSettingTemplate from './ProjectSettingTemplate';

type TemplateProps = React.ComponentProps<typeof ProjectSettingTemplate>;

const base = {
  projectTitle: 'api',
  projectId: 'p-1',
  teamName: 'Team A',
  teamId: 'team-1',
  applicationType: 'web_application',
  analysisFrequency: 'never',
  aiMergeRequestEnabled: true,
  improvingResultsEnabled: true,
  scanOnCommitEnabled: true,
  // No repository and no Jira: only Linear can make the Issues tab appear.
  isProjectLinkedToGithub: false,
  isProjectLinkedToGitlab: false,
  isJiraConnected: false,
  isLinearConnected: false,
  linearTeams: [{ id: 't-eng', key: 'ENG', name: 'Engineering' }],
  linearTeamOptions: null,
  linearConfig: null,
  isLinearConfigLoading: true,
  onLinearTeamChange: vi.fn(),
  onLinearProjectChange: vi.fn(),
  onLinearLabelsChange: vi.fn(),
  onLinearAllowedBranchesChange: vi.fn(),
  onLinearAutoCreateToggle: vi.fn(),
  isSlackConnected: false,
  slackChannelName: '',
  branches: [],
  issueBranchOptions: [],
  referenceBranch: null,
  jiraProjects: [],
  jiraConfig: null,
  securityContextEnvironment: 'production',
  securityContextInternetExposure: 'internal',
  securityContextDeploymentType: 'cloud',
  securityContextDataClassification: 'internal',
  securityContextHandlesPii: false,
  securityContextHandlesPaymentData: false,
  securityContextBusinessCriticality: 'medium',
  securityContextUserBaseSize: 'small',
  securityContextComplianceFrameworks: [],
  securityContextSafetyCritical: false,
  securityContextNetworkSegmentation: 'none',
  isSecurityContextCustomized: false,
  loading: false,
  onCybeAnalysisToggle: vi.fn(),
  onSecurityContextFieldChange: vi.fn(),
};

const renderAt = (url: string, extra: Partial<typeof base> = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ProjectSettingTemplate {...({ ...base, ...extra } as unknown as TemplateProps)} />
    </MemoryRouter>,
  );

const APPSEC = '/appsec/project/p-1/settings';
const ISSUES_TAB = 'pages.projectSetting.tabs.issues';

const menu = () =>
  within(screen.getByText('pages.projectSetting.globalSettingsTitle').parentElement as HTMLElement)
    .getAllByRole('button')
    .map((button) => button.textContent);

describe('ProjectSettingTemplate — the Issues tab and Linear', () => {
  it('has no Issues tab with no repository and no tracker connected', () => {
    renderAt(APPSEC);

    expect(menu()).not.toContain(ISSUES_TAB);
  });

  it('shows the Issues tab when only Linear is connected', () => {
    renderAt(APPSEC, { isLinearConnected: true });

    expect(menu()).toContain(ISSUES_TAB);
  });

  it('hands the Linear settings down to the Issues tab', () => {
    issuesSettings.mockClear();
    renderAt(`${APPSEC}?tab=issues`, { isLinearConnected: true });

    expect(screen.getByTestId('issues-settings')).toBeInTheDocument();
    expect(issuesSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        isLinearConnected: true,
        linearTeams: base.linearTeams,
        linearTeamOptions: null,
        linearConfig: null,
        isLinearConfigLoading: true,
        onLinearTeamChange: base.onLinearTeamChange,
        onLinearProjectChange: base.onLinearProjectChange,
        onLinearLabelsChange: base.onLinearLabelsChange,
        onLinearAllowedBranchesChange: base.onLinearAllowedBranchesChange,
        onLinearAutoCreateToggle: base.onLinearAutoCreateToggle,
      }),
    );
  });
});
