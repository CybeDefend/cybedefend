import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/api/gatewayAPI', () => ({ default: {} }));
vi.mock('@/server/services/integrations/jiraIntegrationsService', () => ({
  createJiraIssues: vi.fn(),
  linkJiraIssue: vi.fn(),
}));
vi.mock('@/server/services/integrations/linearIntegrationsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/integrations/linearIntegrationsService')>()),
  createLinearIssues: vi.fn(),
  linkLinearIssue: vi.fn(),
  listLinearTeams: vi.fn(),
  getLinearTeamOptions: vi.fn(),
}));

import { toast } from 'react-toastify';
import TicketTracker from './TicketTracker';
import { createJiraIssues, linkJiraIssue } from '@/server/services/integrations/jiraIntegrationsService';
import {
  linkLinearIssue,
  listLinearTeams,
  getLinearTeamOptions,
} from '@/server/services/integrations/linearIntegrationsService';
import type { IssueTracking, TrackedTicket, TicketVulnerability } from '@/server/hooks/useIssueTracking';

const P = '11111111-2222-4333-8444-555555555555';

const linearConfig = {
  isConfigured: true,
  teamId: 'team-1',
  teamKey: 'ENG',
  teamName: 'Engineering',
  linearProjectId: '',
  linearProjectName: '',
  labels: [],
  allowedBranches: [],
  autoCreateEnabled: false,
};

const vulnerabilities: TicketVulnerability[] = [
  { vulnerabilityId: 'v-1', scannerType: 'sast', severity: 'high', name: 'SQL injection', filePath: 'app.py', startLine: 17 },
  { vulnerabilityId: 'v-2', scannerType: 'sast', severity: 'critical', name: 'SQL injection', filePath: 'db.py', startLine: 3 },
];

const kan1: TrackedTicket = {
  provider: 'jira',
  key: 'KAN-1',
  url: 'https://acme.atlassian.net/browse/KAN-1',
  status: 'In Progress',
  statusCategory: 'indeterminate',
  priority: 'High',
  assignee: 'Ada Lovelace',
  container: 'KAN',
};
const eng7: TrackedTicket = {
  provider: 'linear',
  key: 'ENG-7',
  url: 'https://linear.app/acme/issue/ENG-7/sql-injection',
  status: 'Todo',
  statusCategory: 'new',
  container: 'ENG',
};

const trackingWith = (over: Partial<IssueTracking> = {}): IssueTracking => ({
  organizationId: 'org-1',
  ticketsByVulnerability: new Map(),
  jira: { configured: true, projectKey: 'KAN', allowedBranches: [] },
  linear: { connected: true, configured: true, config: linearConfig, allowedBranches: [] },
  anyConfigured: true,
  refresh: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const renderTracker = (tracking: IssueTracking) =>
  render(
    <TicketTracker
      tracking={tracking}
      projectId={P}
      groupName="SQL injection"
      occurrenceIds={['v-1', 'v-2']}
      vulnerabilities={vulnerabilities}
    />,
  );

const open = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('TicketTracker', () => {
  beforeEach(() => {
    vi.mocked(createJiraIssues).mockReset();
    vi.mocked(linkJiraIssue).mockReset();
    vi.mocked(linkLinearIssue).mockReset();
    vi.mocked(listLinearTeams).mockReset();
    vi.mocked(getLinearTeamOptions).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(listLinearTeams).mockResolvedValue([{ id: 'team-1', key: 'ENG', name: 'Engineering' }]);
    vi.mocked(getLinearTeamOptions).mockResolvedValue({ projects: [], labels: [], members: [] });
  });

  it('shows linked tickets of both tools with their logo', () => {
    renderTracker(
      trackingWith({
        ticketsByVulnerability: new Map([
          ['v-1', [kan1]],
          ['v-2', [eng7]],
        ]),
      }),
    );

    open(/KAN-1/);
    const dialog = screen.getByRole('dialog');

    const jiraRow = within(dialog).getByRole('link', { name: /KAN-1/ });
    expect(jiraRow).toHaveAttribute('href', kan1.url);
    expect(within(jiraRow).getByRole('img', { name: 'Jira' })).toHaveAttribute('src', '/image/integrations/jira.png');
    expect(within(jiraRow).getByText('In Progress')).toBeInTheDocument();
    expect(within(jiraRow).getByText(/Ada Lovelace/)).toBeInTheDocument();

    const linearRow = within(dialog).getByRole('link', { name: /ENG-7/ });
    expect(linearRow).toHaveAttribute('href', eng7.url);
    expect(within(linearRow).getByRole('img', { name: 'Linear' })).toHaveAttribute('src', '/image/integrations/linear.svg');
    expect(within(linearRow).getByText(/Unassigned/)).toBeInTheDocument();
  });

  it('offers only configured tools', () => {
    renderTracker(trackingWith({ jira: { configured: false, allowedBranches: [] } }));

    open(/linear/i);

    expect(screen.queryByRole('group', { name: 'Ticket tool' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Linear ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Jira ticket' })).not.toBeInTheDocument();
    expect(screen.getByText('2 occurrences without a Linear ticket')).toBeInTheDocument();
  });

  it('offers Linear when the organisation has it connected, even without project settings', async () => {
    renderTracker(
      trackingWith({
        jira: { configured: false, allowedBranches: [] },
        linear: { connected: true, configured: false, allowedBranches: [] },
      }),
    );

    open(/linear/i);
    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    // The form starts with no team: the project has none set.
    await waitFor(() => expect(listLinearTeams).toHaveBeenCalledWith('org-1'));
    expect(screen.getByLabelText('Team')).toHaveTextContent('Choose a team');
    expect(screen.getByText('Choose a team to create the ticket.')).toBeInTheDocument();
    const submit = screen.getAllByRole('button', { name: 'Create Linear ticket' }).at(-1);
    expect(submit).toBeDisabled();
    expect(getLinearTeamOptions).not.toHaveBeenCalled();
  });

  it('does not offer Linear when it is not connected, nor Jira without project settings', () => {
    const { container } = renderTracker(
      trackingWith({
        jira: { configured: false, allowedBranches: [] },
        linear: { connected: false, configured: false, allowedBranches: [] },
      }),
    );

    // Nothing to show and nothing to offer: no trigger at all.
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the tickets of a tool it cannot offer, without offering it', () => {
    renderTracker(
      trackingWith({
        ticketsByVulnerability: new Map([['v-2', [eng7]]]),
        jira: { configured: false, allowedBranches: [] },
        linear: { connected: false, configured: false, allowedBranches: [] },
      }),
    );

    open(/ENG-7/);

    expect(within(screen.getByRole('dialog')).getByRole('link', { name: /ENG-7/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Linear ticket' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link to an existing ticket' })).not.toBeInTheDocument();
  });

  it('lets the user choose the tool when both are configured', () => {
    renderTracker(trackingWith());

    open(/jira/i);
    const tools = screen.getByRole('group', { name: 'Ticket tool' });
    expect(screen.getByRole('button', { name: 'Create Jira ticket' })).toBeInTheDocument();

    fireEvent.click(within(tools).getByRole('button', { name: /Linear/ }));

    expect(screen.getByRole('button', { name: 'Create Linear ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Jira ticket' })).not.toBeInTheDocument();
  });

  it('creates a Jira ticket exactly as before', async () => {
    vi.mocked(createJiraIssues).mockResolvedValue({ success: true, issues: [{} as never], failedVulnerabilityIds: [] });
    const tracking = trackingWith({ ticketsByVulnerability: new Map([['v-2', [kan1]]]) });
    renderTracker(tracking);

    open(/KAN-1/);
    fireEvent.click(screen.getByRole('button', { name: 'Create Jira ticket' }));

    await waitFor(() => expect(createJiraIssues).toHaveBeenCalledTimes(1));
    // The payload the Jira-only tracker sent: the occurrences without a Jira ticket,
    // each with the AppSec page of its finding.
    expect(createJiraIssues).toHaveBeenCalledWith('org-1', P, {
      scanId: '',
      mode: 2,
      vulnerabilities: [
        { ...vulnerabilities[0], cybedefendUrl: `${window.location.origin}/appsec/project/${P}/sast/issue/v-1` },
      ],
      cybedefendBaseUrl: window.location.origin,
      jiraProjectKey: 'KAN',
    });
    await waitFor(() => expect(tracking.refresh).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Jira ticket created successfully');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the Linear form to create a Linear ticket', async () => {
    renderTracker(trackingWith({ jira: { configured: false, allowedBranches: [] } }));

    open(/linear/i);
    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    await waitFor(() => expect(listLinearTeams).toHaveBeenCalledWith('org-1'));
    expect(screen.getByLabelText('Team')).toBeInTheDocument();
    expect(createJiraIssues).not.toHaveBeenCalled();
  });

  it('links a Linear ticket by URL', async () => {
    vi.mocked(linkLinearIssue).mockResolvedValue({ success: true, issue: {} as never });
    const tracking = trackingWith({ jira: { configured: false, allowedBranches: [] } });
    renderTracker(tracking);

    open(/linear/i);
    fireEvent.click(screen.getByRole('button', { name: 'Link to an existing ticket' }));
    fireEvent.change(screen.getByLabelText('Linear identifier or link'), {
      target: { value: '  https://linear.app/acme/issue/ENG-42/fix-it  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Link ticket' }));

    await waitFor(() => expect(linkLinearIssue).toHaveBeenCalledTimes(1));
    expect(linkLinearIssue).toHaveBeenCalledWith('org-1', P, {
      issueRef: 'https://linear.app/acme/issue/ENG-42/fix-it',
      vulnerabilityIds: ['v-1', 'v-2'],
      scannerType: 'sast',
      vulnerabilities: [
        { vulnerabilityId: 'v-1', scannerType: 'sast', severity: 'high', name: 'SQL injection', filePath: 'app.py', startLine: 17 },
        { vulnerabilityId: 'v-2', scannerType: 'sast', severity: 'critical', name: 'SQL injection', filePath: 'db.py', startLine: 3 },
      ],
      cybedefendBaseUrl: window.location.origin,
    });
    await waitFor(() => expect(tracking.refresh).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Linked to the Linear ticket');
    expect(linkJiraIssue).not.toHaveBeenCalled();
  });

  it('links a Jira ticket by its key as before', async () => {
    vi.mocked(linkJiraIssue).mockResolvedValue({ success: true, issue: {} as never });
    const tracking = trackingWith({ linear: { connected: false, configured: false, allowedBranches: [] } });
    renderTracker(tracking);

    open(/jira/i);
    fireEvent.click(screen.getByRole('button', { name: 'Link to an existing ticket' }));
    fireEvent.change(screen.getByLabelText('Jira issue key'), { target: { value: 'kan-42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link ticket' }));

    await waitFor(() => expect(linkJiraIssue).toHaveBeenCalledTimes(1));
    expect(linkJiraIssue).toHaveBeenCalledWith('org-1', P, {
      jiraIssueKey: 'KAN-42',
      vulnerabilityIds: ['v-1', 'v-2'],
      scannerType: 'sast',
      vulnerabilities: [
        { vulnerabilityId: 'v-1', scannerType: 'sast', severity: 'high', name: 'SQL injection', filePath: 'app.py', startLine: 17 },
        { vulnerabilityId: 'v-2', scannerType: 'sast', severity: 'critical', name: 'SQL injection', filePath: 'db.py', startLine: 3 },
      ],
      cybedefendBaseUrl: window.location.origin,
    });
    await waitFor(() => expect(tracking.refresh).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Vulnerability linked to Jira ticket');
    expect(linkLinearIssue).not.toHaveBeenCalled();
  });

  it('shows the fixed sentence of a Linear refusal, never the server text, when a link is refused', async () => {
    vi.mocked(linkLinearIssue).mockRejectedValue({ response: { data: { message: 'LINEAR_ISSUE_NOT_FOUND' } } });
    const tracking = trackingWith({ jira: { configured: false, allowedBranches: [] } });
    renderTracker(tracking);

    open(/linear/i);
    fireEvent.click(screen.getByRole('button', { name: 'Link to an existing ticket' }));
    fireEvent.change(screen.getByLabelText('Linear identifier or link'), { target: { value: 'ENG-404' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link ticket' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This Linear ticket could not be found. Check the identifier or the link, then try again.',
      ),
    );
    expect(tracking.refresh).not.toHaveBeenCalled();
  });
});
