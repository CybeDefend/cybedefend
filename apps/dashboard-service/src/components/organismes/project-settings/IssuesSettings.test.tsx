import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// i18n stub: return the defaultValue (positional string or { defaultValue })
// when provided, otherwise echo the key — same pattern as BranchSelector.test.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import IssuesSettings from './IssuesSettings';

// Minimal props for the GitHub/GitLab issue-creation branch multi-select to render.
const baseProps = {
  isProjectLinkedToGithub: true,
  isProjectLinkedToGitlab: false,
  githubIssueEnabled: true,
  onGithubIssueToggle: vi.fn(),
  gitlabIssueEnabled: false,
  onGitlabIssueToggle: vi.fn(),
  isJiraConnected: false,
  jiraProjects: [],
  jiraConfig: null,
  onJiraProjectChange: vi.fn(),
  onJiraAllowedBranchesChange: vi.fn(),
  onJiraAutoCreateToggle: vi.fn(),
  isLinearConnected: false,
  linearTeams: [],
  linearTeamOptions: null,
  linearConfig: null,
  onLinearTeamChange: vi.fn(),
  onLinearProjectChange: vi.fn(),
  onLinearLabelsChange: vi.fn(),
  onLinearAllowedBranchesChange: vi.fn(),
  onLinearAutoCreateToggle: vi.fn(),
  issueCreationMode: 'per_vulnerability_type',
  onIssueCreationModeChange: vi.fn(),
  onIssueCreationBranchesChange: vi.fn(),
};

describe('IssuesSettings — Jira allowed-branches multi-select (backend search)', () => {
  it('renders a Jira allowedBranch that is NOT in the current backend page as a checked chip', () => {
    // Current backend page only contains `main` and `dev`. The Jira config
    // already has `release-99` in allowedBranches (lives on a different page).
    // It MUST still appear, selected, in the Jira branch dropdown so the user
    // can see/deselect it.
    render(
      <IssuesSettings
        {...(baseProps as any)}
        isJiraConnected
        jiraProjects={[{ projectId: 'PROJ-1', key: 'PROJ', name: 'Project One', avatarUrl: '' }]}
        jiraConfig={{
          isConfigured: true,
          jiraProjectId: 'PROJ-1',
          jiraProjectKey: 'PROJ',
          jiraProjectName: 'Project One',
          allowedBranches: ['release-99'],
          autoCreateEnabled: false,
        }}
        branches={[{ name: 'main', isDefault: true }, { name: 'dev' }]}
        issueCreationBranches={[]}
      />,
    );

    // Open the Jira branch multi-select: it is the first multi-select button
    // rendered (inside the Jira section, which appears before GitHub/GitLab).
    const buttons = screen.getAllByRole('button');
    // The Jira branch select trigger is the second button (first is the Jira
    // project single-select). Click it to open the dropdown.
    const trigger = buttons[1];
    fireEvent.click(trigger);

    // The off-page selected branch must appear in the dropdown as a checked option.
    const releaseCheckbox = screen.getByDisplayValue('release-99') as HTMLInputElement;
    expect(releaseCheckbox).toBeInTheDocument();
    expect(releaseCheckbox.checked).toBe(true);
  });
});

describe('IssuesSettings — issue-creation branch multi-select (backend search)', () => {
  it('renders a selected branch that is NOT in the current backend page as a checked chip', () => {
    // Current backend page only contains `main` and `dev`. The project already
    // has `release-42` selected (it lives on a different page). It MUST still
    // appear, selected, in the dropdown so the user can see/deselect it.
    render(
      <IssuesSettings
        {...(baseProps as any)}
        branches={[{ name: 'main', isDefault: true }, { name: 'dev' }]}
        issueCreationBranches={['release-42']}
      />,
    );

    // Open the branch multi-select (last combobox button rendered).
    const buttons = screen.getAllByRole('button');
    const trigger = buttons[buttons.length - 1];
    fireEvent.click(trigger);

    // The off-page selected branch must be present in the dropdown options.
    const releaseCheckbox = screen.getByDisplayValue('release-42') as HTMLInputElement;
    expect(releaseCheckbox).toBeInTheDocument();
    expect(releaseCheckbox.checked).toBe(true);
  });

  it('lifts the search term up via onBranchSearchChange instead of filtering client-side', () => {
    const onBranchSearchChange = vi.fn();
    render(
      <IssuesSettings
        {...(baseProps as any)}
        branches={[{ name: 'feature-x' }]}
        issueCreationBranches={[]}
        branchesAsync
        onBranchSearchChange={onBranchSearchChange}
        onBranchLoadMore={vi.fn()}
        branchesHasMore={false}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const trigger = buttons[buttons.length - 1];
    fireEvent.click(trigger);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'zzz' } });

    expect(onBranchSearchChange).toHaveBeenCalledWith('zzz');
    // Client-side filtering is disabled in async mode: `feature-x` stays visible
    // even though it doesn't match the query.
    expect(screen.getByText('feature-x')).toBeInTheDocument();
  });
});
