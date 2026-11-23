import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Real `en` strings: an assertion on visible English also proves the key exists.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import IssuesSettings from './IssuesSettings';
import type {
  LinearProjectConfig,
  LinearTeam,
  LinearTeamOptions,
} from '@/server/services/integrations/linearIntegrationsService';

const TEAMS: LinearTeam[] = [
  { id: 'team-eng', key: 'ENG', name: 'Engineering' },
  { id: 'team-ops', key: 'OPS', name: 'Operations' },
];

const OPTIONS: LinearTeamOptions = {
  projects: [
    { id: 'lp-sec', name: 'Security fixes' },
    { id: 'lp-debt', name: 'Tech debt' },
  ],
  labels: [
    { id: 'lb-vuln', name: 'Vulnerability' },
    { id: 'lb-sec', name: 'Security' },
  ],
  members: [],
};

const CONFIG: LinearProjectConfig = {
  isConfigured: true,
  teamId: 'team-eng',
  teamKey: 'ENG',
  teamName: 'Engineering',
  linearProjectId: '',
  linearProjectName: '',
  labels: [],
  allowedBranches: [],
  autoCreateEnabled: false,
};

const noop = () => {};

const baseProps = {
  isProjectLinkedToGithub: false,
  isProjectLinkedToGitlab: false,
  githubIssueEnabled: false,
  onGithubIssueToggle: noop,
  gitlabIssueEnabled: false,
  onGitlabIssueToggle: noop,
  isJiraConnected: false,
  jiraProjects: [],
  jiraConfig: null,
  onJiraProjectChange: noop,
  onJiraAllowedBranchesChange: noop,
  onJiraAutoCreateToggle: noop,
  isLinearConnected: true,
  linearTeams: TEAMS,
  linearTeamOptions: null as LinearTeamOptions | null,
  linearConfig: null as LinearProjectConfig | null,
  onLinearTeamChange: vi.fn(),
  onLinearProjectChange: vi.fn(),
  onLinearLabelsChange: vi.fn(),
  onLinearAllowedBranchesChange: vi.fn(),
  onLinearAutoCreateToggle: vi.fn(),
  issueCreationMode: 'per_vulnerability_type',
  onIssueCreationModeChange: noop,
  issueCreationBranches: [] as string[],
  onIssueCreationBranchesChange: noop,
  branches: [{ name: 'main', isDefault: true }, { name: 'dev' }],
};

/** The open dropdown (the atom portals it to the body). */
const openList = () => within(document.querySelector('[data-select-dropdown="true"]') as HTMLElement);

describe('IssuesSettings — Linear section', () => {
  it('shows the Linear section only when Linear is connected', () => {
    const { rerender } = render(<IssuesSettings {...baseProps} isLinearConnected={false} />);

    expect(screen.queryByText('Linear Tickets')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Target Linear team')).not.toBeInTheDocument();

    rerender(<IssuesSettings {...baseProps} isLinearConnected />);

    expect(screen.getByText('Linear Tickets')).toBeInTheDocument();
    expect(screen.getByLabelText('Target Linear team')).toBeInTheDocument();
  });

  it('choosing a team loads its projects and labels', () => {
    const onLinearTeamChange = vi.fn();
    const { rerender } = render(<IssuesSettings {...baseProps} onLinearTeamChange={onLinearTeamChange} />);

    // The team list is the workspace's: the team's own projects and labels are not read yet.
    fireEvent.click(screen.getByLabelText('Target Linear team'));
    expect(openList().getByText('Engineering (ENG)')).toBeInTheDocument();
    expect(openList().getByText('Operations (OPS)')).toBeInTheDocument();
    fireEvent.click(openList().getByText('Engineering (ENG)'));

    // The choice is handed up by id: the page saves it and reads that team's options.
    expect(onLinearTeamChange).toHaveBeenCalledTimes(1);
    expect(onLinearTeamChange).toHaveBeenCalledWith('team-eng');

    // Once the page has them, the project and labels selects offer the team's options.
    rerender(
      <IssuesSettings
        {...baseProps}
        onLinearTeamChange={onLinearTeamChange}
        linearConfig={CONFIG}
        linearTeamOptions={OPTIONS}
      />,
    );

    fireEvent.click(screen.getByLabelText('Linear project (optional)'));
    expect(openList().getByText('Security fixes')).toBeInTheDocument();
    expect(openList().getByText('Tech debt')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Linear project (optional)'));

    fireEvent.click(screen.getByLabelText('Labels for Linear tickets'));
    expect(openList().getByDisplayValue('lb-vuln')).toBeInTheDocument();
    expect(openList().getByDisplayValue('lb-sec')).toBeInTheDocument();
  });

  it('the project, labels, branches and auto-create controls appear once a team is set', () => {
    const { rerender } = render(<IssuesSettings {...baseProps} linearConfig={null} />);

    // No team yet: only the team field.
    expect(screen.getByLabelText('Target Linear team')).toBeInTheDocument();
    expect(screen.queryByLabelText('Linear project (optional)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Labels for Linear tickets')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Allowed branches for Linear tickets')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto-create tickets after scans')).not.toBeInTheDocument();

    rerender(<IssuesSettings {...baseProps} linearConfig={CONFIG} linearTeamOptions={OPTIONS} />);

    expect(screen.getByLabelText('Linear project (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Labels for Linear tickets')).toBeInTheDocument();
    expect(screen.getByLabelText('Allowed branches for Linear tickets')).toBeInTheDocument();
    expect(screen.getByText('Auto-create tickets after scans')).toBeInTheDocument();
    expect(screen.getByText('Configured: tickets will be created in Engineering (ENG)')).toBeInTheDocument();
  });

  it('disables the team select while the project’s saved config is being read', () => {
    const onLinearTeamChange = vi.fn();
    const { rerender } = render(
      <IssuesSettings {...baseProps} isLinearConfigLoading onLinearTeamChange={onLinearTeamChange} />,
    );

    // A team picked now would be saved over the stored branches and auto-create.
    const trigger = screen.getByLabelText('Target Linear team');
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(document.querySelector('[data-select-dropdown="true"]')).toBeNull();
    expect(onLinearTeamChange).not.toHaveBeenCalled();

    rerender(<IssuesSettings {...baseProps} isLinearConfigLoading={false} onLinearTeamChange={onLinearTeamChange} />);
    expect(screen.getByLabelText('Target Linear team')).toBeEnabled();
  });

  it('leaves the team select enabled when the loading flag is not given', () => {
    render(<IssuesSettings {...baseProps} />);

    expect(screen.getByLabelText('Target Linear team')).toBeEnabled();
  });

  it('names the configured team even before the workspace teams are read', () => {
    render(<IssuesSettings {...baseProps} linearTeams={[]} linearConfig={CONFIG} />);

    expect(screen.getByLabelText('Target Linear team')).toHaveTextContent('Engineering (ENG)');
  });

  it('hands up the project, labels, branches and auto-create choices', () => {
    const onLinearProjectChange = vi.fn();
    const onLinearLabelsChange = vi.fn();
    const onLinearAllowedBranchesChange = vi.fn();
    const onLinearAutoCreateToggle = vi.fn();
    render(
      <IssuesSettings
        {...baseProps}
        linearConfig={{ ...CONFIG, labels: [{ id: 'lb-vuln', name: 'Vulnerability' }] }}
        linearTeamOptions={OPTIONS}
        onLinearProjectChange={onLinearProjectChange}
        onLinearLabelsChange={onLinearLabelsChange}
        onLinearAllowedBranchesChange={onLinearAllowedBranchesChange}
        onLinearAutoCreateToggle={onLinearAutoCreateToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText('Linear project (optional)'));
    fireEvent.click(openList().getByText('Tech debt'));
    expect(onLinearProjectChange).toHaveBeenCalledWith('lp-debt');

    // The labels select starts from the labels already saved and adds one.
    fireEvent.click(screen.getByLabelText('Labels for Linear tickets'));
    fireEvent.click(openList().getByDisplayValue('lb-sec'));
    expect(onLinearLabelsChange).toHaveBeenCalledWith(['lb-vuln', 'lb-sec']);
    fireEvent.click(screen.getByLabelText('Labels for Linear tickets'));

    fireEvent.click(screen.getByLabelText('Allowed branches for Linear tickets'));
    fireEvent.click(openList().getByDisplayValue('dev'));
    expect(onLinearAllowedBranchesChange).toHaveBeenCalledWith(['dev']);
    fireEvent.click(screen.getByLabelText('Allowed branches for Linear tickets'));

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onLinearAutoCreateToggle).toHaveBeenCalledTimes(1);
  });

  it('offers to stop creating Linear tickets, and to drop the Linear project', () => {
    const onLinearTeamChange = vi.fn();
    const onLinearProjectChange = vi.fn();
    render(
      <IssuesSettings
        {...baseProps}
        linearConfig={{ ...CONFIG, linearProjectId: 'lp-sec', linearProjectName: 'Security fixes' }}
        linearTeamOptions={OPTIONS}
        onLinearTeamChange={onLinearTeamChange}
        onLinearProjectChange={onLinearProjectChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Linear project (optional)'));
    fireEvent.click(openList().getByText('No Linear project'));
    expect(onLinearProjectChange).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByLabelText('Target Linear team'));
    fireEvent.click(openList().getByText('No team (stop creating Linear tickets)'));
    expect(onLinearTeamChange).toHaveBeenCalledWith(null);
  });

  it('notes the branches Linear tickets are restricted to', () => {
    render(
      <IssuesSettings
        {...baseProps}
        linearConfig={{ ...CONFIG, allowedBranches: ['main', 'release-9'] }}
        linearTeamOptions={OPTIONS}
      />,
    );

    expect(
      screen.getByText('Linear tickets will only be created for scans on 2 branch(es): main, release-9'),
    ).toBeInTheDocument();
  });
});
