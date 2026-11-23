import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/api/gatewayAPI', () => ({ default: {} }));
vi.mock('@/server/services/integrations/linearIntegrationsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/integrations/linearIntegrationsService')>()),
  createLinearIssues: vi.fn(),
  listLinearTeams: vi.fn(),
  getLinearTeamOptions: vi.fn(),
}));

import { toast } from 'react-toastify';
import LinearTicketForm from './LinearTicketForm';
import {
  LINEAR_REFUSALS,
  createLinearIssues,
  getLinearTeamOptions,
  listLinearTeams,
  type LinearTeamOptions,
} from '@/server/services/integrations/linearIntegrationsService';
import type { IssueTracking, TicketVulnerability } from '@/server/hooks/useIssueTracking';
import refusals from '@/i18n/locales/en/components/linearRefusals.json';

const P = '11111111-2222-4333-8444-555555555555';

const linearConfig = {
  isConfigured: true,
  teamId: 'team-1',
  teamKey: 'ENG',
  teamName: 'Engineering',
  linearProjectId: 'lp-1',
  linearProjectName: 'Security',
  labels: [{ id: 'l-1', name: 'security' }],
  allowedBranches: [],
  autoCreateEnabled: false,
};

const OPTIONS: Record<string, LinearTeamOptions> = {
  'team-1': {
    projects: [
      { id: 'lp-1', name: 'Security' },
      { id: 'lp-2', name: 'Platform' },
    ],
    labels: [
      { id: 'l-1', name: 'security' },
      { id: 'l-2', name: 'bug' },
    ],
    members: [{ id: 'u-1', name: 'Grace Hopper', displayName: 'grace' }],
  },
  'team-2': {
    projects: [{ id: 'lp-9', name: 'Infra' }],
    labels: [{ id: 'l-9', name: 'ops' }],
    members: [{ id: 'u-9', name: 'Alan Turing', displayName: 'alan' }],
  },
};

const vulnerabilities: TicketVulnerability[] = [
  { vulnerabilityId: 'v-1', scannerType: 'sast', severity: 'high', name: 'SQL injection', filePath: 'app.py', startLine: 17 },
  { vulnerabilityId: 'v-2', scannerType: 'sast', severity: 'medium', name: 'SQL injection', filePath: 'db.py', startLine: 3 },
];

const tracking: IssueTracking = {
  organizationId: 'org-1',
  ticketsByVulnerability: new Map(),
  jira: { configured: false, allowedBranches: [] },
  linear: { connected: true, configured: true, config: linearConfig, allowedBranches: [] },
  anyConfigured: true,
  refresh: async () => undefined,
};

const renderForm = (onDone = vi.fn(), vulns = vulnerabilities) => {
  render(<LinearTicketForm tracking={tracking} projectId={P} vulnerabilities={vulns} onDone={onDone} />);
  return onDone;
};

/** The trigger of a Select, found by its label. */
const field = (label: string) => screen.getByLabelText(label);

/** Opens a single Select and picks one of its options. */
const pick = (label: string, option: string) => {
  fireEvent.click(field(label));
  fireEvent.click(screen.getByText(option));
};

/** The form once its team options are loaded. */
const loaded = async () => {
  await waitFor(() => expect(field('Project')).toHaveTextContent('Security'));
};

describe('LinearTicketForm', () => {
  beforeEach(() => {
    vi.mocked(createLinearIssues).mockReset();
    vi.mocked(listLinearTeams).mockReset();
    vi.mocked(getLinearTeamOptions).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(listLinearTeams).mockResolvedValue([
      { id: 'team-1', key: 'ENG', name: 'Engineering' },
      { id: 'team-2', key: 'OPS', name: 'Operations' },
    ]);
    vi.mocked(getLinearTeamOptions).mockImplementation(async (_org, teamId) => OPTIONS[teamId]);
  });

  it('prefills team, project and labels from the project config and priority from the severity', async () => {
    renderForm(vi.fn(), [
      ...vulnerabilities,
      { vulnerabilityId: 'v-3', scannerType: 'sast', severity: 'critical', name: 'SQL injection' },
    ]);

    await loaded();
    expect(getLinearTeamOptions).toHaveBeenCalledWith('org-1', 'team-1');
    expect(field('Team')).toHaveTextContent('Engineering (ENG)');
    expect(field('Labels')).toHaveTextContent('security');
    expect(field('Assignee')).toHaveTextContent('Unassigned');
    const priority = screen.getByRole('group', { name: 'Priority' });
    // The highest severity is critical: urgent.
    expect(within(priority).getByRole('button', { name: 'Urgent' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['critical', 'Urgent'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
    ['info', 'None'],
  ])('takes the priority of a %s finding from its severity', async (severity, label) => {
    renderForm(vi.fn(), [{ vulnerabilityId: 'v-1', scannerType: 'sast', severity, name: 'x' }]);
    await loaded();

    const priority = screen.getByRole('group', { name: 'Priority' });
    expect(within(priority).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('changing the team reloads its options and clears project, labels and assignee', async () => {
    renderForm();
    await loaded();
    pick('Assignee', 'Grace Hopper');
    expect(field('Assignee')).toHaveTextContent('Grace Hopper');

    pick('Team', 'Operations (OPS)');

    await waitFor(() => expect(getLinearTeamOptions).toHaveBeenCalledWith('org-1', 'team-2'));
    expect(field('Team')).toHaveTextContent('Operations (OPS)');
    expect(field('Project')).toHaveTextContent('No project');
    expect(field('Labels')).toHaveTextContent('No labels');
    expect(field('Assignee')).toHaveTextContent('Unassigned');

    // The new team's own options are offered.
    fireEvent.click(field('Project'));
    expect(screen.getByText('Infra')).toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('sends the per-ticket choices', async () => {
    vi.mocked(createLinearIssues).mockResolvedValue({ success: true, issues: [{} as never], failedVulnerabilityIds: [] });
    const onDone = renderForm();
    await loaded();

    pick('Project', 'Platform');
    fireEvent.click(field('Labels'));
    fireEvent.click(screen.getByLabelText('bug'));
    pick('Assignee', 'Grace Hopper');
    fireEvent.click(within(screen.getByRole('group', { name: 'Priority' })).getByRole('button', { name: 'Low' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    await waitFor(() => expect(createLinearIssues).toHaveBeenCalledTimes(1));
    expect(createLinearIssues).toHaveBeenCalledWith('org-1', P, {
      scanId: '',
      mode: 2,
      vulnerabilities: vulnerabilities.map((v) => ({
        ...v,
        cybedefendUrl: `${window.location.origin}/appsec/project/${P}/sast/issue/${v.vulnerabilityId}`,
      })),
      cybedefendBaseUrl: window.location.origin,
      teamId: 'team-1',
      linearProjectId: 'lp-2',
      labelIds: ['l-1', 'l-2'],
      assigneeId: 'u-1',
      priority: 4,
    });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Linear ticket created');
  });

  it('sends no project and no assignee when none is chosen', async () => {
    vi.mocked(createLinearIssues).mockResolvedValue({ success: true, issues: [{} as never], failedVulnerabilityIds: [] });
    renderForm();
    await loaded();

    pick('Project', 'No project');
    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    await waitFor(() => expect(createLinearIssues).toHaveBeenCalledTimes(1));
    const [, , payload] = vi.mocked(createLinearIssues).mock.calls[0];
    expect(payload.teamId).toBe('team-1');
    // The gateway refuses an empty id: an id not chosen is left out, never sent as "".
    expect(payload).not.toHaveProperty('linearProjectId');
    expect(payload).not.toHaveProperty('assigneeId');
    expect(payload.labelIds).toEqual(['l-1']);
    expect(payload.priority).toBe(2);
  });

  it('starts with no team when the project has no Linear settings, and creates nothing until one is chosen', async () => {
    vi.mocked(createLinearIssues).mockResolvedValue({ success: true, issues: [{} as never], failedVulnerabilityIds: [] });
    const onDone = vi.fn();
    render(
      <LinearTicketForm
        tracking={{ ...tracking, linear: { connected: true, configured: false, allowedBranches: [] } }}
        projectId={P}
        vulnerabilities={vulnerabilities}
        onDone={onDone}
      />,
    );

    await waitFor(() => expect(listLinearTeams).toHaveBeenCalledWith('org-1'));
    expect(field('Team')).toHaveTextContent('Choose a team');
    expect(field('Project')).toHaveTextContent('No project');
    expect(field('Labels')).toHaveTextContent('No labels');
    expect(screen.getByText('Choose a team to create the ticket.')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Create Linear ticket' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createLinearIssues).not.toHaveBeenCalled();
    expect(getLinearTeamOptions).not.toHaveBeenCalled();

    pick('Team', 'Engineering (ENG)');
    await waitFor(() => expect(getLinearTeamOptions).toHaveBeenCalledWith('org-1', 'team-1'));
    expect(screen.queryByText('Choose a team to create the ticket.')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(createLinearIssues).toHaveBeenCalledTimes(1));
    const [, , payload] = vi.mocked(createLinearIssues).mock.calls[0];
    // No project, assignee or label chosen: none of their keys is sent.
    expect(payload).toEqual({
      scanId: '',
      mode: 2,
      vulnerabilities: vulnerabilities.map((v) => ({
        ...v,
        cybedefendUrl: `${window.location.origin}/appsec/project/${P}/sast/issue/${v.vulnerabilityId}`,
      })),
      cybedefendBaseUrl: window.location.origin,
      teamId: 'team-1',
      priority: 2,
    });
    expect(payload).not.toHaveProperty('linearProjectId');
    expect(payload).not.toHaveProperty('assigneeId');
    expect(payload).not.toHaveProperty('labelIds');
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('says so when no ticket was created', async () => {
    vi.mocked(createLinearIssues).mockResolvedValue({ success: true, issues: [], failedVulnerabilityIds: ['v-1', 'v-2'] });
    const onDone = renderForm();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No Linear ticket was created. These occurrences may already be linked to an open Linear ticket.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each(LINEAR_REFUSALS)('shows a fixed sentence for each refusal (%s)', async (code) => {
    vi.mocked(createLinearIssues).mockRejectedValue({ response: { data: { message: code } } });
    const onDone = renderForm();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(refusals.components.linearRefusals[code]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a fixed sentence, never the server text, for any other failure', async () => {
    vi.mocked(createLinearIssues).mockRejectedValue({ response: { data: { message: 'Internal: token abc123 rejected' } } });
    renderForm();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Create Linear ticket' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Linear ticket could not be created. Try again.');
    expect(alert).not.toHaveTextContent('abc123');
  });

  it('shows the refusal of the teams read', async () => {
    vi.mocked(listLinearTeams).mockRejectedValue({ response: { data: { message: 'LINEAR_NEEDS_RECONNECT' } } });
    renderForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(refusals.components.linearRefusals.LINEAR_NEEDS_RECONNECT);
  });
});
